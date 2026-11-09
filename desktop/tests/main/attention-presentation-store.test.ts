import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';

// Original SQLite owner entry points only. Facts below are metadata corpus,
// not an assertion that a live multiowner source or Native profile is ready.
describe('original activity presentation metadata owner',()=>{
 let root:string,file:string,store:ConversationActivityStore,now:number;
 const origin={profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'};
 const fact=(reasonCode='review_required',revision=1)=>({profile:'ordinary',schemaVersion:1,factId:'owner:fact',revision,reasonCode,evidenceRefs:[]});
 function bind(watchId='watch',epoch='epoch'){
  store.prepareAssociation({operationId:'op:'+watchId,creationIdempotencyKey:'create:'+watchId,origin});
  return store.bindWork({operationId:'op:'+watchId,watchId,source:'kswarm',logicalSourceId:'hub',sourceDataEpoch:epoch,workId:'project',runId:''});
 }
 function rebuild(sourceFacts=[fact()]){
  const expected=store.getAttentionSourceSnapshot('watch');
  return store.rebuildAttentionPresentation('watch',{expectedMembershipDigest:expected.membershipDigest,expectedProjectionVersion:expected.projectionVersion,expectedPresentationIncarnation:expected.presentationIncarnation,sourceFacts,questions:[],deliveryStage:'none'});
 }
 beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'attention-cache-'));file=join(root,'activity.sqlite');now=100;store=new ConversationActivityStore(file,{now:()=>now});bind();});
 afterEach(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 it('keeps the same presentation version and dismiss disposition through replay, body GC and actual reopen',()=>{
  const first=rebuild();expect(first.projectionVersion).toBe(1);expect(first.presentationIncarnation).toMatch(/^[a-f0-9-]{36}$/);
  expect(store.dismissAttentionPresentation('watch',first.projectionVersion,first.presentationIncarnation).dismissed).toBe(true);
  expect(rebuild().projectionVersion).toBe(1);expect(rebuild().dismissed).toBe(true);
  store.clearAttentionPresentationBody('watch',first.presentationIncarnation);expect(store.getAttentionPresentation('watch')?.presentation).toBeNull();
  const restored=rebuild();expect(restored.presentationIncarnation).toBe(first.presentationIncarnation);expect(restored.projectionVersion).toBe(1);expect(restored.dismissed).toBe(true);
  store.close();store=new ConversationActivityStore(file);expect(store.getAttentionPresentation('watch')).toEqual(restored);
 });
 it('advances for a real fact revision and rejects stale dismiss without changing original business projection',()=>{
  const first=rebuild(),before=store.getProjection('watch');store.dismissAttentionPresentation('watch',1,first.presentationIncarnation);
  const second=rebuild([fact('delivery_unknown',2)]);expect(second.projectionVersion).toBe(2);expect(second.dismissed).toBe(false);expect(second.presentation?.primaryReason).toBe('delivery_unknown');
  expect(()=>store.dismissAttentionPresentation('watch',1,first.presentationIncarnation)).toThrow(/conflict/);expect(store.getProjection('watch')).toEqual(before);
 });
 it('rejects a newly joined native source member even when the first watch revision did not change',()=>{
  const expected=store.getAttentionSourceSnapshot('watch');bind('second');
  expect(()=>store.rebuildAttentionPresentation('watch',{expectedMembershipDigest:expected.membershipDigest,expectedProjectionVersion:0,expectedPresentationIncarnation:null,sourceFacts:[fact()],questions:[],deliveryStage:'none'})).toThrow(/source.*conflict/);
  expect(store.getAttentionPresentation('watch')).toBeNull();
 });
 it('cannot forget or replace the head with raw DELETE, INSERT OR REPLACE or REPLACE INTO',()=>{
  rebuild();const db=new DatabaseSync(file);try{
   expect(()=>db.exec('DELETE FROM activity_attention_heads')).toThrow(/head.*immutable/);
   for(const verb of ['INSERT OR REPLACE','REPLACE'])expect(()=>db.exec(`${verb} INTO activity_attention_heads SELECT * FROM activity_attention_heads`)).toThrow(/head.*immutable/);
  }finally{db.close();}
 });
 it('requires exact incarnation as well as version and refuses missing or foreign watch identities',()=>{
  const first=rebuild();expect(()=>store.dismissAttentionPresentation('watch',first.projectionVersion,'00000000-0000-4000-8000-000000000000')).toThrow(/conflict/);
  expect(()=>store.dismissAttentionPresentation('watch',first.projectionVersion,undefined as never)).toThrow();expect(()=>store.getAttentionSourceSnapshot('not-owned')).toThrow();
  store.deleteThread('profile','thread','delete');expect(()=>store.dismissAttentionPresentation('watch',1,first.presentationIncarnation)).toThrow(/deleted/);
 });
 it('does not mint a fresh head when its permanent namespace proves a lost head after body GC',()=>{
  const first=rebuild();store.clearAttentionPresentationBody('watch',first.presentationIncarnation);
  const db=new DatabaseSync(file);try{
   // Physical-corruption injection only, not a claimed native permission.
   db.exec('DROP TRIGGER activity_attention_head_delete; DELETE FROM activity_attention_heads');
  }finally{db.close();}
  expect(()=>store.getAttentionSourceSnapshot('watch')).toThrow(/head.*integrity/);
  expect(()=>rebuild()).toThrow(/head.*integrity/);
 });
 it('does not serve a cached fresh projection after the original source changed without a cache-aware writer',()=>{
  rebuild();store.ingest('watch',{schemaVersion:1,eventId:'new-block',source:'kswarm',logicalSourceId:'hub',sourceDataEpoch:'epoch',workId:'project',runId:'',transportGeneration:1,sourceSequence:1,kind:'blocked',receivedAt:100,evidenceRefs:[]});
  expect(()=>store.getAttentionPresentation('watch')).toThrow(/source.*conflict/);expect(()=>store.dismissAttentionPresentation('watch',1,store.getAttentionSourceSnapshot('watch').presentationIncarnation!)).toThrow(/source.*conflict/);
 });
 it('detects valid-JSON cache body corruption and only rebuilds from fresh complete metadata without resetting dismiss',()=>{
  const first=rebuild();store.dismissAttentionPresentation('watch',1,first.presentationIncarnation);
  const db=new DatabaseSync(file);try{db.exec("UPDATE activity_attention_bodies SET data_json=json_set(data_json,'$.categoryRank',6)");}finally{db.close();}
  expect(()=>store.getAttentionPresentation('watch')).toThrow(/cache.*integrity/);const fixed=rebuild();expect(fixed.projectionVersion).toBe(1);expect(fixed.dismissed).toBe(true);expect(fixed.presentation?.categoryRank).toBe(2);
 });
 for(const afterCommit of [false,true])it(`preserves actual original commit ${afterCommit?'unknown-after-COMMIT':'failure-before-COMMIT'} without claiming a successful metadata write`,()=>{
  const expected=store.getAttentionSourceSnapshot('watch');
  const db=(store as unknown as {db:DatabaseSync}).db,exec=db.exec.bind(db),fault=Error('actual metadata COMMIT fault');let armed=true;
  db.exec=(sql:string)=>{if(armed&&sql==='COMMIT'){armed=false;if(afterCommit)exec(sql);throw fault;}return exec(sql);};
  expect(()=>store.rebuildAttentionPresentation('watch',{expectedMembershipDigest:expected.membershipDigest,expectedProjectionVersion:0,expectedPresentationIncarnation:null,sourceFacts:[fact()],questions:[],deliveryStage:'none'})).toThrow(fault);db.exec=exec;expect(()=>rebuild()).toThrow(/write_unconfirmed/);
  store.close();store=new ConversationActivityStore(file);const actual=store.getAttentionPresentation('watch');expect(Boolean(actual)).toBe(afterCommit);if(actual)expect(actual.projectionVersion).toBe(1);
 });
 it('bounds actual complete native membership and uses the indexed identity lookup',()=>{
  const db=(store as unknown as {db:DatabaseSync}).db;
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT watch_id FROM work_watches WHERE profile_id=? AND json_extract(data_json,'$.origin.workspaceId')=? AND json_extract(data_json,'$.source')=? AND json_extract(data_json,'$.logicalSourceId')=? AND json_extract(data_json,'$.sourceDataEpoch')=? AND json_extract(data_json,'$.workId')=? AND COALESCE(json_extract(data_json,'$.runId'),'')=?").all('profile','workspace','kswarm','hub','epoch','project','');
  expect(JSON.stringify(plan)).toContain('activity_attention_membership');
  for(let index=1;index<=512;index++)bind('alias'+index);
  expect(()=>store.getAttentionSourceSnapshot('watch')).toThrow(/membership_capacity/);
 });
 it('keeps stable complete owner facts dismissed through actual heartbeat, freshness and report bookkeeping',()=>{
  const first=rebuild();store.dismissAttentionPresentation('watch',1,first.presentationIncarnation);
  store.ingest('watch',{schemaVersion:1,eventId:'heartbeat',source:'kswarm',logicalSourceId:'hub',sourceDataEpoch:'epoch',workId:'project',runId:'',transportGeneration:1,sourceSequence:1,kind:'heartbeat',receivedAt:100,evidenceRefs:[]});store.setFreshness('watch','fresh');
  now=store.getWatch('watch')!.nextReportDueAt;expect(store.reportDue(new Set(['watch']))).toEqual(['watch']);expect(store.getProjection('watch')!.lastReportAt).toBe(now);
  const after=rebuild();expect(after.projectionVersion).toBe(1);expect(after.dismissed).toBe(true);expect(after.presentationIncarnation).toBe(first.presentationIncarnation);
 });
 it('advances once for each actual stale and fresh transition while preserving the stable owner fact',()=>{
  const first=rebuild();store.dismissAttentionPresentation('watch',1,first.presentationIncarnation);
  store.setFreshness('watch','stale');const stale=rebuild();expect(stale.projectionVersion).toBe(2);expect(stale.dismissed).toBe(false);expect(stale.presentation?.freshness).toBe('stale');
  expect(rebuild().projectionVersion).toBe(2);store.dismissAttentionPresentation('watch',2,first.presentationIncarnation);
  store.setFreshness('watch','fresh');const fresh=rebuild();expect(fresh.projectionVersion).toBe(3);expect(fresh.dismissed).toBe(false);expect(fresh.presentation?.sourceFacts).toEqual(stale.presentation?.sourceFacts);
 });
 it('cannot use a prior incarnation against a new empty activity database with coincident source IDs',()=>{
  const first=rebuild();store.close();file=join(root,'new-empty.sqlite');store=new ConversationActivityStore(file);bind();const next=rebuild();
  expect(next.projectionVersion).toBe(1);expect(next.presentationIncarnation).not.toBe(first.presentationIncarnation);
  expect(()=>store.dismissAttentionPresentation('watch',1,first.presentationIncarnation)).toThrow(/conflict/);
 });
 it('reads one coherent original source snapshot when a real second connection crosses the membership query',()=>{
  const db=(store as unknown as {db:DatabaseSync}).db,prepare=db.prepare.bind(db),other=new DatabaseSync(file);other.exec('PRAGMA busy_timeout=0');let armed=true;
  db.prepare=(sql:string)=>{if(armed&&sql.includes('SELECT w.watch_id,w.data_json AS watch_json')){armed=false;try{other.exec("UPDATE work_projections SET data_json=json_set(data_json,'$.revision',1,'$.executionState','blocked') WHERE watch_id='watch'");}catch(error){if(!/locked|busy/i.test(String(error)))throw error;}}return prepare(sql);};
  try{const first=store.getAttentionSourceSnapshot('watch');db.prepare=prepare;const second=store.getAttentionSourceSnapshot('watch');
   expect(first.sourceRevision===second.sourceRevision||first.membershipDigest!==second.membershipDigest).toBe(true);
  }finally{db.prepare=prepare;other.close();}
 });
});
