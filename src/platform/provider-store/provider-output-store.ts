/**
 * StableProviderOutputFile + ProviderOutputStore (design v58 §4.4; R40-01,
 * R41-01, R42-01, R43-01).
 *
 * The problem: when `output_path` is omitted, the renderer writes into the
 * invocation workdir and returns a relative name. Checking that pathname and then
 * renaming it is not enough — the provider child (or anything else with the same
 * uid) can swap the pathname between the check and the commit, so `rename` would
 * publish a different inode than the one that was validated.
 *
 * The committed identity is therefore anchored to an *open handle*:
 *
 *   1. open candidate A with `O_NOFOLLOW` and record its stable file id;
 *   2. keep that handle open across the rename into a private staging dir;
 *   3. after the rename, re-`lstat` the intake path and open a second no-follow
 *      handle; the pre-rename fstat, the post-rename lstat and the intake fstat
 *      must all report the same device+inode, so an A→B swap fails even when B is
 *      itself a perfectly stable regular file;
 *   4. read A exactly once, hashing and writing the destination from the same
 *      bytes, then `fstat(A)` again and never read A afterwards;
 *   5. re-read only the destination and require size+hash to equal that single
 *      stream, then fsync and publish `DELIVERED.json`.
 */

import { createHash } from 'node:crypto';
import {
  closeSync, constants as fsConstants, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync,
} from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';

export const PROVIDER_OUTPUT_STORE_DIRNAME = 'provider-outputs-v1';
export const DELIVERED_MANIFEST = 'DELIVERED.json';
export const MAX_DEFAULT_PROVIDER_OUTPUT_BYTES = 256 * 1024 * 1024;

export class InvalidProviderOutputError extends Error {
  readonly code = 'invalid_provider_output';

  constructor(detail: string) {
    super(`invalid_provider_output: ${detail}`);
    this.name = 'InvalidProviderOutputError';
  }
}

export interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

function identityOf(stat: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }): FileIdentity {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function sameInode(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function openNoFollowRead(path: string): number {
  // O_NOFOLLOW makes a symlink at the final component an error instead of a
  // silent redirect. Platforms without it must fail closed rather than degrade.
  const nofollow = fsConstants.O_NOFOLLOW;
  if (typeof nofollow !== 'number') {
    throw new InvalidProviderOutputError('platform lacks O_NOFOLLOW; refusing to promote');
  }
  return openSync(path, fsConstants.O_RDONLY | nofollow);
}

export interface DeliveredOutput {
  readonly outputId: string;
  readonly absolutePath: string;
  readonly size: number;
  readonly sha256: string;
}

export interface PromoteRequest {
  /** The exact workdir this invocation used; nothing outside it is accepted. */
  readonly invocationWorkDir: string;
  /** Path the backend reported, absolute or relative to the workdir. */
  readonly backendOutputPath: string;
  readonly providerName: string;
  readonly sourceDigest: string;
  readonly runtimeContractDigest?: string;
  readonly maxBytes?: number;
  /** Test seam: runs while A's handle is open, before the rename. */
  readonly onBeforeRename?: () => void;
  /** Test seam: runs after the rename, before the single read stream. */
  readonly onBeforeStream?: () => void;
  /** Test seam: runs after the first chunk has been read from A. */
  readonly onMidStream?: () => void;
}

export class ProviderOutputStore {
  constructor(private readonly configDir: string) {}

  private get root(): string {
    return join(this.configDir, PROVIDER_OUTPUT_STORE_DIRNAME);
  }

  /**
   * Promotes a scratch artifact into the durable store, returning the only path
   * callers may use afterwards.
   */
  promote(request: PromoteRequest): DeliveredOutput {
    const workDir = resolve(request.invocationWorkDir);
    const candidate = isAbsolute(request.backendOutputPath)
      ? resolve(request.backendOutputPath)
      : resolve(workDir, request.backendOutputPath);

    // Containment: the default-output path must stay inside this invocation.
    const rel = relative(workDir, candidate);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new InvalidProviderOutputError(`candidate escapes the invocation workdir: ${rel || '.'}`);
    }

    // Early rejection only; the authoritative checks happen on handles.
    const preStat = lstatSync(candidate, { throwIfNoEntry: false });
    if (!preStat) throw new InvalidProviderOutputError('candidate does not exist');
    if (preStat.isSymbolicLink()) throw new InvalidProviderOutputError('candidate is a symlink');
    if (preStat.isDirectory()) throw new InvalidProviderOutputError('candidate is a directory');
    if (!preStat.isFile()) throw new InvalidProviderOutputError('candidate is not a regular file');
    const maxBytes = request.maxBytes ?? MAX_DEFAULT_PROVIDER_OUTPUT_BYTES;
    if (preStat.size > maxBytes) {
      throw new InvalidProviderOutputError(`candidate exceeds ${maxBytes} bytes`);
    }

    const outputId = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`;
    const staging = join(this.root, request.providerName, `.staging-${outputId}`);
    mkdirSync(staging, { recursive: true, mode: 0o700 });

    // (1) Anchor the identity on an open handle before anything can move.
    const aFd = openNoFollowRead(candidate);
    let intakeFd: number | null = null;
    try {
      const aBefore = identityOf(fstatSync(aFd));
      if (fstatSync(aFd).nlink !== 1) {
        throw new InvalidProviderOutputError('candidate is a hardlink');
      }

      request.onBeforeRename?.();

      // (2)(3) Rename into staging, then prove the intake is the very same inode.
      const intake = join(staging, 'intake');
      renameSync(candidate, intake);
      const intakeLstat = lstatSync(intake);
      if (!intakeLstat.isFile()) throw new InvalidProviderOutputError('intake is not a regular file');
      if (intakeLstat.nlink !== 1) throw new InvalidProviderOutputError('intake is a hardlink');
      intakeFd = openNoFollowRead(intake);
      const intakeIdentity = identityOf(fstatSync(intakeFd));
      if (!sameInode(aBefore, identityOf(intakeLstat)) || !sameInode(aBefore, intakeIdentity)) {
        throw new InvalidProviderOutputError('intake inode differs from the validated candidate (A→B swap)');
      }

      // `rename` bumps the inode's ctime, so the stream-stability baseline is
      // taken *after* the move. The A→B protection above already used the
      // pre-rename identity, which rename cannot change (dev+ino are stable).
      const aStreamBaseline = identityOf(fstatSync(aFd));

      request.onBeforeStream?.();

      // (4) One sequential pass over A: hash and write the destination together.
      const destination = join(staging, 'delivered.bin');
      const destFd = openSync(destination, 'wx', 0o600);
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let streamSize = 0;
      let firstChunk = true;
      try {
        for (;;) {
          const read = readSync(aFd, buffer, 0, buffer.length, null);
          if (read === 0) break;
          const chunk = buffer.subarray(0, read);
          hash.update(chunk);
          writeSync(destFd, chunk);
          streamSize += read;
          if (streamSize > maxBytes) {
            throw new InvalidProviderOutputError(`candidate exceeds ${maxBytes} bytes mid-stream`);
          }
          if (firstChunk) {
            firstChunk = false;
            request.onMidStream?.();
          }
        }
        fsyncSync(destFd);
      } finally {
        closeSync(destFd);
      }
      const streamSha256 = hash.digest('hex');

      // A must not have changed while we streamed it, and is never read again.
      const aAfter = identityOf(fstatSync(aFd));
      if (!sameInode(aStreamBaseline, aAfter)
        || aAfter.size !== aStreamBaseline.size
        || aAfter.mtimeMs !== aStreamBaseline.mtimeMs
        || aAfter.ctimeMs !== aStreamBaseline.ctimeMs) {
        throw new InvalidProviderOutputError('candidate changed while it was being read');
      }
      if (streamSize !== aStreamBaseline.size) {
        throw new InvalidProviderOutputError('stream length disagrees with the validated size');
      }

      // (5) Re-read only the destination and require an exact match.
      const verifyFd = openNoFollowRead(destination);
      try {
        const verifyHash = createHash('sha256');
        let verifySize = 0;
        for (;;) {
          const read = readSync(verifyFd, buffer, 0, buffer.length, null);
          if (read === 0) break;
          verifyHash.update(buffer.subarray(0, read));
          verifySize += read;
        }
        if (verifySize !== streamSize || verifyHash.digest('hex') !== streamSha256) {
          throw new InvalidProviderOutputError('destination does not match the single source stream');
        }
      } finally {
        closeSync(verifyFd);
      }

      writeFileSync(join(staging, DELIVERED_MANIFEST), `${JSON.stringify({
        schema: 'xiaok-provider-delivered-output-v1',
        outputId,
        provider: request.providerName,
        sourceDigest: request.sourceDigest,
        ...(request.runtimeContractDigest ? { runtimeContractDigest: request.runtimeContractDigest } : {}),
        createdAt: new Date().toISOString(),
        fileName: 'delivered.bin',
        size: streamSize,
        sha256: streamSha256,
        sourceFileIdentity: aBefore,
        deliveredFileIdentity: identityOf(statSync(destination)),
        streamSize,
        streamSha256,
      }, null, 2)}\n`, { mode: 0o600 });

      const finalDir = join(this.root, request.providerName, outputId);
      renameSync(staging, finalDir);

      // Final re-open: the returned path must be readable and still match.
      const finalPath = join(finalDir, 'delivered.bin');
      const finalFd = openNoFollowRead(finalPath);
      try {
        const finalStat = fstatSync(finalFd);
        if (finalStat.size !== streamSize) {
          throw new InvalidProviderOutputError('delivered file changed during publication');
        }
      } finally {
        closeSync(finalFd);
      }

      return { outputId, absolutePath: finalPath, size: streamSize, sha256: streamSha256 };
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    } finally {
      if (intakeFd !== null) closeSync(intakeFd);
      closeSync(aFd);
    }
  }
}
