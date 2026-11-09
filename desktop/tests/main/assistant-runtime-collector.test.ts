// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {assistantDerivedFixture} from '../support/assistant-derived-test-fixture.js';
import {AssistantYzjClient} from '../../electron/assistant-yzj-cli.js';
import {createAssistantRuntime} from '../../electron/assistant-runtime.js';
import {ASSISTANT_MORNING_LOOP_ID,ASSISTANT_EVENING_LOOP_ID} from '../../electron/assistant-types.js';

async function composition(f:ReturnType<typeof assistantDerivedFixture>,snapshot?:()=>Promise<unknown>){
 const calls:string[]=[];
 const inbox={ensureToday:vi.fn(async()=>{calls.push('inbox');})};
 const snapshotReader={collect:vi.fn(async()=>{calls.push('snapshot');return snapshot?await snapshot():{items:[]};})};
 const contextReader={buildMorningContext:vi.fn(async input=>{calls.push('context');return f.ports.contextReader.buildMorningContext(input);})};
 const threadMetaStore={getThreadIds:vi.fn(()=>['pinned-original'])};
 const {createAssistantRuntimeCollector}=await import('../../electron/assistant-runtime-collector.js');
 const collect=createAssistantRuntimeCollector({inbox,snapshotReader,calendarSource:f.calendar,contextReader,threadMetaStore});
 return {collect,calls,inbox,snapshotReader,contextReader,threadMetaStore};
}
it('automatically observes the granted original calendar before the real morning Runtime captures current derived context',async()=>{
 const observe=vi.spyOn(AssistantYzjClient.prototype,'observeCalendar'),f=assistantDerivedFixture();
 try{
  await f.calendar.enable({requestSource:'user'});expect(f.calendar.latest().status).toBe('unavailable');expect(observe).not.toHaveBeenCalled();
  const c=await composition(f),complete=vi.fn(async input=>{expect(JSON.parse(input.userMessage).p2Context.calendar.events).toHaveLength(1);return {text:JSON.stringify({recommendations:[]})};});
  const runtime=createAssistantRuntime({loopStore:f.store,evidenceStore:f.evidence,derived:f.ports.derived,now:()=>f.now,collect:c.collect,llmPort:{complete}});
  expect((await runtime.runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'})).status).toBe('success');
  expect(observe).toHaveBeenCalledTimes(1);expect(c.calls).toEqual(['inbox','snapshot','context']);expect(f.calendar.latest().status).toBe('partial');expect(complete).toHaveBeenCalledTimes(1);
  const run=f.store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0]!;expect(f.store.readAssistantDerivedLineage(run.id)?.calendar?.events).toHaveLength(1);
 }finally{await f.close();observe.mockRestore();}
});
it('keeps disabled consent and the evening collector independent of automatic cloud reads',async()=>{
 const observe=vi.spyOn(AssistantYzjClient.prototype,'observeCalendar'),f=assistantDerivedFixture();
 try{const c=await composition(f);
  await c.collect({kind:'morning',profile:f.profile,now:f.now});expect(observe).not.toHaveBeenCalled();expect(f.calendar.latest().status).toBe('disabled');expect(c.calls).toEqual(['inbox','snapshot','context']);
  await f.calendar.enable({requestSource:'user'});c.calls.length=0;
  const value=await c.collect({kind:'evening',profile:f.profile,now:f.now});expect(value).toEqual({items:[]});expect(c.calls).toEqual(['snapshot']);expect(observe).not.toHaveBeenCalled();
 }finally{await f.close();observe.mockRestore();}
});
it('passes the exact caller AbortSignal through the original Runtime and executor collect boundary',async()=>{
 const f=assistantDerivedFixture(),abort=new AbortController();let observed:AbortSignal|undefined;
 try{const runtime=createAssistantRuntime({loopStore:f.store,evidenceStore:f.evidence,now:()=>f.now,collect:async input=>{observed=input.signal;return {items:[]};},llmPort:{complete:async()=>({text:JSON.stringify({recommendations:[]})})}});
  expect((await runtime.runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,abort.signal,{requestSource:'user'})).status).toBe('success');expect(observed).toBe(abort.signal);
 }finally{await f.close();}
});
it('does not start the cloud or build context when the caller aborts while the original snapshot port is held',async()=>{
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>{release=r;}),began=new Promise<void>(r=>{entered=r;});
 const observe=vi.spyOn(AssistantYzjClient.prototype,'observeCalendar'),f=assistantDerivedFixture(),abort=new AbortController();
 try{await f.calendar.enable({requestSource:'user'});const c=await composition(f,async()=>{entered();await held;return {items:[]};});
  const work=c.collect({kind:'morning',profile:f.profile,now:f.now,signal:abort.signal});await began;abort.abort();release();await expect(work).rejects.toBe(abort.signal.reason);expect(observe).not.toHaveBeenCalled();expect(c.contextReader.buildMorningContext).not.toHaveBeenCalled();
 }finally{release?.();await f.close();observe.mockRestore();}
});
it('retains the actual Source SDK flight until close settles and rejects any later context after that Source stops',async()=>{
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>{release=r;}),began=new Promise<void>(r=>{entered=r;});
 const original=AssistantYzjClient.prototype.observeCalendar;
 const observe=vi.spyOn(AssistantYzjClient.prototype,'observeCalendar').mockImplementation(async function(...args){entered();await held;return Reflect.apply(original,this,args);});
 const f=assistantDerivedFixture();
 try{await f.calendar.enable({requestSource:'user'});const c=await composition(f),work=c.collect({kind:'morning',profile:f.profile,now:f.now});
  const outcome=work.then(value=>({value}),raw=>({raw}));await began;let closed=false;const closing=f.calendar.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
  release();await closing;expect(closed).toBe(true);expect(await outcome).toMatchObject({raw:expect.objectContaining({message:'assistant_calendar_closed'})});expect(c.contextReader.buildMorningContext).not.toHaveBeenCalled();
 }finally{release?.();await f.close();observe.mockRestore();}
});
it('preserves an undefined first failure from the original snapshot port without attempting later calendar or context work',async()=>{
 const observe=vi.spyOn(AssistantYzjClient.prototype,'observeCalendar'),f=assistantDerivedFixture();
 try{await f.calendar.enable({requestSource:'user'});const c=await composition(f,async()=>{throw undefined;});let caught=false,raw:unknown='not-thrown';
  try{await c.collect({kind:'morning',profile:f.profile,now:f.now});}catch(error){caught=true;raw=error;}
  expect(caught).toBe(true);expect(raw).toBeUndefined();expect(observe).not.toHaveBeenCalled();expect(c.contextReader.buildMorningContext).not.toHaveBeenCalled();
 }finally{await f.close();observe.mockRestore();}
});

it('rechecks the original Source after an awaited context read before the Runtime can call the LLM',async()=>{
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>{release=r;}),began=new Promise<void>(r=>{entered=r;}),f=assistantDerivedFixture();
 try{const c=await composition(f),original=c.contextReader.buildMorningContext.getMockImplementation()!;
  c.contextReader.buildMorningContext.mockImplementation(async input=>{entered();await held;return original(input);});
  const complete=vi.fn(async()=>({text:JSON.stringify({recommendations:[]})}));
  const runtime=createAssistantRuntime({loopStore:f.store,evidenceStore:f.evidence,derived:f.ports.derived,now:()=>f.now,collect:c.collect,llmPort:{complete}});
  const work=runtime.runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'});await began;await f.calendar.close();release();expect((await work).status).toBe('failed');expect(complete).not.toHaveBeenCalled();
 }finally{release?.();await f.close();}
});
