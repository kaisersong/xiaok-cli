import {describe,it,expect,vi} from 'vitest';
import {AttentionWorkReader} from '../../../src/runtime/conversation-activity/attention-work-reader.js';
import {projectActivityAttention} from '../../../src/runtime/conversation-activity/attention-projector.js';
import type {WorkWatch,WorkProjection} from '../../../src/runtime/conversation-activity/types.js';
const actor={actorId:'user',requestSource:'user' as const};
function fixture(){
 const watch:WorkWatch={operationId:'op',watchId:'one',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'epoch',workId:'task',runId:'run',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'},status:'active',generation:1,preference:'normal',policyRevision:0,nextReportDueAt:0};
 const projection:WorkProjection={watchId:'one',executionState:'running',businessOutcome:'unknown',freshness:'fresh',sourceSequence:1,revision:1,lastProgressAt:1,lastHeartbeatAt:1,lastReportAt:null,evidenceRefs:[]};
 let native=true,readerCurrent=true,version=0,inFlight=0,maxInFlight=0;
 const slot=(watchId:string)=>({watchId,readerIncarnation:'79d1707f-41a1-48b9-a310-41b87631df24',reference:{endpointId:'endpoint',generation:'v2' as const,taskId:'task',originalOperation:'tools/call' as const}});
 const base=vi.fn(async(watchId:string)=>({watch:{...watch,watchId},projection:{...projection,watchId},presentation:projectActivityAttention({...watch,watchId},{...projection,watchId})}));
 const reader={hasBinding:()=>true,assertCurrent:vi.fn(()=>{if(!readerCurrent)throw Error('attention_inventory_unavailable');}),collect:vi.fn(async(s:ReturnType<typeof slot>)=>({watchId:s.watchId,readerIncarnation:s.readerIncarnation,taskStatus:'working' as const,businessOutcome:'unknown' as const,questions:[]}))};
 const begins=new Map<string,{version:number;watchId:string}>();let next=0;
 const begin=vi.fn(async(watchId:string)=>{const roundId=String(++next);begins.set(roundId,{version,watchId});inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);return{roundId,readerSlots:[slot(watchId)]};});
 const finalize=vi.fn(async(input:Record<string,unknown>)=>{const round=begins.get(input.roundId as string)!;await Promise.resolve();inFlight--;if(round.version!==version)throw Error('attention_projection_conflict');version++;return{view:await base(round.watchId),presentationIncarnation:'a74b50cd-5292-4111-a576-a437ab398520',dismissed:!!input.dismiss,dismissConflict:false};});
 const abort=vi.fn(async()=>({aborted:true}));
 const coordinator=new AttentionWorkReader({base,reader,begin,finalize,abort,assertNative:()=>{if(!native)throw Error('activity_thread_forbidden');}});
 return{coordinator,reader,base,begin,finalize,abort,get maxInFlight(){return maxInFlight;},invalidate:()=>{native=false;readerCurrent=false;}};
}
describe('one-shot attention read coordination',()=>{
 it('serializes different watches of the same native anchor before capturing cache CAS',async()=>{
  const f=fixture(),[one,two]=await Promise.all([f.coordinator.getWork('one',actor),f.coordinator.getWork('two',actor)]);
  expect(one.projection.freshness).toBe('fresh');expect(two.projection.freshness).toBe('fresh');expect(f.maxInFlight).toBe(1);expect(f.begin).toHaveBeenCalledTimes(2);expect(f.reader.collect).toHaveBeenCalledTimes(2);
 });
 it('does not await a redundant abort after successful finalization',async()=>{
  const f=fixture();f.abort.mockImplementation(async()=>{f.invalidate();return{aborted:true};});
  const view=await f.coordinator.getWork('one',actor);expect(view.projection.freshness).toBe('fresh');expect(f.abort).not.toHaveBeenCalled();
 });
 it('rechecks native identity after abort cleanup before delivering an unavailable fallback',async()=>{
  const f=fixture();f.finalize.mockRejectedValue(Error('attention_source_conflict'));f.abort.mockImplementation(async()=>{await Promise.resolve();f.invalidate();return{aborted:true};});
  await expect(f.coordinator.getWork('one',actor)).rejects.toThrow('activity_thread_forbidden');
 });
 it('reauthorizes a queued watch and does not collect it after its native identity is lost',async()=>{
  const f=fixture();let release!:()=>void,entered=false;const held=new Promise<void>(resolve=>{release=resolve;});
  f.reader.collect.mockImplementationOnce(async slot=>{entered=true;await held;return{watchId:slot.watchId,readerIncarnation:slot.readerIncarnation,taskStatus:'working',businessOutcome:'unknown',questions:[]};});
  const one=f.coordinator.getWork('one',actor).catch(error=>error);await vi.waitFor(()=>expect(entered).toBe(true));const two=f.coordinator.getWork('two',actor);void two.catch(()=>{});await Promise.resolve();f.invalidate();release();await one;
  await expect(two).rejects.toThrow('activity_thread_forbidden');expect(f.begin).toHaveBeenCalledTimes(1);
 });
});
