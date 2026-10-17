import {createKnownDirectoryWriterFence} from '../verification/known-directory-writer-fence.js';
import {assertOrdinarySourceWriterRoute,observeOrdinaryDirectoryWriter} from '../verification/ordinary-source-writer-observation.js';
import {assertCapturedJsonUniqueKeys} from '../verification/captured-source-json.js';
import {createCapturedTaskDeclarationAccumulator} from './captured-task-declarations.js';
import {observeTaskSnapshotCompletion,observeTaskSnapshotCompletionSync,withoutTaskCompletionObservation} from './snapshot-completion-observation.js';
import { DesktopTaskObservationStore } from './protected-observation-store.js';
import { mergeProtectedObservationClosures } from '../../ai/runtime/protected-observation-closure.js';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { acquireSaveLock } from '../../ai/runtime/session-store/mutation-lock.js';
import { appendFile, mkdir, open, opendir, readFile, rename, truncate, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActiveTaskRef, DesktopTaskEvent, TaskSnapshot } from './types.js';

export interface TaskSnapshotWriteReceipt { readonly opaqueTaskSnapshotWriteReceipt: never }
export interface TaskSnapshotWriteFacts {
  readonly taskId: string;
  readonly sessionId: string;
  readonly status: TaskSnapshot['status'];
  readonly sequence: number;
  readonly snapshotDigest: string;
}
const writeReceipts = new WeakMap<object, { store: FileTaskSnapshotStore; facts: Readonly<TaskSnapshotWriteFacts> }>();
export function getTaskSnapshotWriteReceipt(receipt: TaskSnapshotWriteReceipt, store: FileTaskSnapshotStore): Readonly<TaskSnapshotWriteFacts> {
  const entry = receipt && typeof receipt === 'object' ? writeReceipts.get(receipt) : undefined;
  if (!entry || entry.store !== store) throw Error('task_snapshot_write_receipt');
  return entry.facts;
}

interface SnapshotIndex {
  activeTaskIds: string[];
}

interface CheckpointPersistence {
  version: 1;
  lastSequence: number;
  checkpointEventCount?: number;
}

interface JournalPayload {
  version: 1;
  taskId: string;
  sequence: number;
  previousSequence: number;
  events: DesktopTaskEvent[];
  patch: Record<string, unknown>;
  removed: string[];
}

interface JournalRecord extends JournalPayload {
  checksum: string;
}

interface CachedSnapshot {
  snapshot: TaskSnapshot;
  sequence: number;
  checkpointEventCount: number;
  sealed: boolean;
  journalRepairOffset?: number;
}

export interface TaskSnapshotStoreDiagnostics {
  onWrite?: (operation: 'checkpoint' | 'journal' | 'index', bytes: number) => void;
}

/** Internal delivery continuation only; tracking is of unmodified physical IO. */
export interface TaskSnapshotReadOptions {
  signal: AbortSignal;
  trackPending(raw: Promise<unknown>): void;
}

const CHECKPOINT_META_KEY = '__xiaokJournal';
const TERMINAL_STATUSES = new Set<TaskSnapshot['status']>(['completed', 'failed', 'cancelled']);

/**
 * A legacy-readable checkpoint plus an append-only mutation journal.
 *
 * Running tasks append only the event suffix and changed top-level fields.
 * Terminal transitions materialize the complete historical TaskSnapshot so
 * older readers keep seeing completed tasks without understanding journals.
 */
const knownTaskWriters=new WeakMap<object,{fence:ReturnType<typeof createKnownDirectoryWriterFence>;pending?:Promise<void>}>();
export class FileTaskSnapshotStore {
  readonly observations: DesktopTaskObservationStore;
  private writerQueue: Promise<void> = Promise.resolve();
  private writerClosed = false;
  private assertWriterCurrent: (() => void) | undefined;
  private indexWriteQueue: Promise<void> = Promise.resolve();
  private readonly taskWriteQueues = new Map<string, Promise<void>>();
  private readonly cache = new Map<string, CachedSnapshot>();

  constructor(
    private readonly rootDir: string,
    private readonly diagnostics: TaskSnapshotStoreDiagnostics = {},
  ) { this.observations = new DesktopTaskObservationStore(rootDir);knownTaskWriters.set(this,{fence:createKnownDirectoryWriterFence(rootDir,'task-root')}); }

  async save(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot): Promise<void> {
    const original: TaskSnapshot = JSON.parse(JSON.stringify(snapshot));
    const expected = expectedPrevious === undefined ? undefined : JSON.parse(JSON.stringify(expectedPrevious));
    await this.enqueueWrite(original.taskId, () => this.saveSerial(original, expected));
  }

  /** Permanently rejects new writes, then waits for accepted physical IO. */
  async closeAndDrain(): Promise<void> {
    this.writerClosed = true;
    await this.writerQueue;
  }

  /** User-only cooperative fence; it grants no all-writer or migration authority. */
  fenceKnownWriter(requestSource: 'user' | 'agent' | 'scheduler'): Promise<void> {
    const owner=knownTaskWriters.get(this);
    if(!owner||arguments.length!==1)return Promise.reject(Error('known_writer_fence_owner'));
    if(requestSource!=='user')return Promise.reject(Error('known_writer_fence_request_source'));
    if(!['darwin','linux'].includes(process.platform))return Promise.reject(Error('known_writer_fence_platform'));
    if(owner.pending)return owner.pending;
    this.writerClosed=true;const accepted=this.writerQueue;
    const work=Promise.resolve().then(async()=>{await accepted;const release=acquireSaveLock(join(this.rootDir,'.task-store.save.lock'));try{owner.fence.persist();}finally{release();}});
    owner.pending=work;void work.then(()=>{if(owner.pending===work)owner.pending=undefined;},()=>{if(owner.pending===work)owner.pending=undefined;});return work;
  }

  private enqueueWrite<T>(taskId: string | undefined, action: () => Promise<T>): Promise<T> {
    if (this.writerClosed) return Promise.reject(Error('task_store_closed'));
    const run = this.writerQueue.then(async () => {
      assertOrdinarySourceWriterRoute();
      await mkdir(this.rootDir, { recursive: true });
      const root = lstatSync(this.rootDir), resolved = realpathSync(this.rootDir);
      if (!root.isDirectory() || root.isSymbolicLink()) throw Error('task_store_identity_changed');
      const lockPath = join(this.rootDir, '.task-store.save.lock');
      const release = acquireSaveLock(lockPath);
      const lock = lstatSync(lockPath), bytes = readFileSync(lockPath, 'utf8');
      const assertCurrent = () => {
        const now = lstatSync(this.rootDir), current = lstatSync(lockPath);
        if (now.dev !== root.dev || now.ino !== root.ino || now.isSymbolicLink()
          || realpathSync(this.rootDir) !== resolved || current.dev !== lock.dev || current.ino !== lock.ino
          || current.isSymbolicLink() || readFileSync(lockPath, 'utf8') !== bytes) throw Error('task_store_identity_changed');
      };
      this.assertWriterCurrent = assertCurrent;
      let failure: { error: unknown } | undefined;
      let settledBodyResult!: T;
      let settledBodyFailure: {
          error: unknown;
      } | undefined;
      try {
          try {
              assertCurrent();
              knownTaskWriters.get(this)!.fence.assertOpen();
              observeOrdinaryDirectoryWriter(resolved, 'task-root');
              assertOrdinarySourceWriterRoute();
              assertCurrent();
              // This admitted sequence retains the original Task lock across every
              // awaited write. Pending migration must acquire that same lock later.
              const result = await action();
              assertCurrent();
              {
                  settledBodyResult = result;
              }
          }
          catch (error) {
              failure = { error };
              throw error;
          }
      }
      catch (error) {
          settledBodyFailure = { error };
      }
      {
          this.assertWriterCurrent = undefined;
          // A renamed root may now expose an unrelated lock at the old path.
          // The original lock must remain for explicit recovery in that case.
          try {
              assertCurrent();
              release();
          }
          catch (cleanupError) {
              if (failure)
                  throw new AggregateError([failure.error, cleanupError], 'task_store_identity_changed_or_release_failed', { cause: failure.error });
              throw cleanupError;
          }
      }
      if (settledBodyFailure)
          throw settledBodyFailure.error;
      return settledBodyResult;
    });
    const tracked = run.then(() => undefined, () => undefined);
    this.writerQueue = tracked;
    if (taskId) {
      this.taskWriteQueues.set(taskId, tracked);
      void tracked.then(() => { if (this.taskWriteQueues.get(taskId) === tracked) this.taskWriteQueues.delete(taskId); });
    }
    return run;
  }

  /** Main-only exact-write receipt; it grants no completion/verification authority. */
  async saveWithReceipt(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot): Promise<TaskSnapshotWriteReceipt> {
    const original: TaskSnapshot = JSON.parse(JSON.stringify(snapshot));
    const expected: TaskSnapshot | undefined = expectedPrevious === undefined ? undefined : JSON.parse(JSON.stringify(expectedPrevious));
    return this.enqueueWrite(original.taskId, async () => {
      await this.saveSerial(original, expected);
      const committed = this.cache.get(original.taskId);
      if (!committed) throw Error('task_snapshot_write_unconfirmed');
      // An earlier write may have persisted data but failed its index update.
      // A no-change retry must complete that original durable bookkeeping.
      await this.syncIndexForTransition(undefined, committed.snapshot);
      const sync = async (path: string, optional = false) => {
        let handle;
        try { handle = await open(path, 'r'); }
        catch (error) { if (optional && isNodeErrorCode(error, 'ENOENT')) return; throw error; }
        try { await handle.sync(); } finally { await handle.close(); }
      };
      await sync(this.snapshotPath(original.taskId));
      await sync(this.journalPath(original.taskId), true);
      await sync(this.snapshotDir());
      await sync(this.indexPath());
      await sync(this.rootDir);
      const facts = Object.freeze({ taskId: committed.snapshot.taskId, sessionId: committed.snapshot.sessionId,
        status: committed.snapshot.status, sequence: committed.sequence,
        snapshotDigest: createHash('sha256').update(JSON.stringify(committed.snapshot)).digest('hex') });
      const receipt = Object.freeze({}) as TaskSnapshotWriteReceipt;
      this.assertWriterCurrent?.();
      writeReceipts.set(receipt, { store: this, facts });
      return receipt;
    });

  }

  async getActiveTasks(): Promise<ActiveTaskRef[]> {
    const index = await this.loadIndex();
    return index.activeTaskIds.map(taskId => ({ taskId }));
  }

  /** @deprecated Use getActiveTasks() — kept for backward compat */
  async getActiveTask(): Promise<ActiveTaskRef | null> {
    const tasks = await this.getActiveTasks();
    return tasks[0] ?? null;
  }

  async recoverTask(taskId: string, options?: TaskSnapshotReadOptions): Promise<TaskSnapshot | null> {
    options?.signal.throwIfAborted();
    const protection = await this.readProtection(taskId, options);
    const protectedClosure = protection.closure;
    const pendingWrite = this.taskWriteQueues.get(taskId);
    if (pendingWrite) await waitSnapshotRead(() => pendingWrite, options);
    options?.signal.throwIfAborted();
    const cached = this.cache.get(taskId);
    if (cached) {
      const protectedSnapshot = await this.withProtection(cached.snapshot, options);
      return waitSnapshotRead(() => observeTaskSnapshotCompletion(protectedSnapshot, taskId, options?.signal), options);
    }
    let loaded: CachedSnapshot | null;
    try { loaded = await this.loadSnapshotState(taskId, options); }
    catch (cause) {
      if (protectedClosure || protection.executionProtected) throw Object.assign(new Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE', { cause }), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
      throw cause;
    }
    options?.signal.throwIfAborted();
    if (!loaded) {
      if (protectedClosure || protection.executionProtected) throw Object.assign(new Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE'), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
      return null;
    }
    const protectedSnapshot = await this.withProtection(loaded.snapshot, options);
    const observed = await waitSnapshotRead(() => observeTaskSnapshotCompletion(protectedSnapshot, taskId, options?.signal), options);
    options?.signal.throwIfAborted();
    this.cache.set(taskId, loaded);
    return observed;
  }

  /** Read-only legacy ownership check, including terminal tasks absent from the active index. */
  async hasThreadHistory(threadId: string): Promise<boolean> {
    let directory: Awaited<ReturnType<typeof opendir>>;
    try { directory = await opendir(this.snapshotDir()); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    for await (const entry of directory) {
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('task_history_owner_unknown');
      // One checkpoint at a time. Do not recover every task into the runtime's
      // snapshot cache or replay its history simply to establish ownership.
      const snapshot = parseCheckpoint(await readFile(join(this.snapshotDir(), entry.name), 'utf8')).snapshot;
      if (!snapshot || typeof snapshot.taskId !== 'string') throw new Error('task_history_owner_unknown');
      if (snapshot.context?.threadId === threadId) return true;
    }
    return false;
  }

  /** Main-only confirmation history; caller-supplied task lists are never authority. */
  async readPreviousUserTask(threadId: string, currentTaskId: string): Promise<TaskSnapshot | null> {
    const current = await this.recoverTask(currentTaskId);
    if (!current || current.context?.threadId !== threadId) return null;
    let latest: TaskSnapshot | null = null;
    let directory: Awaited<ReturnType<typeof opendir>>;
    try { directory = await opendir(this.snapshotDir()); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    for await (const entry of directory) {
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('task_history_owner_unknown');
      const snapshot = parseCheckpoint(await readFile(join(this.snapshotDir(), entry.name), 'utf8')).snapshot;
      if (snapshot.taskId === currentTaskId || snapshot.context?.threadId !== threadId
        || snapshot.executionScope && (snapshot.executionScope.kind !== 'goal_turn' || snapshot.executionScope.origin !== 'user')) continue;
      if (snapshot.createdAt === current.createdAt) return null;
      if (snapshot.createdAt > current.createdAt) continue;
      if (!latest || snapshot.createdAt > latest.createdAt) latest = snapshot;
      else if (snapshot.createdAt === latest.createdAt) return null;
    }
    return latest ? this.recoverTask(latest.taskId) : null;
  }

  async clearActiveTask(taskId: string): Promise<void> {
    await this.enqueueWrite(undefined, () => this.updateIndex(index => {
      const ids = new Set(index.activeTaskIds);
      ids.delete(taskId);
      return { activeTaskIds: [...ids] };
    }));
  }

  private readProtection(taskId: string, options?: TaskSnapshotReadOptions) {
    return waitSnapshotRead(() => options ? this.observations.readProtectionInWorker(taskId) : this.observations.readProtection(taskId), options);
  }

  private async withProtection(snapshot: TaskSnapshot, options?: TaskSnapshotReadOptions): Promise<TaskSnapshot> {
    const protection = await this.readProtection(snapshot.taskId, options);
    if (snapshot.executionProtected !== undefined && snapshot.executionProtected !== true) throw Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE');
    const closure = mergeProtectedObservationClosures(protection.closure, snapshot.protectedObservationClosure);
    return { ...snapshot, ...(closure ? { protectedObservationClosure: closure } : {}),
      ...(protection.executionProtected || snapshot.executionProtected ? { executionProtected: true as const } : {}) };
  }

  private async saveSerial(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot): Promise<void> {
    if (snapshot.protectedObservationClosure) await this.observations.save(snapshot.taskId, snapshot.protectedObservationClosure);
    snapshot = withoutTaskCompletionObservation(await this.withProtection(snapshot));
    await mkdir(this.snapshotDir(), { recursive: true });
    const current = await this.loadSnapshotState(snapshot.taskId);
    if (current) this.cache.set(snapshot.taskId, current);
    else this.cache.delete(snapshot.taskId);
    this.assertWriterCurrent?.();
    if (!current) {
      await this.writeCheckpoint(snapshot, 0);
      this.cache.set(snapshot.taskId, { snapshot, sequence: 0, checkpointEventCount: snapshot.events.length, sealed: true });
      await this.syncIndexForTransition(undefined, snapshot);
      return;
    }

    assertAppendOnlyEvents(current.snapshot, snapshot, expectedPrevious);
    if (!current.sealed) {
      // A journal must never coexist with an unsealed legacy checkpoint. Seal
      // the exact base aggregate first so an unsupported old-binary rewrite is
      // detected instead of replaying duplicate events.
      await this.writeCheckpoint(current.snapshot, current.sequence);
      current.sealed = true;
    }
    const sequence = current.sequence + 1;
    const payload = buildJournalPayload(current, snapshot, sequence);
    if (payload.events.length === 0 && Object.keys(payload.patch).length === 0 && payload.removed.length === 0) {
      return;
    }
    const record: JournalRecord = { ...payload, checksum: checksumJournalPayload(payload) };
    const encodedRecord = `${JSON.stringify(record)}\n`;
    try {
      if (current.journalRepairOffset !== undefined) {
        await truncate(this.journalPath(snapshot.taskId), current.journalRepairOffset);
      }
    this.assertWriterCurrent?.();
      await appendFile(this.journalPath(snapshot.taskId), encodedRecord, 'utf8');
    } catch (error) {
      // A failed append may still leave a partial frame on disk. Force the next
      // operation to replay and truncate the tail instead of trusting memory.
      this.cache.delete(snapshot.taskId);
      throw error;
    }
    this.diagnostics.onWrite?.('journal', Buffer.byteLength(encodedRecord, 'utf8'));
    this.cache.set(snapshot.taskId, {
      snapshot,
      sequence,
      checkpointEventCount: current.checkpointEventCount,
      sealed: true,
    });

    if (TERMINAL_STATUSES.has(snapshot.status) || shouldWriteInterimCheckpoint(current, snapshot, encodedRecord)) {
      // Checkpoint first, journal cleanup second. If cleanup is interrupted,
      // lastSequence makes replay ignore records already folded into checkpoint.
      await this.writeCheckpoint(snapshot, sequence);
      await unlink(this.journalPath(snapshot.taskId)).catch((error) => {
        if (!isNodeErrorCode(error, 'ENOENT')) throw error;
      });
      this.cache.set(snapshot.taskId, {
        snapshot,
        sequence,
        checkpointEventCount: snapshot.events.length,
        sealed: true,
      });
    }
    await this.syncIndexForTransition(current.snapshot, snapshot);
  }

  private async loadSnapshotState(taskId: string, options?: TaskSnapshotReadOptions): Promise<CachedSnapshot | null> {
    let raw: string;
    try {
      raw = await waitSnapshotRead(() => readFile(this.snapshotPath(taskId), 'utf8'), options);
    } catch (error) {
      options?.signal.throwIfAborted();
      if (isNodeErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
    options?.signal.throwIfAborted();
    const checkpoint = parseCheckpoint(raw);

    let journalRaw: string;
    try {
      journalRaw = await waitSnapshotRead(() => readFile(this.journalPath(taskId), 'utf8'), options);
    } catch (error) {
      options?.signal.throwIfAborted();
      if (isNodeErrorCode(error, 'ENOENT')) return checkpoint;
      throw error;
    }
    options?.signal.throwIfAborted();
    return replayJournal(checkpoint, journalRaw, taskId);
  }

  private async writeCheckpoint(snapshot: TaskSnapshot, lastSequence: number): Promise<void> {
    snapshot = withoutTaskCompletionObservation(snapshot);
    const target = this.snapshotPath(snapshot.taskId);
    const tmp = this.tempPath(target);
    const checkpoint = {
      ...snapshot,
      [CHECKPOINT_META_KEY]: {
        version: 1,
        lastSequence,
        checkpointEventCount: snapshot.events.length,
      } satisfies CheckpointPersistence,
    };
    const encoded = JSON.stringify(checkpoint, null, 2);
    this.assertWriterCurrent?.();
    await writeFile(tmp, encoded, 'utf8');
    this.assertWriterCurrent?.();
    await rename(tmp, target);
    this.assertWriterCurrent?.();
    this.diagnostics.onWrite?.('checkpoint', Buffer.byteLength(encoded, 'utf8'));
  }

  private async syncIndexForTransition(previous: TaskSnapshot | undefined, next: TaskSnapshot): Promise<void> {
    const wasActive = previous ? !TERMINAL_STATUSES.has(previous.status) : undefined;
    const isActive = !TERMINAL_STATUSES.has(next.status);
    if (wasActive === isActive) return;
    await this.updateIndex(index => {
      const ids = new Set(index.activeTaskIds);
      if (isActive) ids.add(next.taskId);
      else ids.delete(next.taskId);
      return { activeTaskIds: [...ids] };
    });
  }

  private async updateIndex(mutator: (index: SnapshotIndex) => SnapshotIndex): Promise<void> {
    const run = this.indexWriteQueue.then(async () => {
      const index = await this.loadIndex(true);
      await this.saveIndex(mutator(index));
    });
    this.indexWriteQueue = run.catch(() => undefined);
    return run;
  }

  private async loadIndex(strict = false): Promise<SnapshotIndex> {
    try {
      const raw = await readFile(this.indexPath(), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if ('activeTaskId' in parsed && !('activeTaskIds' in parsed)) {
        const old = parsed.activeTaskId as string | null;
        if (strict && old !== null && typeof old !== 'string') throw Error('task_store_index_invalid');
        return { activeTaskIds: old ? [old] : [] };
      }
      const ids = parsed.activeTaskIds;
      if (strict && (!Array.isArray(ids) || !ids.every(id => typeof id === 'string'))) throw Error('task_store_index_invalid');
      return { activeTaskIds: Array.isArray(ids) ? ids as string[] : [] };
    } catch (error) {
      if (strict && !isNodeErrorCode(error, 'ENOENT')) throw error;
      return { activeTaskIds: [] };
    }
  }

  private async saveIndex(index: SnapshotIndex): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const target = this.indexPath();
    const tmp = this.tempPath(target);
    const encoded = JSON.stringify(index, null, 2);
    this.assertWriterCurrent?.();
    await writeFile(tmp, encoded, 'utf8');
    this.assertWriterCurrent?.();
    await rename(tmp, target);
    this.assertWriterCurrent?.();
    this.diagnostics.onWrite?.('index', Buffer.byteLength(encoded, 'utf8'));
  }

  private snapshotDir(): string { return join(this.rootDir, 'snapshots'); }
  private snapshotPath(taskId: string): string { return join(this.snapshotDir(), `${taskId}.json`); }
  private journalPath(taskId: string): string { return join(this.snapshotDir(), `${taskId}.journal.jsonl`); }
  private indexPath(): string { return join(this.rootDir, 'active-task.json'); }
  private tempPath(target: string): string {
    return `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  }
}

function waitSnapshotRead<T>(start: () => Promise<T>, options?: TaskSnapshotReadOptions): Promise<T> {
  if (!options) return start();
  const { signal, trackPending } = options;
  signal.throwIfAborted();
  const raw = start(); // Deliberately do not pass AbortSignal into the raw IO.
  trackPending(raw);
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    raw.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(signal.aborted ? signal.reason : error);
    });
    // A synchronous tracker may observe cancellation while registering the raw
    // obligation. Never install a waiter which missed that cancellation.
    if (signal.aborted) abort();
  });
}

/**
 * Compatibility reader for synchronous call sites that previously parsed the
 * checkpoint JSON directly. New runtime paths should prefer recoverTask().
 */
export function recoverTaskSnapshotSync(rootDir: string, taskId: string): TaskSnapshot | null {
  const protection = new DesktopTaskObservationStore(rootDir).readProtectionSync(taskId);
  const protectedClosure = protection.closure;
  const protect=(snapshot:TaskSnapshot)=>{if(snapshot.executionProtected!==undefined&&snapshot.executionProtected!==true)throw Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE');const closure=mergeProtectedObservationClosures(protectedClosure,snapshot.protectedObservationClosure);return {...snapshot,...(closure?{protectedObservationClosure:closure}:{}),...(protection.executionProtected||snapshot.executionProtected?{executionProtected:true as const}:{})};};
  let checkpointRaw: string;
  try {
    checkpointRaw = readFileSync(join(rootDir, 'snapshots', `${taskId}.json`), 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT') && !protectedClosure && !protection.executionProtected) return null;
    throw error;
  }
  const checkpoint = parseCheckpoint(checkpointRaw);
  try {
    const journalRaw = readFileSync(join(rootDir, 'snapshots', `${taskId}.journal.jsonl`), 'utf8');
    if (!checkpoint.sealed && journalRaw.length > 0) {
      throw new Error('unsealed checkpoint has a task journal');
    }
    return observeTaskSnapshotCompletionSync(protect(replayJournal(checkpoint, journalRaw, taskId).snapshot),taskId);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return observeTaskSnapshotCompletionSync(protect(checkpoint.snapshot),taskId);
    throw error;
  }
}

function buildJournalPayload(current: CachedSnapshot, next: TaskSnapshot, sequence: number): JournalPayload {
  const patch: Record<string, unknown> = {};
  const removed: string[] = [];
  const previousRecord = current.snapshot as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)]);
  keys.delete('taskId');
  keys.delete('events');
  for (const key of keys) {
    if (!(key in nextRecord)) {
      removed.push(key);
    } else if (JSON.stringify(previousRecord[key]) !== JSON.stringify(nextRecord[key])) {
      patch[key] = nextRecord[key];
    }
  }
  return {
    version: 1,
    taskId: next.taskId,
    sequence,
    previousSequence: current.sequence,
    events: next.events.slice(current.snapshot.events.length),
    patch,
    removed: removed.sort(),
  };
}

function applyJournalRecord(snapshot: TaskSnapshot, record: JournalRecord): TaskSnapshot {
  const next = {
    ...snapshot,
    ...record.patch,
    events: [...snapshot.events, ...record.events],
  } as TaskSnapshot & Record<string, unknown>;
  for (const key of record.removed) delete next[key];
  return next;
}

const CAPTURED_TASK_FIELDS = new Set([
  'taskId', 'sessionId', 'status', 'prompt', 'materials', 'events', 'understanding', 'result',
  'salvage', 'context', 'executionScope', 'multiAgentPreparation', 'hostDelivery', 'usage',
  'createdAt', 'updatedAt', 'executionProtected', 'protectedObservationClosure', 'currentCompletion',
]);
function capturedIdentity(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw Error('captured_task_session');
}
function capturedCore(value: TaskSnapshot): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['understanding', 'running', 'waiting_user', 'completed', 'failed', 'cancelled'].includes(value.status)
    || typeof value.prompt !== 'string' || !Array.isArray(value.materials) || !Array.isArray(value.events)
    || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
    || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt) throw Error('captured_task_checkpoint');
  capturedIdentity(value.taskId); capturedIdentity(value.sessionId);
}
/** JSON.parse has already checked syntax. Decode object keys before comparing
 * them, so escaped spellings cannot conceal an ambiguous duplicate. */
function capturedUniqueKeys(raw: string): void {
  assertCapturedJsonUniqueKeys(raw, 'captured_task_duplicate');
}

/** Narrow facts from captured bytes only. Actual full-source custody, retained
 * history and cross-owner relationships must be checked by the source collector. */
export function readCapturedTaskSessions(checkpointRaw: string, journalRaw: string, taskId: string): Readonly<{taskId: string; sessionIdentities: readonly string[]}> {
  return readCapturedTaskHistory(checkpointRaw,journalRaw,taskId);
}

/** Captured declarations only: references remain in their original namespace. */
export function readCapturedTaskDeclarations(checkpointRaw:string,journalRaw:string,taskId:string){
  const declarations=createCapturedTaskDeclarationAccumulator();
  const sessions=readCapturedTaskHistory(checkpointRaw,journalRaw,taskId,declarations);
  return declarations.finish(taskId,sessions.sessionIdentities);
}

function readCapturedTaskHistory(checkpointRaw:string,journalRaw:string,taskId:string,declarations?:ReturnType<typeof createCapturedTaskDeclarationAccumulator>):Readonly<{taskId:string;sessionIdentities:readonly string[]}>{
  if (typeof checkpointRaw !== 'string' || typeof journalRaw !== 'string') throw Error('captured_task_input');
  capturedIdentity(taskId);
  const checkpoint = parseCheckpoint(checkpointRaw, true);
  if (checkpoint.snapshot.taskId !== taskId) throw Error('captured_task_owner');
  declarations?.capture(checkpoint.snapshot,'checkpoint');
  if (journalRaw && !journalRaw.endsWith('\n')) throw Error('captured_task_tail');
  const sessions = new Set([checkpoint.snapshot.sessionId]);
  let firstSequence: number | undefined, previousSequence: number | undefined, oldSession: string | undefined;
  const result = replayJournal(checkpoint, journalRaw, taskId, record => {
    declarations?.capture({...record.patch,events:record.events},`journal[${record.sequence}]`);
    if (record.sequence !== record.previousSequence + 1
      || previousSequence !== undefined && record.previousSequence !== previousSequence) throw Error('captured_task_sequence');
    firstSequence ??= record.sequence; previousSequence = record.sequence;
    if (record.removed.includes('sessionId')) throw Error('captured_task_session');
    if (Object.hasOwn(record.patch, 'sessionId')) {
      const session = record.patch.sessionId; capturedIdentity(session); sessions.add(session);
      if (record.sequence <= checkpoint.sequence) oldSession = session;
    }
  });
  if (firstSequence !== undefined && firstSequence <= checkpoint.sequence && previousSequence! < checkpoint.sequence
    || oldSession !== undefined && oldSession !== checkpoint.snapshot.sessionId) throw Error('captured_task_anchor');
  capturedCore(result.snapshot);
  if (result.snapshot.taskId !== taskId) throw Error('captured_task_owner');
  sessions.add(result.snapshot.sessionId);
  declarations?.capture(result.snapshot,'final');
  return Object.freeze({taskId, sessionIdentities: Object.freeze([...sessions].sort())});
}

function parseCheckpoint(raw: string, captured = false): CachedSnapshot {
  const parsed = JSON.parse(raw) as TaskSnapshot & { [CHECKPOINT_META_KEY]?: CheckpointPersistence };
  if (captured) {
    capturedUniqueKeys(raw); capturedCore(parsed);
    if (Object.keys(parsed).some(key => key !== CHECKPOINT_META_KEY && !CAPTURED_TASK_FIELDS.has(key))) throw Error('captured_task_schema');
    if (Object.hasOwn(parsed, CHECKPOINT_META_KEY)) {
      const meta = parsed[CHECKPOINT_META_KEY];
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)
        || Object.keys(meta).sort().join(',') !== 'checkpointEventCount,lastSequence,version'
        || meta.version !== 1 || !Number.isSafeInteger(meta.lastSequence) || meta.lastSequence < 0
        || meta.checkpointEventCount !== parsed.events.length) throw Error('captured_task_checkpoint');
    }
  }
  const persistence = parsed[CHECKPOINT_META_KEY];
  delete parsed[CHECKPOINT_META_KEY];
  const sealed = persistence?.version === 1
    && Number.isSafeInteger(persistence.lastSequence)
    && persistence.lastSequence >= 0
    && Number.isSafeInteger(persistence.checkpointEventCount)
    && persistence.checkpointEventCount! >= 0;
  return {
    snapshot: parsed as TaskSnapshot,
    sequence: sealed
      ? persistence.lastSequence
      : 0,
    checkpointEventCount: sealed
      ? persistence.checkpointEventCount!
      : parsed.events.length,
    sealed,
  };
}

function replayJournal(checkpoint: CachedSnapshot, journalRaw: string, taskId: string, captureRecord?: (record: JournalRecord) => void): CachedSnapshot {
  if (!checkpoint.sealed && journalRaw.length > 0) {
    throw new Error('unsealed checkpoint has a task journal');
  }
  let { snapshot, sequence } = checkpoint;
  const terminated = journalRaw.endsWith('\n');
  const lines = journalRaw.split('\n');
  if (terminated) lines.pop();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      if (captureRecord && journalRaw) throw Error('captured_task_frame');
      continue;
    }
    if (!terminated && index === lines.length - 1) {
      // appendFile only commits newline-terminated frames. A final fragment,
      // even if parseable, is an unacknowledged crash tail.
      break;
    }
    const record = parseJournalRecord(line, taskId, index + 1);
    if (captureRecord) {
      capturedUniqueKeys(line);
      if (Object.keys(record).sort().join(',') !== 'checksum,events,patch,previousSequence,removed,sequence,taskId,version'
        || Array.isArray(record.patch)
        || [...Object.keys(record.patch), ...record.removed].some(key => !CAPTURED_TASK_FIELDS.has(key) || ['taskId', 'events', 'currentCompletion'].includes(key))) throw Error('captured_task_schema');
      captureRecord(record);
    }
    if (record.sequence <= sequence) continue;
    if (record.previousSequence !== sequence || record.sequence !== sequence + 1) {
      throw new Error(`task journal sequence gap at line ${index + 1}`);
    }
    snapshot = applyJournalRecord(snapshot, record);
    sequence = record.sequence;
  }
  return {
    snapshot,
    sequence,
    checkpointEventCount: checkpoint.checkpointEventCount,
    sealed: checkpoint.sealed,
    journalRepairOffset: terminated ? undefined : Math.max(0, journalRaw.lastIndexOf('\n') + 1),
  };
}

function shouldWriteInterimCheckpoint(
  current: CachedSnapshot,
  next: TaskSnapshot,
  encodedRecord: string,
): boolean {
  let nextEventThreshold = 256;
  while (nextEventThreshold <= current.checkpointEventCount) nextEventThreshold *= 2;
  return next.events.length >= nextEventThreshold || Buffer.byteLength(encodedRecord, 'utf8') >= 1_048_576;
}

function assertAppendOnlyEvents(previous: TaskSnapshot, next: TaskSnapshot, expectedPrevious?: TaskSnapshot): void {
  if (next.taskId !== previous.taskId || next.events.length < previous.events.length) {
    throw new Error('task events are not append-only');
  }
  if (
    expectedPrevious === previous
    && (previous.events.length === 0 || next.events[previous.events.length - 1] === previous.events.at(-1))
  ) {
    return;
  }
  for (let index = 0; index < previous.events.length; index += 1) {
    if (JSON.stringify(previous.events[index]) !== JSON.stringify(next.events[index])) {
      throw new Error('task events are not append-only');
    }
  }
}

function checksumJournalPayload(payload: JournalPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function parseJournalRecord(line: string, taskId: string, lineNumber: number): JournalRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`invalid task journal record at line ${lineNumber}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`invalid task journal record at line ${lineNumber}`);
  const record = parsed as Partial<JournalRecord>;
  const { checksum, ...payload } = record;
  if (
    record.version !== 1
    || record.taskId !== taskId
    || !Number.isSafeInteger(record.sequence)
    || record.sequence! <= 0
    || !Number.isSafeInteger(record.previousSequence)
    || record.previousSequence! < 0
    || !Array.isArray(record.events)
    || !record.patch
    || typeof record.patch !== 'object'
    || !Array.isArray(record.removed)
    || record.removed.some(key => typeof key !== 'string' || key === 'taskId' || key === 'events' || key === CHECKPOINT_META_KEY)
    || Object.keys(record.patch).some(key => key === 'taskId' || key === 'events' || key === CHECKPOINT_META_KEY)
    || typeof checksum !== 'string'
    || checksum !== checksumJournalPayload(payload as JournalPayload)
  ) {
    throw new Error(`invalid task journal record at line ${lineNumber}`);
  }
  return record as JournalRecord;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
