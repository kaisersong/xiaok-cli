import {isTaskCompositeNotApplied,observeTaskComposite,inspectTaskCompositeObservation,readTaskCompositeObservation,type TaskCompositeObservationProof,type TaskCompositeObservation} from './kswarm-task-composite-observation.js';
import {inspectProjectPlanningTrigger,type ProjectPlanningTriggerProof} from './project-planning-typed-ipc.js';
import type {ConversationProjectService,ProjectUserSourceProof} from './conversation-project-service.js';
import type {KSwarmService} from './kswarm-service.js';
import {captureTaskCompositeProposal,compositeDigest,readCompositePreparation,taskCompositeOperationId,type KSwarmTaskCompositePreparation} from './kswarm-composite-journal-data.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {inspectUnclaimedInitialPlanState,type UnclaimedInitialPlanState} from './kswarm-initial-plan-owner-client.js';
import type {IngressOwner} from './desktop-shutdown-coordinator.js';
import {writeFileAtomicallySync} from '../../src/utils/atomic-file.js';

/** Main-only owner response, never accepted by the renderer planning DTO. */
interface InitialPlanOwnerIdentity {
  projectId:string;profileId:string;workspaceId:string;
  canonicalCreateOperationId:string;canonicalCreateDigest:string;enqueueKey:string;planGeneration:1;
}
export type KSwarmInitialPlanOwnerBinding=InitialPlanOwnerIdentity & (
  {protocol:'ordinary_initial_plan_v1'} |
  {protocol:'ordinary_initial_plan_additive_v1';acceptanceSchemaVersion:1;semanticSchemaVersion:1;handlerDigest:string;writerFloorDigest:string} |
  {protocol:'ordinary_initial_plan_additive_v2';acceptanceSchemaVersion:2;semanticSchemaVersion:2;handlerDigest:string;writerFloorDigest:string}
);

/** Reader compatibility is deliberately distinct from execution qualification.
 * Main's current producer still chooses v1. Additive metadata reader support
 * never qualifies its Main/native runner; that producer remains closed here. */
export function isInitialPlanOwnerExecutionSupported(binding:KSwarmInitialPlanOwnerBinding|undefined):boolean {
  return binding===undefined||binding?.protocol==='ordinary_initial_plan_v1';
}
export interface KSwarmInitialPlanClaimRequest {
  enqueueKey:string;planRunId:string;planGeneration:1;expectedPlanInputRevision:number;
  startPolicy:'plan_only'|'auto_activate_after_plan'|'activate_and_dispatch_after_plan';
}

export interface KSwarmInitialPlanBootstrapPayload {
  projectId: string;
  projectName: string;
  goal: string;
  requirements: string;
  planningGuidance: string;
  poAgent: string;
  members: string[];
  startPolicy?: 'plan_only' | 'auto_activate_after_plan' | 'activate_and_dispatch_after_plan';
  ownerBinding?:KSwarmInitialPlanOwnerBinding;
}

export interface KSwarmInitialPlanBootstrapJob extends KSwarmInitialPlanBootstrapPayload {
  schemaVersion: 2;
  taskComposite?:KSwarmTaskCompositePreparation;
  taskCompositeObservation?:TaskCompositeObservation;
  taskCompositeSubmission?:{schemaVersion:1;phase:'submission_unknown';preparationDigest:string};
  enqueueKey: string;
  payloadHash: string;
  planRunId: string;
  legacyImport?: true;
  claimToken?: string;
  claimGeneration?: number;
  ownerClaimRequest?:KSwarmInitialPlanClaimRequest;
  ownerClaimRequestHistory?:KSwarmInitialPlanClaimRequest[];
  modelAttempted?:true;
  planCandidate?:{plan:Record<string,unknown>;tasks:Record<string,unknown>[]};
  planCandidateHash?:string;
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'launch_unknown' | 'legacy_unverified';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface StoreData {
  revision: number;
  jobs: KSwarmInitialPlanBootstrapJob[];
}
export type KSwarmBootstrapEnqueueResult = import('../shared/project-planning-ipc-contract.js').ProjectPlanningOutput;

const FILE_NAME = 'kswarm-initial-plan-bootstrap-jobs.json';
const DEFAULT_MAX_ATTEMPTS = 3;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonicalPayload(input:KSwarmInitialPlanBootstrapPayload):KSwarmInitialPlanBootstrapPayload {
  input=captureIpcData(input,'bootstrap_payload_invalid');
  for (const key of ['projectId','projectName','goal','requirements','planningGuidance','poAgent'] as const) {
    if (typeof input[key]!=='string') throw new Error('bootstrap_payload_invalid');
  }
  if (!input.projectId || !input.poAgent || !Array.isArray(input.members) || input.members.some(member=>typeof member!=='string')
    || input.startPolicy!==undefined && !['plan_only','auto_activate_after_plan','activate_and_dispatch_after_plan'].includes(input.startPolicy)) throw new Error('bootstrap_payload_invalid');
  const owner=input.ownerBinding;
  if(owner && (!['ordinary_initial_plan_v1','ordinary_initial_plan_additive_v1','ordinary_initial_plan_additive_v2'].includes(owner.protocol) || owner.projectId!==input.projectId || owner.planGeneration!==1
    || !/^[a-f0-9]{64}$/.test(owner.profileId) || !/^[a-f0-9]{64}$/.test(owner.workspaceId) || !/^[a-f0-9]{64}$/.test(owner.canonicalCreateDigest)
    || !/^initial-plan:[a-f0-9]{64}$/.test(owner.enqueueKey) || !owner.canonicalCreateOperationId || owner.canonicalCreateOperationId.length>256))throw Error('bootstrap_owner_binding_invalid');
  if(owner?.protocol==='ordinary_initial_plan_additive_v1'||owner?.protocol==='ordinary_initial_plan_additive_v2'){
    const fields=['protocol','projectId','profileId','workspaceId','canonicalCreateOperationId','canonicalCreateDigest','enqueueKey','planGeneration',
      'acceptanceSchemaVersion','semanticSchemaVersion','handlerDigest','writerFloorDigest'];
    if(Object.keys(owner).length!==fields.length||Object.keys(owner).some(key=>!fields.includes(key))
      ||owner.acceptanceSchemaVersion!==(owner.protocol==='ordinary_initial_plan_additive_v2'?2:1)||owner.semanticSchemaVersion!==(owner.protocol==='ordinary_initial_plan_additive_v2'?2:1)
      ||typeof owner.canonicalCreateOperationId!=='string'||!owner.canonicalCreateOperationId.trim()
      ||typeof owner.handlerDigest!=='string'||typeof owner.writerFloorDigest!=='string'
      ||!/^[a-f0-9]{64}$/.test(owner.handlerDigest)||!/^[a-f0-9]{64}$/.test(owner.writerFloorDigest))throw Error('bootstrap_owner_binding_invalid');
  }
  let canonicalOwner:KSwarmInitialPlanOwnerBinding|undefined;
  if(owner){
    const identity:InitialPlanOwnerIdentity={projectId:owner.projectId,profileId:owner.profileId,workspaceId:owner.workspaceId,
      canonicalCreateOperationId:owner.canonicalCreateOperationId,canonicalCreateDigest:owner.canonicalCreateDigest,enqueueKey:owner.enqueueKey,planGeneration:1};
    canonicalOwner=owner.protocol==='ordinary_initial_plan_additive_v2'
      ? {protocol:owner.protocol,...identity,acceptanceSchemaVersion:2,semanticSchemaVersion:2,handlerDigest:owner.handlerDigest,writerFloorDigest:owner.writerFloorDigest}
      : owner.protocol==='ordinary_initial_plan_additive_v1'
      ? {protocol:owner.protocol,...identity,acceptanceSchemaVersion:1,semanticSchemaVersion:1,handlerDigest:owner.handlerDigest,writerFloorDigest:owner.writerFloorDigest}
      : {protocol:owner.protocol,...identity};
  }
  return {projectId:input.projectId,projectName:input.projectName,goal:input.goal,requirements:input.requirements,
    planningGuidance:input.planningGuidance,poAgent:input.poAgent,members:[...input.members],startPolicy:input.startPolicy ?? 'activate_and_dispatch_after_plan',
    ...(canonicalOwner?{ownerBinding:canonicalOwner}:{})};
}
const enqueueKey=(projectId:string)=>'initial-plan:'+digest(['initial-plan-v2',projectId]);
const jobEnqueueKey=(payload:KSwarmInitialPlanBootstrapPayload)=>payload.ownerBinding?.enqueueKey ?? enqueueKey(payload.projectId);
const payloadHash=(input:KSwarmInitialPlanBootstrapPayload)=>digest(['initial-plan-payload-v2',canonicalPayload(input)]);

export class JsonKSwarmInitialPlanBootstrapStore {
  private readonly filePath: string;
  private journalFailure:unknown;
  private readonly compositePreparations=new Set<Promise<unknown>>();
  private compositesAccepting=true;
  private readonly compositeAbort=new AbortController();
  private readonly compositeFlights=new Map<string,{kind:'submit'|'reconcile';promise:Promise<{outcome:'metadata_applied';observation:TaskCompositeObservation;transportError?:unknown}>}>();

  constructor(dataRoot: string,private readonly compositeOwners?:{projectSources:ConversationProjectService;gateway:Pick<KSwarmService,'request'|'getDesktopMutationToken'|'submitTaskMetadataOnce'>}) {
    mkdirSync(dataRoot, { recursive: true });
    this.filePath = join(dataRoot, FILE_NAME);
  }

  upsertPending(input: KSwarmInitialPlanBootstrapPayload, now: number): KSwarmInitialPlanBootstrapJob {
    return this.withJournalLock(()=>this.upsertPendingLocked(input,now));
  }
  private upsertPendingLocked(input: KSwarmInitialPlanBootstrapPayload, now: number): KSwarmInitialPlanBootstrapJob {
    const payload=canonicalPayload(input);
    const data = this.load();
    const existing = data.jobs.find(job => job.projectId === input.projectId);
    if (existing) {
      if(existing.legacyImport)throw new Error('bootstrap_legacy_reconciliation_required');
      if(existing.payloadHash!==payloadHash(payload))throw new Error('bootstrap_payload_conflict');
      return structuredClone(existing);
    }

    const job=this.newPendingJob(payload,now);
    data.jobs.push(job);
    this.save(data);
    return structuredClone(job);
  }

  private newPendingJob(payload:KSwarmInitialPlanBootstrapPayload,now:number):KSwarmInitialPlanBootstrapJob {
    if(!Number.isFinite(now))throw Error('bootstrap_time_invalid');
    return {id:payload.projectId,...payload,schemaVersion:2,enqueueKey:jobEnqueueKey(payload),payloadHash:payloadHash(payload),planRunId:randomUUID(),
      status:'pending',attempts:0,maxAttempts:DEFAULT_MAX_ATTEMPTS,nextAttemptAt:now,createdAt:now,updatedAt:now};
  }

  /** Pending metadata preparation in this original journal, never a running
   * claim, model permit or product queued acknowledgement. */
  prepareOrJoinTaskComposite(input:KSwarmInitialPlanBootstrapPayload,proofs:{triggerProof:ProjectPlanningTriggerProof;ownerStateProof:UnclaimedInitialPlanState;sourceProof:ProjectUserSourceProof},proposalInput:unknown,now:number){
    return this.ownTaskCompositeAction(()=>this.prepareTaskComposite(input,proofs,proposalInput,now));
  }
  /** Reserve the complete original action before any reentrant prefix or IO. */
  ownTaskCompositeAction<T>(work:(signal:AbortSignal,current:()=>void)=>Promise<T>):Promise<T>{
    const current=()=>this.compositeCurrent(this.compositeAbort.signal);
    const run=Promise.resolve().then(()=>{current();return work(this.compositeAbort.signal,current);});
    this.compositePreparations.add(run);const release=()=>{this.compositePreparations.delete(run);};void run.then(release,release);return run;
  }
  private async prepareTaskComposite(input:KSwarmInitialPlanBootstrapPayload,proofs:{triggerProof:ProjectPlanningTriggerProof;ownerStateProof:UnclaimedInitialPlanState;sourceProof:ProjectUserSourceProof},proposalInput:unknown,now:number){
    const payload=canonicalPayload(input),proposal=captureTaskCompositeProposal(proposalInput),owners=this.compositeOwners;
    if(!owners||payload.ownerBinding?.protocol!=='ordinary_initial_plan_additive_v2')throw Error('bootstrap_composite_owner_unavailable');
    const current=()=>{
      this.compositeCurrent(this.compositeAbort.signal);
      const trigger=inspectProjectPlanningTrigger(proofs.triggerProof,this),observed=inspectUnclaimedInitialPlanState(proofs.ownerStateProof,owners.gateway),source=owners.projectSources.inspectOriginalTaskSource(proofs.sourceProof);
      if(trigger.projectId!==payload.projectId||trigger.actorId!=='desktop-user:'+payload.ownerBinding!.profileId||compositeDigest(observed.binding)!==compositeDigest(payload.ownerBinding)
        ||!observed.taskControl||observed.taskControl.poAgent!==payload.poAgent||observed.taskControl.startPolicy!==payload.startPolicy
        ||source.identity.profileId!==payload.ownerBinding!.profileId||source.identity.workspaceId!==payload.ownerBinding!.workspaceId
        ||!['auto','default'].includes(source.identity.permissionMode??'default'))throw Error('bootstrap_composite_source_mismatch');
      return {trigger,observed,source,control:observed.taskControl};
    };
    current();
    const original=await owners.projectSources.readOriginalTaskSource(proofs.sourceProof,this.compositeAbort.signal,()=>{current();});
    const admitted=current(),identity=admitted.source.identity;
    if(compositeDigest(original.binding)!==compositeDigest(admitted.source))throw Error('bootstrap_composite_source_mismatch');
    const metadataInput={action:'add_task',expectedProjectRevision:admitted.control.projectRevision,sourceMessageId:identity.canonicalMessageId,body:original.body,...proposal};
    return this.withJournalLock(()=>{
      const live=current();if(compositeDigest(live)!==compositeDigest(admitted))throw Error('bootstrap_composite_source_mismatch');
      const data=this.load(),existing=data.jobs.find(job=>job.projectId===payload.projectId);
      if(existing&&(existing.legacyImport||existing.payloadHash!==payloadHash(payload)||existing.status!=='pending'||existing.attempts!==0||existing.claimToken||existing.modelAttempted||existing.planCandidate||existing.ownerClaimRequest))throw Error('bootstrap_composite_job_conflict');
      const job=existing??this.newPendingJob(payload,now);
      const claimRequest={protocol:'ordinary_initial_plan_additive_v2' as const,fromAgent:payload.poAgent,enqueueKey:job.enqueueKey,planRunId:job.planRunId,planGeneration:1 as const,expectedPlanInputRevision:live.observed.planInputRevision,expectedProjectControlDigest:live.control.projectControlDigest,startPolicy:live.control.startPolicy};
      const source={family:identity.schemaVersion===1?'goal_turn' as const:'main_user_submission' as const,profileId:identity.profileId,workspaceId:identity.workspaceId,threadId:identity.threadId,canonicalUserTaskId:identity.canonicalUserTaskId,canonicalMessageId:identity.canonicalMessageId,bodyHash:identity.promptSha256,
        identityDigest:compositeDigest(identity),sourceTaskId:live.source.sourceTaskId,sourceSessionId:live.source.sourceSessionId};
      const operationId=taskCompositeOperationId(payload.projectId,source),envelopeDigest=compositeDigest(['ordinary-task-metadata-envelope-v2',payload.projectId,metadataInput,claimRequest]);
      if(job.taskComposite){
        const previous=job.taskComposite;
        if(previous.operationId!==operationId||previous.envelopeDigest!==envelopeDigest||previous.ownerBindingDigest!==compositeDigest(payload.ownerBinding)||compositeDigest(previous.taskOwner)!==compositeDigest(live.control.taskOwner))throw Error('bootstrap_composite_request_conflict');
        return {job:structuredClone(job),preparation:structuredClone(previous),submission:{input:metadataInput,...(original.protection?{protection:original.protection}:{})}};
      }
      const record={schemaVersion:2 as const,proposalDigest:compositeDigest(proposal),phase:'prepared' as const,projectId:payload.projectId,operationId,envelopeDigest,inputDigest:compositeDigest(metadataInput),ownerBindingDigest:compositeDigest(payload.ownerBinding),taskOwner:live.control.taskOwner,expectedProjectRevision:live.control.projectRevision,source,trigger:{actorId:live.trigger.actorId,triggerRef:live.trigger.triggerRef},claimRequest,createdAt:now};
      job.taskComposite=readCompositePreparation({...record,preparationDigest:compositeDigest(record)});
      if(!existing)data.jobs.push(job);this.save(data);
      return {job:structuredClone(job),preparation:structuredClone(job.taskComposite),submission:{input:metadataInput,...(original.protection?{protection:original.protection}:{})}};
    });
  }

  private compositeJob(projectId:string){
    const job=this.load().jobs.find(item=>item.projectId===projectId);
    if(!job?.taskComposite||job.ownerBinding?.protocol!=='ordinary_initial_plan_additive_v2'||!this.compositeOwners)throw Error('bootstrap_composite_owner_unavailable');
    return job as KSwarmInitialPlanBootstrapJob & {taskComposite:KSwarmTaskCompositePreparation;ownerBinding:KSwarmInitialPlanOwnerBinding};
  }
  private compositeCurrent(signal:AbortSignal){signal.throwIfAborted();if(!this.compositesAccepting)throw Error('bootstrap_composite_closed');}
  private holdCompositeFlight(projectId:string,kind:'submit'|'reconcile',work:()=>Promise<{outcome:'metadata_applied';observation:TaskCompositeObservation;transportError?:unknown}>){
    const promise=Promise.resolve().then(work);this.compositeFlights.set(projectId,{kind,promise});
    const release=()=>{if(this.compositeFlights.get(projectId)?.promise===promise)this.compositeFlights.delete(projectId);};void promise.then(release,release);return promise;
  }
  /** Main-only semantic submit. A source string without the actual live
   * gesture and original retained Task binding cannot admit this mutation. */
  submitTaskComposite(projectId:string,context:{requestSource:'user'|'agent'|'scheduler';triggerProof:ProjectPlanningTriggerProof;beforeEffects?:()=>void},input:unknown,callerSignal:AbortSignal){
    try{
      if(context?.requestSource!=='user')throw Error('bootstrap_composite_submission_forbidden');
      const signal=AbortSignal.any([callerSignal,this.compositeAbort.signal]),job=this.compositeJob(projectId),prepared=job.taskComposite,owners=this.compositeOwners!;
      const metadataInput=captureIpcData(input,'bootstrap_composite_input_invalid');
      const current=()=>{this.compositeCurrent(signal);assertBeforeEffects(context.beforeEffects);const trigger=inspectProjectPlanningTrigger(context.triggerProof,this);if(trigger.projectId!==projectId||trigger.actorId!=='desktop-user:'+job.ownerBinding.profileId)throw Error('bootstrap_composite_source_mismatch');};current();
      if(compositeDigest(metadataInput)!==prepared.inputDigest||compositeDigest(['ordinary-task-metadata-envelope-v2',projectId,metadataInput,prepared.claimRequest])!==prepared.envelopeDigest)throw Error('bootstrap_composite_request_conflict');
      const existing=this.compositeFlights.get(projectId);if(existing){if(existing.kind!=='submit')throw Error('bootstrap_composite_reconciliation_busy');return existing.promise;}
      return this.holdCompositeFlight(projectId,'submit',async()=>{
        current();
        // A previously known immutable ACK is read back without another POST;
        // purging source text must not turn that known outcome into a resend.
        if(job.taskCompositeObservation){const proof=await observeTaskComposite(owners.gateway,job.ownerBinding,prepared,signal,current);current();return {outcome:'metadata_applied' as const,observation:this.recordTaskCompositeObservation(projectId,proof)};}
        if(job.taskCompositeSubmission){
          try{const proof=await observeTaskComposite(owners.gateway,job.ownerBinding,prepared,signal,current);current();return {outcome:'metadata_applied' as const,observation:this.recordTaskCompositeObservation(projectId,proof)};}
          catch(error){if(!isTaskCompositeNotApplied(error,owners.gateway,prepared))throw error;current();}
        }
        const sourceProof=owners.projectSources.readProjectUserSource(prepared.source.sourceTaskId);if(!sourceProof)throw Error('conversation_user_body_unavailable');
        const sourceCurrent=()=>{current();const source=owners.projectSources.inspectOriginalTaskSource(sourceProof),identity=source.identity;
          if(source.sourceTaskId!==prepared.source.sourceTaskId||source.sourceSessionId!==prepared.source.sourceSessionId||compositeDigest(identity)!==prepared.source.identityDigest||identity.promptSha256!==prepared.source.bodyHash||!['auto','default'].includes(identity.permissionMode??'default'))throw Error('bootstrap_composite_source_mismatch');return source;};
        sourceCurrent();const original=await owners.projectSources.readOriginalTaskSource(sourceProof,signal,()=>{sourceCurrent();});sourceCurrent();
        // The new metadata protocol cannot yet carry protected source closure
        // into B execution. Keep that path closed until its full provenance gate.
        if(original.protection)throw Error('bootstrap_composite_protected_source_unqualified');
        const send=owners.gateway.submitTaskMetadataOnce;if(typeof send!=='function')throw Error('bootstrap_composite_single_transport_unavailable');
        this.withJournalLock(()=>{sourceCurrent();const data=this.load(),actual=data.jobs.find(item=>item.projectId===projectId);if(actual?.taskComposite?.preparationDigest!==prepared.preparationDigest)throw Error('bootstrap_composite_request_conflict');
          if(!actual.taskCompositeSubmission){actual.taskCompositeSubmission={schemaVersion:1,phase:'submission_unknown',preparationDigest:prepared.preparationDigest};this.save(data);}});
        let transportError:unknown,transportFailed=false;
        try{sourceCurrent();const response=await send.call(owners.gateway,projectId,{protocol:'ordinary_task_metadata_input_v2',source:sourceCurrent().identity,input:metadataInput,initialPlanClaim:prepared.claimRequest},{requestSource:'user',signal,beforeEffects:()=>{sourceCurrent();}});sourceCurrent();if(!response.ok)throw Error('bootstrap_composite_submission_rejected',{cause:response.body});}
        catch(error){transportFailed=true;transportError=error;}
        try{sourceCurrent();const proof=await observeTaskComposite(owners.gateway,job.ownerBinding,prepared,signal,()=>{sourceCurrent();});sourceCurrent();return {outcome:'metadata_applied' as const,observation:this.recordTaskCompositeObservation(projectId,proof),...(transportFailed?{transportError}:{})};}
        catch(readError){if(transportFailed)throw new AggregateError([transportError,readError],'bootstrap_composite_submission_unknown',{cause:transportError});throw readError;}
      });
    }catch(error){return Promise.reject(error);}
  }
  /** Original authenticated historical fact read, never a source resurrection,
   * user/planner issuance, POST retry or model-start permission. */
  reconcileTaskComposite(projectId:string,callerSignal:AbortSignal){
    try{const signal=AbortSignal.any([callerSignal,this.compositeAbort.signal]);this.compositeCurrent(signal);const job=this.compositeJob(projectId),existing=this.compositeFlights.get(projectId);
      if(existing){if(existing.kind!=='reconcile')throw Error('bootstrap_composite_submission_busy');return existing.promise;}
      return this.holdCompositeFlight(projectId,'reconcile',async()=>{const current=()=>this.compositeCurrent(signal);current();const proof=await observeTaskComposite(this.compositeOwners!.gateway,job.ownerBinding,job.taskComposite,signal,current);current();return {outcome:'metadata_applied' as const,observation:this.recordTaskCompositeObservation(projectId,proof)};});
    }catch(error){return Promise.reject(error);}
  }
  recoverTaskCompositeObservations():Promise<PromiseSettledResult<unknown>[]>{
    try{if(!this.compositesAccepting||!this.compositeOwners)return Promise.resolve([]);
      return Promise.allSettled(this.load().jobs.filter(job=>job.taskComposite&&!job.taskCompositeObservation).map(job=>this.reconcileTaskComposite(job.projectId,this.compositeAbort.signal)));
    }catch(error){return Promise.reject(error);}
  }
  stopAcceptingTaskComposites():void{this.compositesAccepting=false;}
  abortTaskComposites(reason:unknown):void{this.compositeAbort.abort(reason);}
  hasActiveTaskComposites():boolean{return this.compositeFlights.size>0||this.compositePreparations.size>0;}
  async drainTaskComposites():Promise<void>{while(this.compositeFlights.size||this.compositePreparations.size)await Promise.allSettled([...this.compositePreparations,...[...this.compositeFlights.values()].map(item=>item.promise)]);}

  /** Persist a fact obtained by the original authenticated reader. This does
   * not advance the job to running/queued or qualify its execution profile. */
  recordTaskCompositeObservation(projectId:string,proof:TaskCompositeObservationProof):TaskCompositeObservation {
    return this.withJournalLock(()=>{
      const data=this.load(),job=data.jobs.find(item=>item.projectId===projectId);
      if(!job?.taskComposite||!this.compositeOwners)throw Error('bootstrap_composite_observation_unverified');
      const observation=inspectTaskCompositeObservation(proof,this.compositeOwners.gateway,job.taskComposite);
      if(job.taskCompositeObservation){if(compositeDigest(job.taskCompositeObservation)!==compositeDigest(observation))throw Error('bootstrap_composite_observation_conflict');return structuredClone(job.taskCompositeObservation);}
      job.taskCompositeObservation=observation;this.save(data);return structuredClone(observation);
    });
  }

  claimDue(now: number, limit: number): KSwarmInitialPlanBootstrapJob[] {
    return this.withJournalLock(()=>this.claimDueLocked(now,limit));
  }
  private claimDueLocked(now: number, limit: number): KSwarmInitialPlanBootstrapJob[] {
    if(!Number.isSafeInteger(limit)||limit<1)throw new Error('bootstrap_claim_limit_invalid');
    const data = this.load();
    const due = data.jobs
      .filter(job => isDue(job, now))
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);

    for (const job of due) {
      job.status = 'running';
      job.claimToken=randomUUID();job.claimGeneration=(job.claimGeneration??0)+1;
      job.updatedAt = now;
    }
    if (due.length > 0) this.save(data);
    return due.map(job => ({ ...job, members: [...job.members] }));
  }

  hasDue(now: number): boolean {
    return this.load().jobs.some(job => isDue(job, now));
  }

  nextDueAt(now: number): number | null {
    const candidates = this.load().jobs
      .map(job => {
        if (job.status === 'pending'&&!job.taskComposite&&isInitialPlanOwnerExecutionSupported(job.ownerBinding)) return job.nextAttemptAt;
        return null;
      })
      .filter((value): value is number => typeof value === 'number');
    if (candidates.length === 0) return null;
    return Math.max(now, Math.min(...candidates));
  }

  markSucceeded(projectId: string, now: number, claimToken:string): void {
    return this.withJournalLock(()=>this.markSucceededLocked(projectId,now,claimToken));
  }
  private markSucceededLocked(projectId: string, now: number, claimToken:string): void {
    const data = this.load();
    const job = data.jobs.find(item => item.projectId === projectId);
    this.assertClaim(job,claimToken);
    job.status = 'succeeded';
    job.updatedAt = now;
    job.completedAt = now;
    job.lastError = undefined;
    this.save(data);
  }

  markFailed(projectId: string, now: number, error: string, claimToken:string): void {
    return this.withJournalLock(()=>this.markFailedLocked(projectId,now,error,claimToken));
  }
  private markFailedLocked(projectId: string, now: number, error: string, claimToken:string): void {
    const data = this.load();
    const job = data.jobs.find(item => item.projectId === projectId);
    this.assertClaim(job,claimToken);
    job.attempts += 1;
    job.lastError = error;
    job.updatedAt = now;
    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
    } else {
      job.status = 'pending';
      job.nextAttemptAt = now + Math.min(60_000 * Math.pow(2, job.attempts - 1), 30 * 60_000);
    }
    this.save(data);
  }

  markDeferredBeforeModel(projectId:string,now:number,error:string,claimToken:string):void {
    this.withJournalLock(()=>{
      const data=this.load(),job=data.jobs.find(job=>job.projectId===projectId);this.assertClaim(job,claimToken);
      // The attempt marker is fsynced before the native runner can send. A
      // claimed owner input set alone does not constitute a model launch.
      if(job.modelAttempted || job.planCandidate)throw Error('bootstrap_model_attempt_already_started');
      job.status='pending';job.lastError=error;job.updatedAt=now;
      job.nextAttemptAt=now+Math.min(60000,1000*2**Math.min(job.attempts,6));this.save(data);
    });
  }

  markLaunchUnknown(projectId:string,now:number,error:string,claimToken:string):void {
    return this.withJournalLock(()=>this.markLaunchUnknownLocked(projectId,now,error,claimToken));
  }
  recordOwnerClaimRequest(projectId:string,claimToken:string,input:KSwarmInitialPlanClaimRequest,unclaimedProof?:UnclaimedInitialPlanState):void {
    this.updateClaimedJob(projectId,claimToken,job=>{
      if(!job.ownerBinding || input.enqueueKey!==job.enqueueKey || input.planRunId!==job.planRunId || input.planGeneration!==1
        || input.startPolicy!==job.startPolicy || !Number.isSafeInteger(input.expectedPlanInputRevision) || input.expectedPlanInputRevision<0)throw Error('bootstrap_owner_claim_invalid');
      if(job.ownerClaimRequest && digest(job.ownerClaimRequest)!==digest(input)){
        if(!unclaimedProof || job.modelAttempted || job.planCandidate)throw Error('bootstrap_owner_claim_conflict');
        const state=inspectUnclaimedInitialPlanState(unclaimedProof),previous=job.ownerClaimRequest;
        if(digest(state.binding)!==digest(job.ownerBinding) || state.planInputRevision!==input.expectedPlanInputRevision
          || input.expectedPlanInputRevision<=previous.expectedPlanInputRevision
          || digest({...previous,expectedPlanInputRevision:input.expectedPlanInputRevision})!==digest(input))throw Error('bootstrap_owner_claim_conflict');
        job.ownerClaimRequestHistory=[...(job.ownerClaimRequestHistory ?? []),{...previous}];
      }
      job.ownerClaimRequest={...input};
    });
  }
  recordModelAttempt(projectId:string,claimToken:string):void {
    this.updateClaimedJob(projectId,claimToken,job=>{if(job.modelAttempted)throw Error('bootstrap_model_attempt_already_started');job.modelAttempted=true;});
  }
  recordPlanCandidate(projectId:string,claimToken:string,candidate:NonNullable<KSwarmInitialPlanBootstrapJob['planCandidate']>):void {
    this.updateClaimedJob(projectId,claimToken,job=>{
      if(!job.modelAttempted || !candidate.plan || !Array.isArray(candidate.tasks) || candidate.tasks.length>200
        || Buffer.byteLength(JSON.stringify(candidate),'utf8')>2097152)throw Error('bootstrap_plan_candidate_invalid');
      const hash=digest(candidate);if(job.planCandidateHash && job.planCandidateHash!==hash)throw Error('bootstrap_plan_candidate_conflict');
      job.planCandidate=structuredClone(candidate);job.planCandidateHash=hash;
    });
  }
  private updateClaimedJob(projectId:string,claimToken:string,action:(job:KSwarmInitialPlanBootstrapJob)=>void):void {
    this.withJournalLock(()=>{const data=this.load();const job=data.jobs.find(item=>item.projectId===projectId);this.assertClaim(job,claimToken);action(job);this.save(data);});
  }
  private markLaunchUnknownLocked(projectId:string,now:number,error:string,claimToken:string):void {
    const data=this.load();const job=data.jobs.find(item=>item.projectId===projectId);
    this.assertClaim(job,claimToken);
    job.status='launch_unknown';job.updatedAt=now;job.lastError=error;this.save(data);
  }
  private assertClaim(job:KSwarmInitialPlanBootstrapJob|undefined,claimToken:string):asserts job is KSwarmInitialPlanBootstrapJob {
    if(!job || job.taskComposite || job.status!=='running' || !claimToken || job.claimToken!==claimToken)throw new Error('bootstrap_claim_conflict');
    if(!isInitialPlanOwnerExecutionSupported(job.ownerBinding))throw Error('bootstrap_owner_protocol_unqualified');
  }

  getJournalFailure():unknown{return this.journalFailure;}

  private withJournalLock<T>(action:()=>T):T {
    if(this.journalFailure!==undefined)throw this.journalFailure;
    const lockPath=this.filePath+'.lock';let fd:number;
    try{fd=openSync(lockPath,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('bootstrap_journal_busy');throw error;}
    let result:T|undefined,primary:unknown,failed=false;
    try{writeFileSync(fd,JSON.stringify({pid:process.pid,token:randomUUID()}));fsyncSync(fd);result=action();}
    catch(error){primary=error;failed=true;}
    const cleanup:unknown[]=[];let closed=false;
    try{closeSync(fd);closed=true;}catch(error){cleanup.push(error);}
    // An unknown close keeps the lock and fences this original writer. Never
    // unlink it or retry that fd: the OS may already have reused the number.
    if(closed){try{unlinkSync(lockPath);}catch(error){cleanup.push(error);}}
    if(cleanup.length){
      const errors=failed?[primary,...cleanup]:cleanup;
      this.journalFailure=errors.length===1?errors[0]:new AggregateError(errors,'bootstrap_journal_cleanup_failed',{cause:failed?primary:cleanup[0]});
      throw this.journalFailure;
    }
    if(failed)throw primary;return result as T;
    // A crash-held lock is never reclaimed by elapsed time. Recovery must prove
    // the old writer is gone; until then this journal explicitly stays busy.
  }

  list(): KSwarmInitialPlanBootstrapJob[] {
    return this.load().jobs.map(job => ({ ...job, members: [...job.members] }));
  }

  private load(): StoreData {
    if (!existsSync(this.filePath)) return { revision:0,jobs: [] };
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoreData>;
    if(!parsed || !Array.isArray(parsed.jobs))throw new Error('bootstrap_journal_invalid');
    const revision=parsed.revision??0;
    if(!Number.isSafeInteger(revision)||revision<0)throw new Error('bootstrap_journal_revision_invalid');
    const ids=new Set<string>();
    const jobs=parsed.jobs.map(raw=>{
      if(!isJob(raw) || ids.has(raw.projectId))throw new Error('bootstrap_journal_invalid');
      ids.add(raw.projectId);const payload=canonicalPayload(raw);
      if(raw.schemaVersion===undefined){
        if(Object.hasOwn(raw,'taskComposite'))throw Error('bootstrap_composite_journal_invalid');
        // Import preserves launch state. It is not authority to relaunch a
        // running legacy process or proof that an owner claim exists.
        return {...raw,...payload,schemaVersion:2 as const,legacyImport:true as const,
          status:['succeeded','failed'].includes(raw.status)?raw.status:'legacy_unverified' as const,
          enqueueKey:enqueueKey(raw.projectId),payloadHash:payloadHash(payload),
          planRunId:'legacy:'+digest([raw.projectId,raw.createdAt])};
      }
      if(raw.schemaVersion!==2 || raw.enqueueKey!==jobEnqueueKey(payload) || raw.payloadHash!==payloadHash(payload)
        || typeof raw.planRunId!=='string' || !raw.planRunId)throw new Error('bootstrap_identity_invalid');
      if(Object.hasOwn(raw,'taskComposite')){
        const prepared=readCompositePreparation(raw.taskComposite);
        if(raw.ownerBinding?.protocol!=='ordinary_initial_plan_additive_v2'||raw.status!=='pending'||raw.attempts!==0||raw.claimToken||raw.modelAttempted||raw.planCandidate||raw.ownerClaimRequest
          ||prepared.projectId!==raw.projectId||prepared.claimRequest.planRunId!==raw.planRunId||prepared.claimRequest.enqueueKey!==raw.enqueueKey||prepared.claimRequest.fromAgent!==raw.poAgent||prepared.claimRequest.startPolicy!==raw.startPolicy
          ||prepared.ownerBindingDigest!==compositeDigest(raw.ownerBinding))throw Error('bootstrap_composite_journal_invalid');
      }
      if(Object.hasOwn(raw,'taskCompositeSubmission')){
        const item=raw.taskCompositeSubmission;
        if(!raw.taskComposite||!item||typeof item!=='object'||Object.keys(item).length!==3||Object.keys(item).some(key=>!['schemaVersion','phase','preparationDigest'].includes(key))||item.schemaVersion!==1||item.phase!=='submission_unknown'||item.preparationDigest!==raw.taskComposite.preparationDigest)throw Error('bootstrap_composite_journal_invalid');
      }
      if(Object.hasOwn(raw,'taskCompositeObservation')){
        const observation=readTaskCompositeObservation(raw.taskCompositeObservation);
        if(!raw.taskComposite||observation.preparationDigest!==raw.taskComposite.preparationDigest||observation.ownerRevision!==raw.taskComposite.expectedProjectRevision+1)throw Error('bootstrap_composite_observation_invalid');
      }
      if(raw.planCandidate && (!raw.modelAttempted || raw.planCandidateHash!==digest(raw.planCandidate)))throw Error('bootstrap_plan_candidate_invalid');
      return raw as KSwarmInitialPlanBootstrapJob;
    });
    return {revision,jobs};
  }

  private save(data: StoreData): void {
    data.revision+=1;
    writeFileAtomicallySync(this.filePath,JSON.stringify(data,null,2));
  }
}

export class KSwarmInitialPlanBootstrapQueue {
  private scheduled = false;
  private scheduledFor: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private activeController: AbortController | null = null;
  private activeRun: Promise<void> | null = null;
  private queueError: string | null = null;
  private busyRetryCount = 0;
  // Retain the exact completed execution transition while the original journal
  // is contended. Retrying this write never authorizes another model execution.
  private pendingTransition: {
    projectId:string;claimToken:string;now:number;
    kind:'succeeded'|'deferred'|'unknown'|'failed';error:string;
  } | null = null;

  constructor(
    private readonly store: JsonKSwarmInitialPlanBootstrapStore,
    /**
     * Design v58 §5.5 / R44-06: the signature explicitly gains `signal` so a
     * shutdown abort reaches the job instead of leaving a fire-and-forget run.
     */
    private readonly execute: (
      job: KSwarmInitialPlanBootstrapJob,
      signal: AbortSignal,
    ) => Promise<{ ok: true } | { ok: false; error: string; launchOutcome?: 'unknown'|'not_started' }>,
    private readonly options: {
      now?: () => number;
      maxClaimPerRun?: number;
      setTimeoutFn?: (callback: () => void, ms: number) => NodeJS.Timeout;
      /** Held for the duration of a run so the coordinator can drain it. */
      acquireRunToken?: () => { release(): void };
      onError?: (error: unknown) => void;
    } = {}
  ) {}

  enqueue(input: KSwarmInitialPlanBootstrapPayload): KSwarmBootstrapEnqueueResult {
    if(this.stopped)return {ok:false,error:'bootstrap_queue_stopped'};
    try {
      if(!isInitialPlanOwnerExecutionSupported(input.ownerBinding))return {ok:false,error:'bootstrap_owner_protocol_unqualified'};
      const job=this.store.upsertPending(input, this.now());
      if(job.status==='legacy_unverified')return {ok:false,error:'bootstrap_legacy_reconciliation_required'};
      if(job.status==='failed')return {ok:false,error:'bootstrap_attempts_exhausted'};
      if(job.status==='pending')this.kick();
      return { ok: true, status: job.status==='pending'?'queued':job.status };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  getHealth():{ok:boolean;error:string|null}{const failure=this.store.getJournalFailure();return {ok:this.queueError===null&&failure===undefined,error:this.queueError??(failure===undefined?null:failure instanceof Error?failure.message:String(failure))};}

  startRecovery(): void {
    void this.store.recoverTaskCompositeObservations().catch(error=>this.recordQueueError(error));
    this.kick();
  }

  /** Shutdown owner API (§5.5 phase ③). */
  stopAccepting(): void {
    this.stopped = true;this.store.stopAcceptingTaskComposites();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.scheduled = false;
      this.scheduledFor = null;
    }
  }

  abortActive(reason = 'app_shutdown'): void {
    this.activeController?.abort(reason);this.store.abortTaskComposites(reason);
  }

  async drain(): Promise<void> {
    while (this.activeRun||this.store.hasActiveTaskComposites()) {
      if(this.activeRun)await this.activeRun;await this.store.drainTaskComposites();
    }
  }

  async drainWithin(deadlineMs:number):Promise<boolean>{
    if(!this.activeRun&&!this.store.hasActiveTaskComposites())return this.getHealth().ok;
    if(!Number.isFinite(deadlineMs)||deadlineMs<=0)return false;
    return new Promise<boolean>(resolve=>{
      let settled=false;
      const finish=(result:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
      const timer=setTimeout(()=>finish(false),deadlineMs);
      void this.drain().then(()=>finish(this.getHealth().ok),()=>finish(false));
    });
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    if (this.stopped) return;
    if (this.queueError && this.queueError!=='bootstrap_journal_busy') return;
    this.running = true;
    const token = this.options.acquireRunToken?.() ?? null;
    const controller = new AbortController();
    this.activeController = controller;
    let settleRun: () => void = () => {};
    this.activeRun = new Promise<void>((resolve) => { settleRun = resolve; });
    try {
      this.persistPendingTransition();
      const limit = this.options.maxClaimPerRun ?? 5;
      for(let count=0;count<limit && !controller.signal.aborted;count++) {
        // Claim immediately before execution, so aborting the current run does
        // not strand never-launched jobs in a misleading running state.
        const jobs = this.store.claimDue(this.now(), 1);
        // Only a successful original-store operation clears transient busy.
        // No lock, running claim, model marker or unknown attempt is reclaimed.
        if(this.queueError==='bootstrap_journal_busy')this.queueError=null;
        this.busyRetryCount=0;
        if (jobs.length === 0) break;
        for (const job of jobs) {
          if (controller.signal.aborted) break;
          let result:Awaited<ReturnType<typeof this.execute>>;
          try {result = await this.execute(job, controller.signal);}
          catch(error){result={ok:false,error:error instanceof Error?error.message:String(error),launchOutcome:'unknown'};}
          this.pendingTransition={projectId:job.projectId,claimToken:job.claimToken!,now:this.now(),
            kind:result.ok?'succeeded':result.launchOutcome==='not_started'?'deferred':
              controller.signal.aborted || result.launchOutcome==='unknown'?'unknown':'failed',
            error:result.ok?'':result.error};
          this.persistPendingTransition();
        }
      }
    } catch(error) {
      this.recordQueueError(error);
    } finally {
      this.running = false;
      this.activeController = null;
      token?.release();
      settleRun();
      this.activeRun = null;
      this.scheduleNext();
    }
  }

  private persistPendingTransition():void {
    const transition=this.pendingTransition;
    if(!transition)return;
    const {projectId,claimToken,now,error}=transition;
    if(transition.kind==='succeeded')this.store.markSucceeded(projectId,now,claimToken);
    else if(transition.kind==='deferred')this.store.markDeferredBeforeModel(projectId,now,error,claimToken);
    else if(transition.kind==='unknown')this.store.markLaunchUnknown(projectId,now,error,claimToken);
    else this.store.markFailed(projectId,now,error,claimToken);
    // EEXIST is raised before the journal mutation. Other IO failures remain
    // latched: a possibly committed transition must not be blindly repeated.
    this.pendingTransition=null;
    if(this.queueError==='bootstrap_journal_busy')this.queueError=null;
    this.busyRetryCount=0;
  }

  private recordQueueError(error:unknown):void {
    this.queueError=error instanceof Error?error.message:String(error);
    try{this.options.onError?.(error);}catch{console.warn('[kswarm-bootstrap] error observer failed');}
  }

  private scheduleNext():void {
    if(this.stopped)return;
    if(this.queueError==='bootstrap_journal_busy'){
      // Observe the same pending work after bounded-backoff IO contention.
      // A crash-held lock is retained; elapsed time never proves it releasable.
      const delay=Math.min(30000,250*2**Math.min(this.busyRetryCount++,7));
      this.kick(delay);return;
    }
    if(this.queueError)return;
    try{
      const now=this.now(),nextDueAt=this.store.nextDueAt(now);
      if(nextDueAt!==null)this.kick(Math.max(0,nextDueAt-now));
    }catch(error){this.recordQueueError(error);}
  }

  private kick(delayMs = 0): void {
    if (this.stopped) return;
    const targetAt = this.now() + delayMs;
    if (this.scheduled && this.scheduledFor !== null && this.scheduledFor <= targetAt) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduled = true;
    this.scheduledFor = targetAt;
    this.timer = (this.options.setTimeoutFn ?? setTimeout)(() => {
      this.scheduled = false;
      this.scheduledFor = null;
      this.timer = null;
      void this.runOnce();
    }, delayMs);
    this.timer.unref?.();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function isJob(value: unknown): value is KSwarmInitialPlanBootstrapJob & {schemaVersion?:number} {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.projectId === 'string'
    && typeof record.projectName === 'string'
    && typeof record.goal === 'string'
    && typeof record.poAgent === 'string'
    && Array.isArray(record.members)
    && record.members.every(member=>typeof member==='string')
    && ['pending','running','succeeded','failed','launch_unknown','legacy_unverified'].includes(String(record.status))
    && Number.isSafeInteger(record.attempts) && Number(record.attempts)>=0
    && Number.isSafeInteger(record.maxAttempts) && Number(record.maxAttempts)>0
    && typeof record.createdAt==='number' && Number.isFinite(record.createdAt)
    && typeof record.updatedAt==='number' && Number.isFinite(record.updatedAt)
    && typeof record.nextAttemptAt==='number' && Number.isFinite(record.nextAttemptAt);
}

function isDue(job: KSwarmInitialPlanBootstrapJob, now: number): boolean {
  return !job.taskComposite && job.status === 'pending' && job.nextAttemptAt <= now && isInitialPlanOwnerExecutionSupported(job.ownerBinding);
}

/** Main shutdown observes the same queue, never a mirrored active counter.
 * Timeout reports undrained only; the physical job keeps its claim and journal. */
export function createKSwarmBootstrapShutdownOwner(queue:KSwarmInitialPlanBootstrapQueue):IngressOwner {
  return Object.freeze({name:'kswarm-initial-plan-bootstrap',stopAccepting:()=>queue.stopAccepting(),
    abortAllActive:(reason:string)=>queue.abortActive(reason),drain:(deadlineMs:number)=>queue.drainWithin(deadlineMs)});
}
