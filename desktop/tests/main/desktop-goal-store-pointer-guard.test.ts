import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {SqliteGoalStore} from '../../electron/goal-store-sqlite.js';
import {DesktopGoalCoordinator} from '../../electron/desktop-goal-coordinator.js';
import {DatabaseSync} from 'node:sqlite';
import {createGoalState} from '../../../src/runtime/goal/reducer.js';
async function fixture(run:(f:{store:SqliteGoalStore;peer:SqliteGoalStore;coordinator:DesktopGoalCoordinator;started:string[];path:string})=>Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'goal-pointer-guard-')),path=join(root,'goals.sqlite');
 const store=new SqliteGoalStore(path),peer=new SqliteGoalStore(path);const started:string[]=[];let seq=0;
 const coordinator=new DesktopGoalCoordinator({store,instanceId:'main',now:()=>100,taskHost:{prepareTask:async()=>({taskId:`task_${++seq}`}),startTask:async id=>{started.push(id);},cancelTask:async()=>{}}});
 try{await run({store,peer,coordinator,started,path});}finally{coordinator.disarmAll();peer.close();store.close();rmSync(root,{recursive:true,force:true});}
}
const state=(threadId:string)=>createGoalState({sessionId:threadId,objective:'Sibling-owned Goal',expectedEvidenceKinds:['answer'],turnLimit:3,now:100});
it('rejects noGoal guard after a different store commits a real current Goal without coordinator generation',async()=>fixture(async f=>{
 const token=await f.coordinator.prepareAssistantNoGoalGuard({threadId:'t',requestSource:'user'});expect(()=>f.coordinator.assertAssistantNoGoalGuard(token)).not.toThrow();
 await f.peer.commit({sessionId:'t',expectedRevision:null,next:state('t'),events:[],turns:[],evidence:[]});
 expect(()=>f.coordinator.assertAssistantNoGoalGuard(token)).toThrow('goal_consent_stale');
}));
it('rejects a corrupted current pointer even when the historical Goal stays unchanged',async()=>fixture(async f=>{
 const created=await f.coordinator.createGoal({threadId:'t',objective:'Original',expectedEvidenceKinds:['answer'],turnLimit:3});
 await f.coordinator.setUserQueuePending({threadId:'t',pending:true});await f.coordinator.setUserQueuePending({threadId:'t',pending:false});
 const q=await f.coordinator.prepareAssistantGoalConsent({threadId:'t',requestSource:'user'});
 await f.coordinator.confirmAssistantGoalConsent({consentId:q.consentId,requestDigest:'a'.repeat(64),instruction:'Work',checked:true,requestSource:'user'});
 const sibling=state('sibling');await f.peer.commit({sessionId:'sibling',expectedRevision:null,next:sibling,events:[],turns:[],evidence:[]});
 // Fault injection: public commit correctly forbids replacing active pointer. Simulate out-of-band pointer corruption.
 const fault=new DatabaseSync(f.path);try{fault.prepare('update goal_sessions set current_goal_id=? where session_id=?').run(sibling.goalId,'t');}finally{fault.close();}
 expect(f.store.loadGoalById(created.goal.state.goalId)?.state).toEqual(q.state);
 expect(()=>f.coordinator.assertAssistantGoalConsentQuote(q)).toThrow();
 await expect(f.coordinator.admitAssistantUserTask({prompt:'Work',materials:[],permissionMode:'default',context:{threadId:'t'}},{consentId:q.consentId,requestDigest:'a'.repeat(64),requestSource:'user',guard:()=>{}})).rejects.toThrow();expect(f.started).toEqual([]);
}));
it('the original store current-thread read is synchronous and sees peer commits',async()=>fixture(async f=>{
 expect(f.store.loadGoalStateByThread('missing')).toBeNull();const next=state('t');await f.peer.commit({sessionId:'t',expectedRevision:null,next,events:[],turns:[],evidence:[]});
 const actual=f.store.loadGoalStateByThread('t');expect(actual).not.toBeInstanceOf(Promise);expect(actual).toEqual(next);
}));

it('never treats dangling or malformed current pointer data as absence',async()=>fixture(async f=>{
 const token=await f.coordinator.prepareAssistantNoGoalGuard({threadId:'t',requestSource:'user'});
 const next=state('t');await f.peer.commit({sessionId:'t',expectedRevision:null,next,events:[],turns:[],evidence:[]});
 const fault=new DatabaseSync(f.path);try{
  fault.prepare('update goals set state_json=? where goal_id=?').run('{broken',next.goalId);
  expect(()=>f.store.loadGoalStateByThread('t')).toThrow();expect(()=>f.coordinator.assertAssistantNoGoalGuard(token)).toThrow();
  fault.prepare('update goal_sessions set current_goal_id=? where session_id=?').run('missing-goal','t');
  expect(()=>f.store.loadGoalStateByThread('t')).toThrow();expect(()=>f.coordinator.assertAssistantNoGoalGuard(token)).toThrow();
 }finally{fault.close();}
}));
it('consumed consent and actual execution guard resolve the current thread pointer, not historical rows',async()=>fixture(async f=>{
 await f.coordinator.createGoal({threadId:'t',objective:'Original',expectedEvidenceKinds:['answer'],turnLimit:3});
 await f.coordinator.setUserQueuePending({threadId:'t',pending:true});await f.coordinator.setUserQueuePending({threadId:'t',pending:false});
 const q=await f.coordinator.prepareAssistantGoalConsent({threadId:'t',requestSource:'user'}),requestDigest='a'.repeat(64);
 await f.coordinator.confirmAssistantGoalConsent({consentId:q.consentId,requestDigest,instruction:'Work',checked:true,requestSource:'user'});
 const result=await f.coordinator.admitAssistantUserTask({prompt:'Work',materials:[],permissionMode:'default',context:{threadId:'t'}},{consentId:q.consentId,requestDigest,requestSource:'user',guard:()=>{}});
 const task=f.store.getTaskBinding(result.taskId)!;
 const scope={kind:'goal_turn' as const,origin:task.origin,threadId:task.threadId,goalId:task.goalId,epoch:task.epoch,goalTurnId:task.goalTurnId};
 const binding={consentId:q.consentId,requestDigest,threadId:'t',taskId:result.taskId};expect(()=>f.coordinator.assertAssistantGoalExecution(scope,binding)).not.toThrow();
 const sibling=state('sibling');await f.peer.commit({sessionId:'sibling',expectedRevision:null,next:sibling,events:[],turns:[],evidence:[]});
 const fault=new DatabaseSync(f.path);try{fault.prepare('update goal_sessions set current_goal_id=? where session_id=?').run(sibling.goalId,'t');}finally{fault.close();}
 expect(()=>f.coordinator.assertAssistantGoalConsentQuote(q,true)).toThrow();expect(()=>f.coordinator.assertAssistantGoalExecution(scope,binding)).toThrow();
}));
