import {it,expect,vi} from 'vitest';import {LoopStore} from '../../electron/loop-store.js';import {TimedActionStore} from '../../electron/timed-action-store.js';import {TimedActionService} from '../../electron/timed-action-service.js';
import {AssistantPeriodicPolicyService} from '../../electron/assistant-periodic-policy.js';import {createLoopExecutionAdapter} from '../../electron/loop-execution-adapter.js';
it('uses the existing scheduler for an opted-in qualified interval and pauses it with the global gate',()=>{
 const store=new LoopStore(':memory:'),timedStore=new TimedActionStore(':memory:');let enabled=true;
 try{
  const now=Date.parse('2026-11-02T01:00:00Z');store.ensureBuiltInLoops(now);store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1,2,3,4,5],quietHours:{start:'22:00',end:'08:00'},dataScopes:['tasks'],createdAt:now,updatedAt:now});
  const timed=new TimedActionService(timedStore,{now:()=>now}),policy=new AssistantPeriodicPolicyService({store,timeZone:'UTC',timedActionService:timed,globalEnabled:()=>enabled,qualification:()=>({qualityDigest:'a'.repeat(64),analysisContract:'qualified-provider'}),now:()=>now});
  policy.syncSchedule({requestSource:'scheduler'});expect(timed.getActions()).toHaveLength(0);
  policy.configure({enabled:true,notificationsEnabled:false,intervalMinutes:240,expectedRevision:0,requestSource:'user'});
  expect(timed.getActions()).toMatchObject([{id:'assistant:default-personal-assistant:check',status:'active',trigger:{kind:'interval',intervalMinutes:240},ownerKind:'assistant'}]);
  enabled=false;policy.syncSchedule({requestSource:'scheduler'});expect(timed.getActions()[0]?.status).toBe('paused');
 }finally{store.close();timedStore.close();}
});
it('never routes the new check loop to the unrestricted generic runner',async()=>{
 const generic=vi.fn(),periodic=vi.fn(async()=>({status:'skipped' as const,reason:'paused' as const})),assistant=vi.fn();
 const adapter=createLoopExecutionAdapter({genericRunner:{runLoopNow:generic},assistantRuntime:{runLoopNow:assistant},periodicRuntime:{runLoopNow:periodic}});
 await adapter.runLoopNow('personal-assistant-transaction-check',undefined,undefined,{requestSource:'user'});expect(periodic).toHaveBeenCalledOnce();expect(generic).not.toHaveBeenCalled();
 const closed=createLoopExecutionAdapter({genericRunner:{runLoopNow:generic},assistantRuntime:{runLoopNow:assistant}});expect(await closed.runLoopNow('personal-assistant-transaction-check',undefined,undefined,{requestSource:'user'})).toMatchObject({status:'skipped'});expect(generic).not.toHaveBeenCalled();
});
it('the generic scanner sibling cannot claim a transaction check succeeded without the qualified runtime',async()=>{
 const {createLoopRunner}=await import('../../electron/loop-executor.js');const {CompletionEvidenceStore}=await import('../../electron/completion-evidence-store.js');
 const store=new LoopStore(':memory:'),evidence=new CompletionEvidenceStore(':memory:');try{
  store.ensureBuiltInLoops(1);store.setLoopStatus('personal-assistant-transaction-check','active',1);const scan=vi.fn();
  const runner=createLoopRunner({loopStore:store,evidenceStore:evidence,scanner:{scan},now:()=>2});
  expect(await runner.runLoopNow('personal-assistant-transaction-check',undefined,undefined,{requestSource:'user'})).toMatchObject({status:'skipped'});
  expect(scan).not.toHaveBeenCalled();expect(store.listLoopRuns('personal-assistant-transaction-check',20)).toHaveLength(0);
 }finally{store.close();evidence.close();}
});
