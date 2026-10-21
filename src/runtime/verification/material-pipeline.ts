import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';
import {createMaterialCapacityBinding} from './shared-blob-capacity.js';
import {basename,dirname} from 'node:path';
import type {Database} from 'better-sqlite3';
import {assertVerificationBlobBudgetDatabase,type createVerificationBlobBudget} from './blob-budget.js';
import type {createInstalledRootBrokerClient} from './root-broker-client.js';
import type {ControllerPeer} from './controller-public-daemon.js';
import {createMaterialAuthority,readMaterialMountPlanHandoff,attachMaterialMountPlanHandoff} from './material-authority.js';
import {createBrokerInputStager,assertBrokerStagingDeleted} from '../isolated-execution/broker-staging.js';
import {parseValidationMaterialDraft,type ValidationMaterialInvocation} from './product-material-authorization.js';
const databases=new WeakMap<object,{database:Database;stager:object;assertCurrent():void}>();
export function assertControllerMaterialPipelineDatabase(pipeline:object,database:Database):void{const known=databases.get(pipeline);if(!known||known.database!==database)throw Error('verification_operation_database');known.assertCurrent();}
export function assertMaterialPipelineDeleted(pipeline:object,database:Database,proof:object,proposal:Readonly<import('./blob-budget.js').BlobReservationProposal>):void{const known=databases.get(pipeline);if(!known||known.database!==database)throw Error('verification_operation_database');known.assertCurrent();assertBrokerStagingDeleted(known.stager,database,proof,proposal);}
/** Private production composition. The installed daemon supplies its fixed root
 * broker client and current owner registry. This factory does not qualify mocks. */
export function createControllerMaterialPipeline(input:{root:string;database:Database;budget:ReturnType<typeof createVerificationBlobBudget>;engineBinding:{engineId:string;incarnation:string};broker:Pick<ReturnType<typeof createInstalledRootBrokerClient>,'clock'|'inspectMaterial'|'authorizeMaterials'|'readMaterialPage'>;assertCurrent():void;assertCleanup(resourceId:string):void;resolveOwnerKey(peer:ControllerPeer,invocation:ValidationMaterialInvocation):string;createCapacityOwnerBinding?(peer:ControllerPeer,invocation:ValidationMaterialInvocation):object;wallNow?():number}){
 assertVerificationBlobBudgetDatabase(input.budget,input.database);
 const {broker,resolveOwnerKey,createCapacityOwnerBinding,database}=input,wallNow=input.wallNow??Date.now;
 function checkedOwner(peer:ControllerPeer,invocation:ValidationMaterialInvocation){const value=resolveOwnerKey(peer,invocation);if(typeof value!=='string'||!value||Buffer.byteLength(value)>1024){void Promise.resolve(value).catch(()=>{});throw Error('material_owner');}return value;}
 let stager:ReturnType<typeof createBrokerInputStager>;
 const authority=createMaterialAuthority({database:input.database,engineBinding:input.engineBinding,clock:broker.clock.bind(broker),wallNow,resolveOwnerKey:checkedOwner,
  inspectFile(peer,file,signal){return broker.inspectMaterial({uid:peer.uid,workspace:dirname(file.path),path:basename(file.path),byteLimit:file.byteLimit},signal);},
  approve(peer,review,signal,deadline){return broker.authorizeMaterials({uid:peer.uid,auditSessionId:peer.auditSessionId,review,deadline},signal);},
  acceptPlan(plan){stager.acceptPlan(plan);},discardPlan(plan){stager.discardUnpublishedPlan(plan);},
  async stage(grant,_review,signal){const facts=authority.getGrantFacts(grant),capacityBinding=createCapacityOwnerBinding?createMaterialCapacityBinding({database:input.database,authority,grant,ownerBinding:createCapacityOwnerBinding(facts.peer,facts.review.invocation)}):undefined;return (await stager.prepareValidationInput({grant,ownerKey:facts.ownerKey,signal,capacityBinding})).materializedInput;},
 });
 stager=createBrokerInputStager({root:input.root,database:input.database,budget:input.budget,assertCurrent:input.assertCurrent,assertCleanup:input.assertCleanup,access:{
  getFacts:authority.getGrantFacts,
  readPage(grant,page,signal){const facts=authority.getGrantFacts(grant),file=facts.review.materials.find(f=>f.path===page.path);if(!file||file.sha256!==page.contentHash||file.byteLimit!==page.byteLimit)throw Error('material_pipeline_read_scope');return broker.readMaterialPage({uid:facts.peer.uid,workspace:dirname(file.path),path:basename(file.path),byteLimit:file.byteLimit,contentHash:file.sha256,offset:page.offset,length:page.length},signal);},
 }});
 const pipeline=Object.freeze({
  prepareRequest:authority.prepareRequest,lookupRequest:authority.lookupRequest,retireRequest:authority.retireRequest,
  stager,assertScopeInactive:authority.assertScopeInactive,
  prepare(raw:unknown,peer:ControllerPeer,signal:AbortSignal){const draft=parseValidationMaterialDraft(raw,wallNow());checkedOwner(peer,draft.invocation);return authority.prepare(draft,peer,signal);},
  authorize:authority.authorize,stage:authority.stage,consumeMountPlan:authority.consumeMountPlan,inspectMountPlanHandoff:authority.inspectMountPlanHandoff,readMountPlanHandoff:(ticket:object)=>readMaterialMountPlanHandoff(ticket,authority,database),attachMountPlanHandoff:(ticket:object,transaction:object,expected:QuiescenceExpectation)=>attachMaterialMountPlanHandoff(ticket,authority,database,transaction,expected),revoke:authority.revoke,
 });
 databases.set(pipeline,{database:input.database,stager,assertCurrent:input.assertCurrent.bind(input)});
 return pipeline;
}
