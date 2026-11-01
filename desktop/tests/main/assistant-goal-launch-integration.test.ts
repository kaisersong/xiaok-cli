import {it,expect} from 'vitest';
import {LoopStore} from '../../electron/loop-store.js';
import {SqliteGoalStore} from '../../electron/goal-store-sqlite.js';
import {DesktopGoalCoordinator} from '../../electron/desktop-goal-coordinator.js';
import {createAssistantDesktopAdmission} from '../../electron/assistant-desktop-admission.js';
import {createAssistantThreadTargets} from '../../electron/assistant-launch-thread-target.js';
import {AssistantLaunchService} from '../../electron/assistant-launch-service.js';
import type {TaskSnapshot,TaskCreateInput} from '../../../src/runtime/task-host/types.js';
it('runs stored quote -> second checkbox -> exact original Goal scope -> reservation -> real start guard',async()=>{
 const loop=new LoopStore(':memory:'),store=new SqliteGoalStore(':memory:');let seq=0,commits=0,starts=0;
 const snapshots=new Map<string,TaskSnapshot>(),reservations=new WeakMap<object,any>();
 const domain={lane:'local' as const,workspaceId:'w',cwd:'/w',device:'1',inode:'2',permissionRevision:1,bootId:'b'};
 let adapter:ReturnType<typeof createAssistantDesktopAdmission>;
 const host={reserveAssistantTaskIdentity(binding:any){const r={taskId:`reserved_${++seq}`,reservationId:'r'};reservations.set(r,binding);return r;},
  async prepareTask(input:TaskCreateInput){const reservation=adapter?.reservationFor(input);const taskId=reservation?.taskId??`ordinary_${++seq}`;snapshots.set(taskId,{taskId,sessionId:taskId,status:'understanding',prompt:input.prompt,materials:[],events:[],context:input.context,executionScope:input.executionScope,assistantBinding:reservation?reservations.get(reservation):undefined,createdAt:100,updatedAt:100});return {taskId};},
  async startTask(taskId:string){const snapshot=snapshots.get(taskId)!;if(snapshot.assistantBinding){adapter.assertExecutionWorkspace(snapshot);adapter.commitStart(snapshot);commits++;}snapshot.status='running';starts++;},
  async cancelTask(taskId:string){const snapshot=snapshots.get(taskId);if(snapshot)snapshot.status='cancelled';},async inspectTask(taskId:string){return snapshots.get(taskId);}};
 const coordinator=new DesktopGoalCoordinator({store,taskHost:host,instanceId:'desktop',now:()=>100});
 adapter=createAssistantDesktopAdmission({host:host as any,ready:async()=>{},domain:()=>domain,formalCreate:(input,authority)=>authority?coordinator.admitAssistantUserTask(input,authority):coordinator.admitUserTask(input),assertGoalScope:(scope,binding)=>coordinator.assertAssistantGoalScope(scope,binding),assertGoalExecution:(scope,binding)=>coordinator.assertAssistantGoalExecution(scope,binding)});
 try{
 const created=await coordinator.createGoal({threadId:'local-owned',objective:'Actual objective',completionCriterion:'Actual completion',expectedEvidenceKinds:['answer'],turnLimit:3});
 await coordinator.setUserQueuePending({threadId:'local-owned',pending:true});await coordinator.setUserQueuePending({threadId:'local-owned',pending:false});
 const targets=createAssistantThreadTargets({profileId:'p',goalCoordinator:coordinator,read:async threadId=>({threadId,title:'Owned',profileId:'p',workspaceId:'w',revision:1,deleted:false,goal:(await store.load(threadId))}),assertCurrent:()=>{}});
 const source=()=>({profileId:'default-personal-assistant' as const,runId:'run',publishedAt:100,sourceVector:'a'.repeat(64),recommendations:[{title:'Review',reasonCode:'review',evidenceRefs:[{kind:'task_snapshot',id:'source'}],action:{kind:'review' as const,reason:'Review evidence',nextStep:'Read',instruction:'Review actual work'}}],isCurrent:()=>true});
 const proposal=loop.projectAssistantActions(source(),100)[0]!;
 const service=new AssistantLaunchService({store:loop,port:adapter.port,threadTargets:targets,readSource:async()=>source(),isSourceLaunchable:()=>true,now:()=>100});
 const draft=await service.prepare({proposalId:proposal.id,expectedRevision:1,existingThreadId:'local-owned',requestSource:'user'});
 expect(draft.threadTarget?.goalBinding?.state.goalId).toBe(created.goal.state.goalId);
 const input={draftId:draft.id,instruction:draft.instruction,requestSource:'user' as const};
 await expect(service.confirm(input)).rejects.toThrow('explicit_consent');expect(starts).toBe(0);
 const op=await service.confirm({...input,goalConsentChecked:true});expect(op.state).toBe('attached');expect(commits).toBe(1);expect(starts).toBe(1);
 expect(store.getTaskBinding(op.taskId!)?.goalId).toBe(created.goal.state.goalId);
 await service.confirm({...input,goalConsentChecked:true});expect(starts).toBe(1);
 const snapshot=snapshots.get(op.taskId!)!;snapshot.status='completed';snapshot.events=[{type:'task_terminal',status:'completed'}];snapshot.usage={inputTokens:2,outputTokens:3,known:true};
 await coordinator.handlePersistedTaskEvent({taskId:snapshot.taskId,eventIndex:0,event:snapshot.events[0]!,snapshot});
 expect((await store.load('local-owned'))?.state).toMatchObject({goalId:created.goal.state.goalId,turnsUsed:1,tokensUsed:5});
 }finally{coordinator.disarmAll();loop.close();store.close();}
});
