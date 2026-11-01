import {it,expect} from 'vitest';import {LoopStore} from '../../electron/loop-store.js';
import {AssistantPeriodicPolicyService} from '../../electron/assistant-periodic-policy.js';
function completedRun(store:LoopStore){
 const now=Date.now();store.ensureBuiltInLoops(now);store.setLoopStatus('personal-assistant-transaction-check','active',now);
 const begin=store.beginLoopRun('personal-assistant-transaction-check',{kind:'manual',source:'digest-fixture'},now,60000,{requestSource:'scheduler'});if(begin.status!=='started')throw Error('fixture run');
 store.recordAssistantSourceRun({runId:begin.run.id,profileId:'default-personal-assistant',kind:'morning',now,coverage:['task_snapshots','kswarm_projects','timed_actions','meeting_metadata','knowledge_source_metadata'].map(sourceId=>({sourceId,status:'checked',requestedWindow:{from:now-1000,to:now},recordCount:0,includedCount:0,checkedAt:now,freshUntil:now+60000})) as any});
 store.finishAssistantSourceAnalysis(begin.run.id,'complete');store.finishAssistantLoopRunSuccess(begin.run.id,[],now,'test');return begin.run.id;
}
const start=Date.parse('2026-11-02T01:00:00Z');
function fixture(){const store=new LoopStore(':memory:');let now=start;const service=new AssistantPeriodicPolicyService({store,now:()=>now,timeZone:'Asia/Shanghai',qualification:()=>({qualityDigest:'a'.repeat(64),analysisContract:'qualified-provider-test-v1'})});return {store,service,time:(value:number)=>{now=value;}};}
const revision=(work:string)=>({workItemIdentity:work.repeat(64),notifiableRevision:'b'.repeat(64)});
it('defaults off and rejects model-controlled qualification and nonuser settings',()=>{const f=fixture();try{
 expect(f.service.status().enabled).toBe(false);
 expect(()=>f.service.configure({enabled:true,notificationsEnabled:true,intervalMinutes:240,expectedRevision:0,requestSource:'agent'})).toThrow('user_only');
 const closed=new AssistantPeriodicPolicyService({store:f.store,timeZone:'UTC'});
 expect(()=>closed.configure({enabled:true,notificationsEnabled:true,intervalMinutes:240,expectedRevision:0,requestSource:'user'})).toThrow('quality_unverified');
}finally{f.store.close();}});
it('claims only new structured revisions and reserves rolling notification budget atomically',()=>{const f=fixture();try{
 f.service.configure({enabled:true,notificationsEnabled:true,intervalMinutes:240,expectedRevision:0,requestSource:'user'});
 const first=f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('c')],isCurrent:()=>true,requestSource:'scheduler'});
 expect(first.status).toBe('prepared');
 expect(f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('c')],isCurrent:()=>true,requestSource:'scheduler'}).status).toBe('no_difference');
 expect(f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('d')],isCurrent:()=>true,requestSource:'scheduler'}).status).toBe('budget_exhausted');
 f.time(start+4*3600000);expect(f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('d')],isCurrent:()=>true,requestSource:'scheduler'}).status).toBe('prepared');
 f.time(start+8*3600000);expect(f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('e')],isCurrent:()=>true,requestSource:'scheduler'}).status).toBe('budget_exhausted');
 f.time(start-86400000);expect(f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('f')],isCurrent:()=>true,requestSource:'scheduler'}).status).toBe('budget_exhausted');
}finally{f.store.close();}});
it('rolls back a digest if source grant changes at the transaction tail',()=>{const f=fixture();try{
 f.service.configure({enabled:true,notificationsEnabled:true,intervalMinutes:240,expectedRevision:0,requestSource:'user'});let calls=0;
 expect(()=>f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('c')],isCurrent:()=>++calls<2,requestSource:'scheduler'})).toThrow('source_stale');
 expect(f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('c')],isCurrent:()=>true,requestSource:'scheduler'}).status).toBe('prepared');
}finally{f.store.close();}});
it('never resends a sent digest after an unknown RPC outcome; later lookup can confirm the original receipt',async()=>{
 const store=new LoopStore(':memory:');let sends=0,lookupKnown=false;try{
  const service=new AssistantPeriodicPolicyService({store,timeZone:'UTC',now:()=>start,qualification:()=>({qualityDigest:'a'.repeat(64),analysisContract:'test'}),delivery:{available:async()=>true,send:async()=>{sends++;throw Error('response lost');},lookup:async id=>lookupKnown?{deliveryId:id,status:'shown'}:undefined}});
  service.configure({enabled:true,notificationsEnabled:true,intervalMinutes:240,expectedRevision:0,requestSource:'user'});
  const prepared=service.prepareDigest({runId:completedRun(store),revisions:[revision('a')],isCurrent:()=>true,requestSource:'scheduler'});if(prepared.status!=='prepared')throw Error('fixture');
  expect((await service.dispatchDigest(prepared.envelope,{requestSource:'scheduler'})).status).toBe('unknown');
  await service.dispatchDigest(prepared.envelope,{requestSource:'scheduler'});expect(sends).toBe(1);
  lookupKnown=true;expect((await service.dispatchDigest(prepared.envelope,{requestSource:'scheduler'})).status).toBe('shown');expect(sends).toBe(1);
 }finally{store.close();}
});
it('does not let a concurrent unknown lookup overwrite the original known notification acknowledgement',async()=>{
 const store=new LoopStore(':memory:');let sends=0,release!:()=>void;try{
  const pending=new Promise<void>(resolve=>{release=resolve;});let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
  const service=new AssistantPeriodicPolicyService({store,timeZone:'UTC',now:()=>start,qualification:()=>({qualityDigest:'a'.repeat(64),analysisContract:'test'}),delivery:{available:async()=>true,send:async envelope=>{sends++;started();await pending;return {deliveryId:envelope.deliveryId,status:'shown'};},lookup:async id=>({deliveryId:id,status:'unknown'})}});
  service.configure({enabled:true,notificationsEnabled:true,intervalMinutes:240,expectedRevision:0,requestSource:'user'});
  const prepared=service.prepareDigest({runId:completedRun(store),revisions:[revision('a')],isCurrent:()=>true,requestSource:'scheduler'});if(prepared.status!=='prepared')throw Error('fixture');
  const first=service.dispatchDigest(prepared.envelope,{requestSource:'scheduler'});await entered;
  await service.dispatchDigest(prepared.envelope,{requestSource:'scheduler'});release();expect((await first).status).toBe('shown');expect(sends).toBe(1);
 }finally{release?.();store.close();}
});

it('rejects nonexistent source before reserving a real notification revision',()=>{const f=fixture();try{f.service.configure({enabled:true,notificationsEnabled:true,intervalMinutes:240,expectedRevision:0,requestSource:'user'});expect(()=>f.service.prepareDigest({runId:'fabricated',revisions:[revision('a')],isCurrent:()=>true,requestSource:'scheduler'})).toThrow('source_unknown');expect(f.service.prepareDigest({runId:completedRun(f.store),revisions:[revision('a')],isCurrent:()=>true,requestSource:'scheduler'}).status).toBe('prepared');}finally{f.store.close();}});
