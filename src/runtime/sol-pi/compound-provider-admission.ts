import type {StoredStageInput} from '../intent-delegation/stored-intent-clone.js';
function compoundIntentStageRows(value:StoredStageInput[]|null|undefined):StoredStageInput[]{
 if(!Array.isArray(value))throw Error('intent_stage_context_stages');return value;
}
import {assertIntentStagePrefix,intentStageMessages,intentStageMessagesHash} from '../intent-delegation/stage-context.js';
import {parseIntentPublicationCandidates} from '../intent-delegation/publication-candidate-journal.js';
import {hasProtectedIntentProducerHistory} from '../intent-delegation/intent-commit-boundary.js';
import type {Message} from '../../types.js';
import type {ToolRegistry} from '../../ai/tools/index.js';
import {readProductIntentProducerInstance} from '../../ai/tools/intent-delegation.js';
import {prepareIntentProviderCurrent} from '../intent-delegation/provider-current.js';
import {reserveActiveSemanticSummaryProviderScope,inspectSemanticSummaryProviderLease,consumeSemanticSummaryProviderScope,settleSemanticSummaryProviderScope,type SemanticSummaryProviderScope} from './semantic-summary-attempt.js';
import {getObservationSessionOwnerHostBinding,type ObservationSessionOwner} from './observation-session-owner.js';
import type {AgentSessionState} from '../../ai/runtime/session.js';
import {getCompoundExecutionDomainBinding} from './compound-execution-domain.js';
import {captureCompoundExistingBranchSupervision,captureCompoundSemanticSupervision} from './compound-managed-lifecycle.js';
import type {CompoundTreeOwner} from './compound-child-installation.js';
import {realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {SessionStore} from '../../ai/runtime/session-store/store.js';
import {assertSessionExecutionLease,type SessionExecutionAuthority} from '../../ai/runtime/session-store/execution-authority.js';
import {acquireSessionExecutionChain,acquireSessionExecutionFactChain,assertSessionExecutionChainLeaf,assertSessionExecutionChainRoot,assertSessionExecutionChainParents,getSessionExecutionAncestorLease,type SessionExecutionChain,type AcquiredSessionExecutionChain} from '../../ai/runtime/session-store/execution-chain.js';
import {validateCompoundOperationLedger} from './compound-operation.js';
import {getCompoundProviderAttemptIdentity,validateProviderAttempt,type CompoundProviderAttempt,type CompoundProviderAttemptInput,type ProviderTransportState} from './compound-provider-attempt.js';
import type {createCompoundSessionJournal} from './compound-session-journal.js';

export interface ProviderAncestorAdmission {readonly opaqueProviderAncestorAdmission:true}
export interface ProviderAncestorAttempt {readonly opaqueProviderAncestorAttempt:true}
/** Diagnostic fact about this reserve call, never a quiescence capability.
 * A prior duplicate identity may already have been dispatched elsewhere. */
export class CompoundProviderAdmissionError extends Error {
 readonly noDispatchPossible=true;
 constructor(cause:unknown,readonly reservationMayExist:boolean,readonly undeliveredState:'none'|'cancelled_before_send'|'unconfirmed'){
  super(cause instanceof Error?cause.message:'compound_provider_admission_failed',{cause});this.name='CompoundProviderAdmissionError';
 }
}
export type ProviderAncestorAttemptFacts=Omit<CompoundProviderAttemptInput,'issuerIncarnation'|'parentAdmission'|'rootAdmission'>;
export interface ProviderAncestorAdmissionBinding {
 readonly childSessionIdentity:string;
 reserve(input:ProviderAncestorAttemptFacts&{signal?:AbortSignal}):Promise<ProviderAncestorAttempt>;
 consume(ticket:ProviderAncestorAttempt,facts:ProviderAncestorAttemptFacts):void;
 settle(ticket:ProviderAncestorAttempt,state:Exclude<ProviderTransportState,'reserved'>):Promise<void>;
}
type Journal=ReturnType<typeof createCompoundSessionJournal>;
interface Target {root:string;sessionIdentity:string;authority:SessionExecutionAuthority;journal:Journal;store?:SessionStore}
interface Parent {root:string;sessionIdentity:string;operationId:string;generation:number;store:SessionStore}
const admissions=new WeakMap<object,ProviderAncestorAdmissionBinding>();
const consumedAttempts=new WeakMap<object,{cap:ProviderAncestorAdmission;facts:ProviderAncestorAttemptFacts;semantic?:true}>();
export function inspectConsumedCompoundProviderAttempt(cap:ProviderAncestorAdmission,ticket:ProviderAncestorAttempt,facts:ProviderAncestorAttemptFacts):'ordinary'|'semantic'{
 const actual=consumedAttempts.get(ticket);if(!actual||actual.cap!==cap||!isDeepStrictEqual(actual.facts,facts))throw Error('compound_provider_consumed_attempt_invalid');
 return actual.semantic?'semantic':'ordinary';
}
const supervision=new WeakMap<object,(rows:readonly CompoundProviderAttempt[])=>void>();
/** Recognition of this live issuer only. Caller must independently read the
 * complete canonical tree under its root lease; this grants no new send. */
export function assertCompoundProviderLiveReservations(cap:ProviderAncestorAdmission,rows:readonly CompoundProviderAttempt[]):void {
 const check=supervision.get(cap);if(!check)throw Error('compound_provider_supervision_invalid');check(rows);
}
export function getProviderAncestorAdmissionBinding(cap:ProviderAncestorAdmission):ProviderAncestorAdmissionBinding{
 const binding=admissions.get(cap);if(!binding)throw Error('compound_provider_admission_invalid');return binding;
}

type RegistryState={registry:ToolRegistry;permission:ReturnType<ToolRegistry['getObservationPermissionRevisionPort']>;anchor:unknown};
type RegistryLifetime={registry:RegistryState;generation:number;enabled:boolean};
type RootIntentState=RegistryLifetime&{store:SessionStore;sessionId:string;instanceId:string|undefined;session:AgentSessionState;current():void;views:Map<string,()=>void>};
const stageRoots=new WeakMap<AgentSessionState,RootIntentState>(),stageStores=new WeakMap<SessionStore,Map<string,RootIntentState>>();
/** Read-only publication barrier from the actual branded root binding, never a caller snapshot. */
export function assertCompoundRootIntentHistory(store:SessionStore,sessionId:string):void{
 const state=stageStores.get(store)?.get(sessionId);if(!state)return;state.current();
 const stored=store.loadSync?.(sessionId);if(!stored)throw Error('intent_stage_context_store');
 if(!isDeepStrictEqual(intentStageMessages({...state.session.exportSnapshot(),model:stored.model}),intentStageMessages(stored)))throw Error('intent_stage_context_unpublished_history');state.current();
}
/** Fixed runtime view. Neither an index nor messages can be supplied by the caller. */
export function prepareCompoundRootIntentStageView(session:AgentSessionState,logicalInvocationId?:string){
 const state=stageRoots.get(session),all=session.getMessages();
 const ordinary=()=>({messages:all,active:false,assertCurrent(){},dispose(){}});
 if(!state)return ordinary();state.current();const ledger=state.store.getIntentNativeLedgerSync?.(state.sessionId);
 if(!ledger||!hasProtectedIntentProducerHistory(ledger))return ordinary();
 const record=ledger.intents.find(r=>r.intentId===ledger.activeIntentId),stage=record?compoundIntentStageRows(record.stages).find(r=>r.stageId===record.activeStageId):undefined;
 if(!record||!stage||stage.order===0)return ordinary();
 const candidates=parseIntentPublicationCandidates(ledger).filter(c=>c.intentId===record.intentId&&c.businessProjection?.nextStageContext?.stageId===stage.stageId);
 if(candidates.length!==1||stage.needsFreshContextHandoff)throw Error('intent_stage_context_required');
 const context=candidates[0].businessProjection!.nextStageContext!,stored=state.store.loadSync?.(state.sessionId);if(!stored)throw Error('intent_stage_context_store');
 const durable=assertIntentStagePrefix({...session.exportSnapshot(),model:stored.model},context);assertIntentStagePrefix(stored,context);
 const digest=intentStageMessagesHash(durable),storedDigest=intentStageMessagesHash(intentStageMessages(stored)),model=stored.model;let disposed=false;
 const check=()=>{if(disposed)throw Error('intent_stage_context_disposed');state.current();if(!isDeepStrictEqual(state.store.getIntentNativeLedgerSync?.(state.sessionId),ledger))throw Error('intent_stage_context_changed');const current=state.store.loadSync?.(state.sessionId);if(!current)throw Error('intent_stage_context_store');if(current.model!==model||intentStageMessagesHash(intentStageMessages(current))!==storedDigest)throw Error('intent_stage_context_changed');assertIntentStagePrefix(current,context);if(intentStageMessagesHash(assertIntentStagePrefix({...session.exportSnapshot(),model:current.model},context))!==digest)throw Error('intent_stage_context_changed');state.current();};
 if(logicalInvocationId){if(state.views.has(logicalInvocationId))throw Error('intent_stage_context_duplicate');state.views.set(logicalInvocationId,check);}
 check();return {messages:all.slice(context.messageCount),active:true,assertCurrent:check,dispose(){disposed=true;if(logicalInvocationId&&state.views.get(logicalInvocationId)===check)state.views.delete(logicalInvocationId);}};
}
const rootIntentReaders=new WeakMap<object,(signal?:AbortSignal)=>Promise<void>>();
/** Original root issuer only; a readonly check, never a transferable grant. */
export async function assertCompoundRootIntentProviderCurrent(cap:ProviderAncestorAdmission,signal?:AbortSignal):Promise<void>{const read=rootIntentReaders.get(cap);if(!read)throw Error('compound_intent_product_required');await read(signal);}
const rootIntents=new WeakMap<CompoundTreeOwner,RootIntentState>(),providerRegistryCaps=new WeakMap<object,RegistryLifetime|RootIntentState>();
function registryState(registry:ToolRegistry):RegistryState {return {registry,permission:registry.getObservationPermissionRevisionPort(),anchor:registry.getRegisteredTool('tool_search')};}
function producerInstance(registry:ToolRegistry,store:SessionStore,sessionId:string){return readProductIntentProducerInstance(['intent_step_update','intent_stage_artifact'].map(name=>registry.getRegisteredTool(name)).filter((value):value is NonNullable<typeof value>=>!!value),store,sessionId);}
/** Original product lifecycle only; changes invalidate old tickets, never renew them. */
export function invalidateCompoundProviderRegistry(cap:ProviderAncestorAdmission):void{const state=providerRegistryCaps.get(cap);if(!state)throw Error('compound_root_provider_registry');state.enabled=false;state.generation++;}
export function rebindCompoundProviderRegistry(cap:ProviderAncestorAdmission,registry:ToolRegistry):void{
 const state=providerRegistryCaps.get(cap);if(!state)throw Error('compound_root_provider_registry');const next=registryState(registry);
 if(next.permission.authority!==state.registry.permission.authority||('store'in state&&producerInstance(registry,state.store,state.sessionId)!==state.instanceId))throw Error('intent_provider_registry_changed');
 state.registry=next;state.generation++;state.enabled=true;
}
function captureRegistryCurrent(root:RootIntentState|undefined,own:RegistryLifetime|undefined){
 const lifetimes=[...(root?[root]:[]),...(own&&own!==root?[own]:[])],captured=lifetimes.map(state=>({state,generation:state.generation,registry:state.registry,revision:state.registry.permission.getRevision(),current:state.registry.registry.captureObservationRegistryCurrent()}));
 return ()=>{for(const value of captured){const {state,registry}=value;if(!state.enabled||state.generation!==value.generation||state.registry!==registry||registry.permission.getRevision()!==value.revision)throw Error('intent_provider_permission_changed');value.current();}
  if(root&&producerInstance(root.registry.registry,root.store,root.sessionId)!==root.instanceId)throw Error('intent_provider_registry_changed');};
}
/** Host factory: no callback can mint admission. Requires the actual branded
 * ancestry and an exact durable running child edge. Local transport completion
 * is NOT physical command quiescence or remote model cancellation. Recovery of
 * a vanished issuer requires a separately authenticated supervisor receipt. */
export async function createCompoundRootProviderAdmission(input:{chain:SessionExecutionChain;treeRoot:CompoundTreeOwner;owner:ObservationSessionOwner;session:AgentSessionState;store:SessionStore;registry:ToolRegistry;executionSignal:AbortSignal}):Promise<ProviderAncestorAdmission>{
 const {chain,treeRoot,owner,session,executionSignal}=input,host=getObservationSessionOwnerHostBinding(owner);
 if(host.session!==session||session.exportSnapshot().sessionId!==treeRoot.sessionIdentity)throw Error('compound_root_provider_owner_mismatch');
 const domain=treeRoot.domain&&getCompoundExecutionDomainBinding(treeRoot.domain);
 if(domain&&(domain.canonicalSessionId!==treeRoot.sessionIdentity||realpathSync(domain.storeRoot)!==realpathSync(treeRoot.root)))throw Error('compound_root_provider_domain_mismatch');
 const binding=Object.freeze({rootSessionIdentity:treeRoot.sessionIdentity,authorizationId:domain?.initializationId??`root:${randomUUID()}`,generation:domain?.generation??1});
 const current=()=>{executionSignal.throwIfAborted();owner.assertSession(session);treeRoot.domain?.assertCurrent();if(treeRoot.domain){const now=getCompoundExecutionDomainBinding(treeRoot.domain);if(now.initializationId!==binding.authorizationId||now.generation!==binding.generation)throw Error('compound_root_provider_generation_changed');}};
 const intentRoot:RootIntentState={store:input.store,sessionId:treeRoot.sessionIdentity,instanceId:producerInstance(input.registry,input.store,treeRoot.sessionIdentity),session,current,views:new Map(),registry:registryState(input.registry),generation:1,enabled:true};
 current();const cap=await createProviderAdmission({chain,child:{...treeRoot,store:input.store},rootBudget:treeRoot,treeRoot,issuerIncarnation:randomUUID(),executionSignal,intentRoot,rootGrant:{binding,assertCurrent:current}});rootIntents.set(treeRoot,intentRoot);providerRegistryCaps.set(cap,intentRoot);stageRoots.set(session,intentRoot);let roots=stageStores.get(input.store);if(!roots){roots=new Map();stageStores.set(input.store,roots);}roots.set(treeRoot.sessionIdentity,intentRoot);executionSignal.addEventListener('abort',()=>{if(stageStores.get(input.store)?.get(treeRoot.sessionIdentity)===intentRoot)stageStores.get(input.store)!.delete(treeRoot.sessionIdentity);},{once:true});return cap;
}
export async function createCompoundProviderAdmission(input:{
 chain:SessionExecutionChain;parent:Parent;ancestors?:readonly Parent[];
 child:Target;rootBudget:Target;treeRoot?:CompoundTreeOwner;issuerIncarnation:string;executionSignal:AbortSignal;owner?:ObservationSessionOwner;registry?:ToolRegistry;
}):Promise<ProviderAncestorAdmission>{return createProviderAdmission(input);}
async function createProviderAdmission(input:{chain:SessionExecutionChain;parent?:Parent;ancestors?:readonly Parent[];child:Target;rootBudget:Target;treeRoot?:CompoundTreeOwner;issuerIncarnation:string;executionSignal:AbortSignal;intentRoot?:RootIntentState;owner?:ObservationSessionOwner;registry?:ToolRegistry;rootGrant?:{binding:NonNullable<CompoundProviderAttemptInput['rootAdmission']>;assertCurrent():void}}):Promise<ProviderAncestorAdmission>{
 const chain=input.chain,parent=input.parent&&Object.freeze({...input.parent,root:realpathSync(input.parent.root)}),child=Object.freeze({...input.child,root:realpathSync(input.child.root)}),root=Object.freeze({...input.rootBudget,root:realpathSync(input.rootBudget.root)});
 const signal=input.executionSignal,issuer=input.issuerIncarnation;
 if(!(signal instanceof AbortSignal)||typeof issuer!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(issuer))throw Error('compound_provider_admission_invalid');
 assertSessionExecutionChainLeaf(chain,child);assertSessionExecutionChainRoot(chain,root);
 if((!parent&&!input.rootGrant)||(parent&&input.rootGrant))throw Error('compound_provider_authority_kind');
 const authorization=parent?{parentAdmission:{parentSessionIdentity:parent.sessionIdentity,parentOperationId:parent.operationId,generation:parent.generation}}:{rootAdmission:input.rootGrant!.binding};
 const ancestors=Object.freeze((input.ancestors??(parent?[parent]:[])).map(entry=>Object.freeze({...entry,root:realpathSync(entry.root)})));
 const last=ancestors.at(-1);
 if(parent&&(!last||last.root!==parent.root||last.sessionIdentity!==parent.sessionIdentity||last.operationId!==parent.operationId||last.generation!==parent.generation||last.store!==parent.store))throw Error('compound_parent_admission_not_current');
 assertSessionExecutionChainParents(chain,ancestors);
 const intentRoot=input.intentRoot??(input.treeRoot?rootIntents.get(input.treeRoot):undefined),ownRegistry=input.registry?{registry:registryState(input.registry),generation:1,enabled:true}:undefined,ownHost=input.owner?getObservationSessionOwnerHostBinding(input.owner):undefined;
 if(ownHost&&ownHost.session.exportSnapshot().sessionId!==child.sessionIdentity)throw Error('compound_provider_owner_mismatch');
 const live=()=>{signal.throwIfAborted();input.rootGrant?.assertCurrent();if(input.owner&&ownHost)input.owner.assertSession(ownHost.session);};
 async function intentCurrent(requestSignal?:AbortSignal,logicalInvocationId?:string){const active=requestSignal?AbortSignal.any([signal,requestSignal]):signal,permission=captureRegistryCurrent(intentRoot,ownRegistry);permission();
  const checks:Array<()=>void>=[];if(intentRoot){const view=prepareCompoundRootIntentStageView(intentRoot.session);if(view.active){const selected=input.rootGrant&&logicalInvocationId?intentRoot.views.get(logicalInvocationId):view.assertCurrent;if(!selected)throw Error('intent_stage_context_request_required');checks.push(selected);}}if(intentRoot)checks.push(await prepareIntentProviderCurrent({store:intentRoot.store,sessionId:intentRoot.sessionId,instanceId:intentRoot.instanceId,signal:active}));
  for(const ancestor of ancestors){
   if(intentRoot&&ancestor.sessionIdentity===intentRoot.sessionId&&ancestor.root===root.root)continue;
   if(ancestor.store.getIntentNativeLedgerSync)checks.push(await prepareIntentProviderCurrent({store:ancestor.store,sessionId:ancestor.sessionIdentity,instanceId:undefined,signal:active}));
  }
  // A child cannot silently substitute a second protected Intent for the
  // original root contract. Its own durable ledger remains part of the guard.
  if(child.store&&(!intentRoot||child.sessionIdentity!==intentRoot.sessionId||child.root!==root.root))checks.push(await prepareIntentProviderCurrent({store:child.store,sessionId:child.sessionIdentity,instanceId:undefined,signal:active}));
  const check=()=>{live();active.throwIfAborted();permission();for(const value of checks)value();};check();return check;
 }
 function parentCurrent(){const rows=ancestors.map((ancestor,index)=>{const store=ancestor.store,read=store.loadSync?.bind(store);if(!read)throw Error('compound_parent_sync_reader_required');const row=read(ancestor.sessionIdentity)?.compoundOperations?.directOperations?.find(value=>value.id===ancestor.operationId);if(!row||row.stage!=='started'||row.delegation?.state!=='live'||row.delegation.childPhase!=='running'||row.delegation.generation!==ancestor.generation||row.delegation.childSessionIdentity!==(ancestors[index+1]??child).sessionIdentity||realpathSync(row.delegation.childStoreRoot)!==(ancestors[index+1]??child).root)throw Error('compound_parent_admission_not_current');return {ancestor,read,row:structuredClone(row)};});
  const store=child.store,readChild=store?.loadSync?.bind(store),managed=readChild?.(child.sessionIdentity)?.compoundOperations?.managedTurns?.records.at(-1);
  return ()=>{for(const item of rows)if(!isDeepStrictEqual(item.read(item.ancestor.sessionIdentity)?.compoundOperations?.directOperations?.find(row=>row.id===item.ancestor.operationId),item.row))throw Error('compound_parent_admission_not_current');if(managed&&!isDeepStrictEqual(readChild?.(child.sessionIdentity)?.compoundOperations?.managedTurns?.records.at(-1),managed))throw Error('compound_managed_turn_not_active');};
 }
 async function assertParent(scope:AcquiredSessionExecutionChain){
  live();
  for(let index=0;index<ancestors.length;index++){
   const ancestor=ancestors[index],descendant=ancestors[index+1]??child;
   getSessionExecutionAncestorLease(scope.childLease,ancestor).assertCurrent();live();
   const snapshot=await ancestor.store.load(ancestor.sessionIdentity);scope.assertCurrent();live();
   const record=snapshot?.compoundOperations&&validateCompoundOperationLedger(snapshot.compoundOperations).directOperations?.find(row=>row.id===ancestor.operationId);
   const edge=record?.delegation;
   if(snapshot?.sessionId!==ancestor.sessionIdentity||record?.stage!=='started'||!edge||edge.state!=='live'||edge.childPhase!=='running'||edge.generation!==ancestor.generation||edge.childSessionIdentity!==descendant.sessionIdentity||realpathSync(edge.childStoreRoot)!==descendant.root)throw Error('compound_parent_admission_not_current');
  }
 }
 const initial=await acquireSessionExecutionChain(chain,{invocationId:`provider-admission:${randomUUID()}`,kind:'recovery',signal});
 try{await assertParent(initial);}finally{await initial.releaseAfterDrain();}
 interface Attempt {facts:ProviderAncestorAttemptFacts;reservationId:string;state:'reserved'|'consumed'|'settling'|'closed';requestSignal?:AbortSignal;settlement?:ProviderTransportState;supervisionFailed?:boolean;current:()=>void}
 const attempts=new WeakMap<object,Attempt>();
 const liveAttempts=new Map<string,Attempt>();
 const semanticTickets=new WeakMap<object,{scope:SemanticSummaryProviderScope;facts:ProviderAncestorAttemptFacts;current:()=>void}>();
 const inspectSemantic=(scope:SemanticSummaryProviderScope)=>inspectSemanticSummaryProviderLease(scope,lease=>{live();assertSessionExecutionLease(lease,root);if(!input.treeRoot)throw Error('compound_semantic_tree_missing');captureCompoundSemanticSupervision(input.treeRoot,lease,scope)();});
 const binding:ProviderAncestorAdmissionBinding=Object.freeze<ProviderAncestorAdmissionBinding>({
  childSessionIdentity:child.sessionIdentity,
  async reserve(request){
   if(input.rootGrant){try{live();request.signal?.throwIfAborted();const {signal:_signal,...raw}=request,facts=structuredClone(raw),scope=reserveActiveSemanticSummaryProviderScope({sessionIdentity:child.sessionIdentity,logicalInvocationId:facts.logicalInvocationId,serializedBodySha256:facts.serializedBodySha256,destination:facts.destination.url});if(scope){const current=await intentCurrent(request.signal,request.logicalInvocationId);inspectSemantic(scope);current();const ticket=Object.freeze({opaqueProviderAncestorAttempt:true as const});semanticTickets.set(ticket,{scope,facts,current});return ticket;}}catch(error){throw new CompoundProviderAdmissionError(error,false,'none');}}
   let ticket:ProviderAncestorAttempt|undefined,scope:AcquiredSessionExecutionChain|undefined,failure:unknown,failed=false,reservationMayExist=false;
   try{
    live();request.signal?.throwIfAborted();
    const {signal:requestSignal,...raw}=request;const facts=structuredClone(raw);
    const recorded:CompoundProviderAttemptInput={...facts,issuerIncarnation:issuer,...authorization};
    const identity=getCompoundProviderAttemptIdentity(child.sessionIdentity,recorded),intentCheck=await intentCurrent(requestSignal,facts.logicalInvocationId);
    scope=await acquireSessionExecutionChain(chain,{invocationId:`provider-reserve:${randomUUID()}`,kind:'compound',signal:requestSignal?AbortSignal.any([signal,requestSignal]):signal});
    await assertParent(scope);requestSignal?.throwIfAborted();intentCheck();const parents=parentCurrent();
    const rootLease=getSessionExecutionAncestorLease(scope.childLease,root);
    const recheck=input.treeRoot?captureCompoundExistingBranchSupervision(input.treeRoot,chain,scope.childLease):undefined;
    reservationMayExist=true;
    const allocation=await root.journal.reserveTreeAllocation({...identity,recordKind:'provider'},rootLease);
    if(!allocation.created)throw Error('compound_provider_admission_duplicate');
    const reserved=await child.journal.reserveProviderAttempt(recorded,scope.childLease,input.treeRoot?candidate=>{intentCheck();parents();recheck!();const row=candidate.compoundOperations?.providerAttempts?.at(-1);if(!row||row.transportState!=='reserved'||row.inputHash!==identity.inputHash||!isDeepStrictEqual(row.dispatch,identity.dispatch))throw Error('compound_provider_candidate_invalid');validateProviderAttempt(row);captureCompoundExistingBranchSupervision(input.treeRoot!,chain,scope!.childLease,candidate)();}:undefined);
    if(!reserved.created)throw Error('compound_provider_admission_duplicate');
    ticket=Object.freeze({opaqueProviderAncestorAttempt:true as const});
    const attempt:Attempt={facts,reservationId:reserved.reservationId,state:'reserved',requestSignal,current:()=>{intentCheck();parents();}};attempts.set(ticket,attempt);liveAttempts.set(attempt.reservationId,attempt);attempt.current();
   }catch(error){failed=true;failure=error;}
   try{await scope?.releaseAfterDrain();}catch(error){if(!failed){failed=true;failure=error;}}
   if(failed){
    let undeliveredState:'none'|'cancelled_before_send'|'unconfirmed'=reservationMayExist?'unconfirmed':'none';
    if(!ticket&&child.journal.isUnissuedProviderAttemptFailure(failure)){
     let factsScope:AcquiredSessionExecutionChain|undefined;
     try{
      factsScope=await acquireSessionExecutionFactChain(chain,{invocationId:`unissued-provider:${randomUUID()}`});
      await child.journal.cancelUnissuedProviderAttempt(failure,factsScope.childLease);
      await factsScope.releaseAfterDrain();factsScope=undefined;undeliveredState='cancelled_before_send';
     }catch{/* No send ticket exists, but unconfirmed durable facts remain blocked. */}
     finally{if(factsScope)await factsScope.releaseAfterDrain().catch(()=>{});}
    }
    if(ticket){
     // Ticket has never escaped. Cancel synchronously before another await;
     // use the original private issuer port to reconcile the durable row.
     const attempt=attempts.get(ticket)!;attempt.supervisionFailed=true;attempt.state='settling';attempt.settlement='cancelled_before_send';
     let factsScope:AcquiredSessionExecutionChain|undefined;
     try{
      factsScope=await acquireSessionExecutionFactChain(chain,{invocationId:`undelivered-provider:${randomUUID()}`});
      await child.journal.settleIssuedProviderAttemptFacts({reservationId:attempt.reservationId,transportState:'cancelled_before_send'},factsScope.childLease);
      await factsScope.releaseAfterDrain();factsScope=undefined;attempt.state='closed';liveAttempts.delete(attempt.reservationId);undeliveredState='cancelled_before_send';
     }catch{/* Existing durable reserved/unknown is retained; never infer absence. */}
     finally{if(factsScope)await factsScope.releaseAfterDrain().catch(()=>{});}
    }
    throw new CompoundProviderAdmissionError(failure,reservationMayExist,undeliveredState);
   }
   return ticket!;
  },
  consume(ticket,facts){
   const semantic=semanticTickets.get(ticket);if(semantic){if(!isDeepStrictEqual(semantic.facts,facts))throw Error('compound_provider_ticket_invalid');inspectSemantic(semantic.scope);semantic.current();consumeSemanticSummaryProviderScope(semantic.scope);consumedAttempts.set(ticket,{cap,facts:semantic.facts,semantic:true});return;}
   const attempt=attempts.get(ticket);
   if(!attempt||attempt.state!=='reserved'||!isDeepStrictEqual(attempt.facts,facts))throw Error('compound_provider_ticket_invalid');
   live();attempt.requestSignal?.throwIfAborted();attempt.current();attempt.state='consumed';consumedAttempts.set(ticket,{cap,facts:attempt.facts});
  },
  async settle(ticket,state){
   const semantic=semanticTickets.get(ticket);if(semantic){settleSemanticSummaryProviderScope(semantic.scope,state);semanticTickets.delete(ticket);return;}
   const attempt=attempts.get(ticket);
   if(!attempt||!['reserved','consumed'].includes(attempt.state)||!['drained','cancelled_before_send','unknown'].includes(state)||(state==='drained'&&attempt.state!=='consumed')||(state==='cancelled_before_send'&&attempt.state!=='reserved'))throw Error('compound_provider_settlement_invalid');
   // Irreversible before awaiting any lock. In particular a cancelled ticket
   // can never be consumed while its durable cancellation waits for CAS.
   attempt.state='settling';attempt.settlement=state;
   let scope:AcquiredSessionExecutionChain|undefined;
   let settledBodyFailure: {
       error: unknown;
   } | undefined;
   try {
       try {
           scope = await acquireSessionExecutionFactChain(chain, { invocationId: `provider-settle:${randomUUID()}` });
           await child.journal.settleIssuedProviderAttemptFacts({ reservationId: attempt.reservationId, transportState: state }, scope.childLease);
           attempt.state = 'closed';
           liveAttempts.delete(attempt.reservationId);
       }
       catch (error) {
           attempt.supervisionFailed = true;
           throw error;
       }
   }
   catch (error) {
       settledBodyFailure = { error };
   }
   {
       try {
           await scope?.releaseAfterDrain();
       }
       catch (error) {
           attempt.supervisionFailed = true;
           throw error;
       }
   }
   if (settledBodyFailure)
       throw settledBodyFailure.error;
  },
 });
 const cap=Object.freeze({opaqueProviderAncestorAdmission:true as const});admissions.set(cap,binding);if(input.rootGrant)rootIntentReaders.set(cap,async signal=>{const check=await intentCurrent(signal);check();});if(ownRegistry)providerRegistryCaps.set(cap,ownRegistry);
 supervision.set(cap,rows=>{
  live();const seen=new Set<string>();
  if(!Array.isArray(rows)||rows.length>256)throw Error('compound_provider_supervision_invalid');
  for(const row of rows){
   validateProviderAttempt(row);if(row.transportState!=='reserved'||seen.has(row.id))throw Error('compound_provider_supervision_invalid');seen.add(row.id);
   const attempt=liveAttempts.get(row.id);
   if(!attempt||attempt.supervisionFailed||attempt.state==='closed'||attempt.settlement==='unknown')throw Error('compound_provider_supervision_unknown');attempt.requestSignal?.throwIfAborted();
   const {id:_id,dispatch,reservation:_reservation,inputHash,requestHash:_requestHash,transportState:_state,...recorded}=row;
   const expected:CompoundProviderAttemptInput={...attempt.facts,issuerIncarnation:issuer,...authorization};
   const identity=getCompoundProviderAttemptIdentity(child.sessionIdentity,expected);
   if(!isDeepStrictEqual(recorded,expected)||!isDeepStrictEqual(dispatch,identity.dispatch)||inputHash!==identity.inputHash)throw Error('compound_provider_supervision_changed');
  }
 });return cap;
}
