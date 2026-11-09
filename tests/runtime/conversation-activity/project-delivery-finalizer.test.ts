import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {originalProjectDeliveryFixture} from '../../support/original-project-delivery-fixture.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {AttentionWorkReader} from '../../../src/runtime/conversation-activity/attention-work-reader.js';
import {projectActivityAttention} from '../../../src/runtime/conversation-activity/attention-projector.js';
import {saveActivityProjectionLocked} from '../../../src/runtime/conversation-activity/activity-projection-locked.js';
let original:ReturnType<typeof originalProjectDeliveryFixture>;const cleanup:Array<()=>void>=[];
beforeAll(()=>{original=originalProjectDeliveryFixture();});afterAll(()=>original?.close());afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(ordinaryKind?:'started'|'input_required'|'blocked'){
 const root=mkdtempSync(join(tmpdir(),'project-delivery-finalizer-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const frames=new WeakMap<object,{watchId:string;body:unknown;after:number;demandId:string;assertCurrent():void}>(),ordinaryFrames=new WeakMap<object,{watchId:string;page:unknown;after:number;assertCurrent():void}>(),demand=randomUUID();
 const store=new ConversationActivityStore(join(root,'activity.sqlite'),{projectDeliverySource:frame=>{const record=frames.get(frame);if(!record)throw Error('project_source_forbidden');return record;},projectOrdinarySource:frame=>{const record=ordinaryFrames.get(frame);if(!record)throw Error('project_ordinary_source_forbidden');return record;}});cleanup.push(()=>store.close());
 const db=(store as unknown as{db:DatabaseSync}).db;
 let ordinaryPage:unknown=original.pages.first.page;
 const apply=(watchId='watch',page:unknown=ordinaryPage,after=0)=>{const frame=Object.freeze({});ordinaryFrames.set(frame,{watchId,page,after,assertCurrent(){}});store.applyProjectSourcePage(frame);};
 const bind=(id='watch')=>{store.prepareAssociation({operationId:id,creationIdempotencyKey:id,origin:{profileId:original.pages.first.scope.profileId,workspaceId:original.pages.first.scope.workspaceId,threadId:id,actorId:'user'}});store.bindWork({operationId:id,watchId:id,source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:original.pages.first.page.sourceDataEpoch,workId:'p'});const page=original.pages.first.page;
  // The B delivery head is original. These optional ordinary event fixtures
  // exercise independent ordinary priority through the real retained writer.
  const {executionStarted:_executionStarted,...last}=page.events.at(-1)!;
  const events=ordinaryKind?[{...last,eventId:'p#'+page.headSeq,sourceRevision:String(page.headSeq),kind:ordinaryKind,sourceSequence:page.headSeq}]:page.events;
  const gaps=ordinaryKind&&page.headSeq>1?[{from:1,through:page.headSeq-1,reason:'retention_expired'}]:page.gapRanges;
  const incoming={...page,events,gapRanges:gaps,...(ordinaryKind?{retainedFromSeq:page.headSeq,gap:page.headSeq>1}:{})};if(id==='watch')ordinaryPage=incoming;apply(id,incoming);};bind();
 const issue=(body=original.pages.first,after=0)=>{const frame=Object.freeze({});frames.set(frame,{watchId:'watch',body,after,demandId:demand,assertCurrent(){}});return frame;};
 const frame=issue();store.acceptProjectDelivery(frame);
 const fixed=store as ConversationActivityStore&{finalizeProjectDelivery(frame:object,input:unknown):any;assertProjectDeliveryRead(frame:object,expected:unknown):void};
 const capture=()=>{const c=store.captureAttentionRead('watch');return{expectedMembershipDigest:c.membershipDigest,expectedProjectionVersion:c.projectionVersion,expectedPresentationIncarnation:c.presentationIncarnation};};
 const finish=(input?:object,current=frame)=>fixed.finalizeProjectDelivery(current,{...capture(),...input});
 return{store:fixed,db,bind,apply,frame,issue,finish,capture,root,frames};
}
it('builds ready from the actual stored B fact without modifying the original projection or inventing questions',()=>{
 const f=fixture(),before=f.store.getProjection('watch'),result=f.finish();expect(result.view.presentation.deliveryStage).toBe('ready_for_acceptance');expect(result.view.presentation.questions).toEqual([]);expect(result.view.presentation.categoryRank).toBe(3);expect(f.store.getProjection('watch')).toEqual(before);f.store.assertProjectDeliveryRead(f.frame,result);
});
it('retains dismissal over a same-head reread and a real nonsemantic freshness heartbeat',()=>{
 const f=fixture(),first=f.finish(),dismiss={expectedProjectionVersion:first.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation};expect(f.finish({dismiss}).dismissed).toBe(true);
 expect(()=>f.store.setFreshness('watch','fresh')).toThrow('activity_project_source_delivery_required');f.apply();f.store.acceptProjectDelivery(f.frame);const next=f.finish();expect(next.projectionVersion).toBe(first.projectionVersion);expect(next.dismissed).toBe(true);
});
it('advances presentation after actual empty-page B ABA even without an intermediate Core read',()=>{
 const f=fixture(),first=f.finish();f.finish({dismiss:{expectedProjectionVersion:first.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation}});
 const middle=f.issue(original.pages.middle,original.pages.first.page.headSeq);f.store.acceptProjectDelivery(middle);const again=f.issue(original.pages.again,original.pages.first.page.headSeq);f.store.acceptProjectDelivery(again);
 const next=f.finish(undefined,again);expect(next.view.presentation.deliveryStage).toBe('ready_for_acceptance');expect(next.projectionVersion).toBe(first.projectionVersion+1);expect(next.dismissed).toBe(false);
});
it('requires the whole current alias set but does not bump semantic presentation for a newly qualified identical alias',()=>{
 const f=fixture(),first=f.finish();f.bind('alias');expect(()=>f.finish()).toThrow(/unverified/);f.store.acceptProjectDelivery(f.frame);const next=f.finish();expect(next.projectionVersion).toBe(first.projectionVersion);expect(()=>f.store.assertProjectDeliveryRead(f.frame,first)).toThrow(/conflict/);f.store.assertProjectDeliveryRead(f.frame,next);
});
it('rejects a stale original CAS before publishing a new presentation',()=>{
 const f=fixture(),captured=f.capture();f.bind('alias');f.store.acceptProjectDelivery(f.frame);expect(()=>f.store.finalizeProjectDelivery(f.frame,captured)).toThrow(/source_conflict/);expect(f.store.getAttentionPresentation('watch')).toBeNull();
});
it('does not let generic payload rebuilding or direct dismissal bypass the fixed project finalizer',()=>{
 const f=fixture(),first=f.finish(),captured=f.store.captureAttentionRead('watch');expect(()=>f.store.rebuildAttentionPresentation('watch',{expectedMembershipDigest:captured.membershipDigest,expectedProjectionVersion:captured.projectionVersion,expectedPresentationIncarnation:captured.presentationIncarnation,sourceFacts:[],questions:[],deliveryStage:'ready_to_deliver'})).toThrow(/project_delivery_source_required/);
 expect(()=>f.store.dismissAttentionPresentation('watch',first.projectionVersion,first.presentationIncarnation)).toThrow(/project_delivery_source_required/);
 expect(()=>f.store.finalizeAttentionReadRound('watch',{...f.capture(),inventories:[]})).toThrow(/project_delivery_source_required/);
});
it('rejects copied result receipts even with the same apparent full state',()=>{
 const f=fixture(),first=f.finish();expect(()=>f.store.assertProjectDeliveryRead(f.frame,{...first})).toThrow('project_delivery_read_foreign');
});
it.each(['input_required','blocked'] as const)('preserves ordinary %s priority over B ready without fabricating questions',kind=>{
 const f=fixture(kind),result=f.finish();expect(result.view.presentation.categoryRank).toBe(kind==='input_required'?0:2);expect(result.view.presentation.questions).toEqual([]);expect(result.view.projection.executionState).toBe(kind);expect(result.view.presentation.deliveryStage).toBe('ready_for_acceptance');
});
it('retains ordinary ABA lineage with the same B head through original locked data-owner commits',()=>{
 const f=fixture('started'),first=f.finish();f.finish({dismiss:{expectedProjectionVersion:first.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation}});
 const epoch=original.pages.first.page.sourceDataEpoch,seq=original.pages.first.page.headSeq;
 expect(()=>f.store.reconcileSnapshot('watch',epoch,seq,'blocked',false)).toThrow('activity_project_source_delivery_required');
 // Represent prior authoritative ordinary data-owner commits through its
 // original locked primitive. This is a metadata lineage fixture, not proof
 // that a generic caller can authorize new Source writes or choose a status.
 const transaction=(f.store as unknown as{transaction<T>(run:()=>T):T}).transaction.bind(f.store);
 const ids=[f.store.getOrdinaryAttentionFact('watch').factId],headBefore=f.store.readProjectDelivery(f.frame)!.head;
 for(const state of ['blocked','running'] as const){transaction(()=>{const watch=f.store.getWatch('watch')!,previous=f.store.getProjection('watch')!;saveActivityProjectionLocked(f.db,watch,{...previous,executionState:state,businessOutcome:'unknown',revision:previous.revision+1},{kind:'snapshot',id:'historical-ordinary-'+state,core:{executionState:state,businessOutcome:'unknown'}});});const committed=f.store.getOrdinaryAttentionFact('watch');expect(committed.executionState).toBe(state);ids.push(committed.factId);}
 expect(new Set(ids).size).toBe(3);f.apply();f.store.acceptProjectDelivery(f.frame);expect(f.store.readProjectDelivery(f.frame)!.head).toEqual(headBefore);const next=f.finish();expect(next.projectionVersion).toBe(first.projectionVersion+1);expect(next.dismissed).toBe(false);
});
it.each(['body','dismiss'])('rolls back when SQLite ignores an existing presentation %s update',kind=>{
 const f=fixture(),first=f.finish();f.db.exec(kind==='body'?"CREATE TRIGGER ignore_existing_body BEFORE UPDATE ON activity_attention_bodies BEGIN SELECT RAISE(IGNORE); END":"CREATE TRIGGER ignore_existing_dismiss BEFORE UPDATE ON activity_attention_heads WHEN NEW.dismissed_version<>OLD.dismissed_version BEGIN SELECT RAISE(IGNORE); END");
 expect(()=>f.finish(kind==='dismiss'?{dismiss:{expectedProjectionVersion:first.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation}}:undefined)).toThrow(/attention_projection_conflict/);f.store.assertProjectDeliveryRead(f.frame,first);
});
it('fails closed at the original public WorkReader when a real alias joins after finalizer COMMIT',async()=>{
 const f=fixture(),base=async()=>{const watch=f.store.getWatch('watch')!,projection=f.store.getProjection('watch')!;return{watch,projection,presentation:projectActivityAttention(watch,projection)};};
 const reader=new AttentionWorkReader({base,assertNative(){},reader:{hasBinding:()=>false,assertCurrent(){},async collect(){throw Error('unexpected_inventory');}},async begin(){throw Error('unexpected_inventory');},async finalize(){throw Error('unexpected_inventory');},abort(){},project:async()=>{const result=f.finish();queueMicrotask(()=>f.bind('alias'));return{view:result.view,assertCurrent:()=>f.store.assertProjectDeliveryRead(f.frame,result)};}});
 const view=await reader.getWork('watch',{actorId:'user',requestSource:'user'});expect(view.projection.freshness).toBe('unavailable');expect(view.presentation?.deliveryStage).toBe('none');
});
it.each(['rebuild','finalize','dismiss'])('does not reopen generic %s after the permanent project namespace row is damaged',kind=>{
 const f=fixture(),first=f.finish(),captured=f.capture();f.db.exec('DROP TRIGGER activity_project_delivery_namespaces_delete');f.db.exec('DELETE FROM activity_project_delivery_namespaces');
 const call=()=>kind==='rebuild'?f.store.rebuildAttentionPresentation('watch',{...captured,sourceFacts:[],questions:[],deliveryStage:'ready_to_deliver'}):kind==='finalize'?f.store.finalizeAttentionReadRound('watch',{...captured,inventories:[]}):f.store.dismissAttentionPresentation('watch',first.projectionVersion,first.presentationIncarnation);
 expect(call).toThrow(/project_delivery_source_required/);expect(f.store.getAttentionPresentation('watch')?.dismissed).toBe(false);expect(f.store.getAttentionPresentation('watch')?.presentation?.deliveryStage).toBe('ready_for_acceptance');
});
it('rejects stale source frames at the fixed finalizer sibling as well as the read port',()=>{
 const f=fixture(),again=f.issue(original.pages.again,original.pages.first.page.headSeq);f.store.acceptProjectDelivery(again);expect(()=>f.finish()).toThrow(/source_conflict/);
});
it('rejects a result whose original presentation was subsequently dismissed',()=>{
 const f=fixture(),first=f.finish();f.finish({dismiss:{expectedProjectionVersion:first.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation}});expect(()=>f.store.assertProjectDeliveryRead(f.frame,first)).toThrow(/conflict/);
});
it.each(['namespaces','heads','bodies'])('does not publish success when SQLite ignores the original presentation %s write',table=>{
 const f=fixture();f.db.exec(`CREATE TRIGGER ignore_presentation_write BEFORE INSERT ON activity_attention_${table} BEGIN SELECT RAISE(IGNORE); END`);expect(()=>f.finish()).toThrow(/(attention_|constraint|FOREIGN KEY)/);expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_attention_heads').get()).toMatchObject({n:0});expect(f.db.prepare('SELECT COUNT(*) AS n FROM activity_attention_core_facts').get()).toMatchObject({n:0});
});
it('presents original B ready independently of the unchanged accepted ordinary fact',()=>{
 const f=fixture(),before=f.store.getOrdinaryAttentionFact('watch'),result=f.finish(),head=original.pages.first.page.delivery.head;
 expect(result.view.projection.executionState).toBe('accepted');expect(f.store.getOrdinaryAttentionFact('watch')).toEqual(before);
 expect(result.view.presentation.primaryReason).toBe('review_required');expect(result.view.presentation.reasons.some(reason=>reason.code==='owner_create_pending')).toBe(false);
 expect(result.view.presentation.sourceFacts.some(fact=>fact.reasonCode==='queued')).toBe(true);
 expect(result.view.presentation.sourceFacts.find(fact=>fact.reasonCode==='ordinary_ready')).toMatchObject({profile:'activity',factId:head.factId,revision:head.deliveryRevision,evidenceRefs:[head.factId]});
});
it('does not append a ready reason for the actual empty-cursor B none head',()=>{
 const f=fixture(),frame=f.issue(original.pages.middle,original.pages.first.page.headSeq);f.store.acceptProjectDelivery(frame);const result=f.finish(undefined,frame);
 expect(result.view.presentation.deliveryStage).toBe('none');expect(result.view.presentation.sourceFacts.some(fact=>fact.reasonCode==='ordinary_ready')).toBe(false);
});

function forwardView(result:ReturnType<ReturnType<typeof fixture>['finish']>){return{...result.view,attentionState:{presentationIncarnation:result.presentationIncarnation,dismissed:result.dismissed}};}
it('captures a real project read stamp and verifies it on a second readonly Store without writing',()=>{
 const f=fixture(),result=f.finish(),view=forwardView(result),stamp=f.store.captureProjectForwardStamp(f.frame,result),reader=new ConversationActivityStore(join(f.root,'activity.sqlite'),{readOnly:true});
 try{const db=(reader as unknown as{db:DatabaseSync}).db,before=db.prepare('SELECT total_changes() AS n').get();expect(()=>reader.assertProjectForwardSnapshot(stamp,view)).not.toThrow();expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before);expect(()=>reader.assertProjectForwardSnapshot(JSON.parse(JSON.stringify(stamp)),JSON.parse(JSON.stringify(view)))).not.toThrow();expect(()=>reader.setFreshness('watch','unavailable')).toThrow('conversation_activity_readonly');}
 finally{reader.close();}
});
it('does not capture a forwarding stamp from a copied finalizer receipt or different private frame',()=>{
 const f=fixture(),result=f.finish();expect(()=>f.store.captureProjectForwardStamp(f.frame,{...result})).toThrow('project_delivery_read_foreign');expect(()=>f.store.captureProjectForwardStamp(f.issue(),result)).toThrow('project_delivery_read_foreign');
});
it.each(['demand','hash','watch','view','extra'] as const)('rejects changed project forwarding data (%s)',kind=>{
 const f=fixture(),result=f.finish(),view=forwardView(result),stamp=f.store.captureProjectForwardStamp(f.frame,result);
 const changed=kind==='demand'?{...stamp,demandId:randomUUID()}:kind==='hash'?{...stamp,stateDigest:'0'.repeat(64)}:kind==='watch'?{...stamp,watchId:'other'}:kind==='extra'?{...stamp,extra:true}:stamp;
 expect(()=>f.store.assertProjectForwardSnapshot(changed,kind==='view'?{...view,attentionState:{...view.attentionState,dismissed:true}}:view)).toThrow();
});
it.each(['alias','projection','witness','body','dismiss','tombstone','sourceDigest','bodyBytes'] as const)('rejects a project snapshot after actual database %s changes',kind=>{
 const f=fixture(),result=f.finish(),view=forwardView(result),stamp=f.store.captureProjectForwardStamp(f.frame,result),reader=new ConversationActivityStore(join(f.root,'activity.sqlite'),{readOnly:true});
 try{
  if(kind==='alias')f.bind('alias');
  else if(kind==='projection')f.db.prepare("UPDATE work_projections SET data_json=json_set(data_json,'$.summary','ordinary ABA') WHERE watch_id='watch'").run();
  else if(kind==='witness')f.db.prepare("UPDATE activity_project_delivery_witnesses SET demand_id=? WHERE watch_id='watch'").run(randomUUID());
  else if(kind==='body')f.db.exec("UPDATE activity_attention_bodies SET data_json='{}'");
  else if(kind==='dismiss')f.finish({dismiss:{expectedProjectionVersion:result.projectionVersion,expectedPresentationIncarnation:result.presentationIncarnation}});
  else if(kind==='tombstone')f.store.deleteThread(view.watch.origin.profileId,'watch','delete-test');
  else if(kind==='sourceDigest'){f.db.exec('DROP TRIGGER activity_attention_head_update');f.db.prepare("UPDATE activity_attention_heads SET source_digest=?").run('0'.repeat(64));}
  else{const row=f.db.prepare('SELECT data_json FROM activity_attention_bodies').get() as{data_json:string},bytes=JSON.stringify(JSON.parse(row.data_json),null,2);f.db.prepare('UPDATE activity_attention_bodies SET data_json=?').run(bytes);f.db.prepare('UPDATE activity_attention_heads SET body_digest=?').run(createHash('sha256').update(bytes).digest('hex'));}
  expect(()=>reader.assertProjectForwardSnapshot(stamp,view)).toThrow();
 }finally{reader.close();}
});
it('rejects executable forwarding data without calling its getter or proxy trap',()=>{
 const f=fixture(),result=f.finish(),view=forwardView(result),stamp=f.store.captureProjectForwardStamp(f.frame,result);let calls=0;
 const getter=Object.defineProperty({...stamp},'stateDigest',{enumerable:true,get(){calls++;return stamp.stateDigest;}}),proxy=new Proxy(stamp,{get(){calls++;throw Error('must_not_run');}});
 expect(()=>f.store.assertProjectForwardSnapshot(getter,view)).toThrow();expect(()=>f.store.assertProjectForwardSnapshot(proxy,view)).toThrow();expect(calls).toBe(0);
});

it('verifies a real known-none head and retains the actual dismissal CAS in a readonly snapshot',()=>{
 const f=fixture(),none=f.issue(original.pages.middle,original.pages.first.page.headSeq);f.store.acceptProjectDelivery(none);const result=f.finish(undefined,none),view=forwardView(result),stamp=f.store.captureProjectForwardStamp(none,result);
 expect(view.presentation.deliveryStage).toBe('none');const reader=new ConversationActivityStore(join(f.root,'activity.sqlite'),{readOnly:true});
 try{reader.assertProjectForwardSnapshot(stamp,view);const dismissed=f.finish({dismiss:{expectedProjectionVersion:result.projectionVersion,expectedPresentationIncarnation:result.presentationIncarnation}},none);expect(dismissed.dismissed).toBe(true);expect(()=>reader.assertProjectForwardSnapshot(stamp,view)).toThrow();reader.assertProjectForwardSnapshot(f.store.captureProjectForwardStamp(none,dismissed),forwardView(dismissed));}finally{reader.close();}
});
it.each(['BEGIN','COMMIT','ROLLBACK'] as const)('preserves the original readonly %s failure and fences unknown snapshots',phase=>{
 const f=fixture(),result=f.finish(),view=forwardView(result),stamp=f.store.captureProjectForwardStamp(f.frame,result),reader=new ConversationActivityStore(join(f.root,'activity.sqlite'),{readOnly:true}),db=(reader as unknown as{db:DatabaseSync}).db,exec=db.exec.bind(db),cause=Error('actual_read_'+phase),secondary=Error('actual_read_rollback_failure');
 let fired=false;const spy=vi.spyOn(db,'exec').mockImplementation(sql=>{if(!fired&&sql===phase){fired=true;throw cause;}if(phase==='ROLLBACK'&&sql==='COMMIT')throw secondary;return exec(sql);});
 try{expect(()=>reader.assertProjectForwardSnapshot(stamp,view)).toThrow(phase==='ROLLBACK'?secondary:cause);expect(fired).toBe(true);expect(()=>reader.assertProjectForwardSnapshot(stamp,view)).toThrow('conversation_activity_read_unconfirmed');}
 finally{spy.mockRestore();try{exec('ROLLBACK');}catch{/* BEGIN may never have opened a transaction. */}reader.close();}
});
it('keeps readonly verification closed after its original Store is closed',()=>{
 const f=fixture(),result=f.finish(),stamp=f.store.captureProjectForwardStamp(f.frame,result),reader=new ConversationActivityStore(join(f.root,'activity.sqlite'),{readOnly:true});reader.close();expect(()=>reader.assertProjectForwardSnapshot(stamp,forwardView(result))).toThrow('conversation_activity_store_closed');
});

it('does not capture a different valid cached body as the original finalizer view at the same CAS',()=>{
 const f=fixture(),result=f.finish(),row=f.db.prepare('SELECT data_json FROM activity_attention_bodies').get() as{data_json:string},body=JSON.parse(row.data_json);body.factRevision++;
 const bytes=JSON.stringify(body);f.db.prepare('UPDATE activity_attention_bodies SET data_json=?').run(bytes);f.db.prepare('UPDATE activity_attention_heads SET body_digest=?').run(createHash('sha256').update(bytes).digest('hex'));
 expect(()=>f.store.captureProjectForwardStamp(f.frame,result)).toThrow('project_delivery_read_conflict');
});
it('does not return a snapshot after a synchronous Source guard catches a nested BEGIN failure',()=>{
 const f=fixture(),result=f.finish(),stamp=f.store.captureProjectForwardStamp(f.frame,result),view=forwardView(result),exec=f.db.exec.bind(f.db);let inside=false,nested=false;
 const spy=vi.spyOn(f.db,'exec').mockImplementation(sql=>{const value=exec(sql);if(sql==='BEGIN')inside=true;if(sql==='COMMIT'||sql==='ROLLBACK')inside=false;return value;});
 f.frames.get(f.frame)!.assertCurrent=()=>{if(inside&&!nested){nested=true;try{f.store.assertProjectForwardSnapshot(stamp,view);}catch{/* A caught nested error must still fence the outer return. */}}};
 try{expect(()=>f.store.captureProjectForwardStamp(f.frame,result)).toThrow('conversation_activity_read_unconfirmed');expect(nested).toBe(true);}finally{spy.mockRestore();}
});
it('fences a nested snapshot failure caught by the final Source guard after snapshot COMMIT returned',()=>{
 const f=fixture(),result=f.finish(),stamp=f.store.captureProjectForwardStamp(f.frame,result),view=forwardView(result),exec=f.db.exec.bind(f.db);let readActive=false,writeActive=false,readCommitted=false,nested=false;
 const spy=vi.spyOn(f.db,'exec').mockImplementation(sql=>{const value=exec(sql);if(sql==='BEGIN')readActive=true;if(sql==='BEGIN IMMEDIATE')writeActive=true;if(sql==='COMMIT'||sql==='ROLLBACK'){if(sql==='COMMIT'&&readActive)readCommitted=true;readActive=false;writeActive=false;}return value;});
 f.frames.get(f.frame)!.assertCurrent=()=>{if(readCommitted&&writeActive&&!nested){nested=true;try{f.store.assertProjectForwardSnapshot(stamp,view);}catch{/* Final guard cannot hide the nested unknown state. */}}};
 try{expect(()=>f.store.captureProjectForwardStamp(f.frame,result)).toThrow('conversation_activity_read_unconfirmed');expect(nested).toBe(true);}finally{spy.mockRestore();}
});
