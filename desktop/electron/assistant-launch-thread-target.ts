import {ASSISTANT_THREAD_TARGET_PAGE_SCHEMA} from '../shared/assistant-launch-contract.js';
import type {DesktopGoalCoordinator} from './desktop-goal-coordinator.js';
import type {AssistantLaunchDomain,AssistantThreadTarget,AssistantThreadTargetPage} from '../shared/assistant-launch-contract.js';
export interface AssistantOwnedThread {
 threadId:string; title:string; profileId:string; workspaceId:string; revision:number;
 deleted:boolean; goal:object|null; deletionPending?:boolean; cleanupPending?:boolean;
}
/** Main-private adapter: read and final guard must use the conversation/Goal owners. */
export interface AssistantThreadTargets {
 list?(domain:AssistantLaunchDomain,input:{cursor?:string}):Promise<AssistantThreadTargetPage>;
 prepare(threadId:string,domain:AssistantLaunchDomain):Promise<AssistantThreadTarget>;
 validate(target:AssistantThreadTarget,domain:AssistantLaunchDomain):Promise<void>;
 assertCurrent(target:AssistantThreadTarget):void;
 confirmGoalConsent?(target:AssistantThreadTarget,input:{requestDigest:string;instruction:string;checked:boolean}):Promise<void>;
}
function assertBindingThread(target:AssistantThreadTarget):void {
 if(target.goalBinding&&(target.goalBinding.threadId!==target.threadId||target.goalBinding.state.sessionId!==target.threadId))throw Error('assistant_thread_target_stale');
 if(target.noGoalGuard&&target.noGoalGuard.threadId!==target.threadId)throw Error('assistant_thread_target_stale');
 if(target.goalBinding&&target.noGoalGuard)throw Error('assistant_thread_target_stale');
}
export function createAssistantThreadTargets(options:{goalCoordinator?:Pick<DesktopGoalCoordinator,'prepareAssistantGoalConsent'|'assertAssistantGoalConsentQuote'|'confirmAssistantGoalConsent'|'prepareAssistantNoGoalGuard'|'assertAssistantNoGoalGuard'>;list?:(domain:AssistantLaunchDomain,input:{cursor?:string})=>Promise<AssistantThreadTargetPage>;profileId:string;read:(threadId:string)=>Promise<AssistantOwnedThread|undefined>;assertCurrent:(target:AssistantThreadTarget)=>void}):AssistantThreadTargets {
 const read=async(threadId:string,domain:AssistantLaunchDomain)=>{
  const row=await options.read(threadId);
  if(!row||row.threadId!==threadId||row.profileId!==options.profileId||row.workspaceId!==domain.workspaceId||row.deleted)throw Error('assistant_thread_target_unavailable');
  if(row.deletionPending)throw Error('thread_deletion_pending');
  if(row.cleanupPending)throw Error('thread_cleanup_pending');

  if(!Number.isSafeInteger(row.revision)||row.revision<0)throw Error('assistant_thread_target_unavailable');
  return row;
 };
 return {
  ...(options.list?{async list(domain:AssistantLaunchDomain,input:{cursor?:string}){
   const page=await options.list!(domain,input);
   if(page.items.length>50||Buffer.byteLength(JSON.stringify(page),'utf8')>160*1024)throw Error('assistant_thread_target_page_too_large');
   const items:AssistantThreadTargetPage['items']=[];
   for(const item of page.items){const row=await options.read(item.threadId);if(!row||row.threadId!==item.threadId||row.profileId!==options.profileId||row.workspaceId!==domain.workspaceId||row.deleted)continue;items.push({...item,title:row.title,...(row.deletionPending?{available:false,reason:'thread_deletion_pending'}:row.cleanupPending?{available:false,reason:'thread_cleanup_pending'}:{})});}
   const result={items,nextCursor:page.nextCursor};
   if(Buffer.byteLength(JSON.stringify(result),'utf8')>160*1024)throw Error('assistant_thread_target_page_too_large');
   return ASSISTANT_THREAD_TARGET_PAGE_SCHEMA.parse(result);
  }}:{}),
  async prepare(threadId,domain){const row=await read(threadId,domain);if(row.goal!==null&&!options.goalCoordinator)throw Error('goal_requires_new_thread');const goalBinding=row.goal!==null?await options.goalCoordinator!.prepareAssistantGoalConsent({threadId,requestSource:'user'}):null;const noGoalGuard=goalBinding===null&&options.goalCoordinator?await options.goalCoordinator.prepareAssistantNoGoalGuard({threadId,requestSource:'user'}):undefined;const target:AssistantThreadTarget={kind:'existing',...(noGoalGuard?{noGoalGuard}:{}),threadId:row.threadId,title:row.title,profileId:row.profileId,workspaceId:row.workspaceId,revision:row.revision,goalBinding};assertBindingThread(target);return target;},
  async validate(target,domain){assertBindingThread(target);const row=await read(target.threadId,domain);if(row.revision!==target.revision||row.profileId!==target.profileId||row.workspaceId!==target.workspaceId||(row.goal!==null)!==(target.goalBinding!==null))throw Error('assistant_thread_target_stale');options.assertCurrent(target);if(!target.goalBinding&&options.goalCoordinator){if(!target.noGoalGuard)throw Error('goal_consent_stale');options.goalCoordinator.assertAssistantNoGoalGuard(target.noGoalGuard);}if(target.goalBinding){if(!options.goalCoordinator)throw Error('goal_requires_new_thread');options.goalCoordinator.assertAssistantGoalConsentQuote(target.goalBinding);}},
  assertCurrent(target){assertBindingThread(target);options.assertCurrent(target);if(!target.goalBinding&&options.goalCoordinator){if(!target.noGoalGuard)throw Error('goal_consent_stale');options.goalCoordinator.assertAssistantNoGoalGuard(target.noGoalGuard);}if(target.goalBinding){if(!options.goalCoordinator)throw Error('goal_requires_new_thread');options.goalCoordinator.assertAssistantGoalConsentQuote(target.goalBinding,true);}},
  async confirmGoalConsent(target,input){assertBindingThread(target);if(!target.goalBinding)return;if(!options.goalCoordinator)throw Error('goal_requires_new_thread');await options.goalCoordinator.confirmAssistantGoalConsent({consentId:target.goalBinding.consentId,checked:input.checked,requestDigest:input.requestDigest,instruction:input.instruction,requestSource:'user'});},
 };
}
