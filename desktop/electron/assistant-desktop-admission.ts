import {createHash} from 'node:crypto';
import {resolvePreparedSubmissionProof,type MainUserSubmissionOwner} from './main-user-submission.js';
import type {InProcessTaskRuntimeHost} from '../../src/runtime/task-host/task-runtime-host.js';
import type {TaskSnapshot,TaskCreateInput} from '../../src/runtime/task-host/types.js';
import type {AssistantTaskAdmissionPort} from './assistant-launch-service.js';
import type {AssistantGoalConsentQuote,AssistantLaunchDomain,AssistantLaunchOperation} from '../shared/assistant-launch-contract.js';
type Pending={operationId:string;requestDigest:string;threadId:string;instruction:string;domain:AssistantLaunchDomain;goalConsent?:AssistantGoalConsentQuote;prepared?:{taskId:string;submissionId:string};assertCurrent:()=>void;commit:(taskId:string,submissionId:string)=>void};
/** Main-private business admission only. The original semantic journal and
 * actual Host prepared receipt remain the sole source of task identity. */
export function createAssistantDesktopAdmission(options:{host:InProcessTaskRuntimeHost;ready:()=>Promise<void>;domain:()=>AssistantLaunchDomain;submissions:MainUserSubmissionOwner;submit:(input:unknown)=>Promise<{taskId:string}>;consumeGoal:(quote:AssistantGoalConsentQuote,snapshot:TaskSnapshot)=>void}){
 const pending=new Map<string,Pending>();let closed=false;
 const assertDomain=(domain:AssistantLaunchDomain)=>{if(closed||JSON.stringify(options.domain())!==JSON.stringify(domain))throw Error('assistant_workspace_or_permission_changed');};
 const current=()=>{const identity=options.submissions.currentIdentity();return identity?pending.get(identity.submissionId.split(':')[1]):undefined;};
 const assertCurrent=()=>{const row=current();if(row){assertDomain(row.domain);row.assertCurrent();}};
 const port:AssistantTaskAdmissionPort={
  domain:async()=>{await options.ready();if(closed)throw Error('assistant_admission_closed');return options.domain();},assertDomain,
  async submit(input,commit,guard){
   assertDomain(input.domain);if(pending.has(input.operationId))throw Error('assistant_admission_recovery_required');
   const row:Pending={...input,assertCurrent:guard,commit};pending.set(input.operationId,row);
   try{const result=await options.submit({action:'submit_new',gestureId:input.operationId,input:{kind:'materials',prompt:input.instruction,materials:[],permissionMode:'default',context:{threadId:input.threadId}}});
    if(!row.prepared||row.prepared.taskId!==result.taskId)throw Error('assistant_prepared_source_unverified');return row.prepared;
   }finally{pending.delete(input.operationId);}
  },
  async matches(op:AssistantLaunchOperation){
   if(!op.submissionId||!op.taskId)return false;
   const actual=options.submissions.observePreparedBinding(op.submissionId);
   return actual.submissionId.split(':')[1]===op.operationId&&actual.prepared.taskId===op.taskId&&actual.prepared.threadId===op.threadId&&actual.prepared.promptSha256===createHash('sha256').update(op.instruction).digest('hex')&&actual.prepared.permissionMode==='default';
  },
  lookup:async taskId=>(await options.host.inspectTask(taskId))??undefined,
  cancel:taskId=>options.host.cancelTask(taskId,'user_cancelled'),
 };
 return {port,assertCurrent,
  prepared(snapshot:TaskSnapshot){
   const row=current();if(!row)return;
   assertDomain(row.domain);row.assertCurrent();
   const proof=options.submissions.currentPreparedSourceProof(),identity=options.submissions.currentIdentity();
   if(!proof||!identity)throw Error('assistant_prepared_source_unverified');
   const actual=resolvePreparedSubmissionProof(proof);
   if(actual.submissionId!==identity.submissionId||actual.prepared.taskId!==snapshot.taskId||actual.prepared.threadId!==row.threadId||snapshot.context?.threadId!==row.threadId||snapshot.prompt!==row.instruction||actual.prepared.promptSha256!==createHash('sha256').update(row.instruction).digest('hex')||actual.prepared.permissionMode!=='default')throw Error('assistant_prepared_source_unverified');
   if(row.goalConsent)options.consumeGoal(row.goalConsent,snapshot);else if(snapshot.executionScope)throw Error('assistant_goal_consent_required');
   row.prepared={taskId:snapshot.taskId,submissionId:actual.submissionId};
   row.commit(snapshot.taskId,actual.submissionId);assertDomain(row.domain);row.assertCurrent();
  },
  stopAccepting(){closed=true;},
 };
}
