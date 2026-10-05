import {assertSharedBlobCapacityAuthority} from './shared-blob-capacity.js';
import {assertSharedCapacityLedgerAuthority} from './shared-capacity-ledger.js';
import {assertVerificationBlobBudgetAuthority} from './blob-budget.js';
import {assertAuthorityBlobBudgetAuthority} from './authority-blob-budget.js';
import {createInstalledKSwarmEnrollmentCapability} from './kswarm-enrollment-capability.js';
import type {createProtectedRunLedger} from './protected-run-ledger.js';
import {assertApprovedVerificationOperationsDatabase} from './approved-verification-operation.js';
import type {RecipeBinding} from './independent-recipes.js';
import type {ControllerPeer} from './controller-public-daemon.js';
import type {ValidationMaterialInvocation} from './product-material-authorization.js';
import type {Database} from 'better-sqlite3';
import type {QuiescenceExpectation,PhysicalQuiescenceReceipt} from '../isolated-execution/physical-quiescence.js';
import {assertInstalledControllerLifetime} from './installed-controller-lifetime.js';
import {assertInstalledRootBrokerClient} from './root-broker-client.js';
import {assertInstalledExecutionStack} from './installed-execution-stack.js';
import {assertApprovedRecipeArtifactReader} from './approved-artifact-reader.js';
import {createControllerApplicationRouting} from './controller-application-routing.js';
import {createInstalledSharedCapacity,assertInstalledSharedCapacityAuthority,isCapacityMappingNotReady} from './installed-shared-capacity.js';
import {createApplicationBindingAuthority} from './application-binding-authority.js';
import {APPLICATION_METHODS,type ApplicationMethod} from './application-transport.js';
import {createInstalledCapacityMaintenance} from './installed-capacity-maintenance.js';
import {createInstalledRootBrokerClient} from './root-broker-client.js';
import {ARCHIVE_METHODS,type ArchiveMethod} from './archive-transport.js';
import {createArchiveOperationRouting} from './archive-operation-routing.js';
import {createUserArchiveOperations} from './user-archive-operations.js';
import {createApprovedPublicationOperations} from './approved-publication-operation.js';
import {createInstalledReceiverTransport} from './installed-receiver-transport.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {refreshNativeApprovalQualification,createStableQualificationRefresh} from './native-approval-refresh.js';
import {createControllerOperationRouting} from './controller-operation-routing.js';
import {closeInstalledControllerComponents} from './controller-shutdown.js';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createInstalledControllerLifetime} from './installed-controller-lifetime.js';
import {createInstalledExecutionStack} from './installed-execution-stack.js';
import {createInstalledReceiverRegistration,assertInstalledReceiverRegistration} from './installed-receiver-registration.js';
import {createVerificationCompletionComposition} from './completion-composition.js';
import {createApprovedSourceCapabilities} from './approved-source-capabilities.js';
import {createApprovedProtectedSourceReader} from './approved-protected-source-reader.js';
import {createApprovedVerificationOperations} from './approved-verification-operation.js';
import {createApprovedRecipeArtifactReader} from './approved-artifact-reader.js';
import {createInstalledProfileIndexPublisher} from './installed-migration-publisher.js';
import {startPublicController} from './controller-public-daemon.js';
import {readControllerSocketAuditPeer} from './socket-peer.js';
const failedLifetimes=new Set<ReturnType<typeof createInstalledControllerLifetime>>();
const unresolvedShutdownErrors=new WeakSet<object>();
/** Read-only error classification; only an actual root close failure can enter this set. */
export function isInstalledControllerShutdownUnresolved(error:unknown):boolean{return typeof error==='object'&&error!==null&&unresolvedShutdownErrors.has(error);}
type InstalledAssemblyState={lifetime:ReturnType<typeof createInstalledControllerLifetime>;admission:AbortSignal;closed:boolean;receiver?:ReturnType<typeof createInstalledReceiverRegistration>;stack?:Awaited<ReturnType<typeof createInstalledExecutionStack>>;completion?:ReturnType<typeof createVerificationCompletionComposition>;caps?:ReturnType<typeof createApprovedSourceCapabilities>;sources?:ReturnType<typeof createApprovedProtectedSourceReader>;artifacts?:ReturnType<typeof createApprovedRecipeArtifactReader>;engineBinding?:string;verification?:ReturnType<typeof createApprovedVerificationOperations>;archive?:ReturnType<typeof createUserArchiveOperations>};
const installedAssemblies=new WeakMap<object,InstalledAssemblyState>();
type InstalledCapacityLayer='installed-owner'|'shared'|'ledger'|'authority-budget'|'blob-budget';
type InstalledCapacityAuthorityState={assembly:InstalledAssemblyState;stackConstruction?:object;layers:Map<InstalledCapacityLayer,{phase:'constructing'|'ready'|'failed'|'closed';component?:object}>};
const installedCapacityAuthorities=new WeakMap<object,InstalledCapacityAuthorityState>(),capacityAuthorityLifetimes=new WeakSet<object>(),assemblyCapacityAuthorities=new WeakMap<object,object>();
type InstalledCapacityAuthorityFacts=Readonly<{database:Database;authorityId:string}>;
export function claimInstalledCapacityStackConstruction(assembly:object,owner:object):object{const token=assemblyCapacityAuthorities.get(assembly);if(!token)throw Error('installed_capacity_construction');const state=capacityAuthority(token);if(installedAssemblies.get(assembly)!==state.assembly||state.stackConstruction||state.layers.get('installed-owner')?.component!==owner)throw Error('installed_capacity_construction');const ticket=Object.freeze({});state.stackConstruction=ticket;return ticket;}
function capacityAuthority(token:object){const state=installedCapacityAuthorities.get(token);if(!state)throw Error('capacity_authority_configuration');if(state.assembly.closed)throw Error('capacity_authority_closed');assertInstalledControllerLifetime(state.assembly.lifetime);return state;}
/** Narrow capacity facts only; this token is not accepted by assembly APIs. */
export function readInstalledCapacityAuthority(token:object):InstalledCapacityAuthorityFacts{if(arguments.length!==1)throw Error('capacity_authority_configuration');const state=capacityAuthority(token);return Object.freeze({database:state.assembly.lifetime.database,authorityId:state.assembly.lifetime.manifest.authorityId});}
export function assertInstalledCapacityReplacement(authority:object,_receipt:object,_facts:Readonly<import('./shared-capacity-ledger.js').CapacityMetadataReplacementFacts>):void{readInstalledCapacityAuthority(authority);throw Error('shared_capacity_replacement_unavailable');}
/** No installed commit issuer exists until the fixed target handoff is wired.
 * Preparation/custody receipts can never become retirement authorization. */
export function assertInstalledCapacityReplacementCommit(authority:object,_receipt:object,_facts:Readonly<import('./shared-capacity-ledger.js').CapacityMetadataReplacementFacts>):void{readInstalledCapacityAuthority(authority);throw Error('shared_capacity_replacement_commit_unavailable');}
export function executeInstalledCapacityReplacementCommit(authority:object,_receipt:object,_context:import('./shared-capacity-ledger.js').CapacityMetadataReplacementCommitContext):void{readInstalledCapacityAuthority(authority);throw Error('shared_capacity_replacement_commit_unavailable');}

export function assertInstalledCapacityAuthorityLifetime(token:object,lifetime:ReturnType<typeof createInstalledControllerLifetime>):void{const state=capacityAuthority(token);if(state.assembly.lifetime!==lifetime)throw Error('capacity_authority_lifetime');}
export function claimInstalledCapacityLayer(token:object,layer:InstalledCapacityLayer):InstalledCapacityAuthorityFacts{const state=installedCapacityAuthorities.get(token);if(!state)throw Error('capacity_authority_configuration');if(state.assembly.closed)throw Error('capacity_authority_closed');if(!['installed-owner','shared','ledger','authority-budget','blob-budget'].includes(layer))throw Error('capacity_authority_layer');if(state.layers.has(layer))throw Error('capacity_authority_layer_used');const parent=layer==='ledger'?'shared':layer==='blob-budget'?'authority-budget':layer==='installed-owner'?undefined:'installed-owner';if(parent&&state.layers.get(parent)?.phase!=='constructing')throw Error('capacity_authority_layer_order');if((layer==='authority-budget'||layer==='blob-budget')&&state.layers.get('shared')?.phase!=='ready')throw Error('capacity_authority_layer_order');const slot:{phase:'constructing'|'failed';component?:object}={phase:'constructing'};state.layers.set(layer,slot);try{return readInstalledCapacityAuthority(token);}catch(error){slot.phase='failed';throw error;}}
export function finishInstalledSharedCapacityLayer(token:object,component:object):void{const state=capacityAuthority(token),slot=state.layers.get('installed-owner');if(!slot||slot.phase!=='constructing')throw Error('capacity_authority_layer');assertInstalledSharedCapacityAuthority(component,token);if(['shared','ledger','authority-budget','blob-budget'].some(layer=>state.layers.get(layer as InstalledCapacityLayer)?.phase!=='ready'))throw Error('capacity_authority_layer_order');slot.component=component;slot.phase='ready';}
function assertCapacityLayerComponent(token:object,layer:InstalledCapacityLayer,component:object){switch(layer){case 'installed-owner':assertInstalledSharedCapacityAuthority(component,token);break;case 'shared':assertSharedBlobCapacityAuthority(component,token);break;case 'ledger':assertSharedCapacityLedgerAuthority(component,token);break;case 'authority-budget':assertAuthorityBlobBudgetAuthority(component,token);break;case 'blob-budget':assertVerificationBlobBudgetAuthority(component,token);break;}}
export function finishInstalledCapacityLayer(token:object,layer:InstalledCapacityLayer,component:object):void{const state=capacityAuthority(token),slot=state.layers.get(layer);if(!slot||slot.phase!=='constructing')throw Error('capacity_authority_layer');assertCapacityLayerComponent(token,layer,component);slot.component=component;slot.phase='ready';}
export function readInstalledCapacityLayer(token:object,layer:InstalledCapacityLayer):object{const state=capacityAuthority(token),slot=state.layers.get(layer);if(!slot||slot.phase!=='ready'||!slot.component)throw Error('capacity_authority_layer');assertCapacityLayerComponent(token,layer,slot.component);return slot.component;}
export function failInstalledCapacityLayer(token:object,layer:InstalledCapacityLayer):void{const state=installedCapacityAuthorities.get(token),slot=state?.layers.get(layer);if(!slot||slot.phase!=='constructing')throw Error('capacity_authority_layer');slot.phase='failed';}

function assemblyState(token:object){
 const state=installedAssemblies.get(token);if(!state)throw Error('installed_assembly_identity');if(state.closed)throw Error('installed_assembly_closed');
 assertInstalledControllerLifetime(state.lifetime);
 if(!state.stack||!state.receiver||!state.completion||!state.caps||!state.sources||!state.artifacts||!state.engineBinding)throw Error('installed_assembly_unassembled');
 assertInstalledExecutionStack(state.stack,state.lifetime);assertInstalledReceiverRegistration(state.receiver,state.lifetime);assertInstalledRootBrokerClient(state.stack.privateHost.broker,state.lifetime);
 assertApprovedRecipeArtifactReader(state.artifacts,state.stack.privateHost.execution.privateHost.raw);
 return state as Required<InstalledAssemblyState>;
}
/** Validators/compiled operations only. The sole issuer is zero-argument start. */
export function assertInstalledVerificationAssembly(token:object,database:Database,input:Pick<Parameters<typeof createApprovedVerificationOperations>[0],'completion'|'materials'|'raw'|'quiescence'|'runs'|'capabilities'|'sourceReader'|'imageId'|'verifierHash'>){
 const state=assemblyState(token),stack=state.stack.privateHost;
 if(database!==state.lifetime.database||input.completion!==state.completion.privateHost||input.materials!==stack.materials||input.raw!==stack.execution.privateHost.raw||input.quiescence!==stack.execution.privateHost.quiescence||input.runs!==stack.runs||input.capabilities!==state.caps||input.sourceReader!==state.sources||input.imageId!==stack.engine.imageDigest||input.verifierHash!==state.lifetime.manifest.packageHash)throw Error('installed_assembly_binding');
}
export function assertInstalledAssemblyLifetime(token:object,lifetime:ReturnType<typeof createInstalledControllerLifetime>):void{const state=installedAssemblies.get(token);if(!state||state.lifetime!==lifetime)throw Error('installed_assembly_identity');if(state.closed)throw Error('installed_assembly_closed');assertInstalledControllerLifetime(lifetime);}
export function resolveInstalledVerificationOwner(token:object,peer:ControllerPeer,invocation:ValidationMaterialInvocation){return assemblyState(token).completion.privateHost.enrollment.resolveOwnerKey(peer,invocation);}
export function createInstalledVerificationCapacityBinding(token:object,peer:ControllerPeer,invocation:ValidationMaterialInvocation){return assemblyState(token).completion.privateHost.enrollment.createCapacityOwnerBinding(peer,invocation);}
export function readInstalledApprovedRecipe(token:object,binding:RecipeBinding){return assemblyState(token).completion.privateHost.readApprovedRecipeBinding(binding);}
function actualVerification(token:object){const state=assemblyState(token),verification=state.verification;if(!verification)throw Error('installed_assembly_unassembled');assertApprovedVerificationOperationsDatabase(verification,state.lifetime.database,state.completion.privateHost);return verification;}
export function readInstalledVerificationPlan(token:object,binding:RecipeBinding){return actualVerification(token).getOriginalPlan(binding);}
export function readInstalledVerificationSignal(token:object,binding:RecipeBinding){return actualVerification(token).signalForBinding(binding);}
export function registerInstalledCaseExecution(token:object,binding:RecipeBinding,expected:QuiescenceExpectation,database:Database){const state=assemblyState(token);if(state.lifetime.database!==database)throw Error('installed_assembly_binding');actualVerification(token).registerCaseExecution(binding,expected,database);}
export function recordInstalledCaseResult(token:object,result:Parameters<ReturnType<typeof createApprovedVerificationOperations>['recordCaseResult']>[0]){actualVerification(token).recordCaseResult(result);}
export function recordInstalledCaseCancellation(token:object,result:Parameters<ReturnType<typeof createApprovedVerificationOperations>['recordCaseCancellation']>[0]){actualVerification(token).recordCaseCancellation(result);}
export function assertInstalledInputCleanup(token:object,id:string){assemblyState(token).stack.privateHost.materialCleanup.assertCleanup(id);}
export function assertInstalledTranscriptRead(token:object,...args:Parameters<ReturnType<typeof createUserArchiveOperations>['assertTranscriptRead']>){const archive=assemblyState(token).archive;if(!archive)throw Error('installed_assembly_unassembled');archive.assertTranscriptRead(...args);}
export function assertInstalledTranscriptDelete(token:object,...args:Parameters<ReturnType<typeof createUserArchiveOperations>['assertTranscriptDelete']>){const archive=assemblyState(token).archive;if(!archive)throw Error('installed_assembly_unassembled');archive.assertTranscriptDelete(...args);}
export function assertInstalledRunDelete(token:object,...args:Parameters<ReturnType<typeof createUserArchiveOperations>['assertRunDelete']>){const archive=assemblyState(token).archive;if(!archive)throw Error('installed_assembly_unassembled');archive.assertRunDelete(...args);}
export function assertInstalledRunStart(token:object,...args:Parameters<ReturnType<typeof createApprovedSourceCapabilities>['assertStart']>){assemblyState(token).caps.assertStart(...args);}
export function assertInstalledRunRead(token:object,...args:Parameters<Parameters<typeof createProtectedRunLedger>[0]['access']['assertRead']>){const state=assemblyState(token),archive=state.archive;if(!archive)throw Error('installed_assembly_unassembled');if(archive.isReadCapability(args[1]))archive.assertRunRead(...args);else state.caps.assertRead(...args);}
export function assertInstalledAssemblyDatabase(token:object,database:Database):void{const state=installedAssemblies.get(token);if(!state||state.lifetime.database!==database)throw Error('installed_assembly_identity');assertInstalledAssemblyLifetime(token,state.lifetime);}
export function assertInstalledBlackboxExecution(token:object,database:Database,raw:object,caseStager:object,quiescence:object):void{const state=assemblyState(token),execution=state.stack.privateHost.execution.privateHost;if(state.lifetime.database!==database||execution.raw!==raw||execution.caseStager!==caseStager||execution.quiescence!==quiescence)throw Error('installed_assembly_binding');}
export function assertInstalledVerificationCurrent(token:object):void{const state=assemblyState(token);state.stack.privateHost.qualification.assertCurrent();}
export function readInstalledVerificationClock(token:object){const state=assemblyState(token);return state.stack.privateHost.broker.clock();}
export async function ensureInstalledVerificationQualification(token:object,signal:AbortSignal):Promise<void>{const state=assemblyState(token);state.admission.throwIfAborted();signal.throwIfAborted();await state.stack.privateHost.qualification.ensureCurrent(signal);assertInstalledVerificationCurrent(token);state.admission.throwIfAborted();signal.throwIfAborted();if(json(state.stack.privateHost.qualification.currentFacts().engineBinding)!==state.engineBinding)throw Error('installed_controller_engine_changed');}
export function recordInstalledVerificationResult(token:object,result:{expected:QuiescenceExpectation;output:object;receipt:PhysicalQuiescenceReceipt}):void{const state=assemblyState(token),stack=state.stack.privateHost;stack.transcripts.record({ownerKey:stack.execution.privateHost.raw.readOwnerKey(result.expected),...result});}
export function registerInstalledVerificationOutput(token:object,result:{expected:QuiescenceExpectation;output:object;receipt:PhysicalQuiescenceReceipt}):void{const state=assemblyState(token);state.artifacts.registerActualOutput(result);}

/** Sole fixed installed entry. Public listener opens only after all private ports
 * are actual, same-authority instances. No user-selected path/key/engine/config. */
export async function startInstalledVerificationController(){
 if(arguments.length)throw Error('installed_controller_arguments');
 const lifetime=createInstalledControllerLifetime(),db=lifetime.database,admission=new AbortController(),assembly=Object.freeze({}),assemblyFacts:InstalledAssemblyState={lifetime,admission:admission.signal,closed:false};installedAssemblies.set(assembly,assemblyFacts);
 const capacityAuthorityToken=Object.freeze({});if(capacityAuthorityLifetimes.has(lifetime))throw Error('capacity_authority_lifetime_used');capacityAuthorityLifetimes.add(lifetime);installedCapacityAuthorities.set(capacityAuthorityToken,{assembly:assemblyFacts,layers:new Map()});assemblyCapacityAuthorities.set(assembly,capacityAuthorityToken);
 let stack:Awaited<ReturnType<typeof createInstalledExecutionStack>>|undefined,completion:ReturnType<typeof createVerificationCompletionComposition>|undefined,caps:ReturnType<typeof createApprovedSourceCapabilities>|undefined,sources:ReturnType<typeof createApprovedProtectedSourceReader>|undefined,operations:ReturnType<typeof createApprovedVerificationOperations>|undefined,artifacts:ReturnType<typeof createApprovedRecipeArtifactReader>|undefined,server:Awaited<ReturnType<typeof startPublicController>>|undefined;
 let archive:ReturnType<typeof createUserArchiveOperations>|undefined;
 let application:ReturnType<typeof createApplicationBindingAuthority>|undefined;
 let publication:ReturnType<typeof createApprovedPublicationOperations>|undefined,receiverTransport:ReturnType<typeof createInstalledReceiverTransport>|undefined;
 let sharedCapacity:ReturnType<typeof createInstalledSharedCapacity>|undefined,rootBroker:ReturnType<typeof createInstalledRootBrokerClient>|undefined,maintenance:ReturnType<typeof createInstalledCapacityMaintenance>|undefined;
 let stackConstructionPending=false;
 let receiver:ReturnType<typeof createInstalledReceiverRegistration>|undefined,closing:Promise<void>|undefined;
 const need=<T>(value:T|undefined):T=>{lifetime.assertCurrent();if(!value)throw Error('installed_controller_unassembled');return value;};
 const denied=()=>{throw Error('installed_controller_native_delete_authorization_required');};
 function close():Promise<void>{
  if(closing)return closing;
  let resolve!:(value:void)=>void,reject!:(error:unknown)=>void;closing=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  // Publish the original attempt before abort listeners or any actual drain may reenter.
  admission.abort(Error('installed_controller_closing'));
  void closeInstalledControllerComponents({components:[()=>{if(stackConstructionPending)throw Error('installed_stack_construction_unknown');},()=>server?.close(),()=>maintenance?.close(),()=>archive?.close(),()=>application?.close(),()=>publication?.close(),()=>receiverTransport?.close(),()=>operations?.close(),()=>stack?.close()],finalizers:[()=>sources?.close(),()=>caps?.close(),()=>artifacts?.close(),()=>completion?.close(),()=>receiver?.close(),()=>sharedCapacity?.close(),()=>rootBroker?.dispose()],closeLifetime:()=>{lifetime.close();assemblyFacts.closed=true;},retainLifetime:()=>{failedLifetimes.add(lifetime);}}).then(resolve,error=>{const failure=typeof error==='object'&&error!==null?error:new AggregateError([error],'installed_controller_shutdown_unknown');unresolvedShutdownErrors.add(failure);reject(failure);});
  return closing;
 }
 try{
  rootBroker=createInstalledRootBrokerClient();sharedCapacity=createInstalledSharedCapacity(capacityAuthorityToken);
  try{sharedCapacity.capacity.migrateLegacy();}catch(error){
   if(!isCapacityMappingNotReady(error))throw error;
   maintenance=createInstalledCapacityMaintenance({lifetime,broker:rootBroker,capacity:sharedCapacity.capacity});const recovery=maintenance;
   server=await startPublicController({socketPath:join(lifetime.base,'public','controller.sock'),authorityId:lifetime.manifest.authorityId,serviceEpoch:lifetime.serviceEpoch,privateKey:lifetime.privateKey,allowedUserIds:lifetime.manifest.allowedUserIds,
    acceptPeer(socket){lifetime.assertCurrent();const peer=readControllerSocketAuditPeer(socket,lifetime.peerHelper);return {uid:peer.uid,gid:peer.gid,auditSessionId:peer.auditSessionId};},
    async invoke(method,payload,peer,signal){const combined=AbortSignal.any([signal,admission.signal]);combined.throwIfAborted();lifetime.assertCurrent();if(method!=='maintenance.diagnose')throw Error('installed_controller_maintenance');return recovery.publicPort.diagnose(payload,peer,combined);},
   });
   return Object.freeze({close});
  }
  receiver=createInstalledReceiverRegistration(lifetime);const actualReceiver=receiver;assertInstalledReceiverRegistration(actualReceiver,lifetime);
  stackConstructionPending=true;
  stack=await createInstalledExecutionStack({assembly,lifetime,sharedCapacity,broker:rootBroker});
  stackConstructionPending=false;
  const installed=stack.privateHost,broker=installed.broker,raw=installed.execution.privateHost.raw,quiescence=installed.execution.privateHost.quiescence;
  const qualified=()=>{lifetime.assertCurrent();assertInstalledReceiverRegistration(actualReceiver,lifetime);installed.qualification.assertCurrent();};
  const initialEngineBinding=json(installed.qualification.currentFacts().engineBinding);
  const renew=createStableQualificationRefresh({ensureCurrent:signal=>installed.qualification.ensureCurrent(signal),readBinding:()=>installed.qualification.currentFacts().engineBinding,assertCurrent:qualified});
  completion=createVerificationCompletionComposition({root:lifetime.state,database:db,authorityId:lifetime.manifest.authorityId,
   authority:{receiverVerifier:actualReceiver.receiverVerifier,issuerId:lifetime.manifest.authorityId,keyId:createHash('sha256').update(lifetime.publicKey.export({format:'der',type:'spki'})).digest('hex'),verifierHash:lifetime.manifest.packageHash,serviceEpoch:lifetime.serviceEpoch,privateKey:lifetime.privateKey,clock:()=>broker.clock(),assertQualified:qualified,quiescence},
   enrollment:{kswarmCapability:createInstalledKSwarmEnrollmentCapability(lifetime),resolvePrincipal:peer=>broker.resolvePrincipal(peer),approve:async(review,signal)=>{const approval=await broker.authorizeOwnerEnrollment(review,signal);return refreshNativeApprovalQualification({approval,deadline:review.deadline,originalEngineBinding:initialEngineBinding,ensureQualified:()=>renew(signal),currentEngineBinding:()=>json(installed.qualification.currentFacts().engineBinding),clock:()=>broker.clock(),assertCurrent:()=>{lifetime.assertCurrent();assertInstalledReceiverRegistration(actualReceiver,lifetime);}});},profilePublication:createInstalledProfileIndexPublisher({lifetime})},
   recipePorts:{assertCurrent:binding=>{need(completion).privateHost.readApprovedRecipeBinding(binding);},readArtifact:(binding,path,limits)=>need(artifacts).readArtifact(binding,path,limits),runBlackbox:request=>installed.blackbox.runBlackbox(request),readFailedRun:request=>need(sources).readFailedRun(request),assertFailedRunComplete:(receipt,expected)=>installed.runs.assertComplete(receipt,expected)},
  });
  application=createApplicationBindingAuthority({database:db,authorityId:lifetime.manifest.authorityId,completion,clock:()=>broker.clock(),assertCurrent:qualified,resolvePrincipal:peer=>broker.resolvePrincipal(peer),approve:async(review,signal)=>{const approval=await broker.authorizeApplicationBinding({requestSource:'user',review},signal);return refreshNativeApprovalQualification({approval,deadline:review.deadline,originalEngineBinding:initialEngineBinding,ensureQualified:()=>renew(signal),currentEngineBinding:()=>json(installed.qualification.currentFacts().engineBinding),clock:()=>broker.clock(),assertCurrent:()=>{lifetime.assertCurrent();assertInstalledReceiverRegistration(actualReceiver,lifetime);}});}});
  caps=createApprovedSourceCapabilities({database:db,completion:completion.privateHost,clock:()=>broker.clock()});
  sources=createApprovedProtectedSourceReader({database:db,completion:completion.privateHost,capabilities:caps,runs:installed.runs});
  artifacts=createApprovedRecipeArtifactReader({raw,quiescence,readApprovedRecipeBinding:completion.privateHost.readApprovedRecipeBinding});
  Object.assign(assemblyFacts,{receiver:actualReceiver,stack,completion,caps,sources,artifacts,engineBinding:initialEngineBinding});
  operations=createApprovedVerificationOperations({assembly,database:db,runs:installed.runs,capabilities:caps,completion:completion.privateHost,materials:installed.materials,raw,quiescence,imageId:installed.engine.imageDigest,verifierHash:lifetime.manifest.packageHash,sourceReader:sources});
  assemblyFacts.verification=operations;
  receiverTransport=createInstalledReceiverTransport(lifetime,actualReceiver);
  publication=createApprovedPublicationOperations({database:db,authorityId:lifetime.manifest.authorityId,completion,verification:operations,receiverIdentity:actualReceiver.identity,receiver:receiverTransport,clock:()=>broker.clock(),assertCurrent:qualified,resolvePrincipal:peer=>broker.resolvePrincipal(peer),approve:async(review,signal)=>{const approval=await broker.authorizePublicationOperation(review,signal);return refreshNativeApprovalQualification({approval,deadline:review.deadline,originalEngineBinding:initialEngineBinding,ensureQualified:()=>renew(signal),currentEngineBinding:()=>json(installed.qualification.currentFacts().engineBinding),clock:()=>broker.clock(),assertCurrent:()=>{lifetime.assertCurrent();assertInstalledReceiverRegistration(actualReceiver,lifetime);}});}});
  archive=createUserArchiveOperations({database:db,raw,quiescence,authorityId:lifetime.manifest.authorityId,completion,transcripts:installed.transcripts,runs:installed.runs,clock:()=>broker.clock(),assertCurrent:qualified,ensureQualified:signal=>renew(signal),resolvePrincipal:peer=>broker.resolvePrincipal(peer),approve:(review,signal)=>broker.authorizeArchiveOperation({requestSource:'user',review},signal)});
  assemblyFacts.archive=archive;
  const archiveRouting=createArchiveOperationRouting(archive,signal=>renew(signal));
  const routing=createControllerOperationRouting({assertCurrent:()=>{admission.signal.throwIfAborted();lifetime.assertCurrent();},renew:signal=>renew(signal),verification:operations,publication,completion:completion.public,execution:stack.publicPort});
  const applicationRouting=createControllerApplicationRouting({application:need(application),assertCurrent:()=>{admission.signal.throwIfAborted();lifetime.assertCurrent();},renew:signal=>renew(signal)});
  // The namespace is ready only here; no early requests can reach late-bound ports.
  server=await startPublicController({socketPath:join(lifetime.base,'public','controller.sock'),authorityId:lifetime.manifest.authorityId,serviceEpoch:lifetime.serviceEpoch,privateKey:lifetime.privateKey,allowedUserIds:lifetime.manifest.allowedUserIds,
   acceptPeer(socket){lifetime.assertCurrent();const peer=readControllerSocketAuditPeer(socket,lifetime.peerHelper);return {uid:peer.uid,gid:peer.gid,auditSessionId:peer.auditSessionId};},
   async invoke(method,payload,peer,signal){const combined=AbortSignal.any([signal,admission.signal]);if(APPLICATION_METHODS.includes(method as ApplicationMethod))return applicationRouting.invoke(method,payload,peer,combined);if(ARCHIVE_METHODS.includes(method as ArchiveMethod)){lifetime.assertCurrent();return archiveRouting.invoke(method,payload,peer,combined);}return routing.invoke(method,payload,peer,combined);},
  });
  return Object.freeze({close});
 }catch(error){
  // Keep the original lifetime before cleanup: unknown drains and native close
  // failures must never let GC release its actual OS owner lock.
  failedLifetimes.add(lifetime);
  try{
   await closeInstalledControllerComponents({components:[()=>{if(stackConstructionPending)throw Error('installed_stack_construction_unknown');},()=>server?.close(),()=>maintenance?.close(),()=>archive?.close(),()=>application?.close(),()=>publication?.close(),()=>receiverTransport?.close(),()=>operations?.close(),()=>stack?.close()],
    finalizers:[()=>sources?.close(),()=>caps?.close(),()=>artifacts?.close(),()=>completion?.close(),()=>receiver?.close(),()=>sharedCapacity?.close(),()=>rootBroker?.dispose()],
    closeLifetime(){},retainLifetime(){/* Already strongly retained before cleanup. */}});
  }catch(cleanupError){throw new AggregateError([error,cleanupError],'installed_controller_startup_cleanup_unknown',{cause:error});}
  throw error;
 }
}
