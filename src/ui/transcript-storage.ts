import {
  chmodSync,
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip, gunzipSync } from 'node:zlib';
import {
  PluginClaimLock,
  PluginLockBusyError,
  PluginLockFailClosedError,
  type PluginLockCapability,
} from '../platform/provider-store/plugin-claim-lock.js';
import {
  probeIdentityOrFailClosed,
  probeProcessIdentity,
} from '../platform/provider-store/process-identity.js';
import { getConfigDir } from '../utils/config.js';

const DEFAULT_ARCHIVE_AGE_DAYS = 7;
const MAX_SEGMENTS = 128;
const SESSION_ID = /^[A-Za-z0-9_-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MANIFEST_FILE = /^manifest-(\d{6})-([0-9a-f-]{36})\.json$/;
const SEGMENT_FILE = /^(\d{6})-([a-f0-9]{64})\.jsonl\.gz$/;

export type TranscriptArchivePhase =
  | 'afterSegmentPublished'
  | 'afterRawRenamed'
  | 'afterPendingVerified'
  | 'afterManifestCommitted';

export interface TranscriptArchiveOptions {
  rootDir?: string;
  olderThanDays?: number;
  now?: number;
  onPhase?: (phase: TranscriptArchivePhase) => void | Promise<void>;
}

export interface TranscriptArchiveResult {
  status: 'archived' | 'already_archived' | 'archived_pending_cleanup';
  sessionId: string;
  sourceBytes: number;
  compressedBytes: number;
  bytesFreed: number;
  segmentCount: number;
}

export class TranscriptStorageError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'TranscriptStorageError';
  }
}

export interface TranscriptLine {
  line: string;
  lineNumber: number;
  terminated: boolean;
}

export type TranscriptReadPhase = 'afterManifestResolved';

export interface TranscriptReadOptions {
  onPhase?: (phase: TranscriptReadPhase) => void | Promise<void>;
}

export interface TranscriptSealOperations {
  open(path: string, flags: string): number;
  fsync(fd: number): void;
  close(fd: number): void;
}

interface TranscriptPaths {
  rootDir: string;
  raw: string;
  archiveDir: string;
  claimsDir: string;
}

interface ManifestSegment {
  sequence: number;
  fileName: string;
  sourceBytes: number;
  sourceSha256: string;
  compressedBytes: number;
  archivedAt: string;
}

interface ArchiveManifest {
  version: 1;
  generation: number;
  sessionId: string;
  segments: ManifestSegment[];
}

interface ManifestState {
  manifest: ArchiveManifest;
  path: string;
}

interface PendingState {
  path: string;
  fileName: string;
  sequence: number;
  sha256: string;
}

interface SourceDescriptor {
  path: string;
  gzip: boolean;
  expectedBytes?: number;
  expectedSha256?: string;
}

interface OpenSource extends SourceDescriptor {
  fd: number;
}

interface SourceResolution {
  paths: TranscriptPaths;
  segments: ManifestSegment[];
}

interface DigestResult {
  bytes: number;
  sha256: string;
  stat: import('node:fs').BigIntStats;
}

export class TranscriptSessionLease {
  private released = false;

  constructor(
    private readonly lock: PluginClaimLock,
    private readonly capability: PluginLockCapability,
  ) {}

  close(): void {
    if (this.released) return;
    this.released = true;
    this.lock.release(this.capability);
  }
}

export function defaultTranscriptRoot(): string {
  return join(getConfigDir(), 'transcripts');
}

export function transcriptPaths(sessionId: string, rootDir = defaultTranscriptRoot()): TranscriptPaths {
  validateTranscriptSessionId(sessionId);
  const resolvedRoot = resolve(rootDir);
  const paths: TranscriptPaths = {
    rootDir: resolvedRoot,
    raw: join(resolvedRoot, `${sessionId}.jsonl`),
    archiveDir: join(resolvedRoot, `${sessionId}.archive`),
    claimsDir: join(resolvedRoot, `${sessionId}.claims`),
  };
  for (const path of [paths.raw, paths.archiveDir, paths.claimsDir]) {
    assertContained(resolvedRoot, path);
  }
  return paths;
}

export function validateTranscriptSessionId(sessionId: string): void {
  if (!SESSION_ID.test(sessionId) || sessionId === '.' || sessionId === '..' || sessionId.length > 200) {
    throw new TranscriptStorageError(
      'invalid_transcript_session_id',
      `invalid transcript session id: ${sessionId}`,
    );
  }
}

export async function acquireTranscriptLease(
  sessionId: string,
  rootDir = defaultTranscriptRoot(),
  acquireTimeoutMs = 10_000,
): Promise<TranscriptSessionLease> {
  const paths = transcriptPaths(sessionId, rootDir);
  mkdirSync(paths.rootDir, { recursive: true });
  const selfProbe = probeProcessIdentity(process.pid);
  if (selfProbe.kind !== 'alive') {
    throw new TranscriptStorageError(
      'transcript_lock_identity_unreadable',
      selfProbe.kind === 'unknown' ? selfProbe.diagnostic : 'current process identity not found',
    );
  }
  const lock = new PluginClaimLock({
    claimsDir: paths.claimsDir,
    acquireTimeoutMs,
    pollIntervalMs: 10,
    deps: {
      self: () => selfProbe.identity,
      probeIdentity: probeIdentityOrFailClosed,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
    },
  });
  try {
    return new TranscriptSessionLease(lock, await lock.acquire());
  } catch (error) {
    if (error instanceof PluginLockBusyError) {
      throw new TranscriptStorageError('transcript_busy', `session ${sessionId} is active`, { cause: error });
    }
    if (error instanceof PluginLockFailClosedError || isIdentityProbeError(error)) {
      throw new TranscriptStorageError(
        'transcript_lock_identity_unreadable',
        `cannot verify session claim owner for ${sessionId}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function prepareTranscriptWriter(sessionId: string, rootDir = defaultTranscriptRoot()): Promise<void> {
  const paths = transcriptPaths(sessionId, rootDir);
  const pending = listPending(paths, sessionId);
  const manifest = loadLatestManifest(paths, sessionId);
  if (pending.length > 1 || (pending.length === 1 && existsSync(paths.raw))) {
    throw new TranscriptStorageError('transcript_ambiguous_state', `ambiguous raw/pending state for ${sessionId}`);
  }
  if (pending.length === 1) {
    const item = pending[0];
    const latest = manifest?.manifest.segments.at(-1);
    if (latest && latest.sequence === item.sequence && latest.sourceSha256 === item.sha256) {
      await verifyCommittedPending(paths, sessionId, item, latest);
      deleteCommittedPending(item.path);
    } else {
      const expected = (manifest?.manifest.segments.length ?? 0) + 1;
      if (item.sequence !== expected) {
        throw new TranscriptStorageError('transcript_ambiguous_state', `unexpected pending sequence for ${sessionId}`);
      }
      const digest = await digestPlainFile(item.path, true);
      if (digest.sha256 !== item.sha256) {
        throw new TranscriptStorageError('transcript_pending_corrupt', `pending digest mismatch for ${sessionId}`);
      }
      try {
        renameSync(item.path, paths.raw);
      } catch (error) {
        throw mapBusyError(error, `cannot restore pending transcript ${sessionId}`);
      }
    }
  }
  if (existsSync(paths.raw)) chmodOwnerWritable(paths.raw);
}

export function sealTranscriptWriter(
  sessionId: string,
  rootDir = defaultTranscriptRoot(),
  operations: TranscriptSealOperations = {
    open: openSync,
    fsync: fsyncSync,
    close: closeSync,
  },
): void {
  const paths = transcriptPaths(sessionId, rootDir);
  if (!existsSync(paths.raw)) return;
  try {
    const fd = operations.open(paths.raw, 'r+');
    try {
      operations.fsync(fd);
    } finally {
      operations.close(fd);
    }
  } catch (error) {
    throw mapBusyError(error, `cannot seal transcript ${sessionId}`);
  }
  chmodOwnerReadOnly(paths.raw);
}

export function readTranscriptJsonValues(
  sessionId: string,
  rootDir = defaultTranscriptRoot(),
): unknown[] {
  const sources = openSourceSnapshot(sessionId, rootDir);
  const values: unknown[] = [];
  try {
    for (const source of sources) {
      const stored = readFileSync(source.fd);
      const bytes = source.gzip ? gunzipSync(stored) : stored;
      verifySourceDigest(source, bytes);
      for (const entry of parseBufferLines(bytes)) {
        if (!entry.line) continue;
        try {
          values.push(JSON.parse(entry.line));
        } catch (error) {
          throw new TranscriptStorageError(
            'transcript_invalid_json',
            `invalid transcript JSON at line ${entry.lineNumber}`,
            { cause: error },
          );
        }
      }
    }
  } finally {
    for (const source of sources) {
      try { closeSync(source.fd); } catch {}
    }
  }
  return values;
}

export async function* iterateTranscriptLines(
  sessionId: string,
  rootDir = defaultTranscriptRoot(),
  options: TranscriptReadOptions = {},
): AsyncGenerator<TranscriptLine> {
  const sources = await openSourceSnapshotAsync(sessionId, rootDir, options);
  let lineNumber = 0;
  try {
    for (const source of sources) {
      const hash = createHash('sha256');
      let bytes = 0;
      const decoder = new StringDecoder('utf8');
      let pending = '';
      const fileStream = Readable.from(readFdChunks(source.fd));
      const stream: Readable = source.gzip ? fileStream.pipe(createGunzip()) : fileStream;
      for await (const rawChunk of stream) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as string);
        hash.update(chunk);
        bytes += chunk.length;
        pending += decoder.write(chunk);
        while (true) {
          const newline = pending.indexOf('\n');
          if (newline < 0) break;
          lineNumber += 1;
          const rawLine = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          yield {
            line: rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine,
            lineNumber,
            terminated: true,
          };
        }
      }
      pending += decoder.end();
      if (pending.length > 0) {
        lineNumber += 1;
        yield {
          line: pending.endsWith('\r') ? pending.slice(0, -1) : pending,
          lineNumber,
          terminated: false,
        };
      }
      if (source.expectedBytes !== undefined && bytes !== source.expectedBytes) {
        throw new TranscriptStorageError('transcript_segment_mismatch', `segment byte count mismatch: ${basename(source.path)}`);
      }
      if (source.expectedSha256 !== undefined && hash.digest('hex') !== source.expectedSha256) {
        throw new TranscriptStorageError('transcript_segment_mismatch', `segment digest mismatch: ${basename(source.path)}`);
      }
    }
  } finally {
    for (const source of sources) {
      try { closeSync(source.fd); } catch {}
    }
  }
}

export async function archiveTranscript(
  sessionId: string,
  options: TranscriptArchiveOptions = {},
): Promise<TranscriptArchiveResult> {
  const rootDir = options.rootDir ?? defaultTranscriptRoot();
  const paths = transcriptPaths(sessionId, rootDir);
  const olderThanDays = options.olderThanDays ?? DEFAULT_ARCHIVE_AGE_DAYS;
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new TranscriptStorageError('invalid_archive_age', `olderThanDays must be a non-negative number`);
  }
  const lease = await acquireTranscriptLease(sessionId, rootDir, 250);
  try {
    mkdirSync(paths.rootDir, { recursive: true });
    const recovered = await recoverArchivePending(
      paths,
      sessionId,
      olderThanDays,
      options.now ?? Date.now(),
      options.onPhase,
    );
    if (recovered) return recovered;
    if (!existsSync(paths.raw)) {
      const manifest = loadLatestManifest(paths, sessionId);
      if (manifest) return alreadyArchivedResult(sessionId, manifest.manifest);
      throw new TranscriptStorageError('transcript_not_found', `transcript not found: ${sessionId}`);
    }
    assertOldEnough(paths.raw, olderThanDays, options.now ?? Date.now());
    const existingManifest = loadLatestManifest(paths, sessionId);
    if ((existingManifest?.manifest.segments.length ?? 0) >= MAX_SEGMENTS) {
      throw new TranscriptStorageError('transcript_segment_limit', `session ${sessionId} reached ${MAX_SEGMENTS} segments`);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await archiveRawAttempt(paths, sessionId, existingManifest, options.onPhase);
      if (result) return result;
    }
    throw new TranscriptStorageError('transcript_changed', `transcript kept changing during archive: ${sessionId}`);
  } finally {
    lease.close();
  }
}

async function archiveRawAttempt(
  paths: TranscriptPaths,
  sessionId: string,
  manifestState: ManifestState | null,
  onPhase?: TranscriptArchiveOptions['onPhase'],
): Promise<TranscriptArchiveResult | null> {
  chmodOwnerReadOnly(paths.raw);
  mkdirSync(paths.archiveDir, { recursive: true });
  const sequence = (manifestState?.manifest.segments.length ?? 0) + 1;
  const generation = (manifestState?.manifest.generation ?? 0) + 1;
  const tempPath = join(paths.archiveDir, `.segment-${randomUUID()}.tmp`);
  let retainedFd: number | null = null;
  let pendingPath: string | null = null;
  let manifestTemp: string | null = null;
  try {
    retainedFd = openSync(paths.raw, 'r');
    const initialIdentity = fstatSync(retainedFd, { bigint: true });
    const digest = await gzipAndValidateFd(retainedFd, paths.raw, tempPath);
    fsyncFile(tempPath);
    await verifyGzipFile(tempPath, digest.sha256, digest.bytes);
    const segmentName = `${padSequence(sequence)}-${digest.sha256}.jsonl.gz`;
    const segmentPath = join(paths.archiveDir, segmentName);
    if (existsSync(segmentPath)) {
      await verifyGzipFile(segmentPath, digest.sha256, digest.bytes);
      safeUnlink(tempPath);
    } else {
      try {
        renameSync(tempPath, segmentPath);
      } catch (error) {
        throw mapBusyError(error, `cannot publish transcript segment ${segmentName}`);
      }
    }
    chmodOwnerReadOnly(segmentPath);
    await onPhase?.('afterSegmentPublished');

    pendingPath = join(paths.rootDir, `${sessionId}.pending-${padSequence(sequence)}-${digest.sha256}.jsonl`);
    try {
      renameSync(paths.raw, pendingPath);
    } catch (error) {
      throw mapBusyError(error, `cannot freeze transcript ${sessionId}`);
    }
    await onPhase?.('afterRawRenamed');

    const pendingDigest = await digestPlainFile(pendingPath, true);
    const pendingIdentity = statSync(pendingPath, { bigint: true });
    if (
      initialIdentity.dev !== pendingIdentity.dev
      || initialIdentity.ino !== pendingIdentity.ino
      || pendingDigest.sha256 !== digest.sha256
      || pendingDigest.bytes !== digest.bytes
    ) {
      restorePendingAfterChange(paths, pendingPath);
      pendingPath = null;
      return null;
    }
    await onPhase?.('afterPendingVerified');

    const segment: ManifestSegment = {
      sequence,
      fileName: segmentName,
      sourceBytes: digest.bytes,
      sourceSha256: digest.sha256,
      compressedBytes: statSync(segmentPath).size,
      archivedAt: new Date().toISOString(),
    };
    const manifest: ArchiveManifest = {
      version: 1,
      generation,
      sessionId,
      segments: [...(manifestState?.manifest.segments ?? []), segment],
    };
    manifestTemp = join(paths.archiveDir, `.manifest-${randomUUID()}.tmp`);
    writeNewFileSynced(manifestTemp, `${JSON.stringify(manifest)}\n`);

    const finalStat = fstatSync(retainedFd, { bigint: true });
    if (
      finalStat.size !== pendingDigest.stat.size
      || finalStat.mtimeNs !== pendingDigest.stat.mtimeNs
      || finalStat.ctimeNs !== pendingDigest.stat.ctimeNs
    ) {
      safeUnlink(manifestTemp);
      manifestTemp = null;
      restorePendingAfterChange(paths, pendingPath);
      pendingPath = null;
      return null;
    }
    if (findManifestFiles(paths.archiveDir).some((item) => item.generation === generation)) {
      throw new TranscriptStorageError('transcript_manifest_conflict', `manifest generation ${generation} already exists`);
    }
    const manifestPath = join(paths.archiveDir, `manifest-${padSequence(generation)}-${randomUUID()}.json`);
    if (existsSync(manifestPath)) {
      throw new TranscriptStorageError('transcript_manifest_conflict', `manifest target already exists: ${basename(manifestPath)}`);
    }
    try {
      renameSync(manifestTemp, manifestPath);
    } catch (error) {
      throw mapBusyError(error, `cannot publish transcript manifest ${basename(manifestPath)}`);
    }
    manifestTemp = null;
    fsyncDirectory(paths.archiveDir);
    const committed = loadLatestManifest(paths, sessionId);
    if (!committed || committed.path !== manifestPath) {
      throw new TranscriptStorageError('transcript_manifest_commit_failed', `manifest verification failed for ${sessionId}`);
    }
    await onPhase?.('afterManifestCommitted');

    try {
      deleteCommittedPending(pendingPath);
      pendingPath = null;
    } catch (error) {
      if (error instanceof TranscriptStorageError && error.code === 'transcript_busy') {
        return {
          status: 'archived_pending_cleanup',
          sessionId,
          sourceBytes: segment.sourceBytes,
          compressedBytes: segment.compressedBytes,
          bytesFreed: 0,
          segmentCount: manifest.segments.length,
        };
      }
      throw error;
    }
    return {
      status: 'archived',
      sessionId,
      sourceBytes: segment.sourceBytes,
      compressedBytes: segment.compressedBytes,
      bytesFreed: Math.max(0, segment.sourceBytes - segment.compressedBytes),
      segmentCount: manifest.segments.length,
    };
  } finally {
    if (retainedFd !== null) {
      try { closeSync(retainedFd); } catch {}
    }
    if (manifestTemp) safeUnlink(manifestTemp);
    if (existsSync(tempPath)) safeUnlink(tempPath);
  }
}

async function recoverArchivePending(
  paths: TranscriptPaths,
  sessionId: string,
  olderThanDays: number,
  now: number,
  onPhase?: TranscriptArchiveOptions['onPhase'],
): Promise<TranscriptArchiveResult | null> {
  const pending = listPending(paths, sessionId);
  const manifest = loadLatestManifest(paths, sessionId);
  if (pending.length > 1 || (pending.length === 1 && existsSync(paths.raw))) {
    throw new TranscriptStorageError('transcript_ambiguous_state', `ambiguous raw/pending state for ${sessionId}`);
  }
  if (pending.length === 0) return null;
  const item = pending[0];
  assertOldEnough(item.path, olderThanDays, now);
  const latest = manifest?.manifest.segments.at(-1);
  if (latest && latest.sequence === item.sequence && latest.sourceSha256 === item.sha256) {
    await verifyCommittedPending(paths, sessionId, item, latest);
    deleteCommittedPending(item.path);
    return alreadyArchivedResult(sessionId, manifest!.manifest);
  }
  const expected = (manifest?.manifest.segments.length ?? 0) + 1;
  if (item.sequence !== expected) {
    throw new TranscriptStorageError('transcript_ambiguous_state', `unexpected pending sequence for ${sessionId}`);
  }
  let retainedFd: number | null = null;
  try {
    retainedFd = openSync(item.path, 'r');
    const initialIdentity = fstatSync(retainedFd, { bigint: true });
    const digest = await digestPlainFile(item.path, true);
    if (
      initialIdentity.dev !== digest.stat.dev
      || initialIdentity.ino !== digest.stat.ino
      || digest.sha256 !== item.sha256
    ) {
      throw new TranscriptStorageError('transcript_pending_corrupt', `pending digest mismatch for ${sessionId}`);
    }
    const segmentName = `${padSequence(item.sequence)}-${item.sha256}.jsonl.gz`;
    const segmentPath = join(paths.archiveDir, segmentName);
    if (existsSync(segmentPath)) {
      try {
        await verifyGzipFile(segmentPath, digest.sha256, digest.bytes);
        chmodOwnerReadOnly(segmentPath);
        await onPhase?.('afterPendingVerified');
        const finalStat = fstatSync(retainedFd, { bigint: true });
        if (
          finalStat.size !== digest.stat.size
          || finalStat.mtimeNs !== digest.stat.mtimeNs
          || finalStat.ctimeNs !== digest.stat.ctimeNs
        ) {
          restorePendingAfterChange(paths, item.path);
          return null;
        }
        return await commitRecoveredPending(
          paths,
          sessionId,
          item,
          manifest,
          segmentName,
          digest.bytes,
          onPhase,
        );
      } catch (error) {
        if (!(error instanceof TranscriptStorageError) || error.code !== 'transcript_segment_corrupt') {
          throw error;
        }
        deleteUntrustedOrphanSegment(segmentPath);
      }
    }
  } finally {
    if (retainedFd !== null) {
      try { closeSync(retainedFd); } catch {}
    }
  }
  try {
    renameSync(item.path, paths.raw);
  } catch (error) {
    throw mapBusyError(error, `cannot restore archive transaction ${sessionId}`);
  }
  return null;
}

async function commitRecoveredPending(
  paths: TranscriptPaths,
  sessionId: string,
  item: PendingState,
  manifestState: ManifestState | null,
  segmentName: string,
  sourceBytes: number,
  onPhase?: TranscriptArchiveOptions['onPhase'],
): Promise<TranscriptArchiveResult> {
  const generation = (manifestState?.manifest.generation ?? 0) + 1;
  const segment: ManifestSegment = {
    sequence: item.sequence,
    fileName: segmentName,
    sourceBytes,
    sourceSha256: item.sha256,
    compressedBytes: statSync(join(paths.archiveDir, segmentName)).size,
    archivedAt: new Date().toISOString(),
  };
  const manifest: ArchiveManifest = {
    version: 1,
    generation,
    sessionId,
    segments: [...(manifestState?.manifest.segments ?? []), segment],
  };
  if (findManifestFiles(paths.archiveDir).some((entry) => entry.generation === generation)) {
    throw new TranscriptStorageError('transcript_manifest_conflict', `manifest generation ${generation} already exists`);
  }
  const temp = join(paths.archiveDir, `.manifest-${randomUUID()}.tmp`);
  const target = join(paths.archiveDir, `manifest-${padSequence(generation)}-${randomUUID()}.json`);
  try {
    writeNewFileSynced(temp, `${JSON.stringify(manifest)}\n`);
    if (existsSync(target)) {
      throw new TranscriptStorageError('transcript_manifest_conflict', `manifest target already exists: ${basename(target)}`);
    }
    try {
      renameSync(temp, target);
    } catch (error) {
      throw mapBusyError(error, `cannot publish transcript manifest ${basename(target)}`);
    }
    fsyncDirectory(paths.archiveDir);
    const committed = loadLatestManifest(paths, sessionId);
    if (!committed || committed.path !== target) {
      throw new TranscriptStorageError('transcript_manifest_commit_failed', `manifest verification failed for ${sessionId}`);
    }
    await onPhase?.('afterManifestCommitted');
  } finally {
    if (existsSync(temp)) safeUnlink(temp);
  }
  try {
    deleteCommittedPending(item.path);
  } catch (error) {
    if (error instanceof TranscriptStorageError && error.code === 'transcript_busy') {
      return {
        status: 'archived_pending_cleanup',
        sessionId,
        sourceBytes,
        compressedBytes: segment.compressedBytes,
        bytesFreed: 0,
        segmentCount: manifest.segments.length,
      };
    }
    throw error;
  }
  return {
    status: 'archived',
    sessionId,
    sourceBytes,
    compressedBytes: segment.compressedBytes,
    bytesFreed: Math.max(0, sourceBytes - segment.compressedBytes),
    segmentCount: manifest.segments.length,
  };
}

function alreadyArchivedResult(sessionId: string, manifest: ArchiveManifest): TranscriptArchiveResult {
  const latest = manifest.segments.at(-1);
  return {
    status: 'already_archived',
    sessionId,
    sourceBytes: latest?.sourceBytes ?? 0,
    compressedBytes: latest?.compressedBytes ?? 0,
    bytesFreed: 0,
    segmentCount: manifest.segments.length,
  };
}

function beginSourceResolution(sessionId: string, rootDir: string): SourceResolution {
  const paths = transcriptPaths(sessionId, rootDir);
  const manifest = loadLatestManifest(paths, sessionId);
  const segments = manifest?.manifest.segments ?? [];
  if (segments.length > MAX_SEGMENTS) {
    throw new TranscriptStorageError('transcript_segment_limit', `session ${sessionId} exceeds ${MAX_SEGMENTS} segments`);
  }
  return { paths, segments };
}

function finishSourceResolution(
  sessionId: string,
  resolution: SourceResolution,
): SourceDescriptor[] {
  const { paths, segments } = resolution;
  const pending = listPending(paths, sessionId);
  if (pending.length > 1 || (pending.length === 1 && existsSync(paths.raw))) {
    throw new TranscriptStorageError('transcript_ambiguous_state', `ambiguous raw/pending state for ${sessionId}`);
  }
  const sources: SourceDescriptor[] = segments.map((segment) => ({
    path: join(paths.archiveDir, segment.fileName),
    gzip: true,
    expectedBytes: segment.sourceBytes,
    expectedSha256: segment.sourceSha256,
  }));
  if (pending.length === 1) {
    const item = pending[0];
    const latest = segments.at(-1);
    const committed = latest?.sequence === item.sequence && latest.sourceSha256 === item.sha256;
    if (!committed) {
      const expected = segments.length + 1;
      if (item.sequence !== expected) {
        throw new TranscriptStorageError('transcript_ambiguous_state', `unexpected pending sequence for ${sessionId}`);
      }
      sources.push({ path: item.path, gzip: false });
    }
  } else if (existsSync(paths.raw)) {
    sources.push({ path: paths.raw, gzip: false });
  }
  if (sources.length === 0) {
    throw new TranscriptStorageError('transcript_not_found', `transcript not found: ${sessionId}`);
  }
  return sources;
}

function openSourceSnapshot(sessionId: string, rootDir: string): OpenSource[] {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let opened: OpenSource[] = [];
    try {
      const before = finishSourceResolution(sessionId, beginSourceResolution(sessionId, rootDir));
      opened = openSourcePlan(before);
      const after = finishSourceResolution(sessionId, beginSourceResolution(sessionId, rootDir));
      if (sourcePlansEqual(before, after)) return opened;
    } catch (error) {
      closeSourcePlan(opened);
      if (attempt === 0 && isRetryableSnapshotError(error)) continue;
      throw error;
    }
    closeSourcePlan(opened);
  }
  throw new TranscriptStorageError('transcript_snapshot_unstable', `cannot snapshot transcript ${sessionId}`);
}

async function openSourceSnapshotAsync(
  sessionId: string,
  rootDir: string,
  options: TranscriptReadOptions,
): Promise<OpenSource[]> {
  let phaseInjected = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let opened: OpenSource[] = [];
    try {
      const resolution = beginSourceResolution(sessionId, rootDir);
      if (!phaseInjected && options.onPhase) {
        phaseInjected = true;
        await options.onPhase('afterManifestResolved');
      }
      const before = finishSourceResolution(sessionId, resolution);
      opened = openSourcePlan(before);
      const after = finishSourceResolution(sessionId, beginSourceResolution(sessionId, rootDir));
      if (sourcePlansEqual(before, after)) return opened;
    } catch (error) {
      closeSourcePlan(opened);
      if (attempt === 0 && isRetryableSnapshotError(error)) continue;
      throw error;
    }
    closeSourcePlan(opened);
  }
  throw new TranscriptStorageError('transcript_snapshot_unstable', `cannot snapshot transcript ${sessionId}`);
}

function openSourcePlan(sources: SourceDescriptor[]): OpenSource[] {
  const opened: OpenSource[] = [];
  try {
    for (const source of sources) opened.push({ ...source, fd: openSync(source.path, 'r') });
    return opened;
  } catch (error) {
    closeSourcePlan(opened);
    throw error;
  }
}

function closeSourcePlan(sources: OpenSource[]): void {
  for (const source of sources) {
    try { closeSync(source.fd); } catch {}
  }
}

function sourcePlansEqual(left: SourceDescriptor[], right: SourceDescriptor[]): boolean {
  return left.length === right.length && left.every((source, index) => {
    const other = right[index];
    return source.path === other.path
      && source.gzip === other.gzip
      && source.expectedBytes === other.expectedBytes
      && source.expectedSha256 === other.expectedSha256;
  });
}

function isRetryableSnapshotError(error: unknown): boolean {
  return isErrno(error, 'ENOENT') || (
    error instanceof TranscriptStorageError
    && (error.code === 'transcript_ambiguous_state' || error.code === 'transcript_not_found')
  );
}

function loadLatestManifest(paths: TranscriptPaths, sessionId: string): ManifestState | null {
  if (!existsSync(paths.archiveDir)) return null;
  const files = findManifestFiles(paths.archiveDir);
  if (files.length === 0) return null;
  const byGeneration = new Map<number, string[]>();
  for (const item of files) {
    const bucket = byGeneration.get(item.generation) ?? [];
    bucket.push(item.path);
    byGeneration.set(item.generation, bucket);
  }
  const maxGeneration = Math.max(...byGeneration.keys());
  let previous: ArchiveManifest | null = null;
  let latestPath = '';
  let latestManifest: ArchiveManifest | null = null;
  for (let generation = 1; generation <= maxGeneration; generation += 1) {
    const bucket = byGeneration.get(generation);
    if (!bucket || bucket.length !== 1) {
      throw new TranscriptStorageError('transcript_manifest_conflict', `manifest generation ${generation} is missing or duplicated`);
    }
    const manifest = parseManifest(bucket[0], sessionId, paths.archiveDir);
    if (manifest.generation !== generation) {
      throw new TranscriptStorageError('transcript_manifest_invalid', `manifest generation mismatch: ${basename(bucket[0])}`);
    }
    if (previous && !manifestExtends(previous, manifest)) {
      throw new TranscriptStorageError('transcript_manifest_conflict', `manifest generation ${generation} does not preserve its predecessor`);
    }
    previous = manifest;
    latestPath = bucket[0];
    latestManifest = manifest;
  }
  return { path: latestPath, manifest: latestManifest! };
}

function manifestExtends(previous: ArchiveManifest, current: ArchiveManifest): boolean {
  if (current.segments.length !== previous.segments.length + 1) return false;
  return previous.segments.every((segment, index) => segmentEquals(segment, current.segments[index]));
}

function segmentEquals(left: ManifestSegment, right: ManifestSegment): boolean {
  return left.sequence === right.sequence
    && left.fileName === right.fileName
    && left.sourceBytes === right.sourceBytes
    && left.sourceSha256 === right.sourceSha256
    && left.compressedBytes === right.compressedBytes
    && left.archivedAt === right.archivedAt;
}

function findManifestFiles(archiveDir: string): Array<{ generation: number; path: string }> {
  if (!existsSync(archiveDir)) return [];
  const found: Array<{ generation: number; path: string }> = [];
  for (const fileName of readdirSync(archiveDir)) {
    if (fileName.startsWith('manifest-') && fileName.endsWith('.json')) {
      const match = MANIFEST_FILE.exec(fileName);
      if (!match) {
        throw new TranscriptStorageError('transcript_manifest_invalid', `invalid manifest filename: ${fileName}`);
      }
      found.push({ generation: Number(match[1]), path: join(archiveDir, fileName) });
    }
  }
  return found.sort((left, right) => left.generation - right.generation || left.path.localeCompare(right.path));
}

function parseManifest(path: string, sessionId: string, archiveDir: string): ArchiveManifest {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new TranscriptStorageError('transcript_manifest_invalid', `cannot parse manifest ${basename(path)}`, { cause: error });
  }
  if (!isRecord(value) || value.version !== 1 || value.sessionId !== sessionId || !Number.isSafeInteger(value.generation) || !Array.isArray(value.segments)) {
    throw new TranscriptStorageError('transcript_manifest_invalid', `invalid manifest schema: ${basename(path)}`);
  }
  const segments: ManifestSegment[] = value.segments.map((segment, index) => {
    if (!isRecord(segment)) throw new TranscriptStorageError('transcript_manifest_invalid', `invalid segment schema`);
    const sequence = index + 1;
    if (
      segment.sequence !== sequence
      || typeof segment.fileName !== 'string'
      || typeof segment.sourceBytes !== 'number'
      || !Number.isSafeInteger(segment.sourceBytes)
      || segment.sourceBytes < 0
      || typeof segment.sourceSha256 !== 'string'
      || !SHA256.test(segment.sourceSha256)
      || typeof segment.compressedBytes !== 'number'
      || !Number.isSafeInteger(segment.compressedBytes)
      || segment.compressedBytes < 0
      || typeof segment.archivedAt !== 'string'
    ) {
      throw new TranscriptStorageError('transcript_manifest_invalid', `invalid segment ${sequence}`);
    }
    const expectedName = `${padSequence(sequence)}-${segment.sourceSha256}.jsonl.gz`;
    if (basename(segment.fileName) !== segment.fileName || segment.fileName !== expectedName) {
      throw new TranscriptStorageError('transcript_manifest_invalid', `invalid segment path ${segment.fileName}`);
    }
    const segmentPath = join(archiveDir, segment.fileName);
    assertContained(archiveDir, segmentPath);
    if (!existsSync(segmentPath)) {
      throw new TranscriptStorageError('transcript_segment_missing', `missing segment ${segment.fileName}`);
    }
    return segment as unknown as ManifestSegment;
  });
  if (value.generation !== segments.length || segments.length > MAX_SEGMENTS) {
    throw new TranscriptStorageError('transcript_manifest_invalid', `manifest generation/segment count mismatch`);
  }
  return { version: 1, generation: value.generation as number, sessionId, segments };
}

function listPending(paths: TranscriptPaths, sessionId: string): PendingState[] {
  if (!existsSync(paths.rootDir)) return [];
  const prefix = `${sessionId}.pending-`;
  const pending: PendingState[] = [];
  for (const fileName of readdirSync(paths.rootDir)) {
    if (!fileName.startsWith(prefix) || !fileName.endsWith('.jsonl')) continue;
    const suffix = fileName.slice(prefix.length, -'.jsonl'.length);
    const match = /^(\d{6})-([a-f0-9]{64})$/.exec(suffix);
    if (!match) {
      throw new TranscriptStorageError('transcript_ambiguous_state', `invalid pending filename: ${fileName}`);
    }
    const path = join(paths.rootDir, fileName);
    assertContained(paths.rootDir, path);
    pending.push({ path, fileName, sequence: Number(match[1]), sha256: match[2] });
  }
  return pending.sort((left, right) => left.sequence - right.sequence || left.fileName.localeCompare(right.fileName));
}

async function gzipAndValidateFd(fd: number, displayPath: string, tempPath: string): Promise<DigestResult> {
  const hash = createHash('sha256');
  let bytes = 0;
  const validator = new JsonlValidator(displayPath);
  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buffer);
        bytes += buffer.length;
        validator.push(buffer);
        callback(null, buffer);
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        validator.finish();
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  await pipeline(
    Readable.from(readFdChunks(fd)),
    inspect,
    createGzip({ level: 6 }),
    createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }),
  );
  return { bytes, sha256: hash.digest('hex'), stat: fstatSync(fd, { bigint: true }) };
}

async function verifyGzipFile(path: string, expectedSha256: string, expectedBytes: number): Promise<void> {
  const hash = createHash('sha256');
  let bytes = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.length;
      callback();
    },
  });
  try {
    await pipeline(createReadStream(path), createGunzip(), sink);
  } catch (error) {
    throw new TranscriptStorageError('transcript_segment_corrupt', `cannot gunzip ${basename(path)}`, { cause: error });
  }
  if (bytes !== expectedBytes || hash.digest('hex') !== expectedSha256) {
    throw new TranscriptStorageError('transcript_segment_mismatch', `segment mismatch ${basename(path)}`);
  }
}

async function verifyCommittedPending(
  paths: TranscriptPaths,
  sessionId: string,
  pending: PendingState,
  segment: ManifestSegment,
): Promise<void> {
  const digest = await digestPlainFile(pending.path, true);
  if (digest.sha256 !== pending.sha256 || digest.bytes !== segment.sourceBytes) {
    throw new TranscriptStorageError('transcript_pending_corrupt', `committed pending mismatch for ${sessionId}`);
  }
  await verifyGzipFile(
    join(paths.archiveDir, segment.fileName),
    segment.sourceSha256,
    segment.sourceBytes,
  );
}

async function digestPlainFile(path: string, validateJson: boolean): Promise<DigestResult> {
  const fd = openSync(path, 'r');
  const hash = createHash('sha256');
  let bytes = 0;
  const validator = validateJson ? new JsonlValidator(path) : null;
  try {
    for (const chunk of readFdChunks(fd)) {
      hash.update(chunk);
      bytes += chunk.length;
      validator?.push(chunk);
    }
    validator?.finish();
    return { bytes, sha256: hash.digest('hex'), stat: fstatSync(fd, { bigint: true }) };
  } finally {
    closeSync(fd);
  }
}

function* readFdChunks(fd: number): Generator<Buffer> {
  let position = 0;
  for (;;) {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
    if (bytesRead === 0) return;
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}

class JsonlValidator {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private lineNumber = 0;

  constructor(private readonly displayPath: string) {}

  push(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk);
    while (true) {
      const newline = this.pending.indexOf('\n');
      if (newline < 0) break;
      this.lineNumber += 1;
      const line = stripCarriageReturn(this.pending.slice(0, newline));
      this.pending = this.pending.slice(newline + 1);
      this.parseLine(line, true);
    }
  }

  finish(): void {
    this.pending += this.decoder.end();
    if (!this.pending) return;
    this.lineNumber += 1;
    this.parseLine(stripCarriageReturn(this.pending), false);
  }

  private parseLine(line: string, terminated: boolean): void {
    if (!line) return;
    try {
      JSON.parse(line);
    } catch (error) {
      const code = !terminated && isIncompleteJsonTail(line)
        ? 'transcript_incomplete_tail'
        : 'transcript_invalid_json';
      throw new TranscriptStorageError(code, `${this.displayPath}: invalid JSON at line ${this.lineNumber}`, { cause: error });
    }
  }
}

function* parseBufferLines(bytes: Buffer): Generator<TranscriptLine> {
  const text = bytes.toString('utf8');
  const parts = text.split('\n');
  const lastTerminated = text.endsWith('\n');
  for (let index = 0; index < parts.length; index += 1) {
    if (index === parts.length - 1 && parts[index] === '' && lastTerminated) continue;
    yield {
      line: stripCarriageReturn(parts[index]),
      lineNumber: index + 1,
      terminated: index < parts.length - 1 || lastTerminated,
    };
  }
}

function verifySourceDigest(source: SourceDescriptor, bytes: Buffer): void {
  if (source.expectedBytes !== undefined && bytes.length !== source.expectedBytes) {
    throw new TranscriptStorageError('transcript_segment_mismatch', `segment byte count mismatch: ${basename(source.path)}`);
  }
  if (source.expectedSha256 !== undefined) {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== source.expectedSha256) {
      throw new TranscriptStorageError('transcript_segment_mismatch', `segment digest mismatch: ${basename(source.path)}`);
    }
  }
}

function restorePendingAfterChange(paths: TranscriptPaths, pendingPath: string): void {
  if (existsSync(paths.raw)) {
    throw new TranscriptStorageError('transcript_ambiguous_state', `raw was recreated while archiving ${basename(paths.raw)}`);
  }
  try {
    renameSync(pendingPath, paths.raw);
    chmodOwnerReadOnly(paths.raw);
  } catch (error) {
    throw mapBusyError(error, `cannot restore changed transcript ${basename(paths.raw)}`);
  }
}

function deleteCommittedPending(path: string): void {
  chmodOwnerWritable(path);
  try {
    unlinkSync(path);
  } catch (error) {
    try { chmodOwnerReadOnly(path); } catch {}
    throw mapBusyError(error, `cannot delete committed pending ${basename(path)}`);
  }
}

function deleteUntrustedOrphanSegment(path: string): void {
  chmodOwnerWritable(path);
  try {
    unlinkSync(path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    try { chmodOwnerReadOnly(path); } catch {}
    throw mapBusyError(error, `cannot remove corrupt orphan segment ${basename(path)}`);
  }
}

function writeNewFileSynced(path: string, content: string): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncFile(path: string): void {
  const fd = openSync(path, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function fsyncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } catch (error) {
    if (!isErrno(error, 'EINVAL') && !isErrno(error, 'EPERM')) throw error;
  } finally {
    closeSync(fd);
  }
}

function chmodOwnerWritable(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    throw mapBusyError(error, `cannot make transcript writable: ${basename(path)}`);
  }
}

function chmodOwnerReadOnly(path: string): void {
  try {
    chmodSync(path, 0o400);
  } catch (error) {
    throw mapBusyError(error, `cannot make transcript read-only: ${basename(path)}`);
  }
}

function assertOldEnough(path: string, olderThanDays: number, now: number): void {
  const requiredMs = olderThanDays * 24 * 60 * 60 * 1000;
  if (requiredMs === 0) return;
  const ageMs = now - statSync(path).mtimeMs;
  if (ageMs < requiredMs) {
    throw new TranscriptStorageError('transcript_too_recent', `${basename(path)} is newer than ${olderThanDays} days`);
  }
}

function assertContained(root: string, path: string): void {
  const rel = relative(resolve(root), resolve(path));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return;
  throw new TranscriptStorageError('invalid_transcript_path', `path escapes transcript root: ${path}`);
}

function padSequence(value: number): string {
  return String(value).padStart(6, '0');
}

function stripCarriageReturn(value: string): string {
  return value.endsWith('\r') ? value.slice(0, -1) : value;
}

function safeUnlink(path: string): void {
  try { unlinkSync(path); } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
  }
}

function mapBusyError(error: unknown, message: string): Error {
  if (isErrno(error, 'EPERM') || isErrno(error, 'EBUSY') || isErrno(error, 'EACCES')) {
    return new TranscriptStorageError('transcript_busy', message, { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function isIdentityProbeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('plugin_lock_identity_unreadable');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isIncompleteJsonTail(input: string): boolean {
  const text = input.trim();
  if (!text.startsWith('{')) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return inString || escaped || depth > 0;
}
