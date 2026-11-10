// @vitest-environment node
import {expect,it} from 'vitest';
import {LoopStore} from '../../electron/loop-store.js';

it('keeps real LoopStore memory consent off by default and requires a user CAS before any auxiliary recall',()=>{
 const store=new LoopStore(':memory:'),key={ownerId:'desktop-user:'+'a'.repeat(64),profileId:'default-personal-assistant'};
 try{
  expect(store.getAssistantCalendarMemorySettings(key)).toEqual({...key,enabled:false,revision:0});
  expect(()=>store.setAssistantCalendarMemorySettings({...key,enabled:true,expectedRevision:0,requestSource:'agent'})).toThrow('assistant_calendar_memory_user_only');
  expect(store.getAssistantCalendarMemorySettings(key).revision).toBe(0);
  expect(store.setAssistantCalendarMemorySettings({...key,enabled:true,expectedRevision:0,requestSource:'user'})).toEqual({...key,enabled:true,revision:1});
  expect(()=>store.setAssistantCalendarMemorySettings({...key,enabled:false,expectedRevision:0,requestSource:'user'})).toThrow('assistant_calendar_memory_conflict');
 }finally{store.close();}
});

it('keeps a real durable owner marker fail-closed when the original lineage is missing',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{await f.connect();expect((await f.run()).status).toBe('success');const run=f.store.listLoopRuns('personal-assistant-morning-briefing',1)[0]!;
  expect(f.store.isAssistantDerivedRunTracked(run.id)).toBe(true);expect(f.store.readAssistantDerivedLineage(run.id)?.calendar?.events).toHaveLength(1);expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toHaveLength(1);
  f.lease.database.prepare('DELETE FROM assistant_derived_lineage WHERE run_id=?').run(run.id);
  expect(f.store.getLoopRun(run.id)).toMatchObject({status:'success',message:'assistant_source_unavailable',evidenceIds:[]});expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toEqual([]);expect(await f.ports.contextReader.listMorningSuggestions()).toEqual([]);
 }finally{await f.close();}
});

it('uses the original user promotion and durable completion facts for opt-in memory, then withdraws every real reader on revoke',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{const accepted=await f.seedAccepted();await f.connect();expect(f.ports.confirmMemory(accepted.record)?.isCurrent()).toBe(true);expect(f.ports.calendarMemory.status()).toEqual({enabled:false,revision:0});
  f.ports.calendarMemory.configure({enabled:true,expectedRevision:0,requestSource:'user'});
  expect((await f.run(value=>{expect(value.p2Context.calendar.events).toHaveLength(1);expect(value.p2Context.personalization.memories).toMatchObject([{summary:'Use concise notes'}]);})).status).toBe('success');expect(f.recalls).toBe(1);
  const run=f.store.listLoopRuns('personal-assistant-morning-briefing',1)[0]!,lineage=f.store.readAssistantDerivedLineage(run.id)!;expect(lineage.memory?.records).toMatchObject([{id:accepted.record.id,candidateId:accepted.candidateId}]);expect((await f.ports.contextReader.listMorningSuggestions())[0]?.title).toBe('Read the notes');
  f.ports.calendarMemory.configure({enabled:false,expectedRevision:1,requestSource:'user'});expect(await f.ports.contextReader.listMorningSuggestions()).toEqual([]);expect(f.evidence.listCompletionRecords({ownerKind:'loop_run',ownerId:run.id})).toEqual([]);expect(f.store.getLoopRun(run.id)?.summary).toBeUndefined();expect(f.store.getLoopRun(accepted.runId)?.summary).toBe('Completed preference source');
 }finally{await f.close();}
});
it('does not recall private memory merely because calendar connection and a real accepted memory exist',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{await f.seedAccepted();await f.connect();expect((await f.run(value=>expect(value.p2Context.personalization).toEqual({kind:'data',status:'disabled',memories:[]}))).status).toBe('success');expect(f.recalls).toBe(0);}finally{await f.close();}
});
it('rejects forged provenance and a real accepted memory after original evidence is orphaned',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{const accepted=await f.seedAccepted();expect(f.ports.confirmMemory(accepted.record)).toBeDefined();expect(f.ports.confirmMemory({...accepted.record,summary:'Forged content'})).toBeUndefined();expect(f.ports.confirmMemory({...accepted.record,provenance:{...accepted.record.provenance!,candidateId:'not-confirmed'}})).toBeUndefined();f.evidence.markEvidenceOrphaned(accepted.evidenceIds[0]!,f.now);expect(f.ports.confirmMemory(accepted.record)).toBeUndefined();}finally{await f.close();}
});
it('cancels publication after memory consent changes during a real pending recall',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();let release!:()=>void,entered!:()=>void;const began=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 try{await f.seedAccepted();await f.connect();f.ports.calendarMemory.configure({enabled:true,expectedRevision:0,requestSource:'user'});f.holdRecall(async()=>{entered();await held;});const running=f.run(()=>{throw Error('late_llm_must_not_run');});await began;f.ports.calendarMemory.configure({enabled:false,expectedRevision:1,requestSource:'user'});release();expect((await running).status).toBe('failed');expect(await f.ports.contextReader.listMorningSuggestions()).toEqual([]);}finally{release?.();await f.close();}
});
it('rejects a late LLM result after the actual calendar epoch is revoked without deleting its durable history',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();let release!:()=>void,entered!:()=>void;const began=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 try{await f.connect();const running=f.run(async()=>{entered();await held;});await began;const run=f.store.listLoopRuns('personal-assistant-morning-briefing',1)[0]!;expect(f.store.isAssistantDerivedRunTracked(run.id)).toBe(true);f.calendar.disable({requestSource:'user'});release();expect((await running).status).toBe('failed');expect(f.store.readAssistantDerivedLineage(run.id)?.calendar?.epoch).toBe(1);expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toEqual([]);expect(f.store.getLoopRun(run.id)?.summary).toBeUndefined();}finally{release?.();await f.close();}
});
it('withdraws a previously displayed derived result when the actual accepted memory contents change',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{const accepted=await f.seedAccepted();await f.connect();f.ports.calendarMemory.configure({enabled:true,expectedRevision:0,requestSource:'user'});expect((await f.run()).status).toBe('success');expect(await f.ports.contextReader.listMorningSuggestions()).toHaveLength(1);await f.memory.save({...accepted.record,summary:'A different preference',updatedAt:f.now+1});expect(await f.ports.contextReader.listMorningSuggestions()).toEqual([]);const run=f.store.listLoopRuns('personal-assistant-morning-briefing',1)[0]!;expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toEqual([]);expect(f.store.getLoopRun(run.id)?.summary).toBeUndefined();}finally{await f.close();}
});
it('withdraws calendar-derived output when the original observed event revision changes',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{await f.connect();expect((await f.run()).status).toBe('success');expect(await f.ports.contextReader.listMorningSuggestions()).toHaveLength(1);f.changeTitle('Changed by the source');await f.calendar.collect({now:f.now,requestSource:'user'});expect(await f.ports.contextReader.listMorningSuggestions()).toEqual([]);}finally{await f.close();}
});
it('retains the original protected publication branch without injecting unbound calendar or memory input',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{await f.connect();f.ports.calendarMemory.configure({enabled:true,expectedRevision:0,requestSource:'user'});const definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe:{kind:'artifact-content' as const,checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes' as const}]}}]};
  f.store.saveLoopPublicationConfiguration({loopId:'personal-assistant-morning-briefing',expectedRevision:null,requestSource:'user',now:f.now,configuration:{version:1,contract:{kind:'assistant',assistantKind:'morning',objective:'Original',completionCriterion:'Original'},verificationDefinitions:{run:definition,stages:{}}}});
  expect((await f.run(snapshot=>expect(snapshot).not.toHaveProperty('p2Context'))).status).toBe('publication_pending');expect(f.recalls).toBe(0);const run=f.store.listLoopRuns('personal-assistant-morning-briefing',1)[0]!;expect(f.store.isAssistantDerivedRunTracked(run.id)).toBe(false);expect(f.store.getLoopRunPublicationBasis(run.id)).toBeDefined();expect(f.store.listLoopPublicationCandidates(run.id).length).toBeGreaterThan(0);
 }finally{await f.close();}
});
it('rechecks the actual owned project mapping rather than only the record cwd after an await',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{const accepted=await f.seedAccepted(true),confirmation=f.ports.confirmMemory(accepted.record);expect(confirmation?.isCurrent()).toBe(true);f.moveProject(undefined);expect(confirmation?.isCurrent()).toBe(false);expect(f.ports.confirmMemory(accepted.record)).toBeUndefined();}finally{await f.close();}
});
it('uses captured original memory SDK methods instead of later public method replacements',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),f=assistantDerivedFixture();
 try{await f.seedAccepted();await f.connect();f.ports.calendarMemory.configure({enabled:true,expectedRevision:0,requestSource:'user'});let calls=0;f.memory.listRelevant=async()=>{calls++;throw Error('public_recall_trap');};f.memory.getById=()=>{calls++;throw Error('public_read_trap');};expect((await f.run(value=>expect(value.p2Context.personalization.memories).toHaveLength(1))).status).toBe('success');expect(calls).toBe(0);expect(f.recalls).toBe(1);}finally{await f.close();}
});
it('keeps the original internal evening flow independent of unused calendar and memory grants',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),{createAssistantRuntime}=await import('../../electron/assistant-runtime.js'),f=assistantDerivedFixture();
 try{await f.connect();f.ports.calendarMemory.configure({enabled:true,expectedRevision:0,requestSource:'user'});const runtime=createAssistantRuntime({loopStore:f.store,evidenceStore:f.evidence,derived:f.ports.derived,now:()=>f.now,collect:()=>({items:[]}),llmPort:{complete:async input=>{const value=JSON.parse(input.userMessage);expect(value.p2Context.calendar).toMatchObject({status:'not_used',events:[]});expect(value.p2Context.personalization.memories).toEqual([]);f.calendar.disable({requestSource:'user'});f.ports.calendarMemory.configure({enabled:false,expectedRevision:1,requestSource:'user'});return {text:JSON.stringify({summary:'Original internal reflection',candidates:[]})};}}});
  expect((await runtime.runLoopNow('personal-assistant-evening-reflection',undefined,undefined,{requestSource:'user'})).status).toBe('success');const run=f.store.listLoopRuns('personal-assistant-evening-reflection',1)[0]!;expect(f.store.readAssistantDerivedLineage(run.id)).not.toHaveProperty('calendar');expect(f.store.readAssistantDerivedLineage(run.id)).not.toHaveProperty('memory');expect(f.store.getLoopRun(run.id)?.summary).toBe('Original internal reflection');expect(f.recalls).toBe(0);
 }finally{await f.close();}
});
it('preserves the protected morning pipeline after an actual internal-only derived evening result',async()=>{
 const {assistantDerivedFixture}=await import('../support/assistant-derived-test-fixture.js'),{createAssistantRuntime}=await import('../../electron/assistant-runtime.js'),f=assistantDerivedFixture();
 try{const evening=createAssistantRuntime({loopStore:f.store,evidenceStore:f.evidence,derived:f.ports.derived,now:()=>f.now,collect:()=>({items:[]}),llmPort:{complete:async()=>({text:JSON.stringify({summary:'Original internal reflection',candidates:[]})})}});expect((await evening.runLoopNow('personal-assistant-evening-reflection',undefined,undefined,{requestSource:'user'})).status).toBe('success');
  const definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe:{kind:'artifact-content' as const,checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes' as const}]}}]};
  f.store.saveLoopPublicationConfiguration({loopId:'personal-assistant-morning-briefing',expectedRevision:null,requestSource:'user',now:f.now,configuration:{version:1,contract:{kind:'assistant',assistantKind:'morning',objective:'Original',completionCriterion:'Original'},verificationDefinitions:{run:definition,stages:{}}}});
  const result=await f.run(snapshot=>{expect(snapshot.latestEvening.summary).toBe('Original internal reflection');expect(snapshot).not.toHaveProperty('p2Context');expect(snapshot).not.toHaveProperty('derivedRunIds');});console.info(JSON.stringify({fixture:'protected-internal-pipeline',status:result.status,message:f.store.listLoopRuns('personal-assistant-morning-briefing',1)[0]?.message}));expect(result.status).toBe('publication_pending');
 }finally{await f.close();}
});
