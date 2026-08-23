/**
 * Live source pin + per-launch journals (design v58 §4.4; R29-02, R30-01,
 * R32-02, R33-01, R33-02, R34-02).
 *
 * Purpose: prove, across processes, that a materialised source/runtime root is
 * still referenced, so no installer/pruner/uninstall can delete code that a live
 * provider child is executing.
 *
 * Layout under `pins/<name>/<digest>/<instanceId>/`:
 *   source.json                     immutable description of what is pinned
 *   owners/main/000-acquired.json   written before the root is exposed
 *   owners/main/090-released.json   normal shutdown, every ref closed
 *   owners/main/095-owner-dead.json appended by a later process after proving death
 *   refs/<launchId>/000-starting.json   fsynced BEFORE spawn (crash window)
 *   refs/<launchId>/010-spawned.json    pid + start identity, tree unverified
 *   refs/<launchId>/020-orphaned.json   cleanup could not prove the tree is empty
 *   refs/<launchId>/090-released.json   observer proved the population is empty
 *   refs/<launchId>/090-not-created.json only with full pre-spawn evidence
 *
 * Durability rule: unique file via `open('wx')` → full payload with checksum →
 * fsync file → fsync directory. A repeated append with byte-identical content is
 * an idempotent no-op; different content for the same event is invalid and fails
 * closed. Nothing is ever rewritten in place, so two launches can never lose
 * each other's updates (that is why per-launch journals replaced one JSON doc).
 */

import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { ProcessIdentity } from './plugin-claim-lock.js';

export const PIN_SCHEMA = 'xiaok-provider-source-pin-v1';

export type RefEvent =
  | '000-starting'
  | '010-spawned'
  | '020-orphaned'
  | '090-released'
  | '090-not-created';

export type MainOwnerEvent = '000-acquired' | '090-released' | '095-owner-dead';

export class PinFailClosedError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = 'PinFailClosedError';
  }
}

export interface PinnedSourceDescription {
  readonly pluginName: string;
  readonly sourceDigest: string;
  readonly sourceSnapshotPath: string;
  readonly runtimeContractDigest?: string;
  readonly runtimeGenerationPath?: string;
}

function canonical(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = payload[k];
  return JSON.stringify(ordered);
}

function withChecksum(payload: Record<string, unknown>): string {
  const body = canonical(payload);
  const checksum = createHash('sha256').update(body).digest('hex');
  return `${canonical({ ...payload, checksum })}\n`;
}

function fsyncDir(dir: string): void {
  if (process.platform === 'win32') return; // documented platform split
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function mkdirFsync(dir: string): void {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  fsyncDir(dir);
}

/** Appends one immutable event; identical repeats are no-ops. */
function appendEvent(dir: string, name: string, payload: Record<string, unknown>): void {
  const path = join(dir, `${name}.json`);
  const contents = withChecksum({ ...payload, schema: PIN_SCHEMA, event: name });
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8');
    if (existing === contents) return; // idempotent append
    throw new PinFailClosedError(
      'pin_event_conflict',
      `${name} already exists with different content in ${dir}`,
    );
  }
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDir(dir);
}

function readEvent(dir: string, name: string): Record<string, unknown> | null {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new PinFailClosedError('pin_event_corrupt', `${name} in ${dir} is not valid JSON`);
  }
  const { checksum, ...rest } = parsed as { checksum?: unknown };
  if (typeof checksum !== 'string') {
    throw new PinFailClosedError('pin_event_corrupt', `${name} in ${dir} has no checksum`);
  }
  const expected = createHash('sha256').update(canonical(rest as Record<string, unknown>)).digest('hex');
  if (expected !== checksum) {
    throw new PinFailClosedError('pin_event_checksum_mismatch', `${name} in ${dir}`);
  }
  if ((rest as { schema?: unknown }).schema !== PIN_SCHEMA) {
    throw new PinFailClosedError('pin_event_unknown_schema', `${name} in ${dir}`);
  }
  return rest as Record<string, unknown>;
}

export interface LaunchRef {
  readonly launchId: string;
  /** Written and fsynced BEFORE spawn, so a crash cannot hide the child. */
  markSpawned(identity: ProcessIdentity): void;
  markOrphaned(observation: string): void;
  /** Only valid with complete pre-spawn evidence (design R34-02). */
  markNotCreated(evidence: PreSpawnFailureEvidence): void;
  /** Requires a production observer proof that the whole population is gone. */
  release(observation: string): void;
}

/**
 * The single accepted proof that no child was ever created (design R34-02): a
 * synchronous pre-spawn failure with no pid, no spawn event, no exit, one
 * numeric ENOENT/EACCES and a matching `close(errno, null)`.
 */
export interface PreSpawnFailureEvidence {
  readonly spawnObserved: false;
  readonly everHadPid: false;
  readonly exitObserved: false;
  readonly errorCode: 'ENOENT' | 'EACCES';
  readonly errno: number;
  readonly syscall: string;
  readonly path: string;
  readonly spawnargs: readonly string[];
  readonly closeCode: number;
  readonly closeSignal: null;
}

export function isCompletePreSpawnEvidence(e: PreSpawnFailureEvidence): boolean {
  return e.spawnObserved === false
    && e.everHadPid === false
    && e.exitObserved === false
    && (e.errorCode === 'ENOENT' || e.errorCode === 'EACCES')
    && Number.isInteger(e.errno)
    && e.closeSignal === null
    && e.closeCode === e.errno
    && e.syscall.startsWith('spawn ')
    && e.syscall.endsWith(e.path);
}

export class ProviderSourcePin {
  private readonly instanceDir: string;

  private readonly ownersMainDir: string;

  private readonly refsDir: string;

  constructor(
    pinsRoot: string,
    private readonly description: PinnedSourceDescription,
    readonly instanceId: string,
    private readonly self: () => ProcessIdentity,
  ) {
    this.instanceDir = join(pinsRoot, description.pluginName, description.sourceDigest, instanceId);
    this.ownersMainDir = join(this.instanceDir, 'owners', 'main');
    this.refsDir = join(this.instanceDir, 'refs');
  }

  get path(): string {
    return this.instanceDir;
  }

  /** Must complete before the pinned root is exposed to services. */
  acquireMain(): void {
    mkdirFsync(this.instanceDir);
    mkdirFsync(this.ownersMainDir);
    mkdirFsync(this.refsDir);
    const identity = this.self();
    appendEvent(this.instanceDir, 'source', {
      pluginName: this.description.pluginName,
      sourceDigest: this.description.sourceDigest,
      sourceSnapshotPath: this.description.sourceSnapshotPath,
      ...(this.description.runtimeContractDigest
        ? { runtimeContractDigest: this.description.runtimeContractDigest } : {}),
      ...(this.description.runtimeGenerationPath
        ? { runtimeGenerationPath: this.description.runtimeGenerationPath } : {}),
    });
    appendEvent(this.ownersMainDir, '000-acquired', {
      pid: identity.pid,
      startIdentity: identity.startIdentity,
    });
  }

  /**
   * Normal shutdown only: requires every known ref closed. Otherwise we leave
   * `000-acquired` in place and let the next process prove death.
   */
  releaseMain(reason: string): { released: boolean; blockedBy?: string[] } {
    const open = this.openRefs();
    if (open.length > 0) return { released: false, blockedBy: open };
    appendEvent(this.ownersMainDir, '090-released', { reason });
    return { released: true };
  }

  private openRefs(): string[] {
    if (!existsSync(this.refsDir)) return [];
    const open: string[] = [];
    for (const launchId of readdirSync(this.refsDir).sort()) {
      const dir = join(this.refsDir, launchId);
      const released = readEvent(dir, '090-released') ?? readEvent(dir, '090-not-created');
      if (!released) open.push(launchId);
    }
    return open;
  }

  /** Creates the launch ref and fsyncs `000-starting` BEFORE the caller spawns. */
  beginLaunch(launchId: string): LaunchRef {
    const dir = join(this.refsDir, launchId);
    mkdirFsync(dir);
    appendEvent(dir, '000-starting', { treeStatus: 'unknown' });
    return {
      launchId,
      markSpawned: (identity) => {
        appendEvent(dir, '010-spawned', {
          pid: identity.pid,
          startIdentity: identity.startIdentity,
          treeStatus: 'unverified',
        });
      },
      markOrphaned: (observation) => {
        appendEvent(dir, '020-orphaned', { observation });
      },
      markNotCreated: (evidence) => {
        if (!isCompletePreSpawnEvidence(evidence)) {
          throw new PinFailClosedError(
            'pin_incomplete_pre_spawn_evidence',
            `refusing 090-not-created for ${launchId}`,
          );
        }
        appendEvent(dir, '090-not-created', {
          errorCode: evidence.errorCode,
          errno: evidence.errno,
          syscall: evidence.syscall,
          path: evidence.path,
        });
      },
      release: (observation) => {
        appendEvent(dir, '090-released', { observation });
      },
    };
  }
}

export type InstanceVerdict =
  | { kind: 'inactive'; instanceId: string }
  | { kind: 'in_use'; instanceId: string; reason: string; detail: string[] };

/**
 * The single production reducer. Tests must use it rather than re-implementing
 * the state machine.
 */
export function reducePinState(
  pinsRoot: string,
  pluginName: string,
  sourceDigest: string,
  probeIdentity: (pid: number) => ProcessIdentity | null,
): InstanceVerdict[] {
  const digestDir = join(pinsRoot, pluginName, sourceDigest);
  if (!existsSync(digestDir)) return [];
  const verdicts: InstanceVerdict[] = [];

  for (const instanceId of readdirSync(digestDir).sort()) {
    const instanceDir = join(digestDir, instanceId);
    const ownersMainDir = join(instanceDir, 'owners', 'main');
    const acquired = readEvent(ownersMainDir, '000-acquired');
    if (!acquired) {
      verdicts.push({
        kind: 'in_use', instanceId, reason: 'missing_main_owner_acquired', detail: [],
      });
      continue;
    }
    const released = readEvent(ownersMainDir, '090-released');
    const ownerDead = readEvent(ownersMainDir, '095-owner-dead');

    // Any ref that is starting/spawned/orphaned without a terminal event keeps
    // the source in use, regardless of the main owner's state.
    const openRefs: string[] = [];
    const refsDir = join(instanceDir, 'refs');
    if (existsSync(refsDir)) {
      for (const launchId of readdirSync(refsDir).sort()) {
        const refDir = join(refsDir, launchId);
        const starting = readEvent(refDir, '000-starting');
        if (!starting) {
          verdicts.push({
            kind: 'in_use', instanceId, reason: 'ref_missing_starting_event', detail: [launchId],
          });
          openRefs.push(launchId);
          continue;
        }
        const terminal = readEvent(refDir, '090-released') ?? readEvent(refDir, '090-not-created');
        if (terminal) continue;
        const orphaned = readEvent(refDir, '020-orphaned');
        const spawned = readEvent(refDir, '010-spawned');
        if (orphaned) { openRefs.push(`${launchId}:orphaned`); continue; }
        if (spawned) {
          const pid = spawned.pid as number;
          const identity = probeIdentity(pid);
          const stillAlive = identity !== null
            && identity.startIdentity === (spawned.startIdentity as string);
          openRefs.push(`${launchId}:${stillAlive ? 'live_child' : 'unverified_tree'}`);
          continue;
        }
        // starting but never spawned: the crash window. Fail closed.
        openRefs.push(`${launchId}:starting`);
      }
    }

    if (openRefs.length > 0) {
      verdicts.push({ kind: 'in_use', instanceId, reason: 'open_refs', detail: openRefs });
      continue;
    }
    if (released || ownerDead) {
      verdicts.push({ kind: 'inactive', instanceId });
      continue;
    }
    const identity = probeIdentity(acquired.pid as number);
    const mainAlive = identity !== null
      && identity.startIdentity === (acquired.startIdentity as string);
    verdicts.push(
      mainAlive
        ? { kind: 'in_use', instanceId, reason: 'main_owner_live', detail: [] }
        : { kind: 'in_use', instanceId, reason: 'main_owner_dead_needs_observation', detail: [] },
    );
  }
  return verdicts;
}

/** Only a process holding the plugin lock may record another owner's death. */
export function recordMainOwnerDead(
  pinsRoot: string,
  pluginName: string,
  sourceDigest: string,
  instanceId: string,
  observation: string,
): void {
  const ownersMainDir = join(pinsRoot, pluginName, sourceDigest, instanceId, 'owners', 'main');
  appendEvent(ownersMainDir, '095-owner-dead', { observation });
}

export function isSourceDeletable(verdicts: InstanceVerdict[]): boolean {
  return verdicts.every((v) => v.kind === 'inactive');
}
