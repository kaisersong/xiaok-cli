import {it,expect,vi} from 'vitest';
import {AttentionWorkReader,type AttentionDismiss} from '../../../src/runtime/conversation-activity/attention-work-reader.js';
import {projectActivityAttention} from '../../../src/runtime/conversation-activity/attention-projector.js';
import type {ActivityActor} from '../../../src/runtime/conversation-activity/service.js';
import type {WorkWatch,WorkProjection} from '../../../src/runtime/conversation-activity/types.js';
const actor:ActivityActor={actorId:'user',requestSource:'user'};
function fixture(){
 const watch:WorkWatch={operationId:'op',watchId:'one',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:'epoch',workId:'p',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'},status:'active',generation:0,preference:'normal',policyRevision:0,nextReportDueAt:0};
 const projection:WorkProjection={watchId:'one',executionState:'running',businessOutcome:'unknown',freshness:'fresh',sourceSequence:1,revision:1,lastProgressAt:1,lastHeartbeatAt:1,lastReportAt:null,evidenceRefs:[]};
 const base=vi.fn(async(watchId:string)=>({watch:{...watch,watchId},projection:{...projection,watchId},presentation:projectActivityAttention({...watch,watchId},{...projection,watchId})}));
 let membership=true,inFlight=0,maximum=0;const denied=new Set<ActivityActor>();
 const guard=vi.fn((current:ActivityActor)=>{if(!membership)throw Error('project_membership_changed');if(denied.has(current))throw Error('activity_actor_forbidden');});
 const project=vi.fn(async(watchId:string,_actor:ActivityActor,dismiss?:AttentionDismiss)=>{
  inFlight++;maximum=Math.max(maximum,inFlight);try{await Promise.resolve();return{view:{...await base(watchId),attentionState:{presentationIncarnation:'a74b50cd-5292-4111-a576-a437ab398520',dismissed:!!dismiss}},assertCurrent:guard};}finally{inFlight--;}
 });
 const begin=vi.fn(async()=>{throw Error('unexpected_mcp_begin');}),collect=vi.fn(async()=>{throw Error('unexpected_mcp_collect');});
 const options={base,reader:{hasBinding:()=>false,collect,assertCurrent:()=>{}},begin,finalize:async()=>{throw Error('unexpected_mcp_finalize');},abort:()=>{},assertNative:(_watch:WorkWatch,current:ActivityActor)=>{if(denied.has(current))throw Error('activity_actor_forbidden');},project};
 return{reader:new AttentionWorkReader(options),project,guard,begin,collect,denied,base,get maximum(){return maximum;},invalidate:()=>{membership=false;}};
}
it('uses the fixed project callback before the no-MCP-binding fast return',async()=>{
 const f=fixture(),view=await f.reader.getWork('one',actor);expect(f.project).toHaveBeenCalledTimes(1);expect(view.attentionState?.dismissed).toBe(false);expect(f.begin).not.toHaveBeenCalled();expect(f.collect).not.toHaveBeenCalled();
});
it('serializes project aliases in the existing physical-anchor lane',async()=>{
 const f=fixture();await Promise.all([f.reader.getWork('one',actor),f.reader.getWork('alias',actor)]);expect(f.project).toHaveBeenCalledTimes(2);expect(f.maximum).toBe(1);
});
it('shares a project read and checks each caller at public delivery',async()=>{
 const f=fixture(),other={...actor};const first=f.reader.getWork('one',actor),second=f.reader.getWork('one',other);f.denied.add(actor);
 const results=await Promise.allSettled([first,second]);expect(results[0].status).toBe('rejected');expect(results[1].status).toBe('rejected');
 // Admission itself failed before a shared frame existed. A new legal caller
 // gets an independent admitted read rather than inheriting a stale frame.
 await f.reader.getWork('one',other);expect(f.project).toHaveBeenCalledTimes(1);
});
it('does not let one caller withdrawal reject another legal consumer of an admitted shared frame',async()=>{
 const f=fixture(),other={...actor};let checks=0;
 f.guard.mockImplementation(current=>{if(f.denied.has(current))throw Error('activity_actor_forbidden');if(++checks===1)queueMicrotask(()=>f.denied.add(actor));});
 const results=await Promise.allSettled([f.reader.getWork('one',actor),f.reader.getWork('one',other)]);
 expect(results[0].status).toBe('rejected');expect(results[1].status).toBe('fulfilled');expect(f.project).toHaveBeenCalledTimes(1);expect(f.guard).toHaveBeenLastCalledWith(other);
});
it('fails closed when membership changes between project finalization and delivery',async()=>{
 const f=fixture(),original=f.project.getMockImplementation()!;f.project.mockImplementation(async(...args)=>{const result=await original(...args);queueMicrotask(f.invalidate);return result;});
 const result=await f.reader.getWork('one',actor);expect(result.projection.freshness).toBe('unavailable');expect(result.presentation?.protocolUnavailable).toBe(true);
});
it('keeps failed project metadata unavailable instead of returning the legacy fresh view',async()=>{
 const f=fixture();f.project.mockRejectedValue(Error('project_delivery_source_unverified'));const view=await f.reader.getWork('one',actor);expect(view.projection.freshness).toBe('unavailable');expect(view.presentation?.protocolUnavailable).toBe(true);
});
it('routes project dismiss through the same fixed callback and propagates conflicts',async()=>{
 const f=fixture(),dismiss={expectedProjectionVersion:1,expectedPresentationIncarnation:'a74b50cd-5292-4111-a576-a437ab398520'};
 expect((await f.reader.dismiss('one',dismiss,actor)).attentionState?.dismissed).toBe(true);expect(f.project).toHaveBeenLastCalledWith('one',actor,dismiss);f.project.mockRejectedValue(Error('attention_projection_conflict'));await expect(f.reader.dismiss('one',dismiss,actor)).rejects.toThrow('attention_projection_conflict');
});
it.each(['false','promise'])('rejects a non-synchronous-void project guard (%s) before delivering fresh work',async kind=>{
 const f=fixture(),rejected=Promise.reject(Error('guard_tail'));void rejected.catch(()=>{});
 f.guard.mockImplementation((()=>kind==='false'?false:rejected) as unknown as(typeof f.guard));
 const view=await f.reader.getWork('one',actor);expect(view.projection.freshness).toBe('unavailable');expect(view.presentation?.protocolUnavailable).toBe(true);
});
it('rejects an async project guard introduced only at the public delivery boundary',async()=>{
 const f=fixture();let checks=0;
 f.guard.mockImplementation((()=>++checks===1?undefined:Promise.resolve()) as unknown as(typeof f.guard));
 await expect(f.reader.getWork('one',actor)).rejects.toThrow();
});

it('isolates a caller withdrawn during initial authorization from another caller of the same watch',async()=>{
 const f=fixture(),other={...actor};let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});const original=f.base.getMockImplementation()!;
 f.base.mockImplementation(async(id:string,current?:ActivityActor)=>{if(current===actor)await held;return original(id);});
 const first=f.reader.getWorkForCaller('one',actor),second=f.reader.getWorkForCaller('one',other);
 f.denied.add(actor);release();const results=await Promise.allSettled([first,second]);
 expect(results[0].status).toBe('rejected');expect(results[1].status).toBe('fulfilled');expect(f.project).toHaveBeenCalledTimes(1);expect(f.guard).toHaveBeenLastCalledWith(other);
});
it('coalesces one caller presentation but serializes distinct caller presentations in the original anchor lane',async()=>{
 const f=fixture(),other={...actor};await Promise.all([f.reader.getWorkForCaller('one',actor),f.reader.getWorkForCaller('one',actor),f.reader.getWorkForCaller('one',other)]);
 expect(f.project).toHaveBeenCalledTimes(2);expect(f.maximum).toBe(1);
});
it('keeps caller-specific dismiss on the original shared anchor lane and propagates conflicts',async()=>{
 const f=fixture(),other={...actor},input={expectedProjectionVersion:1,expectedPresentationIncarnation:'a74b50cd-5292-4111-a576-a437ab398520'};
 const results=await Promise.all([f.reader.getWorkForCaller('one',actor),f.reader.dismissForCaller('one',input,other)]);
 expect(results[1].attentionState?.dismissed).toBe(true);expect(f.maximum).toBe(1);f.project.mockRejectedValue(Error('attention_projection_conflict'));
 await expect(f.reader.dismissForCaller('one',input,other)).rejects.toThrow('attention_projection_conflict');
});
