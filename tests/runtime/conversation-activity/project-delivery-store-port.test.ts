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
function fixture(withPort=true){
 const root=mkdtempSync(join(tmpdir(),'project-delivery-port-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const frames=new WeakMap<object,{watchId:string;body:unknown;after:number;demandId:string;assertCurrent():void}>();let current=true;const cause=Error('actual_source_revoked');
 const port=(frame:object)=>{const state=frames.get(frame);if(!state)throw Error('project_source_forbidden');return state;};
 const options={...(withPort?{projectDeliverySource:port}:{})};const store=new ConversationActivityStore(join(root,'activity.sqlite'),options);cleanup.push(()=>store.close());
 store.prepareAssociation({operationId:'op',creationIdempotencyKey:'op',origin:{profileId:original.pages.first.scope.profileId,workspaceId:original.pages.first.scope.workspaceId,threadId:'thread',actorId:'user'}});
 store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:original.pages.first.page.sourceDataEpoch,workId:'p'});
 const page=original.pages.first.page;store.ingestRetainedPage('watch',{sourceDataEpoch:page.sourceDataEpoch,coveredThrough:page.coveredThrough,gapRanges:page.gapRanges,events:page.events.map((event:object)=>({...event,logicalSourceId:'kswarm',transportGeneration:0,receivedAt:1}))});
 const frame=Object.freeze({kind:'test_actual_host_frame'});frames.set(frame,{watchId:'watch',body:original.pages.first,after:0,demandId:randomUUID(),assertCurrent(){if(!current)throw cause;}});
 return{store:store as ConversationActivityStore&{acceptProjectDelivery(frame:object):void;readProjectDelivery(frame:object):{head:{factId:string}}|null;invalidateProjectDelivery(watchId:string):void},db:(store as unknown as{db:DatabaseSync}).db,options,frame,frames,cause,revoke:()=>{current=false;}};
}
it('accepts the original B head only through the fixed host frame port on the original Store connection',()=>{
 const f=fixture(),before=f.store.getProjection('watch');f.store.acceptProjectDelivery(f.frame);expect(f.store.readProjectDelivery(f.frame)?.head.factId).toBe(original.pages.first.page.delivery.head.factId);expect(f.store.getProjection('watch')).toEqual(before);
});
it('defaults to denying project fact writes when no fixed source port was installed',()=>{
 const f=fixture(false);expect(()=>f.store.acceptProjectDelivery(f.frame)).toThrow(/source.*(unsupported|required|forbidden)/);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_namespaces').get()).toMatchObject({n:0});
});
it('rejects a copied frame and does not trust a later constructor-options replacement',()=>{
 const f=fixture();f.options.projectDeliverySource=()=>f.frames.get(f.frame)!;expect(()=>f.store.acceptProjectDelivery({...f.frame})).toThrow('project_source_forbidden');
});
it('rechecks exact source currentness and preserves its original rejection',()=>{
 const f=fixture();f.store.acceptProjectDelivery(f.frame);f.revoke();expect(()=>f.store.readProjectDelivery(f.frame)).toThrow(f.cause);expect(()=>f.store.acceptProjectDelivery(f.frame)).toThrow(f.cause);
});
it('allows negative invalidation without granting a replacement B fact',()=>{
 const f=fixture();f.store.acceptProjectDelivery(f.frame);f.store.invalidateProjectDelivery('watch');expect(()=>f.store.readProjectDelivery(f.frame)).toThrow(/unverified/);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_facts').get()).toMatchObject({n:1});
});
it('rolls the original transaction back when the actual source guard withdraws during its body',()=>{
 const f=fixture(),record=f.frames.get(f.frame)!;let calls=0;record.assertCurrent=()=>{if(++calls===2)throw f.cause;};expect(()=>f.store.acceptProjectDelivery(f.frame)).toThrow(f.cause);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_namespaces').get()).toMatchObject({n:0});
});
it('rejects a Promise-returning fixed source guard before any project fact write',()=>{
 const f=fixture(),record=f.frames.get(f.frame)!;record.assertCurrent=async()=>{};expect(()=>f.store.acceptProjectDelivery(f.frame)).toThrow();expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_namespaces').get()).toMatchObject({n:0});
});
it('rejects delivery after a post-COMMIT withdrawal without claiming that the committed fact rolled back',()=>{
 const f=fixture(),record=f.frames.get(f.frame)!;let calls=0;record.assertCurrent=()=>{if(++calls===4){f.revoke();throw f.cause;}};
 expect(()=>f.store.acceptProjectDelivery(f.frame)).toThrow(f.cause);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_facts').get()).toMatchObject({n:1});
});
it('keeps the captured body and demand when a later guard mutates the original host record',()=>{
 const f=fixture(),record=f.frames.get(f.frame)!,firstDemand=record.demandId;let calls=0;
 record.assertCurrent=()=>{if(++calls===2){record.body={};record.demandId=randomUUID();}};f.store.acceptProjectDelivery(f.frame);
 expect(f.db.prepare('SELECT demand_id FROM activity_project_delivery_witnesses').get()).toMatchObject({demand_id:firstDemand});
 const row=f.db.prepare('SELECT data_json FROM activity_project_delivery_facts').get() as{data_json:string};expect(JSON.parse(row.data_json).factId).toBe(original.pages.first.page.delivery.head.factId);
});
it('does not acknowledge negative invalidation when the original SQLite writer ignores the delete',()=>{
 const f=fixture();f.store.acceptProjectDelivery(f.frame);f.db.exec("CREATE TRIGGER ignore_project_revoke BEFORE DELETE ON activity_project_delivery_witnesses BEGIN SELECT RAISE(IGNORE); END");expect(()=>f.store.invalidateProjectDelivery('watch')).toThrow(/conflict/);
});
it('does not commit after a guard catches a nested transaction failure and leaves write state unknown',()=>{
 const f=fixture(),record=f.frames.get(f.frame)!;let calls=0;record.assertCurrent=()=>{if(++calls===3)try{f.store.setFreshness('watch','fresh');}catch{/* The original BEGIN failure still fences the outer write. */}};
 expect(()=>f.store.acceptProjectDelivery(f.frame)).toThrow('conversation_activity_write_unconfirmed');expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_facts').get()).toMatchObject({n:0});
});
it.each(['middle','again','unknown'])('does not authorize the old database head with a different current scoped frame (%s)',which=>{
 const f=fixture();f.store.acceptProjectDelivery(f.frame);const next=Object.freeze({kind:'next_actual_host_frame'}),record=f.frames.get(f.frame)!;
 const body=which==='unknown'?{...structuredClone(original.pages.first),page:{...structuredClone(original.pages.first.page),delivery:{status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'}}}:original.pages[which];
 f.frames.set(next,{...record,body,after:which==='unknown'?0:original.pages.first.page.headSeq});expect(()=>f.store.readProjectDelivery(next)).toThrow(/(conflict|unverified)/);
});
it('does not authorize a newly committed B version with the older still-branded frame',()=>{
 const f=fixture();f.store.acceptProjectDelivery(f.frame);const next=Object.freeze({kind:'next_actual_host_frame'}),record=f.frames.get(f.frame)!;
 f.frames.set(next,{...record,body:original.pages.again,after:original.pages.first.page.headSeq});f.store.acceptProjectDelivery(next);expect(()=>f.store.readProjectDelivery(f.frame)).toThrow(/(conflict|unverified)/);
});
