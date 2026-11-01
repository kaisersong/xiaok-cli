import {it,expect,vi} from 'vitest';
import {createAssistantThreadTargets} from '../../electron/assistant-launch-thread-target.js';
import {createAssistantDesktopAdmission} from '../../electron/assistant-desktop-admission.js';
import type {AssistantThreadTarget,AssistantGoalConsentQuote} from '../../shared/assistant-launch-contract.js';
const domain={lane:'local' as const,workspaceId:'w',cwd:'/w',device:'1',inode:'2',permissionRevision:1,bootId:'b'};
const quote:AssistantGoalConsentQuote={consentId:'00000000-0000-4000-8000-000000000001',threadId:'X',validUntil:600100,state:{goalId:'actual-goal-X',sessionId:'X',epoch:1,revision:1,objective:'Goal X',expectedEvidenceKinds:['answer'],status:'active',turnsUsed:0,tokensUsed:0,activeWallClockMs:0,budgetLimits:{turnLimit:3},consecutiveBlockedTurns:0,createdAt:100,updatedAt:100}};
it('rejects mixed Goal/noGoal thread bindings in validate, final assert and confirm before delegation',async()=>{
 for(const patch of [{goalBinding:quote},{goalBinding:{...quote,threadId:'Y'}},{goalBinding:null,noGoalGuard:{guardId:quote.consentId,threadId:'X',validUntil:600100}},{goalBinding:{...quote,threadId:'Y',state:{...quote.state,sessionId:'Y'}},noGoalGuard:{guardId:quote.consentId,threadId:'Y',validUntil:600100}}]){
 const confirm=vi.fn(async()=>{}),assert=vi.fn();const owner=createAssistantThreadTargets({profileId:'p',read:async threadId=>({threadId,title:'Owned Y',profileId:'p',workspaceId:'w',revision:1,deleted:false,goal:patch.goalBinding?{}:null}),assertCurrent:assert,goalCoordinator:{prepareAssistantGoalConsent:async()=>quote,assertAssistantGoalConsentQuote:assert,confirmAssistantGoalConsent:confirm,prepareAssistantNoGoalGuard:async()=>({guardId:quote.consentId,threadId:'X',validUntil:600100}),assertAssistantNoGoalGuard:assert}});
 await expect(owner.prepare('Y',domain)).rejects.toThrow('assistant_thread_target_stale');
 const target:AssistantThreadTarget={kind:'existing',threadId:'Y',title:'Owned Y',profileId:'p',workspaceId:'w',revision:1,...patch};
 await expect(owner.validate(target,domain)).rejects.toThrow('assistant_thread_target_stale');expect(()=>owner.assertCurrent(target)).toThrow('assistant_thread_target_stale');await expect(owner.confirmGoalConsent!(target,{requestDigest:'a'.repeat(64),instruction:'Work',checked:true})).rejects.toThrow('assistant_thread_target_stale');
 expect(confirm).not.toHaveBeenCalled();expect(assert).not.toHaveBeenCalled();
 }
});
it('rejects a cross-thread Goal quote in ensure before formalCreate and never cancels an unowned task',async()=>{
 const cancel=vi.fn(async()=>{}),formalCreate=vi.fn(async()=>({taskId:'foreign-task'}));
 const adapter=createAssistantDesktopAdmission({host:{reserveAssistantTaskIdentity:()=>({taskId:'owned-task',reservationId:'r'}),cancelTask:cancel} as any,ready:async()=>{},domain:()=>domain,formalCreate});
 const binding={operationId:'op',requestDigest:'a'.repeat(64),threadId:'Y'};
 for(const goalConsent of [quote,{...quote,threadId:'Y'}]){const allocation=adapter.port.allocate(binding);await expect(adapter.port.ensure({...binding,allocation,taskId:allocation.taskId,instruction:'Work',domain,goalConsent},()=>{})).rejects.toThrow('assistant_admission_identity_mismatch');}
 expect(formalCreate).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled();
 const next=adapter.port.allocate(binding);await expect(adapter.port.ensure({...binding,allocation:next,taskId:next.taskId,instruction:'Work',domain},()=>{})).rejects.toThrow('assistant_admission_identity_mismatch');expect(cancel).not.toHaveBeenCalled();
});
