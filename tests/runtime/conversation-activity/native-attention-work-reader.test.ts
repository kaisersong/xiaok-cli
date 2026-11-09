import {expect,it,vi} from 'vitest';import {randomUUID} from 'node:crypto';
import {AttentionWorkReader} from '../../../src/runtime/conversation-activity/attention-work-reader.js';
import {projectActivityAttention} from '../../../src/runtime/conversation-activity/attention-projector.js';
import type {NativeAttentionReaderSlot} from '../../../src/runtime/conversation-activity/attention-reader-owner.js';
import type {WorkWatch,WorkProjection} from '../../../src/runtime/conversation-activity/types.js';
const actor={actorId:'user',requestSource:'user' as const};
function fixture(terminal=false){
 const nativeIncarnation=randomUUID(),reference={sourceKind:'codex_native_approval' as const,taskId:'task',taskSessionId:'session',executionThreadId:'thread',nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeGeneration:1,nativeIncarnation};
 const slots:NativeAttentionReaderSlot[]=['one','two'].map((watchId,index)=>({sourceKind:'codex_native_approval',watchId,readerIncarnation:nativeIncarnation,reference,sourceLeaseId:randomUUID(),enrollmentIncarnation:randomUUID(),bindingDigest:String(index).repeat(64),mode:terminal?'terminal':'live'}));
 const watch:WorkWatch={watchId:'one',operationId:'operation',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'session',workId:'task',runId:'run',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'},status:'active',generation:0,preference:'normal',policyRevision:0,nextReportDueAt:0};
 const projection:WorkProjection={watchId:'one',executionState:terminal?'completed':'running',businessOutcome:terminal?'success':'unknown',freshness:'fresh',sourceSequence:1,revision:1,lastProgressAt:1,lastHeartbeatAt:1,lastReportAt:null,evidenceRefs:[]};
 const view={watch,projection,presentation:projectActivityAttention(watch,projection)};let current=true,collectedCurrent=true;
 const reader={hasBinding:()=>true,assertCollectedCurrent:vi.fn(()=>{if(!collectedCurrent)throw Error('native_question_inventory_stale');}),assertCurrent:vi.fn((slot:NativeAttentionReaderSlot,caller:typeof actor)=>{if(!current||slot.watchId==='two'&&caller.actorId!=='user')throw Error('activity_thread_forbidden');}),collect:vi.fn(async(slot:NativeAttentionReaderSlot)=>({sourceKind:'codex_native_approval' as const,watchId:slot.watchId,readerIncarnation:nativeIncarnation,reference,enrollmentIncarnation:slot.enrollmentIncarnation,bindingDigest:slot.bindingDigest,coverage:'native_approvals_exclusive_execution_v1' as const,inventoryRevision:1,inventoryDigest:'a'.repeat(64),taskStatus:'working' as const,businessOutcome:'unknown' as const,questions:[]}))};
 const finalize=vi.fn(async(_input:Record<string,unknown>)=>({view,presentationIncarnation:randomUUID(),dismissed:false,dismissConflict:false}));
 const coordinator=new AttentionWorkReader({reader,base:async()=>view,assertNative:()=>{},begin:async()=>({roundId:randomUUID(),readerSlots:terminal?[]:slots,memberSlots:slots}),finalize,abort:()=>({}),onError:()=>{}});
 return{coordinator,reader,finalize,slots,invalidate:()=>{current=false;},invalidateCollected:()=>{collectedCurrent=false;}};
}
it('collects one physical turn once but sends each original watch enrollment and lease independently',async()=>{
 const f=fixture();await f.coordinator.getWork('one',actor);expect(f.reader.collect).toHaveBeenCalledTimes(1);const inventories=f.finalize.mock.calls[0][0].inventories as Array<Record<string,unknown>>;expect(inventories).toHaveLength(2);
 for(const slot of f.slots)expect(inventories.find(item=>item.watchId===slot.watchId)).toMatchObject({enrollmentIncarnation:slot.enrollmentIncarnation,bindingDigest:slot.bindingDigest,sourceLeaseId:slot.sourceLeaseId});
});
it('checks every terminal member after held finalize even when there are no live collection slots',async()=>{
 const f=fixture(true);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});const original=f.finalize.getMockImplementation()!;f.finalize.mockImplementationOnce(async input=>{enter();await gate;return original(input);});
 const pending=f.coordinator.getWork('one',actor),rejected=expect(pending).rejects.toThrow('activity_thread_forbidden');await entered;f.invalidate();release();await rejected;expect(f.reader.collect).not.toHaveBeenCalled();
});
it('rechecks all members with each actual caller when two callers share the same final result',async()=>{
 const f=fixture(true);const one=f.coordinator.getWork('one',actor),other=f.coordinator.getWork('one',{...actor,actorId:'other'});await expect(one).resolves.toMatchObject({projection:{executionState:'completed'}});await expect(other).rejects.toThrow('activity_thread_forbidden');expect(f.finalize).toHaveBeenCalledTimes(1);expect(f.reader.assertCurrent.mock.calls.some(([slot,caller])=>slot.watchId==='two'&&caller.actorId==='other')).toBe(true);
});

it('rejects an actual collected proof withdrawn during held finalize even while every source lease remains current',async()=>{
 const f=fixture();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),original=f.finalize.getMockImplementation()!;
 f.finalize.mockImplementationOnce(async input=>{enter();await gate;return original(input);});const pending=f.coordinator.getWork('one',actor),rejected=expect(pending).rejects.toThrow('native_question_inventory_stale');await entered;f.invalidateCollected();release();await rejected;
});
