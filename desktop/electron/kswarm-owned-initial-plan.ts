import {createInitialPlanOwnerClient} from './kswarm-initial-plan-owner-client.js';
import {createHash} from 'node:crypto';
import type {KSwarmService} from './kswarm-service.js';
import {JsonKSwarmInitialPlanBootstrapStore,isInitialPlanOwnerExecutionSupported,type KSwarmInitialPlanBootstrapJob,type KSwarmInitialPlanClaimRequest} from './kswarm-initial-plan-bootstrap.js';

type Data=Record<string,unknown>;
const record=(value:unknown):value is Data=>!!value && typeof value==='object' && !Array.isArray(value);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function ordered(value:unknown):unknown {
  if(Array.isArray(value))return value.map(ordered);
  if(record(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])]));
  return value;
}
const digest=(value:unknown)=>hash(JSON.stringify(ordered(JSON.parse(JSON.stringify(value)))));
const denied=(error:string)=>({ok:false as const,error});
type Candidate=NonNullable<KSwarmInitialPlanBootstrapJob['planCandidate']>;
export interface InitialPlanUserInput {operationId:string;sourceMessageId:string;contentHash:string;body:string}

/** Physical bootstrap remains in the original Main queue. This adapter does
 * only owner claim/submission; no second PO producer or worker is introduced.
 * A durable model-start marker precedes the real runner, and its candidate is
 * fsynced before owner submission. Unknown model outcomes never generate again.
 */
export async function executeOwnedInitialPlanBootstrap(reference:KSwarmInitialPlanBootstrapJob,deps:{
  store:JsonKSwarmInitialPlanBootstrapStore;
  gateway:Pick<KSwarmService,'request'|'getDesktopMutationToken'>;
  scope:{profileId:string;workspaceId:string};
  generateCandidate(input:{job:KSwarmInitialPlanBootstrapJob;inputs:InitialPlanUserInput[];signal:AbortSignal;beforeStart:()=>void}):Promise<Candidate>;
},signal:AbortSignal):Promise<{ok:true}|{ok:false;error:string;launchOutcome?:'unknown'|'not_started'}> {
  let modelAttempted=false,candidate:Candidate|undefined;
  try {
    signal.throwIfAborted();
    const job=deps.store.list().find(job=>job.projectId===reference.projectId);
    if(!job || job.status!=='running' || job.claimToken!==reference.claimToken || job.planRunId!==reference.planRunId || !job.claimToken)return denied('bootstrap_claim_conflict');
    const binding=job.ownerBinding;
    if(!binding || binding.profileId!==deps.scope.profileId || binding.workspaceId!==deps.scope.workspaceId)return denied('bootstrap_owner_scope_mismatch');
    // Inspect the actual durable record, never a caller-supplied reference or
    // a matching digest alone. No owner HTTP, claim mutation or M marker here.
    if(!isInitialPlanOwnerExecutionSupported(binding))return denied('bootstrap_owner_protocol_unqualified');
    modelAttempted=job.modelAttempted===true;candidate=job.planCandidate;
    const ownerClient=createInitialPlanOwnerClient(deps.gateway,binding,signal);
    const request=ownerClient.request;
    const {state,unclaimedProof}=await ownerClient.read();
    if(!state.ok)return denied(String(state.error));
    const owner=state.ownerBinding;
    if(!record(owner) || Object.entries(binding).some(([key,value])=>owner[key]!==value))return denied('bootstrap_owner_binding_mismatch');
    const claimRequest:KSwarmInitialPlanClaimRequest=job.ownerClaimRequest && !(unclaimedProof && !job.modelAttempted && !job.planCandidate
      && Number(state.planInputRevision)>job.ownerClaimRequest.expectedPlanInputRevision) ? job.ownerClaimRequest : {
      enqueueKey:job.enqueueKey,planRunId:job.planRunId,planGeneration:1,
      expectedPlanInputRevision:Number(state.planInputRevision),startPolicy:job.startPolicy ?? 'activate_and_dispatch_after_plan',
    };
    deps.store.recordOwnerClaimRequest(job.projectId,job.claimToken,claimRequest,unclaimedProof);
    const claim=await request('/claim',claimRequest as unknown as Data);
    signal.throwIfAborted();
    if(!claim.ok)return claim.error==='PLAN_INPUT_REVISION_CONFLICT' && !job.modelAttempted && !job.planCandidate
      ? {ok:false,error:String(claim.error),launchOutcome:'not_started'}:denied(String(claim.error));
    const reservation=claim.reservation;
    if(!record(reservation) || !record(reservation.scope) || reservation.scope.profileId!==binding.profileId || reservation.scope.workspaceId!==binding.workspaceId
      || reservation.projectId!==job.projectId || reservation.enqueueKey!==job.enqueueKey || reservation.planRunId!==job.planRunId || reservation.planGeneration!==1
      || reservation.startPolicy!==job.startPolicy || typeof reservation.id!=='string' || typeof reservation.commitCommandId!=='string'
      || !Number.isSafeInteger(reservation.ownerRevision) || Number(reservation.ownerRevision)<1
      || !Array.isArray(reservation.consumedOperationIds) || !Array.isArray(reservation.consumedMessageIds) || !Array.isArray(claim.inputs)
      || claim.inputs.length!==reservation.consumedOperationIds.length || claim.inputs.length!==reservation.consumedMessageIds.length)throw Error('bootstrap_owner_claim_invalid');
    const inputs:InitialPlanUserInput[]=claim.inputs.map((input,index)=>{
      if(!record(input) || typeof input.body!=='string' || typeof input.operationId!=='string' || typeof input.sourceMessageId!=='string' || typeof input.contentHash!=='string'
        || input.operationId!==(reservation.consumedOperationIds as unknown[])[index] || input.sourceMessageId!==(reservation.consumedMessageIds as unknown[])[index]
        || hash(input.body)!==input.contentHash)throw Error('bootstrap_owner_input_invalid');
      return {operationId:input.operationId,sourceMessageId:input.sourceMessageId,contentHash:input.contentHash,body:input.body};
    });
    if(!candidate){
      if(modelAttempted)return {ok:false,error:'bootstrap_model_outcome_unknown',launchOutcome:'unknown'};
      candidate=await deps.generateCandidate({job,inputs,signal,beforeStart:()=>{
        signal.throwIfAborted();deps.store.recordModelAttempt(job.projectId,job.claimToken!);modelAttempted=true;
      }});
      deps.store.recordPlanCandidate(job.projectId,job.claimToken,candidate);
    }
    signal.throwIfAborted();
    const command:Data={reservationId:reservation.id,enqueueKey:job.enqueueKey,planRunId:job.planRunId,commandId:reservation.commitCommandId,
      expectedProjectRevision:reservation.ownerRevision,fromAgent:job.poAgent,plan:candidate.plan,tasks:candidate.tasks};
    const commandDigest=digest(['initial-plan-submit-v1',command]);
    const receiptResult=(receipt:unknown):{ok:true}|{ok:false;error:string}|undefined=>{
      if(!record(receipt) || receipt.id!==reservation.commitCommandId || receipt.kind!=='initial_plan_commit_receipt' || receipt.projectId!==job.projectId
        || receipt.reservationId!==reservation.id || receipt.planRunId!==job.planRunId || receipt.envelopeDigest!==commandDigest)return undefined;
      if(receipt.outcome==='applied')return {ok:true};
      if(receipt.outcome==='rejected' && typeof receipt.reasonCode==='string')return denied(receipt.reasonCode);
      return undefined;
    };
    const existing=receiptResult(state.commitReceipt);
    if(existing)return existing;
    try {
      const submitted=await request('/commit',command);
      const result=receiptResult(submitted.receipt);
      if(result)return result;
      return denied(typeof submitted.error==='string'?submitted.error:'bootstrap_owner_commit_unconfirmed');
    } catch(error) {
      // Candidate and exact command identity already exist durably. Reading the
      // owner is safe; another queue attempt can only resend this same command.
      const observed=await request().catch(()=>undefined);
      const result=receiptResult(observed?.commitReceipt);if(result)return result;
      throw error;
    }
  } catch(error) {
    const message=error instanceof Error?error.message:'bootstrap_owner_failed';
    if(modelAttempted&&!candidate)return {ok:false,error:message,launchOutcome:'unknown'};
    // Verify the current durable marker, rather than inferring no launch from
    // an abort/error string or the absence of a model reply.
    const current=deps.store.list().find(job=>job.projectId===reference.projectId);
    if(current?.status==='running' && current.claimToken===reference.claimToken && current.planRunId===reference.planRunId
      && !current.modelAttempted && !current.planCandidate)return {ok:false,error:message,launchOutcome:'not_started'};
    return denied(message);
  }
}
