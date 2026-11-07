import {loadOriginalProcessSdk} from '../verification/original-process-sdk-loader.js';
import type * as OriginalProcessSdk from '../verification/original-process-sdk.js';
import {fileURLToPath} from 'node:url';
import type {OriginalHostWorkerRequest} from './original-host-worker-types.js';
import {readOptionalOriginalTaskStoreProtectionWorkerRequest} from './snapshot-store.js';
import {hasOriginalMainSdkBridgeInstallation} from '../verification/original-main-sdk-bridge.js';
import {withOriginalSnapshotPrepResource} from './task-runtime-host.js';
import {assertSourceSyncCustodyCurrent} from './source-sync-custody.js';
import type {StoredSessionSnapshot} from '../../ai/runtime/session-store/stored-snapshot-types.js';
import {desktopObservationSessionId,desktopObservationSessionsRoot,assertInitializedSnapshot,readDesktopTaskProtection} from './protected-observation-reader.js';
import {SESSION_ALIAS_HOLDER_DIRECTORY} from '../../ai/runtime/session-store/aliases.js';
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
import { saveOriginalFileStoreSession,readOriginalFileStoreSession,readOriginalFileStoreAlias,FileSessionStore, isConfirmedFileSessionPrecommitRejection } from '../../ai/runtime/session-store/file-store.js';
import { mergeProtectedObservationClosures, type ProtectedObservationClosure } from '../../ai/runtime/protected-observation-closure.js';

export {desktopObservationSessionId} from './protected-observation-reader.js';
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

interface ExecutionPersistenceTracking {
  run<T>(work: () => Promise<T>): Promise<T>;
  write<T>(work: () => Promise<T>, confirmedRejection?: (originalPromise: Promise<T>) => boolean): Promise<T>;
}
const observationWorkerBirths=new WeakMap<object,{source(taskId:string):Readonly<OriginalHostWorkerRequest>;read(taskId:string,ticket?:unknown):Promise<{closure?:ProtectedObservationClosure;executionProtected?:true}>}>();
const observationWorkerApply=Reflect.apply,observationWorkerGet=WeakMap.prototype.get,observationWorkerSet=WeakMap.prototype.set;
const observationWorkerFreeze=Object.freeze,ObservationWorkerError=Error;
export function readOriginalTaskObservationWorkerSource(provider:unknown,taskId:string):Readonly<OriginalHostWorkerRequest>{
 const birth=observationWorkerApply(observationWorkerGet,observationWorkerBirths,[provider]) as {source(taskId:string):Readonly<OriginalHostWorkerRequest>}|undefined;
 if(!birth)throw new ObservationWorkerError('TASK_OBSERVATION_ORIGINAL_PROVIDER_REQUIRED');return birth.source(taskId);
}
export function readOriginalTaskObservationProtectionInWorker(provider:unknown,taskId:string,ticket?:unknown):Promise<{closure?:ProtectedObservationClosure;executionProtected?:true}>{
 const birth=observationWorkerApply(observationWorkerGet,observationWorkerBirths,[provider]) as {read(taskId:string,ticket?:unknown):Promise<{closure?:ProtectedObservationClosure;executionProtected?:true}>}|undefined;
 if(!birth)throw new ObservationWorkerError('TASK_OBSERVATION_ORIGINAL_PROVIDER_REQUIRED');return birth.read(taskId,ticket);
}
export class DesktopTaskObservationStore {
  #workerEpoch=0;
  readonly #sessions: FileSessionStore;
  readonly #root:string;
  #canonicalRoot = getConfigDir('compound-sessions');
  #alias(taskId: string,context?:object) {
    const store=new FileSessionStore(this.#canonicalRoot),holder={holderRoot:this.#root,holderId:taskId};return context===undefined?store.loadSessionAliasSync(holder):readOriginalFileStoreAlias(store,holder,context);
  }
  #assertNotAlias(taskId: string) { if(this.#alias(taskId)) throw Error('session_alias_read_only'); }
  /** Validates already committed canonical facts; never writes either history. */
  publishCanonicalFacts(taskId: string, snapshot: AgentSessionSnapshot): boolean {
    const alias = this.#alias(taskId); if (!alias) return false;
    if (!isDeepStrictEqual(toDurableSessionSnapshot(snapshot), toDurableSessionSnapshot(alias.snapshot))) throw Error('session_alias_publication_mismatch');
    return true;
  }
  constructor(root: string, canonicalRoot?: string) {
    this.#root=root;
    this.#sessions = new FileSessionStore(desktopObservationSessionsRoot(root));
    if (canonicalRoot !== undefined) this.#canonicalRoot = canonicalRoot;
    observationWorkerApply(observationWorkerSet,observationWorkerBirths,[this,{
     source:(taskId:string)=>{
      if(typeof taskId!=='string'||!taskId)throw new ObservationWorkerError('SOL_PI_DESKTOP_TASK_ID_INVALID');const epoch=this.#workerEpoch;let failed=false;
      const current=()=>{if(failed||epoch!==this.#workerEpoch){failed=true;throw new ObservationWorkerError('TASK_OBSERVATION_WORKER_SOURCE_CHANGED');}};
      return observationWorkerFreeze({workerKind:'protection_read' as const,entry:fileURLToPath(new URL('./protection-read-worker.js',import.meta.url)),
       options:observationWorkerFreeze({workerData:observationWorkerFreeze({root:resolve(this.#root),canonicalRoot:resolve(this.#canonicalRoot),taskId}),execArgv:observationWorkerFreeze([]) as unknown as string[],stdout:true,stderr:true,resourceLimits:observationWorkerFreeze({maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32,stackSizeMb:4})}),assertCurrent:current,assertLocal:current});
     },
     read:(taskId:string,ticket?:unknown)=>withOriginalSnapshotPrepResource(()=>this.#readProtectionInWorkerOriginal(taskId,ticket)),
    }]);
  }
  /** Host-only raw read. Cancellation abandons its caller, never this thread.
   * Only actual thread exit confirms completion of the original FileStore IO. */
  readProtectionInWorker(taskId: string): Promise<{closure?: ProtectedObservationClosure; executionProtected?: true}> {
    return readOriginalTaskObservationProtectionInWorker(this,taskId);
  }
  async #readProtectionInWorkerOriginal(taskId: string,ticket?:unknown): Promise<{closure?: ProtectedObservationClosure; executionProtected?: true}> {
    const unavailable = () => Object.assign(Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE'), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
    const request=hasOriginalMainSdkBridgeInstallation()?readOptionalOriginalTaskStoreProtectionWorkerRequest(ticket,this,taskId):undefined;
    if(hasOriginalMainSdkBridgeInstallation()&&!request)throw new ObservationWorkerError('TASK_OBSERVATION_WORKER_SOURCE_REQUIRED');
    const sdk=request?await loadOriginalProcessSdk():undefined;
    let owned:Awaited<ReturnType<typeof OriginalProcessSdk.createOriginalHostWorker>>|undefined;
    if(sdk)owned=await sdk.createOriginalHostWorker(ticket);
    let primary:{error:unknown}|undefined,value:{closure?:ProtectedObservationClosure;executionProtected?:true}|undefined;
    try{value=await new Promise<{closure?:ProtectedObservationClosure;executionProtected?:true}>((yes, no) => {
      let response: {closure?: ProtectedObservationClosure; executionProtected?: true} | undefined;
      let received = false, failed = false;
      let worker: Worker;
      try {
        if(!request){
          desktopObservationSessionId(taskId);
          const root = resolve(this.#root), canonicalRoot = resolve(this.#canonicalRoot);
          // Only fresh, explicit absence is ordinary. Any existing path or
          // uncertain metadata retains the original Worker and physical IO owner.
          const directories = [canonicalRoot, join(root, SESSION_ALIAS_HOLDER_DIRECTORY), desktopObservationSessionsRoot(root)];
          if (directories.every(directory => {
            try { lstatSync(directory); return false; }
            catch (error) { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
          })) {
            yes({ closure: mergeProtectedObservationClosures(undefined, undefined) });
            return;
          }
        }
        const entry = new URL(import.meta.url.endsWith('.ts') ? './protection-read-worker.ts' : './protection-read-worker.js', import.meta.url);
        worker = owned?owned.handle:new Worker(entry, { workerData: { root: resolve(this.#root), canonicalRoot: resolve(this.#canonicalRoot), taskId }, stdout: true, stderr: true });
      } catch { no(unavailable()); return; }
      const listen=(event:string,fn:Function)=>{if(owned)sdk!.listenOriginalToolProcess(owned.attempt,'child',event,fn);else worker.on(event,fn as (...args:any[])=>void);};
      if(owned){sdk!.listenOriginalToolProcess(owned.attempt,'stdout','data',()=>{});sdk!.listenOriginalToolProcess(owned.attempt,'stderr','data',()=>{});}else{worker.stdout?.resume();worker.stderr?.resume();}
      listen('error', () => { failed = true; });
      listen('message', (message: unknown) => {
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
      listen('exit', (code:number) => {
        if (code !== 0 || failed || !received || !response) no(unavailable());
        else yes(response);
      });
      if(owned)sdk!.sealOriginalToolProcessListeners(owned.attempt);
    });}catch(error){primary={error};}
    if(owned)try{await sdk!.waitOriginalToolProcessPhysical(owned.attempt);}catch(error){if(!primary)primary={error};else if(primary.error!==error)primary={error:new AggregateError([primary.error,error],'protection_worker_read_and_drain_failed',{cause:primary.error})};}
    if(primary)throw primary.error;return value!;
  }
  /** Main-only complete durable view, including registered canonical aliases.
   * It returns no writer and never derives a root from an untrusted marker. */
  async loadSessionSnapshot(taskId:string):Promise<StoredSessionSnapshot|null>{
    return this.#alias(taskId)?.snapshot??await this.#sessions.load(desktopObservationSessionId(taskId));
  }
  readProtection(taskId: string,context?:object): Promise<{closure?: ProtectedObservationClosure; executionProtected?: true}> {
    return readDesktopTaskProtection(taskId,{loadAlias:id=>this.#alias(id,context),loadSession:async id=>context===undefined?this.#sessions.load(id):readOriginalFileStoreSession(this.#sessions,id,context)});
  }
  async read(taskId: string): Promise<ProtectedObservationClosure | undefined> { return (await this.readProtection(taskId)).closure; }
  readProtectionSync(taskId: string): {closure?: ProtectedObservationClosure; executionProtected?: true} {
    const sessionId = desktopObservationSessionId(taskId), file = join(desktopObservationSessionsRoot(this.#root), `${sessionId}.json`);
    try {
      const alias = this.#alias(taskId);
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
    const sessions = layout ? new FileSessionStore(layout.canonicalRoot) : this.#sessions;
    const sessionId = desktopObservationSessionId(taskId);
    const root = layout?.canonicalRoot ?? join(this.#root, 'protected-observation-sessions');
    const check = (id: string) => { assertCurrent(); if (id !== sessionId) throw Error('SOL_PI_DESKTOP_SESSION_MISMATCH'); if (!layout) this.#assertNotAlias(taskId); };
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
        if (layout || !next.sourceRoots.includes(join(this.#root, 'protected-observation-sessions'))) throw Error('session_alias_source_unregistered');
        this.#workerEpoch++;this.#canonicalRoot = next.canonicalRoot;
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
        await write(async () => { mkdirSync(this.#root,{recursive:true,mode:0o700});
        await sessions.registerSessionAlias({aliasId:createHash('sha256').update(JSON.stringify([this.#root,taskId])).digest('hex'),holderRoot:this.#root,holderId:taskId,targetSessionId:sessionId,domainInitializationId:binding.initializationId,domainGeneration:binding.generation,requestSource:'agent',lease}); }); });
       },
       registerAlias: async (domain: ReturnType<typeof openCompoundExecutionDomain>, lease: SessionExecutionLease) => {
        check(sessionId); const binding=getCompoundExecutionDomainBinding(domain);
        if(binding.storeRoot!==root || binding.canonicalSessionId!==sessionId) throw Error('session_alias_domain_mismatch');
        return run(() => write(async () => { mkdirSync(this.#root, {recursive:true, mode:0o700});
        await sessions.registerSessionAlias({aliasId:createHash('sha256').update(JSON.stringify([this.#root,taskId])).digest('hex'),
          holderRoot:this.#root,holderId:taskId,targetSessionId:sessionId,domainInitializationId:binding.initializationId,
          domainGeneration:binding.generation,requestSource:'agent',lease}); }));
      }} : {}), initialize: async (snapshot: PersistedSessionSnapshot, lease: SessionExecutionLease) => {
      check(snapshot.sessionId);
      if (snapshot.messages.length || snapshot.protectedObservationClosure || snapshot.semanticCompaction || snapshot.compoundOperations) throw Error('SOL_PI_DESKTOP_FRESH_SESSION_REQUIRED');
      return run(async () => { if (await load(sessionId)) throw Error('SOL_PI_DESKTOP_ALREADY_INITIALIZED');
      await store.compareAndSave!({ expectedStoreRevision: 0, expectedHistoryDigest: computeSessionHistoryDigest({ messages: [] }), nextSnapshot: snapshot, lease }); });
    } });
  }
  async save(taskId: string, closure: ProtectedObservationClosure,sourceContext?:object): Promise<void> {
    if(sourceContext!==undefined)assertSourceSyncCustodyCurrent(sourceContext);const alias=this.#alias(taskId,sourceContext);
    if(alias){
      const actual=alias.snapshot.protectedObservationClosure;
      if(!actual||!isDeepStrictEqual(mergeProtectedObservationClosures(actual,closure),actual))throw Error('session_alias_closure_not_durable');
      if(sourceContext!==undefined)assertSourceSyncCustodyCurrent(sourceContext);return;
    }
    const previous = await (sourceContext===undefined?this.#sessions.load(desktopObservationSessionId(taskId)):readOriginalFileStoreSession(this.#sessions,desktopObservationSessionId(taskId),sourceContext));
    if(sourceContext!==undefined)assertSourceSyncCustodyCurrent(sourceContext);
    if (previous && !previous.protectedObservationClosure) assertInitializedSnapshot(previous);
    const validated = mergeProtectedObservationClosures(previous?.protectedObservationClosure, closure)!;
    if (previous && isDeepStrictEqual(previous.protectedObservationClosure, validated)) return;
    const session = new AgentSessionState();
    const next={ ...(previous ?? session.exportSnapshot()), sessionId: desktopObservationSessionId(taskId),
      protectedObservationClosure: validated };
    if(sourceContext===undefined)await this.#sessions.save(next);else await saveOriginalFileStoreSession(this.#sessions,next,sourceContext);
    if(sourceContext!==undefined)assertSourceSyncCustodyCurrent(sourceContext);
  }
  async persistSession(taskId: string, snapshot: AgentSessionSnapshot): Promise<void> {
    this.#assertNotAlias(taskId);
    if (snapshot.sessionId !== desktopObservationSessionId(taskId)) throw new Error('SOL_PI_DESKTOP_SESSION_MISMATCH');
    if (!snapshot.protectedObservationClosure) {
      const previous = await this.#sessions.load(snapshot.sessionId);
      if (!previous) throw Error('SOL_PI_DESKTOP_INITIALIZATION_REQUIRED');
      assertInitializedSnapshot(previous);
    }
    await this.#sessions.save(snapshot);
  }
}

// Capture after the class initializes; fixed function exports keep a cyclic
// Host/Store import from dereferencing a not-yet-initialized class. Callers
// still need the actual observation instance's private fields.
const originalObservationRead=DesktopTaskObservationStore.prototype.readProtection;
const originalObservationSave=DesktopTaskObservationStore.prototype.save;
const observationApply=Reflect.apply;
export function readOriginalTaskObservationProtection(this:DesktopTaskObservationStore,...args:Parameters<DesktopTaskObservationStore['readProtection']>):ReturnType<DesktopTaskObservationStore['readProtection']>{
 return observationApply(originalObservationRead,this,args);
}
export function saveOriginalTaskObservationProtection(this:DesktopTaskObservationStore,...args:Parameters<DesktopTaskObservationStore['save']>):ReturnType<DesktopTaskObservationStore['save']>{
 return observationApply(originalObservationSave,this,args);
}
