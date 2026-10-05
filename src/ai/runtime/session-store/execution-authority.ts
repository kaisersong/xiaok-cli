import { acquireSaveLock } from './mutation-lock.js';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, lstatSync, existsSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { syncDirectoryTreeStrict } from '../../../utils/atomic-file.js';

export interface SessionExecutionClaims { requestSource: 'user' | 'agent' | 'scheduler'; ownerId: string; scopeId: string }
export interface SessionExecutionContext { readonly opaqueSessionExecutionContext: true }
const contexts = new WeakMap<object, Readonly<SessionExecutionClaims>>();
/** Host bootstrap only. Never exposed as a tool or IPC deserializer. */
export function createSessionExecutionContext(claims: SessionExecutionClaims): SessionExecutionContext {
  if (!['user', 'agent', 'scheduler'].includes(claims.requestSource) || typeof claims.ownerId !== 'string' || !claims.ownerId || typeof claims.scopeId !== 'string' || !claims.scopeId) throw Error('invalid_session_execution_context');
  const context = Object.freeze({ opaqueSessionExecutionContext: true as const });
  contexts.set(context, Object.freeze({ ...claims })); return context;
}
export type SessionExecutionKind = 'compound' | 'direct-mutation' | 'compaction' | 'recovery';
export interface SessionExecutionLease {
  assertCurrent(): void;
  /** Register host work before awaiting it; release cannot unlock while it runs. */
  trackInFlight<T>(work: Promise<T>): Promise<T>;
  releaseAfterDrain(): Promise<void>;
}
export interface SessionExecutionAuthority {
  acquire(input: { invocationId: string; kind: SessionExecutionKind; signal?: AbortSignal; assertAdmission?:()=>void }): Promise<SessionExecutionLease>;
  dispose(): void;
}
interface LeaseRecord { root: string; sessionIdentity: string; claims:Readonly<SessionExecutionClaims>; kind:SessionExecutionKind; invocationId:string; current(): void }
const leases = new WeakMap<object, LeaseRecord>();
const owners = new Map<string, SessionExecutionAuthority>();
const requireNative = createRequire(import.meta.url);
export function assertSessionExecutionLease(lease: SessionExecutionLease, target: { root: string; sessionIdentity: string; requestSource?:SessionExecutionClaims['requestSource']; kind?:SessionExecutionKind; allowedKinds?:readonly SessionExecutionKind[] }): void {
  const record = leases.get(lease);
  if (!record || record.root !== realpathSync(target.root) || record.sessionIdentity !== target.sessionIdentity) throw Error('invalid_session_execution_lease');
  if(target.requestSource!==undefined&&record.claims.requestSource!==target.requestSource)throw Error('session_execution_source');
  if(target.kind!==undefined&&record.kind!==target.kind||target.allowedKinds!==undefined&&!target.allowedKinds.includes(record.kind))throw Error('session_execution_kind');
  record.current();
}

export function createSessionExecutionAuthority(options: { root: string; sessionIdentity: string; hostContext: SessionExecutionContext }): SessionExecutionAuthority {
  const claims=contexts.get(options.hostContext);
  if (!claims || !/^[A-Za-z0-9_-]{1,160}$/.test(options.sessionIdentity)) throw Error('invalid_session_execution_context');
  const originalClaims:Readonly<SessionExecutionClaims>=claims;
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  if (lstatSync(options.root).isSymbolicLink()) throw Error('session_execution_root_symlink');
  const root = realpathSync(options.root), key = JSON.stringify([root, options.sessionIdentity.toLowerCase()]);
  if (owners.has(key)) throw Error('session_execution_owner_exists');
  const directory = join(root, '.session-execution');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw Error('session_execution_lock_path');
  const path = join(directory, createHash('sha256').update(options.sessionIdentity.toLowerCase()).digest('hex') + '.sqlite');
  for (const file of [path, path + '-journal', path + '-wal', path + '-shm']) {
    try { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('session_execution_lock_path'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let disposed = false, active = false;
  interface Waiter { invocationId: string; kind:SessionExecutionKind; signal?: AbortSignal; assertAdmission?:()=>void; resolve(lease: SessionExecutionLease): void; reject(error: unknown): void; abort?: () => void }
  const queue: Waiter[] = []; const invocations = new Set<string>();
  function pump(): void {
    if (disposed || active) return;
    const waiter = queue.shift(); if (!waiter) return;
    waiter.signal?.removeEventListener('abort', waiter.abort!);
    if (waiter.signal?.aborted) { invocations.delete(waiter.invocationId); waiter.reject(waiter.signal.reason); pump(); return; }
    let db: import('better-sqlite3').Database | undefined;
    try {
      const releaseRoot = acquireSaveLock(join(root, '.session-store-lock'));
      try {
      // Optional native import is reached only by explicitly enabled mechanisms.
      const Database = requireNative('better-sqlite3') as typeof import('better-sqlite3');
      if (!existsSync(path)) { try { const fd = openSync(path, 'wx', 0o600); closeSync(fd); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
      db = new Database(path, { timeout: 0 });
      db.pragma('journal_mode = DELETE'); db.pragma('synchronous = FULL'); db.exec('BEGIN EXCLUSIVE');
      syncDirectoryTreeStrict(directory);
      } finally { releaseRoot(); }
    } catch (error) { db?.close(); invocations.delete(waiter.invocationId); waiter.reject(error); pump(); return; }
    active = true; const held = db; let closing = false, released = false, release: Promise<void> | undefined;
    const pending = new Set<Promise<unknown>>();
    let checking=false;
    const current = () => { if(checking)throw Error('session_execution_admission_reentrant'); if (disposed || closing || released || !held.open || !held.inTransaction) throw Error('session_execution_lease_expired'); waiter.signal?.throwIfAborted();
      checking=true;try{const result=waiter.assertAdmission?.();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('session_execution_admission_async');}}finally{checking=false;}
      if(disposed||closing||released||!held.open||!held.inTransaction)throw Error('session_execution_lease_expired');waiter.signal?.throwIfAborted();
    };
    const lease: SessionExecutionLease = Object.freeze({
      assertCurrent: current,
      trackInFlight<T>(work: Promise<T>): Promise<T> {
        current(); const observed = Promise.resolve(work); pending.add(observed);
        void observed.then(() => pending.delete(observed), () => pending.delete(observed)); return observed;
      },
      releaseAfterDrain(): Promise<void> {
        if (release) return release;
        closing = true;
        release = (async () => {
          while (pending.size) await Promise.allSettled([...pending]);
          try { held.close(); } finally { released = true; active = false; invocations.delete(waiter.invocationId); pump(); }
        })(); return release;
      },
    });
    leases.set(lease, { root, sessionIdentity: options.sessionIdentity, claims:originalClaims, kind:waiter.kind,invocationId:waiter.invocationId,current }); waiter.resolve(lease);
  }
  const authority: SessionExecutionAuthority = Object.freeze({
    acquire(input: { invocationId: string; kind: SessionExecutionKind; signal?: AbortSignal; assertAdmission?:()=>void }): Promise<SessionExecutionLease> {
      if (disposed || !input.invocationId || !['compound', 'direct-mutation', 'compaction', 'recovery'].includes(input.kind)) return Promise.reject(Error('invalid_session_execution_request'));
      if (invocations.has(input.invocationId)) return Promise.reject(Error('session_execution_non_reentrant'));
      if (input.signal?.aborted) return Promise.reject(input.signal.reason);
      invocations.add(input.invocationId);
      return new Promise((resolve, reject) => {
        const waiter: Waiter = { invocationId: input.invocationId,kind:input.kind, signal: input.signal, assertAdmission:input.assertAdmission, resolve, reject };
        waiter.abort = () => { const index = queue.indexOf(waiter); if (index >= 0) { queue.splice(index, 1); invocations.delete(waiter.invocationId); reject(input.signal?.reason ?? Error('aborted')); } };
        input.signal?.addEventListener('abort', waiter.abort, { once: true }); queue.push(waiter); pump();
      });
    },
    dispose(): void {
      if (disposed) return;
      if (active || queue.length) throw Error('session_execution_not_drained');
      disposed = true; owners.delete(key);
    },
  });
  owners.set(key, authority); return authority;
}


/** Store writer guard. Synchronous and non-waiting: never waits for an execution
 * lock while holding a store transaction. Ordinary sessions without a registered
 * execution lock retain the optional-native startup behavior. */
export function acquireSessionStoreExecutionGuard(rootDirectory: string, sessionIdentity: string, lease?: SessionExecutionLease, rootLockHeld = false): () => void {
  if (lease) { assertSessionExecutionLease(lease, { root: rootDirectory, sessionIdentity }); return () => {}; }
  const root = realpathSync(rootDirectory);
  const releaseRoot = rootLockHeld ? () => {} : acquireSaveLock(join(root, '.session-store-lock'));
  try {
  const directory = join(root, '.session-execution');
  const path = join(directory, createHash('sha256').update(sessionIdentity.toLowerCase()).digest('hex') + '.sqlite');
  let exists = false;
  try { lstatSync(path); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!exists) return releaseRoot;
  if (lstatSync(directory).isSymbolicLink() || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw Error('session_execution_lock_path');
  const Database = requireNative('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(path, { timeout: 0, fileMustExist: true });
  try { db.exec('BEGIN EXCLUSIVE'); } catch (error) { db.close(); throw error; }
  return () => { try { db.close(); } finally { releaseRoot(); } };
  } catch (error) { releaseRoot(); throw error; }
}
