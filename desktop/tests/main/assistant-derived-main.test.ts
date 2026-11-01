import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createAssistantDerivedMainPorts} from '../../electron/assistant-derived-main.js';
import {LoopStore} from '../../electron/loop-store.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {createLoopDatabaseOwnerGroup,openLoopDatabase} from '../../electron/loop-database-owner.js';
import {AssistantCalendarSource} from '../../electron/assistant-calendar-source.js';
import {createAssistantRuntime} from '../../electron/assistant-runtime.js';
import {AssistantActionService} from '../../electron/assistant-action-service.js';
import {ASSISTANT_MORNING_LOOP_ID,ASSISTANT_EVENING_LOOP_ID,DEFAULT_PERSONAL_ASSISTANT_ID} from '../../electron/assistant-types.js';
import {ASSISTANT_SOURCE_IDS} from '../../shared/assistant-coverage-contract.js';
import type {MemoryRecord} from '../../../src/ai/memory/store.js';
function fixture(){
 const owner=createLoopDatabaseOwnerGroup([':memory:']),source=owner.sources[0],lease=openLoopDatabase(source),store=new LoopStore(source),evidence=new CompletionEvidenceStore(source),db=lease.database;
 const now=Date.parse('2026-11-01T00:00:00Z');store.ensureBuiltInLoops(now);for(const id of [ASSISTANT_MORNING_LOOP_ID,ASSISTANT_EVENING_LOOP_ID])store.setLoopStatus(id,'active',now);
 const profile=store.ensureAssistantProfile({id:DEFAULT_PERSONAL_ASSISTANT_ID,status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:now,updatedAt:now});
 const memories=new Map<string,MemoryRecord>(),memoryStore={save:async(r:MemoryRecord)=>{memories.set(r.id,r);},listRelevant:async()=>[...memories.values()],getById:(id:string)=>memories.get(id)};
 const calendar=new AssistantCalendarSource({store,connect:async()=>({binary:'/verified/yzj-cli',accountId:'synthetic-account'}),read:async grant=>({accountId:grant.accountId,grantEpoch:grant.epoch,records:[{id:'calendar-record',title:'Design review',startDate:now+3600000,endDate:now+7200000,timeZone:'UTC'}],completeness:'unknown'})});
 const ports=createAssistantDerivedMainPorts({store,evidenceStore:evidence,publication:{} as never,calendarSource:calendar,memoryStore:()=>memoryStore,dataRoot:'/app-data',cwd:()=>'/work',projectCwd:()=>undefined});
 const coverage=ASSISTANT_SOURCE_IDS.map(sourceId=>({sourceId,status:'checked' as const,recordCount:0,includedCount:0,checkedAt:now,freshUntil:now+10000,requestedWindow:{from:now-86400000,to:now}}));
 const run=(inspect?:(data:any)=>void)=>createAssistantRuntime({loopStore:store,evidenceStore:evidence,derived:ports.derived,now:()=>now,collect:async input=>{await calendar.collect({now,requestSource:'scheduler'});return {current:{items:[],coverage}};},llmPort:{complete:async input=>{const data=JSON.parse(input.userMessage);inspect?.(data);const event=data.p2Context.calendar.events[0];return {text:JSON.stringify({schemaVersion:2,recommendations:[{title:'Prepare review',reasonCode:'preparation',evidenceRefs:[{kind:'calendar_observation',id:event.id}],action:{kind:'prepare',reason:'Preparation may help',nextStep:'Read notes',instruction:'Prepare notes without changing the calendar.'}}]})};}}}).runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'});
 return {store,evidence,db,now,profile,memories,calendar,ports,run,close:()=>{evidence.close();store.close();lease.close();owner.close();}};
}
it('uses the exact main composition for durable P2 display/proposals and withdraws every actual reader after revoke',async()=>{
 const f=fixture();try{
  expect(f.ports.calendarMemory.status()).toEqual({enabled:false,revision:0});await f.calendar.enable({requestSource:'user'});
  expect((await f.run()).status).toBe('success');
  const service=new AssistantActionService({store:f.store,profileId:DEFAULT_PERSONAL_ASSISTANT_ID,readSource:source=>f.ports.contextReader.readMorningDisplaySource(source),now:()=>f.now});
  const proposal=(await service.list({requestSource:'user'})).proposals[0];expect(proposal.instruction).toBe('Prepare notes without changing the calendar.');expect(proposal.startAvailability).toBe('unavailable');expect(await f.ports.contextReader.readMorningActionSource()).toBeUndefined();
  expect((await service.snooze({proposalId:proposal.id,expectedRevision:proposal.revision,snoozeUntil:f.now+60000,requestSource:'user'})).status).toBe('updated');
  const run=f.store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0];expect(f.store.getLoopRun(run.id)).toBeDefined();expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toHaveLength(1);
  f.calendar.disable({requestSource:'user'});expect(f.store.getLoopRun(run.id)).toBeUndefined();expect(f.store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0]).toMatchObject({id:run.id,status:'success',evidenceIds:[],message:'assistant_source_unavailable'});expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toEqual([]);expect(f.evidence.listCompletionRecords({ownerKind:'loop_run',ownerId:run.id})).toEqual([]);expect((await service.list({requestSource:'user'})).proposals).toEqual([]);
 }finally{f.close();}
});
it('uses accepted original publication/evidence raw fences for memory instead of a permissive callback',async()=>{
 const f=fixture();try{
  const begin=f.store.beginLoopRun(ASSISTANT_EVENING_LOOP_ID,{kind:'manual'},f.now-100,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('fixture');
  const input={kind:'memory' as const,title:'Preparation preference',content:'Use concise notes',scope:'global' as const,confidence:1,evidenceRefs:[{kind:'task',id:'task'}],dedupeKey:'preference'};
  const [candidate]=f.store.stageAssistantCandidates(begin.run.id,[input],f.now-99);
  f.evidence.upsertExpectation({ownerKind:'loop_run',ownerId:begin.run.id,expectedKinds:['log_diagnostic'],source:'scheduler_executor_contract',confidence:'explicit',now:f.now-98});
  f.evidence.insertEvidence({ownerKind:'loop_run',ownerId:begin.run.id,kind:'log_diagnostic',summary:'Preference confirmed',metadata:{assistantKind:'evening',output:{summary:'Preference confirmed',candidates:[input]},findings:['assistant_evening_completed']},now:f.now-98});
  const receipt=f.evidence.completeOwnerWithEvidence({ownerKind:'loop_run',ownerId:begin.run.id,now:f.now-98});f.store.finishAssistantLoopRunSuccess(begin.run.id,receipt.evidenceIds,f.now-98,'Preference confirmed');
  f.db.prepare("UPDATE assistant_candidates SET status='accepted',target_kind='memory',target_id='memory-one',accepted_target_ref='memory://layered/memory-one',decided_at=? WHERE id=?").run(f.now-97,candidate.id);
  f.memories.set('memory-one',{id:'memory-one',title:input.title,summary:input.content,scope:'global',tags:['assistant-candidate'],type:'user',updatedAt:f.now-97,provenance:{kind:'assistant_candidate',candidateId:candidate.id,loopRunId:begin.run.id,backend:'layered',evidenceRefs:input.evidenceRefs}});
  f.ports.calendarMemory.configure({enabled:true,expectedRevision:0,requestSource:'user'});await f.calendar.enable({requestSource:'user'});
  expect((await f.run(data=>expect(data.p2Context.personalization.memories[0]?.summary).toBe(input.content))).status).toBe('success');
  const run=f.store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0],lineage=f.store.readAssistantDerivedLineage(run.id)!;expect(lineage.memory?.records[0]).toMatchObject({id:'memory-one',candidateId:candidate.id});expect(lineage.memory?.ownerId).toBe('desktop-user:'+createHash('sha256').update('/app-data').digest('hex'));
  f.ports.calendarMemory.configure({enabled:false,expectedRevision:1,requestSource:'user'});expect(f.store.getLoopRun(run.id)).toBeUndefined();expect(await f.ports.contextReader.readMorningDisplaySource()).toBeUndefined();
  expect(()=>f.ports.calendarMemory.configure({enabled:true,expectedRevision:2,requestSource:'scheduler'} as any)).toThrow();
  expect(()=>f.ports.calendarMemory.configure({enabled:true,expectedRevision:2,requestSource:'user',ownerId:'forged'} as any)).toThrow();
 }finally{f.close();}
});

it('does not silently add calendar or memory input to the existing evening native flow',async()=>{
 const f=fixture();try{
  await f.calendar.enable({requestSource:'user'});await f.calendar.collect({now:f.now,requestSource:'user'});
  const coverage=ASSISTANT_SOURCE_IDS.map(sourceId=>({sourceId,status:'checked' as const,recordCount:0,includedCount:0,checkedAt:f.now,freshUntil:f.now+1000,requestedWindow:{from:f.now-86400000,to:f.now}}));
  const runtime=createAssistantRuntime({loopStore:f.store,evidenceStore:f.evidence,derived:f.ports.derived,now:()=>f.now,collect:()=>({items:[],coverage}),llmPort:{complete:async input=>{const data=JSON.parse(input.userMessage);expect(data.p2Context.calendar).toEqual({status:'not_used',events:[]});expect(data.p2Context.personalization.memories).toEqual([]);return {text:JSON.stringify({summary:'Native reflection',candidates:[]})};}}});
  expect((await runtime.runLoopNow(ASSISTANT_EVENING_LOOP_ID,undefined,undefined,{requestSource:'user'})).status).toBe('success');
  const run=f.store.listLoopRuns(ASSISTANT_EVENING_LOOP_ID,1)[0];expect(f.store.readAssistantDerivedLineage(run.id)?.calendar).toBeUndefined();f.calendar.disable({requestSource:'user'});expect(f.store.getLoopRun(run.id)?.summary).toBe('Native reflection');
 }finally{f.close();}
});
