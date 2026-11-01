import {createAssistantThreadTargets} from '../../electron/assistant-launch-thread-target.js';
import {afterEach,it,expect,vi} from 'vitest';
import {DesktopGoalCoordinator} from '../../electron/desktop-goal-coordinator.js';
import {SqliteGoalStore} from '../../electron/goal-store-sqlite.js';
import type {TaskCreateInput} from '../../../src/runtime/task-host/types.js';
const cleanups:Array<()=>void>=[];afterEach(()=>{for(const close of cleanups.splice(0))close();});
async function setup(){
 const store=new SqliteGoalStore(':memory:');let clock=100;
 const prepared:TaskCreateInput[]=[],started:string[]=[],cancelled:string[]=[];
 const host={prepareTask:vi.fn(async(input:TaskCreateInput)=>{prepared.push(input);return {taskId:`task_${prepared.length}`};}),startTask:vi.fn(async(id:string)=>{started.push(id);}),cancelTask:vi.fn(async(id:string)=>{cancelled.push(id);})};
 const coordinator=new DesktopGoalCoordinator({store,taskHost:host,instanceId:'desktop',now:()=>clock});
 cleanups.push(()=>{coordinator.disarmAll();store.close();});
 const created=await coordinator.createGoal({threadId:'t',objective:'Actual Goal',completionCriterion:'Actual acceptance',expectedEvidenceKinds:['answer'],turnLimit:3});
 // Original user queue owner retires the pending creation task; keep active/armed idle Goal.
 await coordinator.setUserQueuePending({threadId:'t',pending:true});await coordinator.setUserQueuePending({threadId:'t',pending:false});
 const quote=()=>coordinator.prepareAssistantGoalConsent({threadId:'t',requestSource:'user'});
 const confirm=(id:string,extra:object={})=>coordinator.confirmAssistantGoalConsent({consentId:id,checked:true,requestDigest:'a'.repeat(64),instruction:'Explicit assistant work',requestSource:'user',...extra});
 const admit=(id:string,extra:object={})=>coordinator.admitAssistantUserTask({prompt:'Explicit assistant work',materials:[],permissionMode:'default',context:{threadId:'t'}},{consentId:id,requestDigest:'a'.repeat(64),requestSource:'user',guard:()=>{},...extra});
 return {store,host,coordinator,created,prepared,started,cancelled,quote,confirm,admit,setClock:(n:number)=>{clock=n;}};
}
it('issues actual Goal identity/budget/acceptance and consumes once on the original admission',async()=>{
 const f=await setup(),q=await f.quote();expect(q.state).toEqual(f.created.goal.state);expect(q.state.goalId).not.toBe('t');
 await f.confirm(q.consentId);const result=await f.admit(q.consentId);
 expect(f.prepared.at(-1)?.executionScope).toMatchObject({kind:'goal_turn',goalId:q.state.goalId,epoch:q.state.epoch,origin:'user'});
 expect(f.store.getTaskBinding(result.taskId)).toMatchObject({goalId:q.state.goalId,epoch:q.state.epoch});expect(f.started).toEqual([result.taskId]);
 await expect(f.admit(q.consentId)).rejects.toThrow();expect(f.started).toHaveLength(1);
});
it('rejects forged, unchecked, agent, wrong digest and prompt',async()=>{
 const f=await setup(),q=await f.quote();
 await expect(f.confirm(q.consentId,{checked:false})).rejects.toThrow();await expect(f.confirm(q.consentId,{requestSource:'agent'})).rejects.toThrow();
 await expect(f.admit('forged')).rejects.toThrow();await f.confirm(q.consentId);
 await expect(f.admit(q.consentId,{requestDigest:'b'.repeat(64)})).rejects.toThrow();
 await expect(f.coordinator.admitAssistantUserTask({prompt:'Different',materials:[],context:{threadId:'t'}},{consentId:q.consentId,requestDigest:'a'.repeat(64),requestSource:'user',guard:()=>{}})).rejects.toThrow();
 expect(f.started).toEqual([]);
});
it('rejects state changes, paused/disarmed and expiration',async()=>{
 const f=await setup(),q=await f.quote();await f.confirm(q.consentId);await f.coordinator.pauseGoal({threadId:'t'});
 await expect(f.admit(q.consentId)).rejects.toThrow();await expect(f.quote()).rejects.toThrow();
 const g=await setup(),r=await g.quote();await g.confirm(r.consentId);g.coordinator.disarmAll();await expect(g.admit(r.consentId)).rejects.toThrow();
 const h=await setup(),s=await h.quote();h.setClock(600101);await expect(h.confirm(s.consentId)).rejects.toThrow();
});
it('compensates a Goal changed during host preparation before starting',async()=>{
 const f=await setup(),q=await f.quote();await f.confirm(q.consentId);
 const original=f.host.prepareTask.getMockImplementation()!;
 f.host.prepareTask.mockImplementationOnce(async input=>{const result=await original(input);f.coordinator.disarmAll();return result;});
 await expect(f.admit(q.consentId)).rejects.toThrow();expect(f.started).toEqual([]);expect(f.cancelled).toContain('task_2');
});
it('serializes concurrent consumption and respects the final source guard',async()=>{
 const f=await setup(),q=await f.quote();await f.confirm(q.consentId);
 const result=await Promise.allSettled([f.admit(q.consentId),f.admit(q.consentId)]);expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(f.started).toHaveLength(1);
 const g=await setup(),r=await g.quote();await g.confirm(r.consentId);await expect(g.admit(r.consentId,{guard:()=>{throw Error('pilot_closed');}})).rejects.toThrow('pilot_closed');expect(g.started).toEqual([]);
});
it('uses the exact current Goal revision, budget and completion conditions, never mutable returned quotes',async()=>{
 const f=await setup(),q=await f.quote();q.state.budgetLimits.turnLimit=999;
 expect(()=>f.coordinator.assertAssistantGoalConsentQuote(q)).toThrow('stale');
 const r=await f.quote();await f.confirm(r.consentId);
 const current=(await f.store.load('t'))!.state;
 await f.store.commit({sessionId:'t',expectedRevision:current.revision,next:{...current,revision:current.revision+1,completionCriterion:'Different acceptance',budgetLimits:{turnLimit:2}},events:[],turns:[],evidence:[]});
 await expect(f.admit(r.consentId)).rejects.toThrow();expect(f.started).toEqual([]);
});
it('rejects exhausted budgets, busy turns, terminal Goals and a different coordinator boot',async()=>{
 const f=await setup(),q=await f.quote();await f.confirm(q.consentId);
 const other=new DesktopGoalCoordinator({store:f.store,taskHost:f.host,instanceId:'different',now:()=>100});
 await expect(other.admitAssistantUserTask({prompt:'Explicit assistant work',materials:[],permissionMode:'default',context:{threadId:'t'}},{consentId:q.consentId,requestDigest:'a'.repeat(64),requestSource:'user',guard:()=>{}})).rejects.toThrow();other.disarmAll();
 const result=await f.admit(q.consentId);await expect(f.quote()).rejects.toThrow('busy');
 expect(()=>f.coordinator.assertAssistantGoalScope({...f.prepared.at(-1)!.executionScope!,goalTurnId:'forged'} as any,{consentId:q.consentId,requestDigest:'a'.repeat(64),threadId:'t'})).toThrow();
 expect(()=>f.coordinator.assertAssistantGoalExecution(f.prepared.at(-1)!.executionScope as any,{consentId:q.consentId,requestDigest:'a'.repeat(64),threadId:'t',taskId:'forged'})).toThrow();
 expect(()=>f.coordinator.assertAssistantGoalExecution(f.prepared.at(-1)!.executionScope as any,{consentId:q.consentId,requestDigest:'a'.repeat(64),threadId:'t',taskId:result.taskId})).not.toThrow();
 const g=await setup(),state=(await g.store.load('t'))!.state;
 await g.store.commit({sessionId:'t',expectedRevision:state.revision,next:{...state,revision:state.revision+1,budgetLimits:{turnLimit:3,tokenLimit:0}},events:[],turns:[],evidence:[]});
 await expect(g.quote()).rejects.toThrow('budget_exhausted');
 await g.coordinator.cancelGoal({threadId:'t'});await expect(g.quote()).rejects.toThrow('requires_new_thread');
});
it('issues a real no-Goal mutation guard, preserves ordinary admission and rejects later creation/ABA',async()=>{
 const f=await setup();
 const token=await f.coordinator.prepareAssistantNoGoalGuard({threadId:'empty',requestSource:'user'});
 expect(()=>f.coordinator.assertAssistantNoGoalGuard(token)).not.toThrow();
 await f.coordinator.admitUserTask({prompt:'Ordinary',materials:[],context:{threadId:'empty'}});
 expect(()=>f.coordinator.assertAssistantNoGoalGuard(token)).not.toThrow();
 const creating=f.coordinator.createGoal({threadId:'empty',objective:'New actual goal',expectedEvidenceKinds:['answer'],turnLimit:2});
 expect(()=>f.coordinator.assertAssistantNoGoalGuard(token)).toThrow();await creating;
 await expect(f.coordinator.prepareAssistantNoGoalGuard({threadId:'empty',requestSource:'user'})).rejects.toThrow();
 expect(()=>f.coordinator.assertAssistantNoGoalGuard({...token,guardId:'forged'})).toThrow();
});
it('rejects an oversized Goal quote without truncating actual conditions',async()=>{
 const f=await setup(),state=(await f.store.load('t'))!.state;
 const objective='目'.repeat(4000),completionCriterion='验'.repeat(4000);
 await f.store.commit({sessionId:'t',expectedRevision:state.revision,next:{...state,revision:state.revision+1,objective,completionCriterion},events:[],turns:[],evidence:[]});
 await expect(f.quote()).rejects.toThrow('goal_consent_quote_unsupported');
 expect((await f.store.load('t'))?.state.completionCriterion).toBe(completionCriterion);
});
it('invalidates a no-Goal quote when creation was queued before absence read completed',async()=>{
 const f=await setup();
 const capturing=f.coordinator.prepareAssistantNoGoalGuard({threadId:'queued-empty',requestSource:'user'});
 const creating=f.coordinator.createGoal({threadId:'queued-empty',objective:'Queued goal',expectedEvidenceKinds:['answer'],turnLimit:2});
 const token=await capturing;await creating;
 expect(()=>f.coordinator.assertAssistantNoGoalGuard(token)).toThrow();
});

it('helper expiry/status checks use the real coordinator injected clock and actual state',async()=>{
 const domain={lane:'local' as const,workspaceId:'w',cwd:'/w',device:'1',inode:'2',permissionRevision:1,bootId:'b'};
 const makeOwner=(f:Awaited<ReturnType<typeof setup>>)=>createAssistantThreadTargets({profileId:'p',goalCoordinator:f.coordinator,read:async threadId=>({threadId,title:'Owned',profileId:'p',workspaceId:'w',revision:1,deleted:false,goal:await f.store.load(threadId)}),assertCurrent:()=>{}});
 const f=await setup(),owner=makeOwner(f),target=await owner.prepare('t',domain);
 expect(target.goalBinding?.validUntil).toBe(600100);await owner.validate(target,domain);expect(()=>owner.assertCurrent(target)).not.toThrow();
 await owner.confirmGoalConsent!(target,{requestDigest:'a'.repeat(64),instruction:'Work',checked:true});f.setClock(600101);
 await expect(owner.validate(target,domain)).rejects.toThrow('goal_consent_stale');expect(()=>owner.assertCurrent(target)).toThrow('goal_consent_stale');await expect(owner.confirmGoalConsent!(target,{requestDigest:'a'.repeat(64),instruction:'Work',checked:true})).rejects.toThrow('goal_consent_stale');
 const g=await setup(),other=makeOwner(g),active=await other.prepare('t',domain);await g.coordinator.pauseGoal({threadId:'t'});
 await expect(other.validate(active,domain)).rejects.toThrow();expect(()=>other.assertCurrent(active)).toThrow();await expect(other.confirmGoalConsent!(active,{requestDigest:'a'.repeat(64),instruction:'Work',checked:true})).rejects.toThrow();
 const h=await setup(),emptyOwner=makeOwner(h),empty=await emptyOwner.prepare('empty',domain);await emptyOwner.validate(empty,domain);expect(()=>emptyOwner.assertCurrent(empty)).not.toThrow();h.setClock(600101);
 await expect(emptyOwner.validate(empty,domain)).rejects.toThrow('goal_consent_stale');expect(()=>emptyOwner.assertCurrent(empty)).toThrow('goal_consent_stale');
});
