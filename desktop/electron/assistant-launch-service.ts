import type {AssistantThreadTargets} from './assistant-launch-thread-target.js';
import {createHash} from 'node:crypto';import {z} from 'zod';
import type {LoopStore} from './loop-store.js';import type {AssistantActionSource} from './assistant-action-store.js';
import {ASSISTANT_LAUNCH_DOMAIN_SCHEMA,ASSISTANT_THREAD_TARGET_PAGE_SCHEMA,type AssistantGoalConsentQuote,type AssistantLaunchDomain,type AssistantLaunchOperation} from '../shared/assistant-launch-contract.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
type Source='user'|'agent'|'scheduler';
export interface AssistantTaskAdmissionPort{
 domain():Promise<AssistantLaunchDomain>;assertDomain(domain:AssistantLaunchDomain):void;
 submit(input:{operationId:string;requestDigest:string;threadId:string;instruction:string;domain:AssistantLaunchDomain;goalConsent?:AssistantGoalConsentQuote},prepared:(taskId:string,submissionId:string)=>void,assertCurrent:()=>void):Promise<{taskId:string;submissionId:string}>;
 matches(op:AssistantLaunchOperation):Promise<boolean>;lookup(taskId:string):Promise<TaskSnapshot|undefined>;cancel?(taskId:string):Promise<void>;
}
export class AssistantLaunchService {
 private closed=false;private readonly failedAdmissions:unknown[]=[];
 private readonly flights=new Map<string,Promise<AssistantLaunchOperation>>();
 private readonly now:()=>number;
 constructor(private readonly options:{store:LoopStore;port:AssistantTaskAdmissionPort;threadTargets?:AssistantThreadTargets;readSource:()=>Promise<AssistantActionSource|undefined>;readFollowUpSource?:(candidateId:string)=>Promise<AssistantActionSource|undefined>;isSourceLaunchable?:(source:AssistantActionSource)=>boolean;now?:()=>number}){this.now=options.now??Date.now;}
 private user(input:{requestSource:Source}){if(this.closed)throw Error('assistant_launch_closed');if(input?.requestSource!=='user')throw Error('assistant_launch_user_only');}
 private async source(candidateId?:string){const source=await (candidateId?this.options.readFollowUpSource?.(candidateId):this.options.readSource());if(!source||!source.isCurrent()||this.options.isSourceLaunchable?.(source)!==true)throw Error('assistant_launch_source_unavailable');return source;}
 async available(){try{await this.source();await this.options.port.domain();return true;}catch{return false;}}
 async listTargets(input:{cursor?:string;requestSource:Source}){
  this.user(input);const cursor=z.string().min(1).max(4096).optional().parse(input.cursor);
  const domain=ASSISTANT_LAUNCH_DOMAIN_SCHEMA.parse(await this.options.port.domain());this.options.port.assertDomain(domain);
  if(!this.options.threadTargets?.list)throw Error('assistant_existing_thread_unsupported');
  const page=await this.options.threadTargets.list(domain,{...(cursor!==undefined?{cursor}:{})});
  this.options.port.assertDomain(domain);
  if(Buffer.byteLength(JSON.stringify(page),'utf8')>160*1024)throw Error('assistant_thread_target_page_too_large');
  return ASSISTANT_THREAD_TARGET_PAGE_SCHEMA.parse(page);
 }
 async prepare(input:{proposalId:string;expectedRevision:number;requestSource:Source;existingThreadId?:string}){
  this.user(input);if(!/^assistant-action-[a-f0-9]{64}$/.test(input.proposalId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)throw Error('assistant_launch_input');
  const source=await this.source(),domain=ASSISTANT_LAUNCH_DOMAIN_SCHEMA.parse(await this.options.port.domain());
  this.options.port.assertDomain(domain);
  const threadTarget=input.existingThreadId!==undefined?await this.prepareTarget(input.existingThreadId,domain):undefined;
  return this.options.store.prepareAssistantLaunchDraft(source,{proposalId:input.proposalId,expectedRevision:input.expectedRevision,domain,threadTarget,now:this.now()});
 }
 private async prepareTarget(threadId:string,domain:AssistantLaunchDomain){z.string().min(1).max(160).parse(threadId);if(!this.options.threadTargets)throw Error('assistant_existing_thread_unsupported');return this.options.threadTargets.prepare(threadId,domain);}
 private async validateTarget(op:{threadTarget?:import('../shared/assistant-launch-contract.js').AssistantThreadTarget;domain:AssistantLaunchDomain}){if(op.threadTarget){if(!this.options.threadTargets)throw Error('assistant_existing_thread_unsupported');await this.options.threadTargets.validate(op.threadTarget,op.domain);}}
 async prepareFollowUp(input:{candidateId:string;requestSource:Source;existingThreadId?:string}){
  this.user(input);if(typeof input.candidateId!=='string'||!input.candidateId||input.candidateId.length>160)throw Error('assistant_launch_input');
  const source=await this.source(input.candidateId),domain=ASSISTANT_LAUNCH_DOMAIN_SCHEMA.parse(await this.options.port.domain());this.options.port.assertDomain(domain);
  const threadTarget=input.existingThreadId!==undefined?await this.prepareTarget(input.existingThreadId,domain):undefined;
  const proposal=this.options.store.projectAssistantActions(source,this.now())[0];if(!proposal)throw Error('assistant_launch_source_unavailable');
  return this.options.store.prepareAssistantLaunchDraft(source,{proposalId:proposal.id,expectedRevision:proposal.revision,domain,threadTarget,now:this.now(),candidateId:input.candidateId});
 }
 async prepareReconfirmation(input:{draftId:string;requestSource:Source;existingThreadId?:string}){
  this.user(input);z.string().uuid().parse(input.draftId);
  const previousDraft=this.options.store.readAssistantLaunchDraft(input.draftId),operation=this.options.store.readAssistantLaunchOperation(input.draftId,'draft_id');
  if(!previousDraft||!operation||operation.state!=='blocked'||operation.taskId!==null)throw Error('assistant_launch_reconfirmation_denied');
  const source=await this.source(previousDraft.candidateId),domain=ASSISTANT_LAUNCH_DOMAIN_SCHEMA.parse(await this.options.port.domain());this.options.port.assertDomain(domain);
  const threadTarget=input.existingThreadId!==undefined?await this.prepareTarget(input.existingThreadId,domain):undefined;
  const proposal=this.options.store.projectAssistantActions(source,this.now()).find(item=>item.id===operation.proposalId);if(!proposal)throw Error('assistant_launch_source_unavailable');
  return this.options.store.prepareAssistantLaunchDraft(source,{proposalId:proposal.id,expectedRevision:proposal.revision,domain,threadTarget,now:this.now(),candidateId:previousDraft.candidateId,reconfirmOperationId:operation.operationId,expectedOperationDigest:operation.requestDigest});
 }
 async confirm(input:{draftId:string;instruction:string;requestSource:Source;goalConsentChecked?:boolean}):Promise<AssistantLaunchOperation>{
  this.user(input);z.string().uuid().parse(input.draftId);
  if(typeof input.instruction!=='string'||!input.instruction.trim()||input.instruction.length>4000||Buffer.byteLength(input.instruction)>16000)throw Error('assistant_launch_instruction');
  const draft=this.options.store.readAssistantLaunchDraft(input.draftId);if(!draft)throw Error('assistant_launch_draft_missing');
  const old=this.options.store.readAssistantLaunchOperation(draft.id,'draft_id');
  if(old){if(old.instruction!==input.instruction)throw Error('assistant_launch_confirmation_conflict');return this.flights.get(old.operationId)??old;}
  const source=await this.source(draft.candidateId);this.options.port.assertDomain(draft.domain);
  if(draft.threadTarget?.goalBinding&&(input.goalConsentChecked!==true||!this.options.threadTargets?.confirmGoalConsent))throw Error('goal_assistant_explicit_consent_required');
  await this.validateTarget(draft);
  const operation=this.options.store.confirmAssistantLaunch(source,{draftId:draft.id,instruction:input.instruction,now:this.now()});
  const existing=this.flights.get(operation.operationId);if(existing)return existing;
  const run=(async()=>{if(operation.threadTarget?.goalBinding){try{await this.options.threadTargets!.confirmGoalConsent!(operation.threadTarget,{requestDigest:operation.requestDigest,instruction:operation.instruction,checked:input.goalConsentChecked===true});}catch{return this.options.store.updateAssistantLaunchObservation(operation.operationId,{state:'blocked',errorCode:'goal_consent_stale'},this.now());}}return this.dispatch(operation,source);})();this.flights.set(operation.operationId,run);void run.finally(()=>{if(this.flights.get(operation.operationId)===run)this.flights.delete(operation.operationId);}).catch(()=>{});return run;
 }
 private async dispatch(operation:AssistantLaunchOperation,source:AssistantActionSource):Promise<AssistantLaunchOperation>{
  const {store,port}=this.options;let entered=false;
  try{
   await this.validateTarget(operation);port.assertDomain(operation.domain);if(!source.isCurrent())throw Error('source_stale');
   let prepared=false;
   const assertCurrent=()=>{port.assertDomain(operation.domain);if(this.options.isSourceLaunchable?.(source)!==true||!source.isCurrent())throw Error('source_stale');if(!prepared&&operation.threadTarget){if(!this.options.threadTargets)throw Error('assistant_existing_thread_unsupported');this.options.threadTargets.assertCurrent(operation.threadTarget);}};
   store.updateAssistantLaunchObservation(operation.operationId,{state:'preparing'},this.now());entered=true;
   await port.submit({operationId:operation.operationId,requestDigest:operation.requestDigest,threadId:operation.threadId,instruction:operation.instruction,domain:operation.domain,...(operation.threadTarget?.goalBinding?{goalConsent:operation.threadTarget.goalBinding}:{})},(taskId,submissionId)=>{
    const claimed=store.claimAssistantLaunchDispatch(operation.operationId,taskId,this.now(),submissionId);if(!claimed||claimed.state!=='preparing')throw Error('assistant_launch_start_denied');
    prepared=true;store.consumeAssistantLaunchStart(source,operation.operationId,assertCurrent,this.now());
   },assertCurrent);
   return await this.reconcile(store.readAssistantLaunchOperation(operation.operationId)!);
  }catch(error){
   const reason=error instanceof Error&&['goal_requires_new_thread','goal_consent_stale','goal_budget_exhausted','existing_thread_busy','assistant_thread_target_stale','assistant_thread_target_unavailable','thread_deletion_pending','thread_cleanup_pending','assistant_existing_thread_unsupported'].includes(error.message)?error.message:'admission_unavailable';
   const current=store.readAssistantLaunchOperation(operation.operationId)!;
   if(current.taskStatus&&['completed','failed','cancelled'].includes(current.taskStatus))return current;
   if(entered)this.failedAdmissions.push(error);
   return store.updateAssistantLaunchObservation(current.operationId,{state:entered?'outcome_unknown':'blocked',errorCode:entered?'manual_repair':reason},this.now());
  }
 }
 async get(input:{draftId:string;requestSource:Source}){
  this.user(input);z.string().uuid().parse(input.draftId);
  const draft=this.options.store.readAssistantLaunchDraft(input.draftId);if(!draft)throw Error('assistant_launch_draft_missing');
  const operation=this.options.store.readAssistantLaunchOperation(draft.id,'draft_id');return {draft,operation:operation?await this.reconcile(operation):null};
 }
 async list(input:{requestSource:Source}){this.user(input);const rows=this.options.store.listAssistantLaunchOperations();return await Promise.all(rows.map(op=>this.reconcile(op)));}
 private async reconcile(op:AssistantLaunchOperation):Promise<AssistantLaunchOperation>{
  if(!op.taskId)return op;
  let snapshot:TaskSnapshot|undefined;try{snapshot=await this.options.port.lookup(op.taskId);}catch{}
  const latest=this.options.store.readAssistantLaunchOperation(op.operationId)!;
  // A late running observation cannot overwrite a newer terminal/result read.
  if(JSON.stringify(latest)!==JSON.stringify(op))return latest;
  let matches=false;try{matches=await this.options.port.matches(op);}catch{}
  if(!matches||!snapshot||snapshot.context?.threadId!==op.threadId||snapshot.prompt!==op.instruction)return this.options.store.updateAssistantLaunchObservation(op.operationId,{state:'outcome_unknown',errorCode:'manual_repair'},this.now());
  const goal=op.threadTarget?.goalBinding;
  if(goal&&(snapshot.executionScope?.kind!=='goal_turn'||snapshot.executionScope.goalId!==goal.state.goalId||snapshot.executionScope.epoch!==goal.state.epoch))return this.options.store.updateAssistantLaunchObservation(op.operationId,{state:'outcome_unknown',errorCode:'goal_consent_stale'},this.now());
  const terminal=['completed','failed','cancelled'].includes(snapshot.status);
  const digest=terminal?createHash('sha256').update(canonicalVerificationJson(JSON.parse(JSON.stringify({taskId:snapshot.taskId,sessionId:snapshot.sessionId,status:snapshot.status,result:snapshot.result??null,executions:snapshot.events.filter(event=>event.type==='task_execution_started').length})))).digest('hex'):null;
  const actual=this.options.store.readAssistantLaunchOperation(op.operationId)!;
  const attached=snapshot.status!=='understanding'&&['start_committed','attached','outcome_unknown'].includes(actual.state);
  return this.options.store.updateAssistantLaunchObservation(op.operationId,{state:attached?'attached':'outcome_unknown',errorCode:attached?null:'manual_repair',taskStatus:snapshot.status,resultDigest:digest},this.now());
 }
 async cancel(input:{draftId:string;requestSource:Source}){
  this.user(input);z.string().uuid().parse(input.draftId);
  const operation=this.options.store.readAssistantLaunchOperation(input.draftId,'draft_id');if(!operation)throw Error('assistant_launch_operation_missing');
  const requested=this.options.store.requestAssistantLaunchCancel(operation.operationId,this.now());
  if(requested.state==='cancelled'||requested.taskStatus&&['completed','failed','cancelled'].includes(requested.taskStatus))return requested;
  if(!requested.taskId)return this.options.store.updateAssistantLaunchObservation(requested.operationId,{state:'outcome_unknown',errorCode:'cancel_pending'},this.now());
  try{if(!this.options.port.cancel)throw Error('assistant_cancel_unavailable');await this.options.port.cancel(requested.taskId);return await this.reconcile(this.options.store.readAssistantLaunchOperation(requested.operationId)!);}
  catch{return this.options.store.updateAssistantLaunchObservation(requested.operationId,{state:'outcome_unknown',errorCode:'cancel_pending'},this.now());}
 }
 async observeTask(input:{taskId:string;requestSource:Source}){
  if(!input||!['user','scheduler'].includes(input.requestSource))throw Error('assistant_launch_observe_denied');
  const operation=this.options.store.findAssistantLaunchTask(input.taskId);return operation?await this.reconcile(operation):undefined;
 }
 async recover(input:{requestSource:Source}){
  if(input?.requestSource!=='scheduler')throw Error('assistant_launch_recovery_denied');
  for(const operation of this.options.store.listAssistantLaunchRecovery()){
   if(operation.taskId)await this.reconcile(operation);
   else if(operation.state==='accepted'||operation.state==='blocked')this.options.store.updateAssistantLaunchObservation(operation.operationId,{state:'blocked',errorCode:'reconfirmation_required'},this.now());
   else this.options.store.updateAssistantLaunchObservation(operation.operationId,{state:'outcome_unknown',errorCode:'manual_repair'},this.now());
  }
 }
 async close(){this.closed=true;const failures:unknown[]=[];await Promise.all([...this.flights.values()].map(async work=>{try{await work;}catch(raw){failures.push(raw);}}));failures.unshift(...this.failedAdmissions);if(failures.length)throw new AggregateError(failures,'assistant_launch_close_unconfirmed',{cause:failures[0]});}
 async resolve(input:{draftId:string;expectedResultDigest:string;requestSource:Source}){
  this.user(input);if(!/^[a-f0-9]{64}$/.test(input.expectedResultDigest))throw Error('assistant_launch_result_input');
  const {operation}=await this.get(input);if(!operation?.resultDigest||operation.resultDigest!==input.expectedResultDigest)throw Error('assistant_launch_result_conflict');
  return this.options.store.updateAssistantLaunchObservation(operation.operationId,{resolvedDigest:operation.resultDigest},this.now());
 }
}
