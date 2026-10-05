import {persistCompoundPublicationSnapshot} from './product-compound-coordinator.js';
import {getCompoundPublicationWindowOrigin} from './compound-publication-producer.js';
import type {SemanticSummaryProviderScope} from './semantic-summary-attempt.js';
import type {CompoundOperationRecord} from './compound-operation.js';
import {assertManagedFollowupInvocationCurrent} from './compound-managed-message.js';
import {inspectCompoundLiveTree} from './compound-live-tree.js';
import {assertCompoundProviderLiveReservations} from './compound-provider-admission.js';
import type {PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {AgentSessionState} from '../../ai/runtime/session.js';
import type {CompoundRegistryExecutionPort} from '../../ai/tools/index.js';
import {acquireSessionExecutionChain,acquireSessionExecutionFactChain,createSessionExecutionChain,getSessionExecutionAncestorLease,getHeldSessionExecutionChainPath,type SessionExecutionChain} from '../../ai/runtime/session-store/execution-chain.js';
import {createSessionExecutionAuthority,createSessionExecutionContext,type SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import {computeSessionHistoryDigest,type SessionStore} from '../../ai/runtime/session-store/store.js';
import {captureManagedCompoundAdmission,type ManagedCompoundAdmission} from './compound-managed-admission.js';
import {getManagedCompoundSpawnAdapter,type ManagedCompoundSpawnAdapter} from './compound-managed-tool.js';
import {advanceDirectOperation,type DirectOperationRecord} from './compound-direct-operation.js';
import {createCompoundChildInstallation,type BoundCompoundCoordinatorInput,type CompoundTreeOwner} from './compound-child-installation.js';
import {abortablePreparation} from './compound-execution-coordinator.js';
import type {ProductCompoundCoordinator} from './product-compound-coordinator.js';
import type {ObservationSessionOwner} from './observation-session-owner.js';

type Request=Parameters<CompoundRegistryExecutionPort['execute']>[0];
type WithLease=<T>(callback:(lease:SessionExecutionLease)=>Promise<T>,signal?:AbortSignal)=>Promise<T>;
type Installation=ReturnType<typeof createCompoundChildInstallation>;
export interface PreparedManagedCompoundChild {
 readonly admission:ManagedCompoundAdmission;
 readonly installChildExecution:Installation['install'];
 onResourcesReleased(receipt:unknown):Promise<void>;
 readonly persistence:Readonly<{root:string;store:SessionStore}>;
}
export interface PrepareManagedCompoundChildInput {
 preparation:unknown;childSession:AgentSessionState;
 /** Fixed main bootstrap registration; never passed in a model/tool context. */
 registerPersistence?(input:Readonly<{admission:ManagedCompoundAdmission;lease:SessionExecutionLease}>):Promise<void>;
}
interface Invocation {
 readonly request:Request;readonly adapter:Readonly<ManagedCompoundSpawnAdapter>;readonly withLease:WithLease;
 readonly signal:AbortSignal;readonly permissionGeneration:number;readonly record:DirectOperationRecord;
 readonly finalInputHash:string;open:boolean;preparing:boolean;state?:State;
}
interface State {
 readonly record:DirectOperationRecord;readonly admission:ManagedCompoundAdmission;readonly installation:Installation;readonly adapter:Readonly<ManagedCompoundSpawnAdapter>;
 readonly toolUseId:string;ackReady:boolean;prefixLength?:number;prefixDigest?:string;resourceDigest?:string;
}
const treeSupervision=new WeakMap<CompoundTreeOwner,Map<string,(snapshot:PersistedSessionSnapshot,descendant?:string,metadataOrigin?:Readonly<{session:AgentSessionState;nativeInvocationId:string}>,candidate?:PersistedSessionSnapshot,issued?:Readonly<{sessionIdentity:string;record:DirectOperationRecord|CompoundOperationRecord}>)=>void>>();
const turnOrigins=new WeakMap<CompoundTreeOwner,Map<string,()=>Readonly<{session:AgentSessionState;nativeInvocationId:string}>|undefined>>();
const publicationOwners=new WeakMap<ObservationSessionOwner,Readonly<{session:AgentSessionState;tree:CompoundTreeOwner;providerAdmission?:import('./compound-provider-admission.js').ProviderAncestorAdmission;assertCurrent():void}>>();
/** Issued only by the actual coordinator lifecycle, never from an owner-shaped
 * DTO or a caller-selected tree. Ordinary owners have no compound producer. */
export function getCompoundPublicationOwnerBinding(owner:ObservationSessionOwner){return publicationOwners.get(owner);}
/** Read-only consumer of actual lifecycle registrations; no public registration
 * callback, serialized tree, or caller-named "live" method issues supervision. */
export function assertManagedCompoundBranchesCurrent(tree:CompoundTreeOwner,lease:SessionExecutionLease):()=>void{return captureBranches(tree,lease,new Map());}
/** Preparation-only inspection. The caller has just authenticated Main's
 * original preparation; the lifecycle still verifies the actual in-flight
 * metadata invocation before allowing that one row in the complete census. */
export function captureCompoundFollowupPreparationSupervision(tree:CompoundTreeOwner,lease:SessionExecutionLease,origin?:Readonly<{session:AgentSessionState;nativeInvocationId:string}>):()=>void{return captureBranches(tree,lease,new Map(),origin);}

export function captureCompoundExistingBranchSupervision(tree:CompoundTreeOwner,chain:SessionExecutionChain,leafLease:SessionExecutionLease,candidate?:PersistedSessionSnapshot,record?:DirectOperationRecord|CompoundOperationRecord):()=>void{
 const path=getHeldSessionExecutionChainPath(chain,leafLease),descendants=new Map<string,string>();
 if(path[0]?.root!==tree.root||path[0]?.sessionIdentity!==tree.sessionIdentity)throw Error('compound_tree_chain_root');
 for(let i=0;i<path.length-1;i++)descendants.set(path[i].sessionIdentity,path[i+1].sessionIdentity);
 const turnOrigin=turnOrigins.get(tree)?.get(path.at(-1)!.sessionIdentity)?.();
 const windowOrigin=getCompoundPublicationWindowOrigin(tree);
 const origin=turnOrigin??windowOrigin;
 const check=captureBranches(tree,getSessionExecutionAncestorLease(leafLease,tree),descendants,origin,candidate,record?{sessionIdentity:path.at(-1)!.sessionIdentity,record}:undefined);
 return ()=>{if(!turnOrigin&&windowOrigin&&getCompoundPublicationWindowOrigin(tree)!==windowOrigin)throw Error('compound_publication_window_origin_expired');check();};
}
export function captureCompoundSemanticSupervision(tree:CompoundTreeOwner,lease:SessionExecutionLease,semanticScope:SemanticSummaryProviderScope):()=>void{return captureBranches(tree,lease,new Map(),undefined,undefined,undefined,semanticScope);}
function captureBranches(tree:CompoundTreeOwner,lease:SessionExecutionLease,descendants:ReadonlyMap<string,string>,origin?:Readonly<{session:AgentSessionState;nativeInvocationId:string}>,candidate?:PersistedSessionSnapshot,issued?:Readonly<{sessionIdentity:string;record:DirectOperationRecord|CompoundOperationRecord}>,semanticScope?:SemanticSummaryProviderScope):()=>void{
 const members=treeSupervision.get(tree);if(!members)throw Error('compound_tree_supervision_missing');
 const rechecks:Array<()=>void>=[];
 inspectCompoundLiveTree({treeRoot:tree,lease,candidate,semanticScope,assertLive(snapshot){const check=members.get(snapshot.sessionId);if(!check)throw Error('compound_tree_live_issuer_missing');check(snapshot,descendants.get(snapshot.sessionId),origin,candidate,issued);rechecks.push(()=>{if(members.get(snapshot.sessionId)!==check)throw Error('compound_tree_live_issuer_changed');check(snapshot,descendants.get(snapshot.sessionId),origin,candidate,issued);});}});
 return ()=>{lease.assertCurrent();for(const check of rechecks)check();};
}
/** One actual final-authorized native invocation owns this scope. Async work
 * retaining an ALS store after native return cannot allocate another child. */
export function createManagedCompoundLifecycle(input:BoundCompoundCoordinatorInput&{
 chain:SessionExecutionChain;treeRoot:CompoundTreeOwner;
 installCoordinator(input:BoundCompoundCoordinatorInput):ProductCompoundCoordinator;
 hasPendingEffects(ledger:import('./compound-operation.js').CompoundOperationLedger,lease?:SessionExecutionLease):boolean;
 captureBranches(lease:SessionExecutionLease):()=>void;
}) {
 const scope=new AsyncLocalStorage<Invocation>(),states=new Map<string,State>();
 const named=new Map<string,{record:DirectOperationRecord;installation:Installation}>();
 const {session,store,root,journal,owner,chain,treeRoot}=input,sessionIdentity=session.exportSnapshot().sessionId;
 function exactRow(row:DirectOperationRecord|undefined,state:State){
  const original=state.record;
  if(!row||!row.delegation?.managed||!original.delegation?.managed||row.id!==original.id||row.finalInputHash!==original.finalInputHash||!isDeepStrictEqual(row.dispatch,original.dispatch)||row.delegation.admissionId!==original.delegation.admissionId||row.delegation.childSessionIdentity!==original.delegation.childSessionIdentity||row.delegation.childStoreRoot!==root)throw Error('compound_managed_admission_stale');
  const a=original.delegation.managed,b=row.delegation.managed;
  if(!isDeepStrictEqual({...a,ackReady:b.ackReady,ackPublished:b.ackPublished,resourcesReleasedDigest:b.resourcesReleasedDigest},b))throw Error('compound_managed_admission_stale');
  return row;
 }
 let members=treeSupervision.get(treeRoot);if(!members)treeSupervision.set(treeRoot,members=new Map());
 if(members.has(sessionIdentity))throw Error('compound_tree_duplicate_runtime');
 if(publicationOwners.has(owner))throw Error('compound_tree_duplicate_owner');
 publicationOwners.set(owner,Object.freeze({session,tree:treeRoot,providerAdmission:input.providerAdmission,assertCurrent:()=>{input.assertCurrent();owner.assertSession(session);}}));
 let origins=turnOrigins.get(treeRoot);if(!origins)turnOrigins.set(treeRoot,origins=new Map());if(input.getActiveTurnOrigin)origins.set(sessionIdentity,input.getActiveTurnOrigin);
 members.set(sessionIdentity,(snapshot,descendant,metadataOrigin,candidate,issued)=>{
  input.assertCurrent();if(snapshot.sessionId!==sessionIdentity||!snapshot.compoundOperations)throw Error('compound_tree_live_issuer_missing');
  const ledger=snapshot.compoundOperations;
  if(ledger.managedTurns?.records.some(row=>!['drained','cancelled_before_activation'].includes(row.state))){if(!input.assertTurnCurrent)throw Error('compound_tree_turn_issuer_missing');input.assertTurnCurrent(snapshot);}
  const isIssued=(row:DirectOperationRecord|CompoundOperationRecord)=>issued?.sessionIdentity===sessionIdentity&&row.stage!=='outcome_unknown'&&isDeepStrictEqual(row,issued.record);
  if(ledger.operations.some(row=>['edit_started','validation_started','outcome_unknown'].includes(row.stage)&&!isIssued(row)))throw Error('compound_tree_unknown');
  for(const row of ledger.directOperations??[]){
   if(row.stage==='prepared'||row.stage==='settled'||isIssued(row))continue;
   if(metadataOrigin?.session===session&&metadataOrigin.nativeInvocationId===row.id){assertManagedFollowupInvocationCurrent(session,row);continue;}
   const native=named.get(row.id);
   if(native){const edge=row.delegation,original=native.record.delegation;if(row.stage!=='started'||!edge||!original||edge.managed||edge.childSessionIdentity!==descendant||edge.childSessionIdentity!==original.childSessionIdentity||edge.admissionId!==original.admissionId||row.finalInputHash!==native.record.finalInputHash||!isDeepStrictEqual(row.dispatch,native.record.dispatch)||edge.generation!==1||edge.state!=='live'||edge.childPhase!=='running')throw Error('compound_tree_named_unpublished');native.installation.assertLive();continue;}
   const state=states.get(row.id);if(!state||row.stage!=='started')throw Error('compound_tree_unknown');
   exactRow(row,state);const edge=row.delegation!,managed=edge.managed!;
   if(edge.state!=='live'||edge.generation!==1||edge.childPhase!=='running'||((!managed.ackPublished||!state.ackReady)&&edge.childSessionIdentity!==descendant)||state.resourceDigest||!state.installation.hasInstalled()||state.installation.hasDrained()||!state.adapter.assertManagedResourceCurrent)throw Error('compound_tree_branch_unpublished');
   const result:unknown=state.adapter.assertManagedResourceCurrent(state.admission);if(result!==undefined){if(result&&typeof (result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});throw Error('compound_tree_supervision_must_be_synchronous');}
  }
  const candidateRow=candidate?.sessionId===sessionIdentity?candidate.compoundOperations?.providerAttempts?.at(-1):undefined;
  const reserved=(ledger.providerAttempts??[]).filter(row=>row.transportState==='reserved'&&(!candidateRow||!isDeepStrictEqual(row,candidateRow)));
  if(ledger.providerAttempts?.some(row=>row.transportState==='unknown'))throw Error('compound_tree_unknown');
  if(reserved.length){if(!input.providerAdmission)throw Error('compound_tree_provider_issuer_missing');assertCompoundProviderLiveReservations(input.providerAdmission,reserved);}
 });
 async function publishFacts(state:State,held?:SessionExecutionLease){
  const acquired=held?undefined:await acquireSessionExecutionFactChain(chain,{invocationId:`managed-facts:${randomUUID()}`});
  const lease=held??acquired!.childLease;
  try{
   lease.assertCurrent();const snapshot=await store.load(sessionIdentity);lease.assertCurrent();
   if(!snapshot?.compoundOperations)throw Error('compound_managed_admission_stale');
   const row=exactRow(snapshot.compoundOperations.directOperations?.find(r=>r.id===state.record.id),state),delegation=row.delegation!,managed=delegation.managed!;
   if(row.stage==='settled'){if(delegation.generation!==2||delegation.state!=='closed'||delegation.childPhase!=='drained'||!managed.ackPublished||!managed.resourcesReleasedDigest)throw Error('compound_managed_admission_stale');return;}
   // Unknown is retained even if subsequent local cleanup finishes. It needs
   // a separate explicit reconciliation, never an automatic success upgrade.
   if(row.stage!=='started'||delegation.generation!==1||delegation.state!=='live')throw Error('compound_managed_admission_stale');
   let ackPublished=managed.ackPublished;
   if(state.ackReady&&state.prefixLength!==undefined&&state.prefixDigest!==undefined){
    const prefix={messages:snapshot.messages.slice(0,state.prefixLength)};
    ackPublished ||= computeSessionHistoryDigest(prefix)===state.prefixDigest&&snapshot.messages.slice(state.prefixLength).some(message=>message.content.some(block=>block.type==='tool_result'&&block.tool_use_id===state.toolUseId&&block.content===managed.ackBytes));
   }
   const nextManaged={...managed,ackReady:managed.ackReady||state.ackReady,ackPublished,resourcesReleasedDigest:state.resourceDigest??managed.resourcesReleasedDigest};
   const done=nextManaged.ackPublished&&!!nextManaged.resourcesReleasedDigest&&state.installation.hasDrained();
   const nextDelegation={...delegation,managed:nextManaged,...(done?{state:'closed' as const,generation:2,childPhase:'drained' as const}:{})};
   if(isDeepStrictEqual(delegation,nextDelegation))return;
   const ledger=advanceDirectOperation(snapshot.compoundOperations,row.id,done?{stage:'settled',outcome:'completed',quiescence:'delegated_tree',delegation:nextDelegation}:{stage:'started',delegation:nextDelegation});
   await store.compareAndSave!({expectedStoreRevision:snapshot.storeRevision!,expectedHistoryDigest:snapshot.historyDigest!,nextSnapshot:{...snapshot,compoundOperations:ledger},lease,beforeCommit:()=>lease.assertCurrent()});
  }finally{await acquired?.releaseAfterDrain();}
 }
 return Object.freeze({
  registerNamed(record:DirectOperationRecord,installation:Installation){if(named.has(record.id)||!record.delegation||record.delegation.managed)throw Error('compound_tree_named_registration');named.set(record.id,{record:structuredClone(record),installation});},
  async execute(request:Request,inputHash:string,signal:AbortSignal,withLease:WithLease,settlePrepared:(id:string,outcome:'cancelled'|'denied'|'invalid')=>Promise<void>,permissionGeneration:number):Promise<string>{
   const adapter=request.tool&&getManagedCompoundSpawnAdapter(request.tool);
   if(!adapter?.inspectResourcesReleased)throw Error('compound_managed_resources_authority_required');
   const created=await withLease(async lease=>{await input.persistCurrentHistory(lease);if(input.hasPendingEffects(await journal.read(lease),lease))throw Error('compound_session_effect_pending');return journal.createOrGetDirect({hostProviderInvocationId:request.context!.hostProviderInvocationId!,originalToolUseId:request.context!.toolInvocationId!,toolName:request.name,inputHash,permissionGeneration},lease);},signal);
   if(!created.created)return `[operation ${created.operation.id}; duplicate child delivery is not executed again]`;
   const record=created.operation as DirectOperationRecord;
   const prepared=await abortablePreparation(request.native.prepare(request.name,{...request.input},{signal,toolInvocationId:record.id}),signal).catch(async error=>{await settlePrepared(record.id,signal.aborted?'cancelled':'invalid');throw error;});
   if(prepared.kind!=='prepared'){await settlePrepared(record.id,prepared.reason==='denied'?'denied':prepared.reason==='cancelled'?'cancelled':'invalid');return prepared.message;}
   const invocation:Invocation={request,adapter,withLease,signal,permissionGeneration,record,finalInputHash:createHash('sha256').update(JSON.stringify({name:request.name,input:prepared.invocation.input})).digest('hex'),open:true,preparing:false};
   try{
    const result=await scope.run(invocation,()=>request.native.execute(prepared.invocation));
    invocation.open=false;
    if(!invocation.state){await settlePrepared(record.id,'invalid');throw Error('compound_managed_child_not_prepared');}
    const state=invocation.state;
    if(result!==state.record.delegation!.managed!.ackBytes)throw Error('compound_managed_ack_mismatch');
    state.ackReady=true;const snapshot=session.exportSnapshot();state.prefixLength=snapshot.messages.length;state.prefixDigest=computeSessionHistoryDigest(snapshot);
    await publishFacts(state);return result;
   }catch(error){
    invocation.open=false;
    if(!invocation.state){try{await settlePrepared(record.id,signal.aborted?'cancelled':'invalid');}catch{/* A committed started row must remain blocked. */}}
    throw error;
   }finally{invocation.open=false;}
  },
  async prepareManagedChild(args:PrepareManagedCompoundChildInput):Promise<PreparedManagedCompoundChild>{
   const {preparation,childSession,registerPersistence}=args;
   const invocation=scope.getStore();
   if(!invocation?.open||invocation.preparing||invocation.state)throw Error('compound_managed_invocation_required');
   invocation.preparing=true;
   const {adapter,request,record}=invocation;
   const inspect=()=>{
    input.assertCurrent();invocation.signal.throwIfAborted();if(!invocation.open||getManagedCompoundSpawnAdapter(request.tool!)!==adapter)throw Error('compound_managed_invocation_required');
    const facts=adapter.inspectPreparation(preparation);
    if(!facts.childTurnId||typeof facts.initialMessage!=='string'||facts.sourceOwner!==owner||facts.childSession!==childSession||facts.nativeInvocationId!==record.id||facts.childSessionId!==childSession.exportSnapshot().sessionId)throw Error('compound_managed_preparation_mismatch');
    return facts;
   };
   const facts=inspect();let started!:DirectOperationRecord,admission!:ManagedCompoundAdmission;
   await invocation.withLease(async lease=>{
    const current=inspect();if(!isDeepStrictEqual(current,facts))throw Error('compound_managed_preparation_changed');
    await input.persistCurrentHistory(lease);if(input.hasPendingEffects(await journal.read(lease),lease))throw Error('compound_session_effect_pending');
    const revalidateBranches=input.captureBranches(lease);
    const allocation=await treeRoot.journal.reserveTreeAllocation({dispatch:{sessionIdentity:facts.childSessionId,hostProviderInvocationId:`child:${record.id}`,originalToolUseId:record.id},inputHash:invocation.finalInputHash,recordKind:'delegation'},getSessionExecutionAncestorLease(lease,treeRoot));
    if(!allocation.created)throw Error('compound_child_reservation_duplicate');
    started=await journal.advanceDirect(record.id,{stage:'started',finalInputHash:invocation.finalInputHash,delegation:{version:1,admissionId:randomUUID(),childSessionIdentity:facts.childSessionId,childStoreRoot:root,generation:1,state:'live',childPhase:'not_started',managed:{version:1,groupId:facts.groupId,agentId:facts.agentId,rootEpoch:facts.rootEpoch,operationId:facts.operationId,nativeInvocationId:record.id,ackBytes:facts.ackBytes,ackHash:createHash('sha256').update(facts.ackBytes).digest('hex'),ackReady:false,ackPublished:false,resourcesReleasedDigest:null}}},lease,()=>{revalidateBranches();if(!isDeepStrictEqual(inspect(),facts))throw Error('compound_managed_preparation_changed');});
    admission=await captureManagedCompoundAdmission({owner,session,store,root,lease,parentOperationId:record.id});
   },invocation.signal);
   // Initialize metadata before D1 can publish its first inherited reference.
   // This temporary authority is closed before the actual child installer owns
   // it; no execution or provider grant is minted by initialization.
   const childAuthority=createSessionExecutionAuthority({root,sessionIdentity:facts.childSessionId,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:facts.childSessionId,scopeId:facts.childSessionId})});
   try{
    const childChain=createSessionExecutionChain({parent:chain,target:{root,sessionIdentity:facts.childSessionId,authority:childAuthority}});
    const initializing=await acquireSessionExecutionChain(childChain,{invocationId:`managed-metadata:${randomUUID()}`,kind:'recovery',signal:invocation.signal});
    try{
     inspect();const parent=await store.load(sessionIdentity),row=parent?.compoundOperations?.directOperations?.find(item=>item.id===record.id);
     if(!isDeepStrictEqual(row,started)||await store.load(facts.childSessionId))throw Error('compound_managed_child_initialization_conflict');
     const snapshot=childSession.exportSnapshot(),basis=childSession.getPublishedHistoryBasis();
     await store.compareAndSave!({expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest(snapshot),nextSnapshot:snapshot,lease:initializing.childLease,beforeCommit:()=>{inspect();if(!isDeepStrictEqual(childSession.exportSnapshot(),snapshot))throw Error('compound_managed_child_changed');}});
     const durable=await store.load(facts.childSessionId);if(!durable)throw Error('compound_managed_child_initialization_missing');
     childSession.updatePersistenceFacts(durable);childSession.notePublishedHistory(snapshot,basis);
     await registerPersistence?.(Object.freeze({admission,lease:initializing.childLease}));inspect();
    }finally{await initializing.releaseAfterDrain();}
   }finally{childAuthority.dispose();}
   // Root-turn cancellation is deliberately not a managed actor lifetime.
   const installation=createCompoundChildInstallation({...input,sessionIdentity,childSession,record:started,parent:{root,sessionIdentity,operationId:record.id,generation:1,store},ancestors:input.ancestors??[],signal:input.executionSignal,managedTurn:{admission,followup:adapter.followup,turnId:facts.childTurnId!,initialMessage:facts.initialMessage!,assertResourceCurrent:()=>{if(!adapter.assertManagedResourceCurrent)throw Error('compound_managed_resource_authority_required');const result:unknown=adapter.assertManagedResourceCurrent(admission);if(result!==undefined){if(result&&typeof (result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});throw Error('compound_managed_resource_authority_async');}},assertApplied:()=>{if(!adapter.assertAdmissionCurrent)throw Error('compound_managed_turn_main_authority_required');const result:unknown=adapter.assertAdmissionCurrent(admission);if(result!==undefined){if(result&&typeof (result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});throw Error('compound_managed_turn_main_authority_async');}}}});
   const state:State={record:started,admission,installation,adapter,toolUseId:request.context!.toolInvocationId!,ackReady:false};invocation.state=state;states.set(record.id,state);
   const childCheck=(id:string)=>{if(id!==facts.childSessionId)throw Error('compound_managed_child_store_mismatch');};
   const childLoad=async(id:string)=>{childCheck(id);return store.load(id);};
   const installedFacts=async()=>{const value=await store.load(facts.childSessionId);if(!value)throw Error('compound_managed_child_initialization_missing');childSession.updatePersistenceFacts(value);};
   const childStore:SessionStore=Object.freeze<SessionStore>({
    load:childLoad,loadLast:()=>childLoad(facts.childSessionId),list:async()=>{throw Error('compound_managed_child_store_mismatch');},fork:async()=>{throw Error('compound_managed_child_store_mismatch');},
    save:async(snapshot,options)=>{childCheck(snapshot.sessionId);const publication=persistCompoundPublicationSnapshot(childSession,snapshot);if(publication)await publication;else await store.save(snapshot,options);await installedFacts();},
    compareAndSave:async(commit)=>{childCheck(commit.nextSnapshot.sessionId);const result=await store.compareAndSave!(commit);await installedFacts();return result;},
    onCommit:listener=>store.onCommit!(snapshot=>{if(snapshot.sessionId===facts.childSessionId)listener(snapshot);}),
   });
   return Object.freeze({admission,persistence:Object.freeze({root,store:childStore}),
    installChildExecution:async(child:Parameters<Installation['install']>[0])=>{
     const handle=await installation.install(child);return {assertTurnInput:handle.assertTurnInput,prepareManagedFollowup:handle.prepareManagedFollowup,prepareInitialTurn:handle.prepareInitialTurn,activateInitialTurn:handle.activateInitialTurn,prepareManagedChild:handle.prepareManagedChild,bindRegistry:handle.bindRegistry,dispose:async()=>{await handle.dispose();await publishFacts(state);}};
    },
    async onResourcesReleased(receipt:unknown){const actual=adapter.inspectResourcesReleased!(receipt);if(actual.admission!==admission||!/^[a-f0-9]{64}$/.test(actual.closedSnapshotDigest)||state.resourceDigest&&state.resourceDigest!==actual.closedSnapshotDigest)throw Error('compound_managed_resources_mismatch');state.resourceDigest=actual.closedSnapshotDigest;await publishFacts(state);},
   });
  },
  async publish(lease:SessionExecutionLease){for(const state of states.values())await publishFacts(state,lease);},
 });
}
