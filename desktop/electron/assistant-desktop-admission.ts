import type {AssistantGoalAdmission} from './desktop-goal-coordinator.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {InProcessTaskRuntimeHost,TaskIdentityReservation} from '../../src/runtime/task-host/task-runtime-host.js';
import type {GoalTurnExecutionScope,TaskCreateInput,TaskSnapshot} from '../../src/runtime/task-host/types.js';
import type {AssistantTaskAdmissionPort,AssistantTaskAllocation} from './assistant-launch-service.js';
import type {AssistantGoalConsentQuote,AssistantLaunchDomain} from '../shared/assistant-launch-contract.js';
interface Scope {reservation:TaskIdentityReservation;operationId:string;requestDigest:string;threadId:string;instruction:string;domain:AssistantLaunchDomain;commitStart:()=>void;assertStart:()=>void;goalConsent?:AssistantGoalConsentQuote;goalScope?:GoalTurnExecutionScope;open:boolean}
/** No wire identity becomes a reservation; only this main-owned WeakMap issues it. */
export function createAssistantDesktopAdmission(options:{host:InProcessTaskRuntimeHost;ready:()=>Promise<void>;domain:()=>AssistantLaunchDomain;formalCreate:(input:TaskCreateInput,authority?:AssistantGoalAdmission)=>Promise<{taskId:string}>;assertGoalScope?:(scope:GoalTurnExecutionScope,binding:{consentId:string;requestDigest:string;threadId:string})=>void;assertGoalExecution?:(scope:GoalTurnExecutionScope,binding:{consentId:string;requestDigest:string;threadId:string;taskId:string})=>void}){
 const scopes=new AsyncLocalStorage<Scope>(),allocations=new WeakMap<object,TaskIdentityReservation>(),live=new Map<string,Scope>();
 const assertDomain=(expected:AssistantLaunchDomain)=>{if(JSON.stringify(options.domain())!==JSON.stringify(expected))throw Error('assistant_workspace_or_permission_changed');};
 const port:AssistantTaskAdmissionPort={
  domain:async()=>{await options.ready();return options.domain();},assertDomain,
  allocate(binding){const reservation=options.host.reserveAssistantTaskIdentity(binding),control=Object.freeze({});allocations.set(control,reservation);return {taskId:reservation.taskId,control};},
  async ensure(input,commitStart,assertStart=()=>{}){
   assertDomain(input.domain);
   if(input.goalConsent&&(input.goalConsent.threadId!==input.threadId||input.goalConsent.state.sessionId!==input.threadId))throw Error('assistant_admission_identity_mismatch');
   const reservation=allocations.get(input.allocation.control);allocations.delete(input.allocation.control);
   if(!reservation||reservation.taskId!==input.taskId)throw Error('assistant_allocation_invalid');
   const scope:Scope={reservation,operationId:input.operationId,requestDigest:input.requestDigest,threadId:input.threadId,instruction:input.instruction,domain:input.domain,commitStart,assertStart,goalConsent:input.goalConsent,open:true};live.set(input.taskId,scope);
   try{const result=await scopes.run(scope,()=>options.formalCreate({prompt:input.instruction,materials:[],permissionMode:'default',context:{threadId:input.threadId}},input.goalConsent?{consentId:input.goalConsent.consentId,requestDigest:input.requestDigest,requestSource:'user',guard:()=>{assertDomain(input.domain);assertStart();}}:undefined));if(result.taskId!==input.taskId)throw Error('assistant_admission_identity_mismatch');}
   finally{scope.open=false;}
  },
  cancel:taskId=>options.host.cancelTask(taskId,'user_cancelled'),
  lookup:async taskId=>(await options.host.inspectTask(taskId))??undefined,
 };
 const assertGoalExecution=(scope:Scope,snapshot:TaskSnapshot)=>{if(scope.goalConsent){if(!options.assertGoalExecution||!scope.goalScope||snapshot.executionScope?.kind!=='goal_turn'||JSON.stringify(snapshot.executionScope)!==JSON.stringify(scope.goalScope))throw Error('goal_consent_scope_invalid');options.assertGoalExecution(snapshot.executionScope,{consentId:scope.goalConsent.consentId,requestDigest:scope.requestDigest,threadId:scope.threadId,taskId:snapshot.taskId});}};
 const scopeFor=(snapshot:TaskSnapshot)=>{const scope=live.get(snapshot.taskId),binding=snapshot.assistantBinding;if(!scope||!binding||scope.operationId!==binding.operationId||scope.requestDigest!==binding.requestDigest||scope.threadId!==binding.threadId)throw Error('assistant_admission_recovery_required');return scope;};
 return {port,
  reservationFor(input:TaskCreateInput){const scope=scopes.getStore();if(!scope)return undefined;if(!scope.open||input.context?.threadId!==scope.threadId||input.prompt!==scope.instruction||input.permissionMode!=='default')throw Error('assistant_formal_admission_context_changed');if(scope.goalConsent){if(input.executionScope?.kind!=='goal_turn'||!options.assertGoalScope||!options.assertGoalExecution)throw Error('goal_consent_scope_invalid');options.assertGoalScope(input.executionScope,{consentId:scope.goalConsent.consentId,requestDigest:scope.requestDigest,threadId:scope.threadId});scope.goalScope=structuredClone(input.executionScope);}else if(input.executionScope)throw Error('assistant_formal_admission_context_changed');return scope.reservation;},
  commitStart(snapshot:TaskSnapshot){const scope=scopeFor(snapshot);assertDomain(scope.domain);assertGoalExecution(scope,snapshot);scope.assertStart();scope.commitStart();},
  assertExecutionWorkspace(snapshot:TaskSnapshot){const scope=scopeFor(snapshot);assertDomain(scope.domain);assertGoalExecution(scope,snapshot);},
  forget(taskId:string){live.delete(taskId);},
 };
}
