import { assertCompoundHostStorage, type CompoundHostStorage } from '../sol-pi/compound-host-storage.js';
import { getCompoundExecutionDomainBinding, type openCompoundExecutionDomain } from '../sol-pi/compound-execution-domain.js';
import { getConfigDir } from '../../utils/config.js';
import { isDeepStrictEqual } from 'node:util';
import { computeSessionHistoryDigest, toDurableSessionSnapshot, type SessionStore, type PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import {assertSessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import {getSessionExecutionAncestorLease} from '../../ai/runtime/session-store/execution-chain.js';
import {getManagedCompoundAdmissionBinding,type ManagedCompoundAdmission} from '../sol-pi/compound-managed-admission.js';
import { readFileSync, lstatSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { AgentSessionState, type AgentSessionSnapshot } from '../../ai/runtime/session.js';
import { FileSessionStore, isConfirmedFileSessionPrecommitRejection } from '../../ai/runtime/session-store/file-store.js';
import { mergeProtectedObservationClosures, type ProtectedObservationClosure } from '../../ai/runtime/protected-observation-closure.js';

export function desktopObservationSessionId(taskId: string): string {
  if (!taskId || typeof taskId !== 'string') throw new Error('SOL_PI_DESKTOP_TASK_ID_INVALID');
  return `desktop-observation-${createHash('sha256').update(taskId).digest('hex')}`;
}
/** Main-owned session sidecar. No delete/clear API: stale task journals cannot erase protection or execution ledgers. */
export interface DesktopExecutionPersistence {
  readonly root: string;
  readonly store: SessionStore;
  routeCanonical?(layout: CompoundHostStorage): DesktopExecutionPersistence;
  registerAlias?(domain: ReturnType<typeof openCompoundExecutionDomain>, lease: SessionExecutionLease): Promise<void>;
  getCompoundTreeStore?(domain: ReturnType<typeof openCompoundExecutionDomain>): SessionStore;
  registerManagedAlias?(admission:ManagedCompoundAdmission,domain:ReturnType<typeof openCompoundExecutionDomain>,lease:SessionExecutionLease):Promise<void>;
  initialize(snapshot: PersistedSessionSnapshot, lease: SessionExecutionLease): Promise<void>;
}
function assertInitializedSnapshot(snapshot: PersistedSessionSnapshot): void {
  if (snapshot.executionProtected !== true || !Number.isSafeInteger(snapshot.storeRevision) || snapshot.storeRevision! < 1
    || snapshot.historyDigest !== computeSessionHistoryDigest(snapshot)) throw Error('SOL_PI_DESKTOP_INITIALIZATION_REQUIRED');
  toDurableSessionSnapshot(snapshot);
}
interface ExecutionPersistenceTracking {
  run<T>(work: () => Promise<T>): Promise<T>;
  write<T>(work: () => Promise<T>, confirmedRejection?: (originalPromise: Promise<T>) => boolean): Promise<T>;
}
export class DesktopTaskObservationStore {
  private readonly sessions: FileSessionStore;
  private canonicalRoot = getConfigDir('compound-sessions');
  private alias(taskId: string) {
    return new FileSessionStore(this.canonicalRoot).loadSessionAliasSync({holderRoot: this.root, holderId: taskId});
  }
  private assertNotAlias(taskId: string) { if(this.alias(taskId)) throw Error('session_alias_read_only'); }
  /** Validates already committed canonical facts; never writes either history. */
  publishCanonicalFacts(taskId: string, snapshot: AgentSessionSnapshot): boolean {
    const alias = this.alias(taskId); if (!alias) return false;
    if (!isDeepStrictEqual(toDurableSessionSnapshot(snapshot), toDurableSessionSnapshot(alias.snapshot))) throw Error('session_alias_publication_mismatch');
    return true;
  }
  constructor(private readonly root: string, canonicalRoot?: string) {
    this.sessions = new FileSessionStore(join(root, 'protected-observation-sessions'));
    if (canonicalRoot !== undefined) this.canonicalRoot = canonicalRoot;
  }
  /** Host-only raw read. Cancellation abandons its caller, never this thread.
   * Only actual thread exit confirms completion of the original FileStore IO. */
  readProtectionInWorker(taskId: string): Promise<{closure?: ProtectedObservationClosure; executionProtected?: true}> {
    const unavailable = () => Object.assign(Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE'), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
    return new Promise((yes, no) => {
      let response: {closure?: ProtectedObservationClosure; executionProtected?: true} | undefined;
      let received = false, failed = false;
      let worker: Worker;
      try {
        desktopObservationSessionId(taskId);
        const entry = new URL(import.meta.url.endsWith('.ts') ? './protection-read-worker.ts' : './protection-read-worker.js', import.meta.url);
        worker = new Worker(entry, { workerData: { root: resolve(this.root), canonicalRoot: resolve(this.canonicalRoot), taskId }, stdout: true, stderr: true });
      } catch { no(unavailable()); return; }
      worker.stdout?.resume(); worker.stderr?.resume();
      worker.on('error', () => { failed = true; });
      worker.on('message', (message: unknown) => {
        if (received) { failed = true; return; }
        received = true;
        try {
          if (!message || typeof message !== 'object' || Array.isArray(message)) throw unavailable();
          const envelope = message as Record<string, unknown>;
          if (Object.keys(envelope).length !== 2 || envelope.taskId !== taskId || !Object.hasOwn(envelope, 'protection')) throw unavailable();
          const value = envelope.protection;
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
          const facts = value as Record<string, unknown>;
          if (Object.keys(facts).some(key => key !== 'closure' && key !== 'executionProtected')
            || facts.executionProtected !== undefined && facts.executionProtected !== true) throw unavailable();
          const closure = mergeProtectedObservationClosures(undefined, facts.closure as ProtectedObservationClosure | undefined);
          response = { closure, ...(facts.executionProtected ? { executionProtected: true as const } : {}) };
        } catch { failed = true; }
      });
      worker.once('exit', code => {
        if (code !== 0 || failed || !received || !response) no(unavailable());
        else yes(response);
      });
    });
  }
  /** Main-only complete durable view, including registered canonical aliases.
   * It returns no writer and never derives a root from an untrusted marker. */
  async loadSessionSnapshot(taskId:string):Promise<PersistedSessionSnapshot|null>{
    return this.alias(taskId)?.snapshot??await this.sessions.load(desktopObservationSessionId(taskId));
  }
  async readProtection(taskId: string): Promise<{closure?: ProtectedObservationClosure; executionProtected?: true}> {
    try {
      const snapshot = this.alias(taskId)?.snapshot ?? await this.sessions.load(desktopObservationSessionId(taskId));
      if (snapshot && (!snapshot.protectedObservationClosure || snapshot.executionProtected !== undefined)) assertInitializedSnapshot(snapshot);
      return { closure: mergeProtectedObservationClosures(undefined, snapshot?.protectedObservationClosure),
        ...(snapshot?.executionProtected ? { executionProtected: true as const } : {}) };
    } catch (cause) { throw Object.assign(new Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE', { cause }), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' }); }
  }
  async read(taskId: string): Promise<ProtectedObservationClosure | undefined> { return (await this.readProtection(taskId)).closure; }
  readProtectionSync(taskId: string): {closure?: ProtectedObservationClosure; executionProtected?: true} {
    const sessionId = desktopObservationSessionId(taskId), file = join(this.root, 'protected-observation-sessions', `${sessionId}.json`);
    try {
      const alias = this.alias(taskId);
      if (alias) {
        assertInitializedSnapshot(alias.snapshot);
        return {closure: mergeProtectedObservationClosures(undefined, alias.snapshot.protectedObservationClosure), executionProtected: true};
      }
      const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('invalid sidecar');
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (value.schemaVersion !== 1 || value.sessionId !== sessionId) throw Error('invalid sidecar');
      if (!value.protectedObservationClosure || value.executionProtected !== undefined) assertInitializedSnapshot(value);
      return { closure: mergeProtectedObservationClosures(undefined, value.protectedObservationClosure),
        ...(value.executionProtected ? { executionProtected: true as const } : {}) };
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw Object.assign(new Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE', { cause }), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' }); }
  }
  readSync(taskId: string): ProtectedObservationClosure | undefined { return this.readProtectionSync(taskId).closure; }
  getExecutionPersistence(taskId: string, assertCurrent: () => void, tracking?: ExecutionPersistenceTracking): DesktopExecutionPersistence {
    return this.executionPersistence(taskId, assertCurrent, undefined, tracking);
  }
  private executionPersistence(taskId: string, assertCurrent: () => void, layout?: CompoundHostStorage, tracking?: ExecutionPersistenceTracking): DesktopExecutionPersistence {
    assertCurrent();
    const run = <T>(work: () => Promise<T>): Promise<T> => tracking ? tracking.run(work) : work();
    const write = <T>(work: () => Promise<T>, method?: 'save' | 'compareAndSave'): Promise<T> => tracking ? tracking.write(work, method ? original => isConfirmedFileSessionPrecommitRejection(sessions, method, original) : undefined) : work();
    const sessions = layout ? new FileSessionStore(layout.canonicalRoot) : this.sessions;
    const sessionId = desktopObservationSessionId(taskId);
    const root = layout?.canonicalRoot ?? join(this.root, 'protected-observation-sessions');
    const check = (id: string) => { assertCurrent(); if (id !== sessionId) throw Error('SOL_PI_DESKTOP_SESSION_MISMATCH'); if (!layout) this.assertNotAlias(taskId); };
    const denied = () => { assertCurrent(); throw Error('SOL_PI_DESKTOP_EXECUTION_STORE_OPERATION_DENIED'); };
    const load = async (id: string) => { check(id); const result = await sessions.load(id); check(id); return result; };
    const store: SessionStore = Object.freeze<SessionStore>({
      load, loadLast: () => load(sessionId), list: async () => denied(), fork: async () => denied(),
      save: async (snapshot, options) => { check(snapshot.sessionId); return run(async () => { await write(() => sessions.save(snapshot, options), 'save'); check(snapshot.sessionId); }); },
      compareAndSave: async input => {
        check(input.nextSnapshot.sessionId);
        return run(async () => { const receipt = await write(() => sessions.compareAndSave({ ...input, beforeCommit: () => {
          check(input.nextSnapshot.sessionId); return input.beforeCommit?.();
        } }), 'compareAndSave');
        check(input.nextSnapshot.sessionId); return receipt; });
      },
      onCommit: listener => {
        assertCurrent(); return sessions.onCommit(snapshot => {
          if (snapshot.sessionId === sessionId) { assertCurrent(); return listener(snapshot); }
        });
      },
    });
    return Object.freeze({ root, store,
      routeCanonical: (next: CompoundHostStorage) => {
        assertCurrent(); assertCompoundHostStorage(next);
        if (layout || !next.sourceRoots.includes(join(this.root, 'protected-observation-sessions'))) throw Error('session_alias_source_unregistered');
        this.canonicalRoot = next.canonicalRoot;
        return this.executionPersistence(taskId, assertCurrent, next, tracking);
      },
      ...(layout ? {
       getCompoundTreeStore:(domain:ReturnType<typeof openCompoundExecutionDomain>)=>{
        check(sessionId);const binding=getCompoundExecutionDomainBinding(domain);
        if(binding.storeRoot!==root||binding.canonicalSessionId!==sessionId)throw Error('session_alias_domain_mismatch');
        // The main factory retains this exact instance, including its commit
        // notifications. It is never exposed to renderer or model arguments.
        return sessions;
       },
       registerManagedAlias:async(admission:ManagedCompoundAdmission,domain:ReturnType<typeof openCompoundExecutionDomain>,lease:SessionExecutionLease)=>{
        check(sessionId);const binding=getCompoundExecutionDomainBinding(domain),cap=getManagedCompoundAdmissionBinding(admission);
        if(binding.storeRoot!==root||cap.childSessionId!==sessionId)throw Error('session_alias_domain_mismatch');
        assertSessionExecutionLease(lease,{root,sessionIdentity:sessionId});
        const ancestor=getSessionExecutionAncestorLease(lease,{root,sessionIdentity:binding.canonicalSessionId});
        domain.assertForEffect(ancestor);
        getSessionExecutionAncestorLease(lease,{root,sessionIdentity:cap.parentSessionId});
        return run(async () => { const parent=await sessions.load(cap.parentSessionId),row=parent?.compoundOperations?.directOperations?.find(item=>item.id===cap.parentOperationId);
        const child=await sessions.load(sessionId);lease.assertCurrent();domain.assertForEffect(ancestor);check(sessionId);
        if(!child)throw Error('session_alias_child_uninitialized');assertInitializedSnapshot(child);
        if(row?.stage!=='started'||row.delegation?.admissionId!==cap.admissionId||row.delegation.generation!==cap.admissionGeneration||row.delegation.state!=='live'||row.delegation.childPhase!=='not_started'||row.delegation.childSessionIdentity!==sessionId||row.delegation.childStoreRoot!==root||row.delegation.managed?.operationId!==cap.operationId||row.delegation.managed.groupId!==cap.groupId||row.delegation.managed.agentId!==cap.agentId||row.delegation.managed.rootEpoch!==cap.rootEpoch)throw Error('session_alias_child_admission_mismatch');
        await write(async () => { mkdirSync(this.root,{recursive:true,mode:0o700});
        await sessions.registerSessionAlias({aliasId:createHash('sha256').update(JSON.stringify([this.root,taskId])).digest('hex'),holderRoot:this.root,holderId:taskId,targetSessionId:sessionId,domainInitializationId:binding.initializationId,domainGeneration:binding.generation,requestSource:'agent',lease}); }); });
       },
       registerAlias: async (domain: ReturnType<typeof openCompoundExecutionDomain>, lease: SessionExecutionLease) => {
        check(sessionId); const binding=getCompoundExecutionDomainBinding(domain);
        if(binding.storeRoot!==root || binding.canonicalSessionId!==sessionId) throw Error('session_alias_domain_mismatch');
        return run(() => write(async () => { mkdirSync(this.root, {recursive:true, mode:0o700});
        await sessions.registerSessionAlias({aliasId:createHash('sha256').update(JSON.stringify([this.root,taskId])).digest('hex'),
          holderRoot:this.root,holderId:taskId,targetSessionId:sessionId,domainInitializationId:binding.initializationId,
          domainGeneration:binding.generation,requestSource:'agent',lease}); }));
      }} : {}), initialize: async (snapshot: PersistedSessionSnapshot, lease: SessionExecutionLease) => {
      check(snapshot.sessionId);
      if (snapshot.messages.length || snapshot.protectedObservationClosure || snapshot.semanticCompaction || snapshot.compoundOperations) throw Error('SOL_PI_DESKTOP_FRESH_SESSION_REQUIRED');
      return run(async () => { if (await load(sessionId)) throw Error('SOL_PI_DESKTOP_ALREADY_INITIALIZED');
      await store.compareAndSave!({ expectedStoreRevision: 0, expectedHistoryDigest: computeSessionHistoryDigest({ messages: [] }), nextSnapshot: snapshot, lease }); });
    } });
  }
  async save(taskId: string, closure: ProtectedObservationClosure): Promise<void> {
    const alias=this.alias(taskId);
    if(alias){
      const actual=alias.snapshot.protectedObservationClosure;
      if(!actual||!isDeepStrictEqual(mergeProtectedObservationClosures(actual,closure),actual))throw Error('session_alias_closure_not_durable');
      return;
    }
    const previous = await this.sessions.load(desktopObservationSessionId(taskId));
    if (previous && !previous.protectedObservationClosure) assertInitializedSnapshot(previous);
    const validated = mergeProtectedObservationClosures(previous?.protectedObservationClosure, closure)!;
    if (previous && isDeepStrictEqual(previous.protectedObservationClosure, validated)) return;
    const session = new AgentSessionState();
    await this.sessions.save({ ...(previous ?? session.exportSnapshot()), sessionId: desktopObservationSessionId(taskId),
      protectedObservationClosure: validated });
  }
  async persistSession(taskId: string, snapshot: AgentSessionSnapshot): Promise<void> {
    this.assertNotAlias(taskId);
    if (snapshot.sessionId !== desktopObservationSessionId(taskId)) throw new Error('SOL_PI_DESKTOP_SESSION_MISMATCH');
    if (!snapshot.protectedObservationClosure) {
      const previous = await this.sessions.load(snapshot.sessionId);
      if (!previous) throw Error('SOL_PI_DESKTOP_INITIALIZATION_REQUIRED');
      assertInitializedSnapshot(previous);
    }
    await this.sessions.save(snapshot);
  }
}
