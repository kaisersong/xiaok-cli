import {beforeAll,afterAll,afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {originalProjectDeliveryFixture} from '../../support/original-project-delivery-fixture.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
let original:ReturnType<typeof originalProjectDeliveryFixture>;const cleanup:Array<()=>void>=[];
beforeAll(()=>{original=originalProjectDeliveryFixture();});afterAll(()=>original?.close());afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(ordinary=true){
 const root=mkdtempSync(join(tmpdir(),'project-ordinary-port-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const frames=new WeakMap<object,{watchId:string;page:unknown;after:number;assertCurrent():void}>(),strongFrames=new WeakMap<object,{watchId:string;body:unknown;after:number;demandId:string;assertCurrent():void}>();let current=true;const cause=Error('actual_ordinary_source_revoked');
 const resolver=(frame:object)=>{const value=frames.get(frame);if(!value)throw Error('project_ordinary_source_forbidden');return value;};
 const options={...(ordinary?{projectOrdinarySource:resolver}:{}),projectDeliverySource:(frame:object)=>{const value=strongFrames.get(frame);if(!value)throw Error('project_source_forbidden');return value;}};
 const store=new ConversationActivityStore(join(root,'activity.sqlite'),options);cleanup.push(()=>store.close());const db=(store as unknown as{db:DatabaseSync}).db;
 store.prepareAssociation({operationId:'op',creationIdempotencyKey:'op',origin:{profileId:original.pages.first.scope.profileId,workspaceId:original.pages.first.scope.workspaceId,threadId:'thread',actorId:'user'}});store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:original.pages.first.page.sourceDataEpoch,workId:'p'});
 const frame=Object.freeze({}),strong=Object.freeze({});frames.set(frame,{watchId:'watch',page:original.pages.first.page,after:0,assertCurrent(){if(!current)throw cause;}});strongFrames.set(strong,{watchId:'watch',body:original.pages.first,after:0,demandId:randomUUID(),assertCurrent(){if(!current)throw cause;}});
 const retained=()=>{const page=original.pages.first.page;return{sourceDataEpoch:page.sourceDataEpoch,coveredThrough:page.coveredThrough,gapRanges:page.gapRanges,events:page.events.map((event:object)=>({...event,logicalSourceId:'kswarm',transportGeneration:0,receivedAt:1}))};};
 const apply=(input=frame)=>{const fn=Reflect.get(store,'applyProjectSourcePage');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,store,[input]);};
 return{store,db,file:join(root,'activity.sqlite'),frame,strong,frames,retained,apply,options,cause,revoke:()=>{current=false;}};
}
it('applies the actual ordinary page through the original retained writer without granting the B head',()=>{
 const f=fixture();f.apply();expect(f.store.getProjection('watch')?.sourceSequence).toBe(original.pages.first.page.headSeq);expect(f.store.getProjection('watch')?.freshness).toBe('fresh');expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_namespaces').get()).toMatchObject({n:0});f.store.acceptProjectDelivery(f.strong);expect(f.store.readProjectDelivery(f.strong)?.head.factId).toBe(original.pages.first.page.delivery.head.factId);
});
it.each(['event','retained','snapshot','fresh'])('denies the generic positive %s sibling once a fixed ordinary source is installed',kind=>{
 const f=fixture(),page=original.pages.first.page;
 const call=()=>kind==='event'?f.store.ingest('watch',f.retained().events[0]):kind==='retained'?f.store.ingestRetainedPage('watch',f.retained()):kind==='snapshot'?f.store.reconcileSnapshot('watch',page.sourceDataEpoch,0,'accepted',false):f.store.setFreshness('watch','fresh');
 expect(call).toThrow('activity_project_source_delivery_required');expect(f.store.getProjection('watch')?.sourceSequence).toBe(0);
});
it('does not allow a generic writer when a retained qualified project has no ordinary source port',()=>{
 const f=fixture(false);f.store.ingestRetainedPage('watch',f.retained());f.store.acceptProjectDelivery(f.strong);expect(()=>f.store.setFreshness('watch','fresh')).toThrow('activity_project_source_delivery_required');
});
it('keeps the reserved writer fence after the actual Store owner closes and reopens without an ordinary source port',()=>{
 const f=fixture();f.apply();f.store.acceptProjectDelivery(f.strong);f.store.close();const reopened=new ConversationActivityStore(f.file);cleanup.push(()=>reopened.close());expect(()=>reopened.setFreshness('watch','fresh')).toThrow('activity_project_source_delivery_required');reopened.setFreshness('watch','unavailable');expect(reopened.getProjection('watch')?.freshness).toBe('unavailable');
});
it('rejects an ordinary frame clone and a later replacement of the constructor resolver',()=>{
 const f=fixture();f.options.projectOrdinarySource=()=>f.frames.get(f.frame)!;expect(()=>f.apply({...f.frame})).toThrow('project_ordinary_source_forbidden');
});
it('preserves the actual ordinary source guard rejection before any page write',()=>{
 const f=fixture();f.revoke();expect(()=>f.apply()).toThrow(f.cause);expect(f.db.prepare('SELECT COUNT(*) AS n FROM source_events').get()).toMatchObject({n:0});
});
it('rejects an asynchronous ordinary source guard before any page write',()=>{
 const f=fixture();f.frames.get(f.frame)!.assertCurrent=async()=>{};expect(()=>f.apply()).toThrow('before_effects_guard_invalid');expect(f.db.prepare('SELECT COUNT(*) AS n FROM source_events').get()).toMatchObject({n:0});
});
it('allows negative unavailable while revoking all original project witnesses',()=>{
 const f=fixture();f.apply();f.store.acceptProjectDelivery(f.strong);f.store.setFreshness('watch','unavailable','actual_source_unavailable');expect(f.store.getProjection('watch')?.freshness).toBe('unavailable');expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_witnesses').get()).toMatchObject({n:0});expect(()=>f.store.readProjectDelivery(f.strong)).toThrow(/unverified/);
});
it('keeps a later legacy empty page ordinary-only and invalidates an earlier strong projection witness',()=>{
 const f=fixture();f.apply();f.store.acceptProjectDelivery(f.strong);const next=Object.freeze({});f.frames.set(next,{...f.frames.get(f.frame)!,page:original.pages.middle.page,after:original.pages.first.page.headSeq});f.apply(next);
 expect(f.store.getProjection('watch')?.freshness).toBe('fresh');expect(()=>f.store.readProjectDelivery(f.strong)).toThrow(/unverified/);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_facts').get()).toMatchObject({n:1});
});
it.each(['failed','cancelled'])('does not treat a generic %s event as an allowed negative freshness operation',kind=>{
 const f=fixture();expect(()=>f.store.ingest('watch',{...f.retained().events[0],kind})).toThrow('activity_project_source_delivery_required');expect(f.store.getProjection('watch')?.executionState).toBe('accepted');
});
it('does not grant ambient authority and rejects expired, copied and foreign Store write capabilities',()=>{
 const f=fixture(),other=fixture(),write=f.store.setFreshness.bind(f.store);let issued:Parameters<ConversationActivityStore['setFreshness']>[3];
 f.store.setFreshness=(watchId,freshness,errorCode,capability)=>{issued=capability;expect(()=>write(watchId,'fresh')).toThrow('activity_project_source_delivery_required');expect(()=>other.store.setFreshness(watchId,'fresh',undefined,capability)).toThrow('activity_project_source_delivery_required');return write(watchId,freshness,errorCode,capability);};
 f.apply();expect(issued).toBeDefined();expect(()=>write('watch','fresh',undefined,issued)).toThrow('activity_project_source_delivery_required');expect(()=>write('watch','fresh',undefined,{...issued!})).toThrow('activity_project_source_delivery_required');
});
it('rechecks the actual source before the retained transaction commits after its final event INSERT',()=>{
 const f=fixture(),prepare=f.db.prepare.bind(f.db);let inserts=0;
 f.db.prepare=((sql:string)=>{const statement=prepare(sql);if(sql==='INSERT INTO source_events VALUES(?,?,?)'){const run=statement.run.bind(statement);statement.run=(...args:Parameters<typeof statement.run>)=>{const result=run(...args);if(++inserts===original.pages.first.page.events.length)f.revoke();return result;};}return statement;}) as typeof f.db.prepare;
 expect(()=>f.apply()).toThrow(f.cause);expect(inserts).toBe(original.pages.first.page.events.length);expect(f.db.prepare('SELECT COUNT(*) AS n FROM source_events').get()).toMatchObject({n:0});expect(f.store.getProjection('watch')?.sourceSequence).toBe(0);
});
it('preserves a real writer failure even when the actual source is withdrawn at the failing call',()=>{
 const f=fixture(),prepare=f.db.prepare.bind(f.db),physical=Error('actual_ordinary_sql_failure');
 f.db.prepare=((sql:string)=>{if(sql==='INSERT INTO source_events VALUES(?,?,?)'){f.revoke();throw physical;}return prepare(sql);}) as typeof f.db.prepare;
 expect(()=>f.apply()).toThrow(physical);expect(f.db.prepare('SELECT COUNT(*) AS n FROM source_events').get()).toMatchObject({n:0});
});
it('retains a genuinely committed event prefix and revoked witness when the later freshness transaction fails',()=>{
 const f=fixture();f.apply();f.store.acceptProjectDelivery(f.strong);const originalPage=original.pages.first.page,seq=originalPage.headSeq+1;
 const {executionStarted:_started,...last}=originalPage.events.at(-1)!;
 // Controlled ordinary delta through the fixed host fixture, not a claim that
 // the original B business fixture emitted this additional heartbeat.
 const next=Object.freeze({}),page={...originalPage,headSeq:seq,nextCursor:seq,coveredThrough:seq,snapshotRevision:String(seq),gap:false,gapRanges:[],delivery:{status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'},events:[{...last,eventId:'p#'+seq,sourceRevision:String(seq),sourceSequence:seq,kind:'heartbeat',evidenceRefs:[]}]};
 f.frames.set(next,{...f.frames.get(f.frame)!,page,after:originalPage.headSeq});
 const prepare=f.db.prepare.bind(f.db),exec=f.db.exec.bind(f.db),fresh=f.store.setFreshness.bind(f.store),physical=Error('actual_fresh_projection_sql_failure');let commits=0,writingFresh=false;
 f.db.exec=(sql:string)=>{const result=exec(sql);if(sql==='COMMIT')commits++;return result;};f.store.setFreshness=(...args)=>{writingFresh=true;return fresh(...args);};
 f.db.prepare=((sql:string)=>{if(writingFresh&&sql.startsWith('INSERT INTO work_projections'))throw physical;return prepare(sql);}) as typeof f.db.prepare;
 expect(()=>f.apply(next)).toThrow(physical);expect(commits).toBe(2);expect(f.store.getProjection('watch')?.sourceSequence).toBe(seq);expect(f.db.prepare('SELECT COUNT(*) AS n FROM source_events').get()).toMatchObject({n:originalPage.events.length+1});expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_witnesses').get()).toMatchObject({n:0});expect(()=>f.store.readProjectDelivery(f.strong)).toThrow(/unverified/);
});
