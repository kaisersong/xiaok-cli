import {attachInstalledMacEngineForMaintenance} from './maintenance-engine-attachment.js';
import {createInstalledMaintenanceExecution,assertMaintenanceExecutionConstruction,activateInstalledMaintenanceExecution,hasUnresolvedMaintenanceExecutionConstruction} from './maintenance-execution.js';
import {createInstalledMaintenanceStaging,assertMaintenanceStagingConstruction,activateInstalledMaintenanceStaging} from './maintenance-staging.js';
import {readInstalledMaintenanceBatch} from './installed-maintenance-handoff.js';
import {claimInstalledCapacityStackConstruction,assertInstalledStackConstructionKind,assertInstalledAssemblyLifetime,resolveInstalledVerificationOwner,createInstalledVerificationCapacityBinding,readInstalledApprovedRecipe,readInstalledVerificationPlan,readInstalledVerificationSignal,registerInstalledCaseExecution,recordInstalledCaseResult,recordInstalledCaseCancellation,assertInstalledInputCleanup,assertInstalledTranscriptRead,assertInstalledTranscriptDelete,assertInstalledRunDelete,assertInstalledRunStart,assertInstalledRunRead} from './installed-controller.js';
import {assertInstalledSharedCapacity,registerInstalledCapacityIssuer,type createInstalledSharedCapacity} from './installed-shared-capacity.js';
import {assertInstalledRootBrokerClient} from './root-broker-client.js';
import {createStagingFactualCleanup} from './staging-factual-cleanup.js';
import {join} from 'node:path';
import {assertInstalledControllerLifetime,type InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {initializeInstalledMacEngine} from './installed-engine.js';
import {createInstalledEngineQualification} from './installed-engine-qualification.js';
import {createInstalledRootBrokerClient} from './root-broker-client.js';
import {createAuthorityBlobBudget} from './authority-blob-budget.js';
import {createControllerMaterialPipeline} from './material-pipeline.js';
import {createInstalledExecutionController} from './installed-execution-controller.js';
import {createExecutionTranscriptStore} from './execution-transcripts.js';
import {setImmediate as yieldRecoveryBatch} from 'node:timers/promises';
import {createApprovedBlackboxExecutor} from './approved-blackbox-executor.js';
import {createProtectedRunLedger} from './protected-run-ledger.js';
import {ExecutionJournal} from '../isolated-execution/execution-journal.js';
import {canonicalVerificationJson as json} from './protocol.js';
import type {ControllerPeer} from './controller-public-daemon.js';
import type {ValidationMaterialInvocation} from './product-material-authorization.js';
type RunAccess=Parameters<typeof createProtectedRunLedger>[0]['access'];
type TranscriptAccess=Parameters<typeof createExecutionTranscriptStore>[0]['access'];
type StackIdentity={lifetime:Readonly<InstalledControllerLifetime>;closed:boolean};
const installedStacks=new WeakMap<object,StackIdentity>();
const failedStackDrains=new WeakMap<object,{assembly:object;lifetime:InstalledControllerLifetime;ticket:object;identity:StackIdentity}>();
/** Read the exact original builder rejection; there is no caller-issued drain token. */
export function readInstalledFailedStackDrain(error:unknown,assembly:object,lifetime:InstalledControllerLifetime):object|undefined{
 if(!error||typeof error!=='object')return undefined;const known=failedStackDrains.get(error);if(!known||known.assembly!==assembly||known.lifetime!==lifetime)return undefined;
 assertInstalledAssemblyLifetime(assembly,lifetime);const state=capacityConstructions.get(known.ticket);if(!state||state.lifetime!==lifetime||state.kind!=='normal'||state.phase!=='drained'||!known.identity.closed)throw Error('installed_stack_drain_unknown');return error;
}
type CapacityConstruction={owner:object;lifetime:InstalledControllerLifetime;components:Map<string,object>;engine?:object;kind:'normal'|'maintenance';phase:'constructing'|'active'|'draining'|'drained'|'failed-unknown';executionClaimed?:boolean;materialsClaimed?:boolean};
const capacityConstructions=new WeakMap<object,CapacityConstruction>();
const componentOwners=new WeakMap<object,CapacityConstruction>();
const unresolvedConstructions=new Set<CapacityConstruction>();
export function readInstalledCleanupOwner(component:object,slot:'execution'|'materials'|'probe'){
 const facts=componentOwners.get(component);if(!facts)return undefined;
 const exactSlot=slot==='probe'?(facts.kind==='normal'?'qualification':'maintenance-probe'):slot;
 if(facts.components.get(exactSlot)!==component||!(['active','draining'].includes(facts.phase)||slot==='probe'&&facts.kind==='normal'&&facts.phase==='constructing'))throw Error('maintenance_handoff_source');assertInstalledControllerLifetime(facts.lifetime);return {lifetime:facts.lifetime,kind:facts.kind};
}
export function assertInstalledStackDrained(stack:object,lifetime:InstalledControllerLifetime):void{const facts=installedStacks.get(stack)??failedStackDrains.get(stack)?.identity;if(!facts||facts.lifetime!==lifetime||!facts.closed)throw Error('installed_stack_drain_unknown');assertInstalledControllerLifetime(lifetime);}
export function isInstalledConstructionPending(ticket:object):boolean{const state=capacityConstructions.get(ticket);return !state||state.phase==='constructing'||state.phase==='failed-unknown';}
function maintenanceConstruction(ticket:object,lifetime:InstalledControllerLifetime,owner:object){const state=capacityConstructions.get(ticket);if(!state||state.kind!=='maintenance'||state.lifetime!==lifetime||state.owner!==owner||state.phase!=='constructing')throw Error('installed_capacity_construction');assertInstalledControllerLifetime(lifetime);return state;}
export function claimInstalledMaintenanceExecutionConstruction(ticket:object,lifetime:InstalledControllerLifetime,owner:object):void{const state=maintenanceConstruction(ticket,lifetime,owner);if(state.executionClaimed)throw Error('installed_capacity_construction');state.executionClaimed=true;}
export function claimInstalledMaintenanceMaterialsConstruction(ticket:object,lifetime:InstalledControllerLifetime,owner:object):void{const state=maintenanceConstruction(ticket,lifetime,owner);if(state.materialsClaimed||!state.components.has('execution'))throw Error('installed_capacity_construction');state.materialsClaimed=true;}
export function bindInstalledMaintenanceExecutionConstruction(ticket:object,value:object,raw:object):void{const state=capacityConstructions.get(ticket);if(!state)throw Error('installed_capacity_construction');maintenanceConstruction(ticket,state.lifetime,state.owner);assertMaintenanceExecutionConstruction(value,raw,ticket,state.lifetime.database);if(state.components.has('execution')||state.components.has('maintenance-probe'))throw Error('installed_capacity_construction');state.components.set('execution',raw);state.components.set('maintenance-probe',value);registerInstalledCapacityIssuer(state.owner,'execution',raw,undefined,ticket);registerInstalledCapacityIssuer(state.owner,'maintenance-probe',value,undefined,ticket);componentOwners.set(raw,state);componentOwners.set(value,state);}
export function bindInstalledMaintenanceMaterialsConstruction(ticket:object,value:object,materials:object):void{const state=capacityConstructions.get(ticket);if(!state)throw Error('installed_capacity_construction');maintenanceConstruction(ticket,state.lifetime,state.owner);assertMaintenanceStagingConstruction(value,materials,ticket,state.lifetime.database);if(state.components.has('materials'))throw Error('installed_capacity_construction');state.components.set('materials',materials);registerInstalledCapacityIssuer(state.owner,'materials',materials,undefined,ticket);componentOwners.set(materials,state);}
export function assertInstalledMaintenanceConstructionReady(ticket:object):void{const state=capacityConstructions.get(ticket);if(!state||state.kind!=='maintenance'||state.phase!=='constructing'||state.components.size!==3||!['execution','maintenance-probe','materials'].every(slot=>state.components.has(slot)))throw Error('installed_capacity_construction');assertInstalledControllerLifetime(state.lifetime);}

export function assertInstalledStackCapacityComponent(ticket:object,owner:object,slot:string,component:object,engine?:object):void{const state=capacityConstructions.get(ticket);if(!state||state.owner!==owner||state.components.get(slot)!==component||slot==='qualification'&&state.engine!==engine)throw Error('installed_capacity_construction');assertInstalledControllerLifetime(state.lifetime);}

export function assertInstalledExecutionStack(value:object,lifetime:Readonly<InstalledControllerLifetime>):void{const facts=installedStacks.get(value);if(!facts||facts.lifetime!==lifetime)throw Error('installed_stack_identity');if(facts.closed)throw Error('installed_stack_closed');assertInstalledControllerLifetime(lifetime);}
/** Fixed installed stack, not a factory for caller-provided engines or keys.
 * Entry must provide actual same-authority ACL implementations and close public
 * admission before closing its lifetime. No default authorization callbacks. */
export async function createInstalledExecutionStack(input:{assembly:object;lifetime:Readonly<InstalledControllerLifetime>;sharedCapacity:ReturnType<typeof createInstalledSharedCapacity>;broker:ReturnType<typeof createInstalledRootBrokerClient>;signal?:AbortSignal}){
 const lifetime=input.lifetime;assertInstalledControllerLifetime(lifetime);const {assembly,signal}=input;assertInstalledAssemblyLifetime(assembly,lifetime);
 assertInstalledStackConstructionKind(assembly,'normal');
 const sharedOwner=input.sharedCapacity,actualBroker=input.broker;assertInstalledSharedCapacity(sharedOwner,lifetime,true);assertInstalledRootBrokerClient(actualBroker,lifetime);
 const construction=claimInstalledCapacityStackConstruction(assembly,sharedOwner),constructionFacts:CapacityConstruction={owner:sharedOwner,lifetime,components:new Map(),kind:'normal',phase:'constructing'};capacityConstructions.set(construction,constructionFacts);
 function bindCapacity(slot:'qualification'|'materials'|'execution'|'transcripts'|'runs',component:object,engine?:Awaited<ReturnType<typeof initializeInstalledMacEngine>>){if(constructionFacts.components.has(slot))throw Error('installed_capacity_construction');constructionFacts.components.set(slot,component);if(engine)constructionFacts.engine=engine;registerInstalledCapacityIssuer(sharedOwner,slot,component,engine,construction);componentOwners.set(component,constructionFacts);}

 const capacityOwner=(peer:ControllerPeer,invocation:ValidationMaterialInvocation)=>createInstalledVerificationCapacityBinding(assembly,peer,invocation),resolveOwnerKey=(peer:ControllerPeer,invocation:ValidationMaterialInvocation)=>resolveInstalledVerificationOwner(assembly,peer,invocation),readApprovedRecipeBinding:Parameters<typeof createInstalledExecutionController>[0]['readApprovedRecipeBinding']=binding=>readInstalledApprovedRecipe(assembly,binding);
 const cleanup=(id:string)=>assertInstalledInputCleanup(assembly,id),read:TranscriptAccess['assertRead']=(...args)=>assertInstalledTranscriptRead(assembly,...args),remove:TranscriptAccess['assertDelete']=(...args)=>assertInstalledTranscriptDelete(assembly,...args),db=lifetime.database,admission=new AbortController(),identity:StackIdentity={lifetime,closed:false};
 function current(){if(identity.closed)throw Error('installed_stack_closed');assertInstalledControllerLifetime(lifetime);}

 let materialCleanup:ReturnType<typeof createStagingFactualCleanup>|undefined;
 let blackbox:ReturnType<typeof createApprovedBlackboxExecutor>|undefined;
 let qualification:ReturnType<typeof createInstalledEngineQualification>|undefined,materials:ReturnType<typeof createControllerMaterialPipeline>|undefined,execution:ReturnType<typeof createInstalledExecutionController>|undefined,transcripts:ReturnType<typeof createExecutionTranscriptStore>|undefined,runs:ReturnType<typeof createProtectedRunLedger>|undefined;
 const budget=sharedOwner.budget;

 async function drainOwners(){constructionFacts.phase='draining';const errors:unknown[]=[];for(const close of [()=>materialCleanup?.close(),()=>blackbox?.close(),()=>execution?.close(),()=>runs?.close(),()=>transcripts?.close(),()=>qualification?.close()])try{await close();}catch(error){errors.push(error);}if(errors.length){constructionFacts.phase='failed-unknown';unresolvedConstructions.add(constructionFacts);throw new AggregateError(errors,'installed_stack_shutdown_unknown');}identity.closed=true;constructionFacts.phase='drained';}

 try{
  // Broker and shared capacity are borrowed; root closes them after all owners drain.
  // The actual separate OS lifetime lock was acquired before this recovery. It
  // only marks unresolved execution unknown; no guest receipt is invented.
  const recovery=new ExecutionJournal({database:db});try{recovery.recoverInterrupted();}finally{recovery.close();}
  const engine=await initializeInstalledMacEngine({database:db,signal});constructionFacts.engine=engine;current();
  qualification=createInstalledEngineQualification({engine,database:db,budget});bindCapacity('qualification',qualification,engine);await qualification.ensureCurrent(signal);current();
  materials=createControllerMaterialPipeline({root:join(lifetime.state,'staging'),database:db,budget,engineBinding:qualification.currentFacts().engineBinding,broker:actualBroker,assertCurrent:current,assertCleanup:cleanup,resolveOwnerKey,createCapacityOwnerBinding:capacityOwner});bindCapacity('materials',materials);
  execution=createInstalledExecutionController({engine,database:db,qualification,budget,materials,resolveOwnerKey,readApprovedRecipeBinding,onActualExecutionResult(result,raw){if(!transcripts)throw Error('installed_transcript_not_initialized');transcripts.record({ownerKey:raw.readOwnerKey(result.expected),...result});if(runs?.hasExecution(result.expected))runs.recordActualExecution(result);}});
  bindCapacity('execution',execution.privateHost.raw);
  transcripts=createExecutionTranscriptStore({root:join(lifetime.state,'transcripts'),database:db,budget,assertCurrent:current,execution:execution.privateHost.raw,quiescence:execution.privateHost.quiescence,access:{assertRead:read,assertDelete:remove}});
  bindCapacity('transcripts',transcripts);
  runs=createProtectedRunLedger({root:join(lifetime.state,'protected-runs'),database:db,budget,assertCurrent:current,execution:execution.privateHost.raw,quiescence:execution.privateHost.quiescence,access:{assertStart:(...args)=>assertInstalledRunStart(assembly,...args),assertRead:(...args)=>assertInstalledRunRead(assembly,...args),assertDelete:(...args)=>assertInstalledRunDelete(assembly,...args)}});
  bindCapacity('runs',runs);
  // Only reconcile already durable deletion facts. No body deletion or native
  // approval is replayed; normal admission remains closed until these pages finish.
  for(const archive of [transcripts,runs]){
   let after:string|undefined;
   do{
    current();admission.signal.throwIfAborted();
    const page=archive.reconcileDeletedBudget({limit:64,...(after?{after}:{})});
    if(page.nextCursor===null)break;
    if(after!==undefined&&page.nextCursor<=after)throw Error('installed_archive_recovery_cursor');
    after=page.nextCursor;
    await yieldRecoveryBatch(undefined,{signal:admission.signal});
   }while(true);
  }
  blackbox=createApprovedBlackboxExecutor({assembly,database:db,raw:execution.privateHost.raw,caseStager:execution.privateHost.caseStager,quiescence:execution.privateHost.quiescence});
  const originalCleanupEngine=json(qualification.currentFacts().engineBinding),cleanupQualification=qualification;
  materialCleanup=createStagingFactualCleanup({database:db,materials,raw:execution.privateHost.raw,quiescence:execution.privateHost.quiescence,assertCurrent:current,async ensureQualified(signal){await cleanupQualification.ensureCurrent(signal);if(json(cleanupQualification.currentFacts().engineBinding)!==originalCleanupEngine)throw Error('staging_cleanup_engine_changed');}});
  const actualBlackbox=blackbox,actualRuns=runs;
  const actualExecution=execution,actualMaterials=materials,actualQualification=qualification,actualTranscripts=transcripts,active=new Set<Promise<unknown>>();let closing:Promise<void>|undefined;
  function shape(raw:unknown,keys:readonly string[]){const value=JSON.parse(json(raw));if(!value||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('installed_stack_shape');return value;}
  async function invoke(method:string,payload:unknown,peer:ControllerPeer,callerSignal:AbortSignal){current();const activeSignal=AbortSignal.any([callerSignal,admission.signal]);activeSignal.throwIfAborted();
   if(method==='controller.qualification'){shape(payload,[]);await actualQualification.ensureCurrent(activeSignal);current();return {...actualQualification.currentFacts(),authorityId:lifetime.manifest.authorityId,serviceEpoch:lifetime.serviceEpoch,deploymentPackageHash:lifetime.manifest.packageHash};}
   if(method==='materials.prepareRequest')return actualMaterials.prepareRequest(payload,peer,activeSignal);
   if(method==='materials.lookupRequest')return actualMaterials.lookupRequest(payload,peer);
   if(method==='materials.retireRequest')return actualMaterials.retireRequest(payload,peer);
   if(method==='materials.prepare')return actualMaterials.prepare(payload,peer,activeSignal);
   if(method==='materials.authorize'){const p=shape(payload,['challengeId']);return actualMaterials.authorize(p.challengeId,peer,activeSignal);}
   if(method==='materials.stage'){const p=shape(payload,['grantHandle','invocation']);return actualMaterials.stage(p,peer,activeSignal);}
   if(['execution.reserve','execution.dispatch','execution.quiescence'].includes(method))return actualExecution.publicPort.invoke(method,payload,peer,activeSignal);
   throw Error('installed_stack_method');
  }
  materialCleanup.startMaintenance();
  const result=Object.freeze({publicPort:Object.freeze({invoke(method:string,payload:unknown,peer:ControllerPeer,callerSignal:AbortSignal){const work=invoke(method,payload,peer,callerSignal);active.add(work);void work.then(()=>active.delete(work),()=>active.delete(work));return work;}}),privateHost:Object.freeze({materialCleanup,engine,broker:actualBroker,budget,qualification:actualQualification,materials:actualMaterials,execution:actualExecution,transcripts:actualTranscripts,runs:actualRuns,blackbox:actualBlackbox}),
   close(){return closing??=(async()=>{admission.abort();await Promise.allSettled([...active]);await drainOwners();})();},
  });
  constructionFacts.phase='active';installedStacks.set(result,identity);return result;
 }catch(error){admission.abort();try{await drainOwners();}catch(cleanupError){throw new AggregateError([error,cleanupError],'installed_stack_construction_cleanup_unknown',{cause:error});}
  // The factory never returns a partial stack. Its exact failure can carry only
  // the privately recorded result of the same completed owned drain.
  if(error&&typeof error==='object')failedStackDrains.set(error,{assembly,lifetime,ticket:construction,identity});
  // Primitive rejections have no identity witness and remain exactly unchanged.
  throw error;
 }
}

/** Fixed root-only mapped-resource owner. No qualification, new admission, or caller factories. */
export async function createInstalledMaintenanceStack(input:{assembly:object;lifetime:InstalledControllerLifetime;sharedCapacity:ReturnType<typeof createInstalledSharedCapacity>;broker:ReturnType<typeof createInstalledRootBrokerClient>;batch:object;signal?:AbortSignal}){
 const {assembly,lifetime,sharedCapacity,broker,batch,signal}=input;assertInstalledAssemblyLifetime(assembly,lifetime);assertInstalledSharedCapacity(sharedCapacity,lifetime,true);assertInstalledRootBrokerClient(broker,lifetime);readInstalledMaintenanceBatch(batch,lifetime);
 assertInstalledStackConstructionKind(assembly,'maintenance');
 const ticket=claimInstalledCapacityStackConstruction(assembly,sharedCapacity),facts:CapacityConstruction={owner:sharedCapacity,lifetime,components:new Map(),kind:'maintenance',phase:'constructing'};capacityConstructions.set(ticket,facts);
 let attachment:Awaited<ReturnType<typeof attachInstalledMacEngineForMaintenance>>|undefined,execution:ReturnType<typeof createInstalledMaintenanceExecution>|undefined,staging:ReturnType<typeof createInstalledMaintenanceStaging>|undefined,closing:Promise<void>|undefined;
 const identity:StackIdentity={lifetime,closed:false};let partialUnknown=false,partialError:unknown;
 async function drain(){facts.phase='draining';const errors:unknown[]=partialUnknown?[partialError]:[];for(const stop of [()=>staging?.close(),()=>execution?.close(),()=>attachment?.close()])try{await stop();}catch(error){errors.push(error);}if(errors.length){facts.phase='failed-unknown';unresolvedConstructions.add(facts);throw new AggregateError(errors,'installed_maintenance_shutdown_unknown');}facts.phase='drained';identity.closed=true;}
 try{
  attachment=await attachInstalledMacEngineForMaintenance({lifetime,signal});
  execution=createInstalledMaintenanceExecution({lifetime,attachment,sharedCapacity,construction:ticket});
  staging=createInstalledMaintenanceStaging({lifetime,broker,sharedCapacity,attachment,execution,construction:ticket});
  assertInstalledMaintenanceConstructionReady(ticket);activateInstalledMaintenanceExecution(execution,ticket);activateInstalledMaintenanceStaging(staging,ticket);facts.phase='active';
  const result=Object.freeze({privateHost:Object.freeze({execution,staging}),close(){return closing??=drain();}});installedStacks.set(result,identity);return result;
 }catch(error){partialUnknown=hasUnresolvedMaintenanceExecutionConstruction(error,ticket);partialError=error;try{await drain();}catch(cleanup){throw new AggregateError([error,cleanup],'installed_maintenance_construction_unknown',{cause:error});}throw error;}
}
