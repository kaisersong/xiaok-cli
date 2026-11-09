import {z} from 'zod';
import type {KSwarmService} from './kswarm-service.js';
import type {KSwarmInitialPlanOwnerBinding} from './kswarm-initial-plan-bootstrap.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {createInitialPlanOwnerClient,readPlanningOwnerResponse,inspectUnclaimedInitialPlanState} from './kswarm-initial-plan-owner-client.js';
import {COMPOSITE_CLAIM,compositeDigest,readCompositePreparation,type KSwarmTaskCompositePreparation} from './kswarm-composite-journal-data.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(512),positive=z.number().int().positive().safe(),integer=z.number().int().nonnegative().safe();
const scope=z.object({profileId:hash,workspaceId:hash}).strict();
const owner={projectId:id,scope,writerStoreId:z.string().uuid(),bindingDigest:hash,createReceiptDigest:hash,contract:z.literal('ordinary_initial_plan_additive_v2')};
const pair=z.tuple([id,z.enum(['completed','completed_for_remediation','verified_pass'])]);
const row=z.object({taskId:id,rowDigest:hash}).strict(),presence=z.union([z.object({present:z.literal(false)}).strict(),z.object({present:z.literal(true),value:integer}).strict()]);
const proof=z.object({kind:z.literal('ordinary_task_addition_semantic_proof'),schemaVersion:z.literal(2),projectId:id,operationId:id,ordinal:positive,previousProofDigest:hash.nullable(),bodyHash:hash,beforeRevision:positive,afterRevision:positive,beforeDigest:hash,afterDigest:hash,
 addedTaskRows:z.array(row).min(1).max(200),policyDelta:z.array(pair).max(200),controlBefore:z.object({status:z.enum(['created','planning']),bodyMapPresent:z.boolean(),ordinaryInputRevision:presence,updatedAt:presence}).strict()}).strict();
const taskReceipt=z.object({...owner,id,kind:z.literal('ordinary_task_addition_receipt'),schemaVersion:z.literal(1),operationId:id,operationDigest:hash,envelopeDigest:hash,bodyHash:hash,ownerRevision:positive,
 taskRows:z.array(row.extend({inputDigest:hash})).min(1).max(200),policyDelta:z.array(pair).max(200),semanticProof:proof}).strict();
const operation=z.object({id,operationId:id,kind:z.literal('ordinary_input_operation'),schemaVersion:z.literal(1),projectId:id,scope,action:z.literal('add_task'),sourceMessageId:id,authorizingUserTaskId:id,contentHash:hash,sourceThreadId:id,envelopeDigest:hash,expectedProjectRevision:positive,bindingDigest:hash,
 outcome:z.literal('accepted'),taskReceiptId:id,compositeReservationId:id,status:z.literal('applied')}).strict();
const reservation=z.object({...owner,id,kind:z.literal('initial_plan_reservation'),schemaVersion:z.literal(3),poAgent:id,enqueueKey:id,planRunId:z.string().uuid(),planGeneration:z.literal(1),startPolicy:z.enum(['plan_only','auto_activate_after_plan','activate_and_dispatch_after_plan']),
 planInputRevision:integer,consumedMessageIds:z.array(id).max(100000),consumedOperationIds:z.array(id).max(100000),requestDigest:hash,commitCommandId:id,ownerRevision:positive,claimRequest:COMPOSITE_CLAIM,compositeRequest:COMPOSITE_CLAIM,compositeTaskOperationId:id,compositeEnvelopeDigest:hash}).strict();
const applied=z.object({ok:z.literal(true),operation,taskReceipt,acknowledged:z.literal(true),terminal:z.literal(true),consumption:z.object({state:z.literal('not_consumed')}).strict()}).strict();
export const COMPOSITE_OBSERVATION=z.object({schemaVersion:z.literal(1),outcome:z.literal('metadata_applied'),preparationDigest:hash,operationDigest:hash,taskReceiptDigest:hash,reservationDigest:hash,ownerRevision:positive,observationDigest:hash}).strict();
export type TaskCompositeObservation=z.infer<typeof COMPOSITE_OBSERVATION>;
export interface TaskCompositeObservationProof{readonly opaqueTaskCompositeObservation:never}
const observations=new WeakMap<object,{gateway:object;preparationDigest:string;current:()=>void;observation:TaskCompositeObservation}>();
export function inspectTaskCompositeObservation(value:TaskCompositeObservationProof,gateway:object,preparation:KSwarmTaskCompositePreparation):TaskCompositeObservation{
 const observed=observations.get(value);if(!observed||observed.gateway!==gateway||observed.preparationDigest!==preparation.preparationDigest)throw Error('bootstrap_composite_observation_unverified');observed.current();return structuredClone(observed.observation);
}
export function readTaskCompositeObservation(value:unknown):TaskCompositeObservation{
 const parsed=COMPOSITE_OBSERVATION.safeParse(captureIpcData(value,'bootstrap_composite_observation_invalid'));if(!parsed.success)throw Error('bootstrap_composite_observation_invalid');
 const {observationDigest,...data}=parsed.data;if(compositeDigest(data)!==observationDigest)throw Error('bootstrap_composite_observation_invalid');return parsed.data;
}
const absences=new WeakMap<object,{gateway:object;preparationDigest:string;current:()=>void}>();
/** Negative read fact only, never permission to change the frozen CAS. */
export function isTaskCompositeNotApplied(error:unknown,gateway:object,preparation:KSwarmTaskCompositePreparation):boolean{
 if(!error||typeof error!=='object')return false;const observed=absences.get(error);if(!observed||observed.gateway!==gateway||observed.preparationDigest!==preparation.preparationDigest)return false;observed.current();return true;
}
/** Two original authenticated reads, one private same-gateway observation.
 * No caller JSON or HTTP 200 alone creates this proof; it grants no execution. */
export async function observeTaskComposite(gateway:Pick<KSwarmService,'request'|'getDesktopMutationToken'>,binding:KSwarmInitialPlanOwnerBinding,prepared:KSwarmTaskCompositePreparation,signal:AbortSignal,beforeEffects?:()=>void):Promise<TaskCompositeObservationProof>{
 const expected=readCompositePreparation(prepared),current=()=>{signal.throwIfAborted();assertBeforeEffects(beforeEffects);};current();
 if(binding.protocol!=='ordinary_initial_plan_additive_v2'||compositeDigest(binding)!==expected.ownerBindingDigest)throw Error('bootstrap_composite_observation_unverified');
 const token=gateway.getDesktopMutationToken();if(!token)throw Error('mutation_credential_required');
 const response=await gateway.request(`/projects/${encodeURIComponent(expected.projectId)}/ordinary-inputs/${encodeURIComponent(expected.operationId)}`,{signal,method:'GET',headers:{'x-kswarm-mutation-token':token}},current);
 const raw=await readPlanningOwnerResponse(response,current);current();
 const captured=captureIpcData(raw,'bootstrap_composite_observation_invalid');
 if(response.status===404&&captured&&typeof captured==='object'&&!Array.isArray(captured)&&Object.keys(captured).length===2&&(captured as {ok?:unknown}).ok===false&&(captured as {error?:unknown}).error==='OPERATION_NOT_FOUND'){
  const negative=await createInitialPlanOwnerClient(gateway,binding,signal,current).read();current();
  if(!negative.unclaimedProof)throw Error('bootstrap_composite_absence_conflict');const state=inspectUnclaimedInitialPlanState(negative.unclaimedProof,gateway),control=state.taskControl;
  if(!control||compositeDigest(control.taskOwner)!==compositeDigest(expected.taskOwner)||control.projectRevision!==expected.expectedProjectRevision||control.projectControlDigest!==expected.claimRequest.expectedProjectControlDigest||control.poAgent!==expected.claimRequest.fromAgent||control.startPolicy!==expected.claimRequest.startPolicy||state.planInputRevision!==expected.claimRequest.expectedPlanInputRevision)throw Error('bootstrap_composite_absence_conflict');
  const error=Error('bootstrap_composite_not_applied');absences.set(error,{gateway,preparationDigest:expected.preparationDigest,current});throw error;
 }
 const accepted=applied.safeParse(captured);if(!response.ok||!accepted.success)throw Error('bootstrap_composite_observation_unavailable');
 const {state}=await createInitialPlanOwnerClient(gateway,binding,signal,current).read();current();
 const owned=reservation.safeParse(captureIpcData(state.reservation,'bootstrap_composite_observation_invalid'));if(state.ok!==true||!owned.success)throw Error('bootstrap_composite_observation_unavailable');
 const a=accepted.data,r=owned.data,o=a.operation,t=a.taskReceipt,p=expected,s=t.semanticProof;
 const same=(left:unknown,right:unknown)=>compositeDigest(left)===compositeDigest(right);
 const reservationId='initial-plan:'+compositeDigest(['initial-plan-reservation-v1',p.projectId,1]);
 const {status:_,...operationRecord}=o;
 if(!same(state.taskOwner,p.taskOwner)||o.id!==p.operationId||o.operationId!==p.operationId||o.projectId!==p.projectId||!same(o.scope,p.taskOwner.scope)||o.sourceMessageId!==p.source.canonicalMessageId||o.authorizingUserTaskId!==p.source.canonicalUserTaskId||o.sourceThreadId!==p.source.threadId||o.contentHash!==p.source.bodyHash
  ||o.envelopeDigest!==p.envelopeDigest||o.expectedProjectRevision!==p.expectedProjectRevision||o.bindingDigest!==p.taskOwner.bindingDigest||o.taskReceiptId!==p.operationId+':task-addition'||o.compositeReservationId!==reservationId
  ||t.id!==o.taskReceiptId||t.operationId!==p.operationId||t.operationDigest!==compositeDigest(operationRecord)||t.envelopeDigest!==p.envelopeDigest||t.bodyHash!==p.source.bodyHash||t.ownerRevision!==p.expectedProjectRevision+1
  ||!Object.entries(p.taskOwner).every(([key,value])=>same(t[key as keyof typeof t],value)&&same(r[key as keyof typeof r],value))
  ||s.projectId!==p.projectId||s.operationId!==p.operationId||s.bodyHash!==p.source.bodyHash||s.beforeRevision!==p.expectedProjectRevision||s.afterRevision!==t.ownerRevision||!same(s.addedTaskRows,t.taskRows.map(({taskId,rowDigest})=>({taskId,rowDigest})))||!same(s.policyDelta,t.policyDelta)
  ||r.id!==reservationId||r.poAgent!==p.claimRequest.fromAgent||r.enqueueKey!==p.claimRequest.enqueueKey||r.planRunId!==p.claimRequest.planRunId||r.planGeneration!==1||r.startPolicy!==p.claimRequest.startPolicy||r.planInputRevision!==p.claimRequest.expectedPlanInputRevision||r.ownerRevision!==t.ownerRevision
  ||!same(r.claimRequest,p.claimRequest)||!same(r.compositeRequest,p.claimRequest)||r.compositeTaskOperationId!==p.operationId||r.compositeEnvelopeDigest!==p.envelopeDigest
  ||r.requestDigest!==compositeDigest(['initial-plan-claim-composite-v2',p.claimRequest,p.operationId,p.envelopeDigest])||r.commitCommandId!=='initial-plan-submit:'+compositeDigest(['ordinary_initial_plan_additive_v2',reservationId,r.enqueueKey,r.planRunId])||r.consumedMessageIds.length!==r.consumedOperationIds.length)throw Error('bootstrap_composite_observation_mismatch');
 const data={schemaVersion:1 as const,outcome:'metadata_applied' as const,preparationDigest:p.preparationDigest,operationDigest:t.operationDigest,taskReceiptDigest:compositeDigest(t),reservationDigest:compositeDigest(r),ownerRevision:t.ownerRevision},observation=readTaskCompositeObservation({...data,observationDigest:compositeDigest(data)});
 current();const result=Object.freeze(Object.create(null)) as TaskCompositeObservationProof;observations.set(result,{gateway,preparationDigest:p.preparationDigest,current,observation});return result;
}
