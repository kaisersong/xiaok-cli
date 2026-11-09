import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';
import {ConversationActivitySources} from '../../../src/runtime/conversation-activity/sources.js';
import type {TaskRuntimeHost} from '../../../src/runtime/task-host/types.js';
const cleanup:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'task-source-delivery-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new ConversationActivityStore(join(root,'activity.sqlite'));cleanup.push(()=>store.close());
 store.prepareAssociation({operationId:'operation',creationIdempotencyKey:'operation',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'}});
 store.bindWork({operationId:'operation',watchId:'watch',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run'});
 const owner={},reference={sourceKind:'codex_native_approval',taskId:'task',taskSessionId:'host-session',executionThreadId:'thread',nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeGeneration:1,nativeIncarnation:randomUUID()};
 let authorize:()=>Promise<boolean>|boolean=()=>true;
 const service=new ConversationActivityService({store,profileId:'profile',actorId:'user',getThread:()=>({profileId:'profile',workspaceId:'workspace',threadId:'thread',deleteState:'none'}),canObserveWork:()=>authorize(),assertTaskSourceOwner:(watch,actual)=>actual===owner&&watch.workId==='task'} as ConstructorParameters<typeof ConversationActivityService>[0]);let closeHandled=false;cleanup.push(()=>closeHandled?undefined:service.close());
 const event={schemaVersion:1,eventId:'task#0',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:1,transportGeneration:0,kind:'started',receivedAt:1,evidenceRefs:[]};
 return{store,service,owner,reference,event,setAuthorize:(fn:typeof authorize)=>{authorize=fn;},closeHandled:()=>{closeHandled=true;}};
}
it('uses the exact fixed source owner and rejects cloned, foreign-service and aborted handles',async()=>{
 const f=fixture(),other=fixture(),controller=new AbortController();
 await expect(f.service.bindTaskSource('watch',{},controller.signal)).rejects.toThrow('activity_task_source_forbidden');
 const handle=(await f.service.bindTaskSource('watch',f.owner,controller.signal))!;expect(handle).toBeDefined();f.store.enrollNativeAttentionSource('watch',f.reference);
 await expect(f.service.acceptTaskSourceEvent(structuredClone(handle),f.event)).rejects.toThrow('activity_task_source_forbidden');
 await expect(other.service.acceptTaskSourceEvent(handle,f.event)).rejects.toThrow('activity_task_source_forbidden');
 await f.service.acceptTaskSourceEvent(handle,f.event);expect(f.store.getProjection('watch')?.sourceSequence).toBe(1);
 controller.abort();await expect(f.service.confirmTaskSourceFreshness(handle)).rejects.toThrow('activity_task_source_forbidden');
});
it('takes current enrollment only after suspended authorization and never upgrades generic siblings',async()=>{
 const f=fixture(),controller=new AbortController(),handle=(await f.service.bindTaskSource('watch',f.owner,controller.signal))!;
 const gate=deferred();f.setAuthorize(async()=>{await gate.promise;return true;});
 const pending=f.service.acceptTaskSourceEvent(handle,f.event);f.store.enrollNativeAttentionSource('watch',f.reference);gate.resolve();await pending;
 expect(f.store.getProjection('watch')?.sourceSequence).toBe(1);
 await expect(f.service.acceptEvent('watch',{...f.event,eventId:'fake',sourceSequence:2})).rejects.toThrow('activity_native_source_delivery_required');
 await expect(f.service.confirmFreshness('watch')).rejects.toThrow('activity_native_source_delivery_required');
 await expect(f.service.sourceUnavailable('watch','unavailable','fake')).rejects.toThrow('activity_native_source_delivery_required');
});
it.each(['event','fresh','unavailable'] as const)('rechecks original source abort after the actual %s authorization await and drains admitted work',async kind=>{
 const f=fixture(),controller=new AbortController(),handle=(await f.service.bindTaskSource('watch',f.owner,controller.signal))!;f.store.enrollNativeAttentionSource('watch',f.reference);
 const before=f.store.getProjection('watch'),gate=deferred(),entered=deferred();f.setAuthorize(async()=>{entered.resolve();await gate.promise;return true;});
 const pending=kind==='event'?f.service.acceptTaskSourceEvent(handle,f.event):kind==='fresh'?f.service.confirmTaskSourceFreshness(handle):f.service.taskSourceUnavailable(handle,'unavailable','transport_error');
 const rejection=expect(pending).rejects.toThrow(/activity_task_source_forbidden|activity_service_disposed/);await entered.promise;controller.abort();let closed=false;const closing=f.service.close().then(()=>{closed=true;},()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);gate.resolve();await rejection;await closing;await expect(f.service.close()).rejects.toThrow('activity_service_drain_failed');f.closeHandled();expect(f.store.getProjection('watch')).toEqual(before);
});
it('delivers real source records through the private port after enrollment and stops original source subscriptions',async()=>{
 const f=fixture();let actualOwner:TaskRuntimeHost;
 const host={async *subscribeTaskRecords(_task:string,options:{signal?:AbortSignal}){yield{taskId:'task',sourceDataEpoch:'host-session',eventIndex:0,event:{type:'task_execution_started' as const,taskId:'task'}};if(!options.signal?.aborted)await new Promise<void>(resolve=>options.signal?.addEventListener('abort',()=>resolve(),{once:true}));}} as unknown as TaskRuntimeHost;actualOwner=host;
 const service=new ConversationActivityService({store:f.store,profileId:'profile',actorId:'user',getThread:()=>({profileId:'profile',workspaceId:'workspace',threadId:'thread',deleteState:'none'}),canObserveWork:()=>true,assertTaskSourceOwner:(_watch,actual)=>actual===actualOwner});cleanup.push(()=>service.close());
 f.store.enrollNativeAttentionSource('watch',f.reference);
 const sources=new ConversationActivitySources({store:f.store,service,taskHost:()=>host,readProject:async()=>{throw Error('unused');}});cleanup.push(()=>sources.close());
 await sources.startWatch('watch');await vi.waitFor(()=>expect(f.store.getProjection('watch')?.executionState).toBe('running'));sources.stopWatch('watch');await sources.close();expect(f.store.getProjection('watch')?.sourceSequence).toBe(1);
});
it('rejects the original handle when the watch is stopped during its source authorization await',async()=>{
 const f=fixture(),controller=new AbortController(),handle=(await f.service.bindTaskSource('watch',f.owner,controller.signal))!,gate=deferred(),entered=deferred();
 f.store.enrollNativeAttentionSource('watch',f.reference);const before=f.store.getProjection('watch');f.setAuthorize(async()=>{entered.resolve();await gate.promise;return true;});
 const pending=f.service.acceptTaskSourceEvent(handle,f.event),rejected=expect(pending).rejects.toThrow('activity_task_source_forbidden');await entered.promise;
 f.store.stopWatch('profile','watch',f.store.getWatch('watch')!.policyRevision);gate.resolve();await rejected;expect(f.store.getProjection('watch')).toEqual(before);
});
it.each(['task','session'] as const)('rejects a real source callback with a foreign %s record before any event/cursor write',async foreign=>{
 const f=fixture();const errors:unknown[]=[];
 const host={async *subscribeTaskRecords(){yield{taskId:foreign==='task'?'foreign':'task',sourceDataEpoch:foreign==='session'?'foreign':'host-session',eventIndex:0,event:{type:'task_execution_started'}};}} as unknown as TaskRuntimeHost;
 const service=new ConversationActivityService({store:f.store,profileId:'profile',actorId:'user',getThread:()=>({profileId:'profile',workspaceId:'workspace',threadId:'thread',deleteState:'none'}),canObserveWork:()=>true,assertTaskSourceOwner:(_watch,actual)=>actual===host});cleanup.push(()=>service.close());
 f.store.enrollNativeAttentionSource('watch',f.reference);const sources=new ConversationActivitySources({store:f.store,service,taskHost:()=>host,readProject:async()=>{throw Error('unused');},onError:error=>errors.push(error)});cleanup.push(()=>sources.close());
 await sources.startWatch('watch');await vi.waitFor(()=>expect(errors.some(error=>error instanceof Error&&error.message==='activity_source_mismatch')).toBe(true));sources.stopWatch('watch');await sources.close();expect(f.store.getProjection('watch')?.sourceSequence).toBe(0);expect(f.store.getProjection('watch')?.freshness).toBe('unavailable');
});
it('reads actual original snapshot records using one daemon wrapper, rejects a recreated wrapper, and commits its real terminal receipt',async()=>{
 const {ActivityTaskSnapshotReader}=await import('../../../src/runtime/conversation-activity/owner-sources.js');
 const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js');
 const root=mkdtempSync(join(tmpdir(),'daemon-source-delivery-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const wait=deferred(),started=deferred();
 const host=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner:async()=>{started.resolve();await wait.promise;}});cleanup.push(async()=>{wait.resolve();await host.drain();});
 const task=await host.createTask({prompt:'controlled original source delivery',materials:[],context:{threadId:'thread'}});await started.promise;const snapshot=(await host.inspectTask(task.taskId))!;
 const reader=new ActivityTaskSnapshotReader(join(root,'tasks'));cleanup.push(()=>reader.close());const daemonHost=reader.host();
 const store=new ConversationActivityStore(join(root,'activity.sqlite'));cleanup.push(()=>store.close());store.prepareAssociation({operationId:'operation',creationIdempotencyKey:'operation',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'}});store.bindWork({operationId:'operation',watchId:'watch',source:'task_host',logicalSourceId:'host',sourceDataEpoch:snapshot.sessionId,workId:task.taskId});
 const service=new ConversationActivityService({store,profileId:'profile',actorId:'user',getThread:()=>({profileId:'profile',workspaceId:'workspace',threadId:'thread',deleteState:'none'}),assertTaskSourceOwner:(_watch,owner)=>owner===daemonHost,canObserveWork:async watch=>{const current=await reader.snapshot(watch.workId);return current?.taskId===watch.workId&&current.sessionId===watch.sourceDataEpoch&&current.context?.threadId===watch.origin.threadId;}});cleanup.push(()=>service.close());
 await expect(service.bindTaskSource('watch',reader.host(),new AbortController().signal)).rejects.toThrow('activity_task_source_forbidden');
 store.enrollNativeAttentionSource('watch',{sourceKind:'codex_native_approval',taskId:task.taskId,taskSessionId:snapshot.sessionId,executionThreadId:'thread',nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeGeneration:1,nativeIncarnation:randomUUID()});
 const sources=new ConversationActivitySources({store,service,taskHost:()=>daemonHost,readProject:async()=>{throw Error('unused');}});cleanup.push(()=>sources.close());await sources.startWatch('watch');await vi.waitFor(()=>expect(store.getProjection('watch')?.executionState).toBe('running'));
 wait.resolve();await host.drain();await vi.waitFor(()=>expect(store.getProjection('watch')?.executionState).toBe('completed'));const captured=store.captureAttentionRead('watch');const finalized=store.finalizeAttentionReadRound('watch',{expectedMembershipDigest:captured.membershipDigest,expectedProjectionVersion:captured.projectionVersion,expectedPresentationIncarnation:captured.presentationIncarnation,inventories:[]});expect(finalized.view.projection.businessOutcome).toBe('success');expect(finalized.view.presentation.questions).toEqual([]);
});
it('keeps an unchanged source binding through an ordinary reporting preference edit',async()=>{
 const f=fixture(),signal=new AbortController().signal,handle=(await f.service.bindTaskSource('watch',f.owner,signal))!;f.store.enrollNativeAttentionSource('watch',f.reference);
 f.store.updateReporting('profile','watch','quiet',f.store.getWatch('watch')!.policyRevision);await f.service.acceptTaskSourceEvent(handle,f.event);expect(f.store.getProjection('watch')?.sourceSequence).toBe(1);
});
