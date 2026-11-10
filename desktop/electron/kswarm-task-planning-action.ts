import {z} from 'zod';
import {TASK_METADATA_PLANNING_INPUT,type TaskMetadataPlanningInput} from '../shared/task-composite-planning-contract.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import {inspectProjectPlanningTrigger,type ProjectPlanningTriggerProof} from './project-planning-typed-ipc.js';
import {createInitialPlanOwnerClient,inspectUnclaimedInitialPlanState,readPlanningOwnerResponse} from './kswarm-initial-plan-owner-client.js';
import {captureTaskCompositeProposal,compositeDigest} from './kswarm-composite-journal-data.js';
import {isTaskCompositeNotApplied} from './kswarm-task-composite-observation.js';
import type {ConversationProjectService} from './conversation-project-service.js';
import type {KSwarmService} from './kswarm-service.js';
import type {JsonKSwarmInitialPlanBootstrapStore,KSwarmInitialPlanBootstrapJob,KSwarmInitialPlanBootstrapPayload,KSwarmInitialPlanOwnerBinding} from './kswarm-initial-plan-bootstrap.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(512);
const bindingSchema=z.object({protocol:z.literal('ordinary_initial_plan_additive_v2'),projectId:id,profileId:hash,workspaceId:hash,canonicalCreateOperationId:z.string().min(1).max(256),canonicalCreateDigest:hash,enqueueKey:z.string().regex(/^initial-plan:[a-f0-9]{64}$/),planGeneration:z.literal(1),acceptanceSchemaVersion:z.literal(2),semanticSchemaVersion:z.literal(2),handlerDigest:hash,writerFloorDigest:hash}).strict();
type Source=ReturnType<ConversationProjectService['inspectOriginalTaskSource']>;
interface Dependencies{
 store:JsonKSwarmInitialPlanBootstrapStore;
 gateway:Pick<KSwarmService,'request'|'getDesktopMutationToken'>;
 projects:ConversationProjectService;scope:{profileId:string;workspaceId:string};now:()=>number;
 /** Actual Main snapshot/thread authorization, not a renderer callback. */
 authorizeSource(source:Source,current:()=>void):Promise<()=>void>;
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Same original journal and B transaction. It does not enqueue or grant M. */
export function executeTaskMetadataPlanning(deps:Dependencies,raw:unknown,context:{requestSource:'user'|'agent'|'scheduler';triggerProof:ProjectPlanningTriggerProof;current:()=>void}){
 if(context.requestSource!=='user')throw Error('project_planning_source_forbidden');
 return deps.store.ownTaskCompositeAction(async(signal,lifetimeCurrent)=>{
  const current=()=>{lifetimeCurrent();assertBeforeEffects(context.current);};current();
  const input:TaskMetadataPlanningInput=TASK_METADATA_PLANNING_INPUT.parse(captureIpcData(raw,'project_planning_input_invalid'));
  const gesture=()=>{current();const fact=inspectProjectPlanningTrigger(context.triggerProof,deps.store);if(fact.projectId!==input.projectId||fact.actorId!=='desktop-user:'+deps.scope.profileId)throw Error('bootstrap_composite_source_mismatch');};gesture();
  const proposal=captureTaskCompositeProposal(input.proposal),existing=deps.store.list().find(job=>job.projectId===input.projectId);
  const checkBinding=(value:unknown):KSwarmInitialPlanOwnerBinding=>{
   const binding=bindingSchema.parse(captureIpcData(value,'bootstrap_owner_binding_invalid'));
   if(binding.projectId!==input.projectId||binding.profileId!==deps.scope.profileId||binding.workspaceId!==deps.scope.workspaceId)throw Error('bootstrap_owner_scope_mismatch');return binding;
  };
  const output=(job:KSwarmInitialPlanBootstrapJob,ownerRevision:number)=>{
   gesture();return{ok:true as const,status:'metadata_applied' as const,projectId:input.projectId,operationId:job.taskComposite!.operationId,planRunId:job.planRunId,ownerRevision,execution:{state:'blocked' as const,reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE' as const}};
  };
  if(existing?.taskComposite){
   const prepared=existing.taskComposite;checkBinding(existing.ownerBinding);
   if(prepared.schemaVersion!==2)throw Error('bootstrap_composite_request_upgrade_required');
   if(prepared.source.sourceTaskId!==input.sourceTaskId||prepared.proposalDigest!==compositeDigest(proposal))throw Error('bootstrap_composite_request_conflict');
   if(existing.taskCompositeObservation||existing.taskCompositeSubmission){
    try{const result=await deps.store.reconcileTaskComposite(input.projectId,signal);gesture();return output(existing,result.observation.ownerRevision);}
    catch(error){try{gesture();}catch(revocation){throw new AggregateError([error,revocation],'bootstrap_composite_readback_and_admission_failed',{cause:error});}if(existing.taskCompositeObservation||!isTaskCompositeNotApplied(error,deps.gateway,prepared))throw error;}
   }
  }
  // Historical receipts above reveal no body and grant no resubmission. Every
  // new/confirmed-absent send requires the original source's current access.
  const sourceProof=deps.projects.readProjectUserSource(input.sourceTaskId);if(!sourceProof)throw Error('conversation_user_body_unavailable');
  const source=deps.projects.inspectOriginalTaskSource(sourceProof);
  if(source.sourceTaskId!==input.sourceTaskId||source.identity.profileId!==deps.scope.profileId||source.identity.workspaceId!==deps.scope.workspaceId||!['auto','default'].includes(source.identity.permissionMode??'default'))throw Error('bootstrap_composite_source_mismatch');
  const sourceCurrent=()=>{gesture();if(compositeDigest(deps.projects.inspectOriginalTaskSource(sourceProof))!==compositeDigest(source))throw Error('conversation_user_source_changed');};sourceCurrent();
  const authorized=await deps.authorizeSource(source,sourceCurrent);sourceCurrent();assertBeforeEffects(authorized);
  const active=()=>{sourceCurrent();assertBeforeEffects(authorized);sourceCurrent();};active();
  const read=async(path:string,requireOk=true)=>{
   active();const token=deps.gateway.getDesktopMutationToken();if(!token)throw Error('mutation_credential_required');
   const response=await deps.gateway.request(path,{method:'GET',signal,headers:{'x-kswarm-mutation-token':token}},active);
   const value=await readPlanningOwnerResponse(response,active);active();if(!response.ok||!record(value)||requireOk&&value.ok!==true)throw Error('initial_plan_owner_unavailable');return value;
  };
  let payload:KSwarmInitialPlanBootstrapPayload,prepared=existing;
  if(existing?.taskComposite){
   const original=await deps.projects.readOriginalTaskSource(sourceProof,signal,active);active();
   if(compositeDigest(source.identity)!==existing.taskComposite.source.identityDigest||source.sourceSessionId!==existing.taskComposite.source.sourceSessionId)throw Error('bootstrap_composite_source_mismatch');
   const metadata={action:'add_task',expectedProjectRevision:existing.taskComposite.expectedProjectRevision,sourceMessageId:source.identity.canonicalMessageId,body:original.body,...proposal};
   if(compositeDigest(metadata)!==existing.taskComposite.inputDigest)throw Error('bootstrap_composite_request_conflict');
   const result=await deps.store.submitTaskComposite(input.projectId,{requestSource:'user',triggerProof:context.triggerProof,beforeEffects:active},metadata,signal);gesture();return output(existing,result.observation.ownerRevision);
  }
  const binding=checkBinding(existing?.ownerBinding??(await read(`/projects/${encodeURIComponent(input.projectId)}/initial-plan-inputs`)).ownerBinding);active();
  const observed=await createInitialPlanOwnerClient(deps.gateway,binding,signal,active).read();active();
  if(!observed.unclaimedProof)throw Error('bootstrap_composite_claim_already_exists');
  const control=inspectUnclaimedInitialPlanState(observed.unclaimedProof,deps.gateway).taskControl;if(!control)throw Error('bootstrap_owner_metadata_invalid');
  if(existing)payload=existing;
  else{
   const detail=await read(`/projects/${encodeURIComponent(input.projectId)}`,false),project=record(detail.project)?detail.project:detail;
   if(project.id!==input.projectId||project.poAgent!==control.poAgent||project.requestedStartPolicy!==control.startPolicy||typeof project.name!=='string'||typeof project.goal!=='string'||project.requirements!==undefined&&typeof project.requirements!=='string'||project.planningGuidance!==undefined&&typeof project.planningGuidance!=='string'||!Array.isArray(project.members)||project.members.some(value=>typeof value!=='string'))throw Error('bootstrap_owner_metadata_invalid');
   payload={projectId:input.projectId,projectName:project.name,goal:project.goal,requirements:project.requirements??'',planningGuidance:project.planningGuidance??'',poAgent:control.poAgent,members:project.members,startPolicy:control.startPolicy,ownerBinding:binding};
  }
  active();const preparation=await deps.store.prepareOrJoinTaskComposite(payload,{triggerProof:context.triggerProof,ownerStateProof:observed.unclaimedProof,sourceProof},proposal,deps.now());active();prepared=preparation.job;
  const result=await deps.store.submitTaskComposite(input.projectId,{requestSource:'user',triggerProof:context.triggerProof,beforeEffects:active},preparation.submission.input,signal);gesture();return output(prepared,result.observation.ownerRevision);
 });
}
