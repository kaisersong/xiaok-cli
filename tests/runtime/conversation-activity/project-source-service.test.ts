import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {originalProjectDeliveryFixture} from '../../support/original-project-delivery-fixture.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ConversationActivityService,type ActivityActor} from '../../../src/runtime/conversation-activity/service.js';
import {ConversationActivitySources} from '../../../src/runtime/conversation-activity/sources.js';
let original:ReturnType<typeof originalProjectDeliveryFixture>;const cleanup:Array<()=>Promise<void>>=[];
beforeAll(()=>{original=originalProjectDeliveryFixture();});afterAll(()=>original?.close());afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const actor={actorId:'user',requestSource:'user' as const};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'project-source-service-'));let service:ConversationActivityService,sources:ConversationActivitySources;
 const store=new ConversationActivityStore(join(root,'activity.sqlite'),{projectOrdinarySource:frame=>service.resolveProjectOrdinarySource(frame),projectDeliverySource:frame=>service.resolveProjectDeliverySource(frame)});
 const bind=(id='watch')=>{store.prepareAssociation({operationId:id,creationIdempotencyKey:id,origin:{...original.pages.first.scope,threadId:id,actorId:'user'}});store.bindWork({operationId:id,watchId:id,source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:original.pages.first.page.sourceDataEpoch,workId:'p'});};bind();
 let scopedFailure:Error|undefined;let next=original.pages.first,hold:Promise<void>|undefined,reads=0,weak=false,failure:Error|undefined;const frames=new WeakMap<object,{audience:string}>(),scopedFrames=new WeakSet<object>(),denied=new Set<string>();
 const read=vi.fn(async(audience:unknown,signal:AbortSignal,beforeEffects:()=>void)=>{reads++;beforeEffects();if(hold)await hold;beforeEffects();if(signal.aborted)throw Error('source_aborted');if(failure)throw failure;const after=(audience as {after:number}).after,page={...next.page,events:next.page.events.filter((event:{sourceSequence:number})=>event.sourceSequence>after)},scoped={...next,page};scopedFrames.add(scoped);const frame=Object.freeze({subject:audience,page:{...page,delivery:{status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'}},...(!weak?{scoped}:{})});frames.set(frame,{audience:JSON.stringify(audience)});return frame;});
 let onNotify:(()=>Promise<'shown'|'suppressed'|'failed'>)|undefined;const deleted=new Set<string>();const errors:unknown[]=[];let onOwner:(()=>void)|undefined;
 service=new ConversationActivityService({store,profileId:original.pages.first.scope.profileId,actorId:'user',getThread:id=>({threadId:id,...original.pages.first.scope,deleteState:deleted.has(id)?'delete_pending':'none'}),canObserveWork:watch=>!denied.has(watch.watchId),notify:()=>onNotify?.()??Promise.resolve('suppressed'),onError:e=>errors.push(e),projectSource:{assertOwner(owner:object){if(owner!==sources)throw Error('project_owner_forbidden');onOwner?.();},read,assertRead(audience:unknown,frame:object){if(frames.get(frame)?.audience!==JSON.stringify(audience))throw Error('project_http_frame_forbidden');},assertScoped(_audience:unknown,frame:object){if(scopedFailure)throw scopedFailure;if(!scopedFrames.has(frame))throw Error('project_scoped_frame_forbidden');},ensureRound:id=>sources.ensureProjectRound(id)}});
 sources=new ConversationActivitySources({store,service,fixedProjectSource:true,taskHost:()=>{throw Error('unexpected_task');},readProject:async()=>{throw Error('unexpected_legacy_project_reader');},onError:e=>errors.push(e)});
 cleanup.push(async()=>{await sources.close();await service.close();store.close();rmSync(root,{recursive:true,force:true});});
 return{store,service,sources,bind,errors,denied,deleted,read,onNotify(value:()=>Promise<'shown'|'suppressed'|'failed'>){onNotify=value;},onOwner(value?:()=>void){onOwner=value;},get reads(){return reads;},setPage(page:typeof next){next=page;},setHold(value?:Promise<void>){hold=value;},setWeak(){weak=true;},failScoped(error:Error){scopedFailure=error;},fail(e:Error){failure=e;}};
}
function queueNotification(f:{store:ConversationActivityStore}){
 // A controlled legacy ordinary task completion supplies a real pending
 // notification; the original B project is awaiting user acceptance.
 const scope=original.pages.first.scope;f.store.prepareAssociation({operationId:'notify-op',creationIdempotencyKey:'notify-op',origin:{...scope,threadId:'notification-thread',actorId:'user'}});
 f.store.bindWork({operationId:'notify-op',watchId:'notification-watch',source:'task_host',logicalSourceId:'notification-host',sourceDataEpoch:'notification-epoch',workId:'notification-task'});
 f.store.ingest('notification-watch',{schemaVersion:1,eventId:'notification-task#1',source:'task_host',logicalSourceId:'notification-host',sourceDataEpoch:'notification-epoch',workId:'notification-task',sourceSequence:1,transportGeneration:0,kind:'completed',receivedAt:Date.now(),evidenceRefs:[]});
}
it('feeds original B pages through the actual Sources, Service, Store and public WorkReader fixed finalizer',async()=>{
 const f=fixture(),view=await f.service.getWork('watch',actor);expect(f.reads).toBe(1);expect(view.presentation?.deliveryStage).toBe('ready_for_acceptance');expect(view.attentionState?.presentationIncarnation).toBeTruthy();expect(f.store.getProjection('watch')?.sourceSequence).toBe(original.pages.first.page.headSeq);expect(f.errors).toEqual([]);
});
it('shares one source query across concurrent foreground callers without sharing caller presentation authority',async()=>{
 const f=fixture();let release!:()=>void;f.setHold(new Promise<void>(yes=>{release=yes;}));const first=f.service.getWork('watch',actor),second=f.service.getWork('watch',{...actor});await vi.waitFor(()=>expect(f.reads).toBe(1));release();const views=await Promise.all([first,second]);expect(views.map(v=>v.presentation?.deliveryStage)).toEqual(['ready_for_acceptance','ready_for_acceptance']);expect(f.reads).toBe(1);
});
it('revokes ready synchronously on a hint while a replacement original query remains held',async()=>{
 const f=fixture(),ready=await f.service.getWork('watch',actor);let release!:()=>void;f.setHold(new Promise<void>(yes=>{release=yes;}));const refresh=f.sources.refreshProject('p',true);try{await vi.waitFor(()=>expect(f.reads).toBe(2));const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('none');expect(view.presentation?.protocolUnavailable).toBe(true);await expect(f.service.dismissAttention('watch',{expectedProjectionVersion:ready.presentation!.projectionVersion,expectedPresentationIncarnation:ready.attentionState!.presentationIncarnation},actor)).rejects.toThrow();}finally{release();await refresh;}
});
it('keeps a weak legacy Source page ordinary-only through the same private Store port',async()=>{
 const f=fixture();f.setWeak();const view=await f.service.getWork('watch',actor);expect(f.reads).toBe(1);expect(f.store.getProjection('watch')?.freshness).toBe('fresh');expect(view.presentation?.deliveryStage).toBe('none');expect(view.presentation?.protocolUnavailable).toBe(true);expect(()=>f.store.setFreshness('watch','fresh')).toThrow('activity_project_source_delivery_required');
});
it('does not reuse ready after a foreground source failure even when refresh catches its original error',async()=>{
 const f=fixture();await f.service.getWork('watch',actor);const cause=Error('actual_source_failed');f.fail(cause);const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('none');expect(f.errors).toContain(cause);
});
it('rejects copied, JSON and foreign owner frames at both positive Store resolvers',()=>{
 const f=fixture();for(const value of [{},{kind:'project_source_page_v1'}]){expect(()=>f.service.resolveProjectOrdinarySource(value)).toThrow();expect(()=>f.service.resolveProjectDeliverySource(value)).toThrow();}expect(()=>f.service.invalidateProjectSource({},'p')).toThrow('project_owner_forbidden');
});
it('requires all actual alias permissions before admitting a strong source fact',async()=>{
 const f=fixture();f.bind('alias');f.denied.add('alias');const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('none');expect(f.errors.length).toBeGreaterThan(0);
});

it('does not turn subscription reentrant reads of a stable empty page into continued polling',async()=>{
 const f=fixture(),pending:Promise<unknown>[]=[],unsubscribe=f.service.subscribe('watch',actor,()=>{pending.push(f.service.getWork('watch',actor));});
 try{await f.sources.refreshProject('p');await vi.waitFor(()=>expect(pending.length).toBeGreaterThan(0));await Promise.all(pending);await new Promise(resolve=>setTimeout(resolve,30));const count=f.reads;await new Promise(resolve=>setTimeout(resolve,30));expect(f.reads).toBe(count);expect(count).toBeLessThanOrEqual(2);expect(f.errors).toEqual([]);}finally{unsubscribe();}
});

it('continues a pending hint after it supersedes a held foreground round',async()=>{
 const f=fixture();let release!:()=>void;f.setHold(new Promise<void>(yes=>{release=yes;}));const first=f.service.getWork('watch',actor);
 await vi.waitFor(()=>expect(f.reads).toBe(1));const next=f.sources.refreshProject('p',true);f.setHold();release();await Promise.all([first,next]);
 expect(f.reads).toBe(2);expect(f.errors.some(error=>error instanceof Error&&error.message==='activity_project_source_superseded')).toBe(true);const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('ready_for_acceptance');
});
it('preserves pending reentry from the first round completion before the original shared pump finally releases',async()=>{
 const f=fixture();let nested:Promise<void>|undefined;const first=f.sources.ensureProjectRound('p');void first.then(()=>{nested=f.sources.refreshProject('p',true);});await first;
 await vi.waitFor(()=>expect(f.reads).toBe(2));await nested;
});

it('publishes shared ownership before a synchronous owner guard can reenter foreground reservation',async()=>{
 const f=fixture();let nested:Promise<void>|undefined;f.onOwner(()=>{f.onOwner();nested=f.sources.ensureProjectRound('p');});
 const first=f.sources.ensureProjectRound('p');await Promise.all([first,nested]);expect(f.reads).toBe(1);
});

it('preserves an original strong-owner failure instead of silently converting its frame to weak success',async()=>{
 const f=fixture(),cause=Error('original_strong_owner_failure');f.failScoped(cause);const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('none');expect(f.errors).toContain(cause);
});
it('clears in-memory admission before SQL failure can interrupt the failure revocation path',async()=>{
 const f=fixture(),db=(f.store as unknown as {db:import('node:sqlite').DatabaseSync}).db,read=f.store.getOrdinaryAttentionFact.bind(f.store),fresh=f.store.setFreshness.bind(f.store);
 let readFailed=false,negativeFailed=false;f.store.getOrdinaryAttentionFact=(id)=>{if(!readFailed){readFailed=true;db.prepare('SELECT * FROM actual_missing_signature_table').get();}return read(id);};
 f.store.setFreshness=(...args)=>{if(args[1]==='unavailable'&&!negativeFailed){negativeFailed=true;db.prepare('SELECT * FROM actual_missing_negative_table').get();}return fresh(...args);};
 const view=await f.service.getWork('watch',actor);expect(readFailed).toBe(true);expect(negativeFailed).toBe(true);expect(view.presentation?.deliveryStage).toBe('none');expect(f.errors.filter(error=>error instanceof Error&&error.message.includes('actual_missing_')).length).toBe(2);
});

it('keeps a deleted historical alias in CAS without requiring its revoked thread to remain observable',async()=>{
 const f=fixture();f.bind('alias');expect((await f.service.getWork('watch',actor)).presentation?.deliveryStage).toBe('ready_for_acceptance');f.deleted.add('alias');f.service.handleThreadDeletion('alias','delete-alias');const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('ready_for_acceptance');expect(f.store.captureAttentionRead('watch').members.some(member=>member.watch.watchId==='alias'&&member.deleted)).toBe(true);
});

it('keeps one physical query useful for a legal caller when the first caller withdraws during its IO',async()=>{
 const f=fixture(),withdrawn:ActivityActor={...actor};let release!:()=>void;f.setHold(new Promise<void>(yes=>{release=yes;}));const first=f.service.getWork('watch',withdrawn),second=f.service.getWork('watch',{...actor});
 await vi.waitFor(()=>expect(f.reads).toBe(1));withdrawn.requestSource='agent';release();const result=await Promise.allSettled([first,second]);expect(result[0].status).toBe('rejected');expect(result[1].status).toBe('fulfilled');if(result[1].status==='fulfilled')expect(result[1].value.presentation?.deliveryStage).toBe('ready_for_acceptance');expect(f.reads).toBe(1);
});

it('keeps the newest demand when a synchronous owner guard reenters with a real hint',async()=>{
 const f=fixture();let nested:Promise<void>|undefined;f.onOwner(()=>{f.onOwner();nested=f.sources.refreshProject('p',true);});
 await Promise.all([f.sources.ensureProjectRound('p'),nested]);expect(f.reads).toBe(1);expect(f.errors).toEqual([]);
});

it('rechecks the original project output at an outer return after a hint has invalidated its Source round',async()=>{
 const f=fixture(),view=await f.service.getWork('watch',actor);expect(()=>f.service.assertProjectWorkReadCurrent(view,actor)).not.toThrow();
 let release!:()=>void;f.setHold(new Promise<void>(yes=>{release=yes;}));const refresh=f.sources.refreshProject('p',true);
 try{expect(()=>f.service.assertProjectWorkReadCurrent(view,actor)).toThrow();}finally{release();await refresh;}
});
it('keeps actual project output brands separate from copies and rejects a withdrawn outer caller',async()=>{
 const f=fixture(),view=await f.service.getWork('watch',actor);expect(()=>f.service.assertProjectWorkReadCurrent(view,{...actor})).not.toThrow();expect(()=>f.service.assertProjectWorkReadCurrent({...view},actor)).toThrow();expect(()=>f.service.assertProjectWorkReadCurrent(view,{...actor,requestSource:'agent'})).toThrow();
});
it('freezes an actual unknown output so it cannot be upgraded before the final return check',async()=>{
 const f=fixture();f.setWeak();const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('none');expect(Reflect.set(view.presentation!,'deliveryStage','ready_for_acceptance')).toBe(false);expect(()=>f.service.assertProjectWorkReadCurrent(view,actor)).not.toThrow();
});

it('keeps Sources close pending until the actual post-round notification callback has drained',async()=>{
 const f=fixture();
 queueNotification(f);
 let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(yes=>{entered=yes;}),held=new Promise<void>(yes=>{release=yes;});
 f.onNotify(async()=>{entered();await held;return 'shown';});const refresh=f.sources.refreshProject('p');await reached;let closed=false;const close=f.sources.close().then(()=>{closed=true;});
 try{await new Promise(resolve=>setTimeout(resolve,20));expect(closed).toBe(false);}finally{release();await Promise.all([refresh,close]);}
});

it('lets an actual post-round notification await getWork without waiting on its own Source producer',async()=>{
 const f=fixture();queueNotification(f);let delivered=0;f.onNotify(async()=>{delivered++;const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('ready_for_acceptance');return 'shown';});
 await f.sources.refreshProject('p');expect(delivered).toBe(1);expect(f.reads).toBe(2);expect(f.errors).toEqual([]);
});
it('publishes recovery after a real disconnected freshness change even when the B head and ordinary fact stay identical',async()=>{
 const f=fixture();await f.service.getWork('watch',actor);const changes:unknown[]=[],unsubscribe=f.service.subscribe('watch',actor,change=>changes.push(change));
 try{await f.sources.projectConnectionChanged('disconnected');expect(changes.length).toBeGreaterThan(0);changes.length=0;await f.sources.projectConnectionChanged('connected');expect(changes.length).toBeGreaterThan(0);}finally{unsubscribe();}
});

it('revokes an actual ready receipt before a disconnected freshness SQL failure',async()=>{
 const f=fixture(),view=await f.service.getWork('watch',actor),cause=Error('negative_freshness_sql_failure'),originalFresh=f.store.setFreshness.bind(f.store);
 f.store.setFreshness=()=>{throw cause;};
 try{await expect(f.service.sourceUnavailable('watch','reconnecting','transport_disconnected')).rejects.toBe(cause);expect(()=>f.service.assertProjectWorkReadCurrent(view,actor)).toThrow();}
 finally{f.store.setFreshness=originalFresh;}
});
it('publishes same-head recovery once without making stable subscriber reads continue polling',async()=>{
 const f=fixture();await f.service.getWork('watch',actor);await f.sources.projectConnectionChanged('disconnected');
 let delivered=0;const reads:Promise<unknown>[]=[],unsubscribe=f.service.subscribe('watch',actor,()=>{delivered++;reads.push(f.service.getWork('watch',actor));});
 try{await f.sources.projectConnectionChanged('connected');await Promise.all(reads);expect(delivered).toBe(1);expect(f.reads).toBe(3);expect(f.errors).toEqual([]);}
 finally{unsubscribe();}
});
it('admits a real hint synchronously without waiting for held Source IO',async()=>{
 const f=fixture();await f.service.getWork('watch',actor);let release!:()=>void;f.setHold(new Promise<void>(yes=>{release=yes;}));const admission=f.sources.admitProjectHint('p');
 try{expect(admission.demandId).toMatch(/^[a-f0-9-]{36}$/);await vi.waitFor(()=>expect(f.reads).toBe(2));const view=await f.service.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('none');}finally{release();await admission.settled;}
});
it('does not issue a hint admission receipt when actual negative SQL fails in its synchronous prefix',async()=>{
 const f=fixture();await f.service.getWork('watch',actor);const original=f.store.invalidateProjectDelivery.bind(f.store),cause=Error('actual_negative_sql_failure');f.store.invalidateProjectDelivery=()=>{throw cause;};
 try{expect(()=>f.sources.admitProjectHint('p')).toThrow('activity_project_hint_unconfirmed');}finally{f.store.invalidateProjectDelivery=original;}
});
