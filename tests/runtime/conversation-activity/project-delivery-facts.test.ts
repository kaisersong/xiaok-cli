import {beforeAll,afterAll,afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {originalProjectDeliveryFixture} from '../../support/original-project-delivery-fixture.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {createAttentionPresentationStore} from '../../../src/runtime/conversation-activity/attention-presentation-store.js';
import {PROJECT_DELIVERY_FACT_SQL,createProjectDeliveryFacts} from '../../../src/runtime/conversation-activity/project-delivery-facts.js';
let original:ReturnType<typeof originalProjectDeliveryFixture>;const cleanup:Array<()=>void>=[];
beforeAll(()=>{original=originalProjectDeliveryFixture();});afterAll(()=>original?.close());afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'project-delivery-facts-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const sourceFrames=new WeakMap<object,{watchId:string;page:unknown;after:number;assertCurrent():void}>();
 const store=new ConversationActivityStore(join(root,'activity.sqlite'),{projectOrdinarySource:frame=>{const record=sourceFrames.get(frame);if(!record)throw Error('project_ordinary_source_forbidden');return record;}});cleanup.push(()=>store.close());
 const db=(store as unknown as{db:DatabaseSync}).db;db.exec(PROJECT_DELIVERY_FACT_SQL);
 // The real source query runs inside the original store transaction, without
 // opening a second transaction or reconstructing its membership algorithm.
 const presentation=createAttentionPresentationStore(db,run=>run()),facts=createProjectDeliveryFacts(db,id=>presentation.captureRead(id));
 const transaction=<T>(run:()=>T)=>(store as unknown as{transaction<T>(run:()=>T):T}).transaction(run);
 const apply=(watchId='watch')=>{const frame=Object.freeze({});sourceFrames.set(frame,{watchId,page:original.pages.first.page,after:0,assertCurrent(){}});store.applyProjectSourcePage(frame);};
 const bind=(id='watch')=>{
  store.prepareAssociation({operationId:id,creationIdempotencyKey:id,origin:{profileId:original.pages.first.scope.profileId,workspaceId:original.pages.first.scope.workspaceId,threadId:id,actorId:'user'}});
  store.bindWork({operationId:id,watchId:id,source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:original.pages.first.page.sourceDataEpoch,workId:'p'});
  apply(id);
 };
 bind();const demand=randomUUID();return{store,db,facts,transaction,bind,apply,demand,accept:(body=original.pages.first,after=0)=>transaction(()=>facts.accept('watch',body,after,demand)),read:()=>transaction(()=>facts.read('watch',demand))};
}
it('stores the actual B independent head and exact ordinary projection witnesses without changing the original projection',()=>{
 const f=fixture(),before=f.store.getProjection('watch');f.accept();const result=f.read();expect(result?.head.factId).toBe(original.pages.first.page.delivery.head.factId);expect(result?.head.core.stage).toBe('ready_for_acceptance');expect(f.store.getProjection('watch')).toEqual(before);
});
it('advances the actual empty-page delivery ABA without borrowing the event cursor',()=>{
 const f=fixture();f.accept();const first=f.read()!;f.accept(original.pages.middle,original.pages.first.page.headSeq);expect(f.read()?.head.core.stage).toBe('none');f.accept(original.pages.again,original.pages.first.page.headSeq);expect(f.read()?.head.core.stage).toBe('ready_for_acceptance');expect(f.read()?.head.deliveryRevision).toBe(first.head.deliveryRevision+2);expect(f.store.getProjection('watch')?.sourceSequence).toBe(original.pages.first.page.headSeq);
});
it('requires every actual active alias witness while deduplicating the physical B fact',()=>{
 const f=fixture();f.accept();const first=f.read()!;f.bind('alias');expect(()=>f.read()).toThrow(/unverified/);f.accept();expect(f.read()?.head.factId).toBe(first.head.factId);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_facts').get()).toMatchObject({n:1});
});
it('revokes witnesses without deleting the permanent namespace or fabricating a new B version',()=>{
 const f=fixture();f.accept();const before=f.read()!.head;f.transaction(()=>f.facts.invalidate('watch'));expect(()=>f.read()).toThrow(/unverified/);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_namespaces').get()).toMatchObject({n:1});f.accept();expect(f.read()?.head).toEqual(before);
});
it('does not wash an old-writer projection change through ordinary heartbeat or a reread of the same B head',()=>{
 const f=fixture();f.accept();const changed={...f.store.getProjection('watch')!,executionState:'running'};f.db.prepare('UPDATE work_projections SET data_json=? WHERE watch_id=?').run(JSON.stringify(changed),'watch');
 expect(()=>f.read()).toThrow(/unverified/);expect(()=>f.store.ingest('watch',{schemaVersion:1,eventId:'noise',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:original.pages.first.page.sourceDataEpoch,workId:'p',transportGeneration:0,sourceSequence:original.pages.first.page.headSeq+1,kind:'heartbeat',receivedAt:2,evidenceRefs:[]})).toThrow('activity_project_source_delivery_required');
 f.apply();expect(()=>f.read()).toThrow(/unverified/);expect(()=>f.accept()).toThrow();
});
it('never mints a replacement identity after the namespace remains but its head was lost',()=>{
 const f=fixture();f.accept();f.db.exec('DROP TRIGGER activity_project_delivery_head_delete');f.db.exec('DELETE FROM activity_project_delivery_heads');expect(()=>f.read()).toThrow(/integrity/);expect(()=>f.accept()).toThrow(/integrity/);
});
it('rejects an older committed B version',()=>{
 const f=fixture();f.accept(original.pages.again,original.pages.first.page.headSeq);expect(()=>f.accept()).toThrow(/revision/);
});
it('does not remint a damaged project whose only surviving reserved lineage is a witness',()=>{
 const f=fixture();f.accept();f.db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER activity_project_delivery_namespaces_delete; DROP TRIGGER activity_project_delivery_head_delete; DROP TRIGGER activity_project_delivery_facts_delete; DELETE FROM activity_project_delivery_heads; DELETE FROM activity_project_delivery_namespaces; DELETE FROM activity_project_delivery_facts;');
 expect(()=>f.read()).toThrow(/integrity/);expect(()=>f.accept()).toThrow(/integrity/);
});
it('does not report a qualified advance when an actual SQLite trigger ignores the head update',()=>{
 const f=fixture();f.accept();f.db.exec("CREATE TRIGGER ignore_delivery_head BEFORE UPDATE ON activity_project_delivery_heads BEGIN SELECT RAISE(IGNORE); END");
 expect(()=>f.accept(original.pages.again,original.pages.first.page.headSeq)).toThrow(/conflict/);
 expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_facts').get()).toMatchObject({n:1});expect(f.read()?.head.factId).toBe(original.pages.first.page.delivery.head.factId);
});
it('does not report full membership qualification when an actual SQLite trigger ignores a witness',()=>{
 const f=fixture();f.bind('alias');f.db.exec("CREATE TRIGGER ignore_delivery_witness BEFORE INSERT ON activity_project_delivery_witnesses WHEN NEW.watch_id='alias' BEGIN SELECT RAISE(IGNORE); END");
 expect(()=>f.accept()).toThrow(/conflict/);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_project_delivery_namespaces').get()).toMatchObject({n:0});
});
it.each(['invalidate','unknown'])('does not acknowledge %s revocation when SQLite silently retains the old witnesses',kind=>{
 const f=fixture();f.accept();expect(f.read()?.head.core.stage).toBe('ready_for_acceptance');f.db.exec("CREATE TRIGGER ignore_delivery_delete BEFORE DELETE ON activity_project_delivery_witnesses BEGIN SELECT RAISE(IGNORE); END");
 const unknown=structuredClone(original.pages.first);unknown.page.delivery={status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'};
 expect(()=>kind==='invalidate'?f.transaction(()=>f.facts.invalidate('watch')):f.accept(unknown)).toThrow(/conflict/);
 // The rejected transaction retains its old committed truth; its caller must
 // revoke the private demand first and may never report successful invalidation.
 expect(f.read()?.head.core.stage).toBe('ready_for_acceptance');
});
