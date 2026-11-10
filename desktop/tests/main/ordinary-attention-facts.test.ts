import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';

describe('original activity ordinary state facts',()=>{
 let root:string,file:string,now:number,store:ConversationActivityStore;
 beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'ordinary-attention-'));file=join(root,'activity.sqlite');now=1;store=new ConversationActivityStore(file,{now:()=>now});
  store.prepareAssociation({operationId:'op',creationIdempotencyKey:'create',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'}});
  store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'hub',sourceDataEpoch:'epoch',workId:'project'});
 });
 afterEach(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const event=(kind:string,sourceSequence:number)=>({schemaVersion:1,eventId:'event:'+sourceSequence,source:'kswarm',logicalSourceId:'hub',sourceDataEpoch:'epoch',workId:'project',runId:'',transportGeneration:1,sourceSequence,kind,receivedAt:1,evidenceRefs:[]});
 it('preserves one actual owner fact through heartbeat/report/freshness and original reopen',()=>{
  const first=store.getOrdinaryAttentionFact('watch');expect(first.revision).toBe(1);expect(first.executionState).toBe('accepted');
  store.ingest('watch',event('heartbeat',1));now=store.getWatch('watch')!.nextReportDueAt;expect(store.reportDue()).toEqual(['watch']);store.setFreshness('watch','stale');store.setFreshness('watch','fresh');
  expect(store.getOrdinaryAttentionFact('watch')).toEqual(first);store.close();store=new ConversationActivityStore(file);expect(store.getOrdinaryAttentionFact('watch')).toEqual(first);
 });
 it('appends exactly once on a real accepted state transition and keeps replay and equal snapshots stable',()=>{
  const first=store.getOrdinaryAttentionFact('watch');store.ingest('watch',event('blocked',1));const blocked=store.getOrdinaryAttentionFact('watch');
  expect(blocked.revision).toBe(2);expect(blocked.factId).not.toBe(first.factId);expect(blocked.executionState).toBe('blocked');
  store.ingest('watch',event('blocked',1));store.reconcileSnapshot('watch','epoch',1,'blocked',false);expect(store.getOrdinaryAttentionFact('watch')).toEqual(blocked);
 });
 it('does not revalidate a missed old writer through noise or same-state ABA; a complete source snapshot creates a new version',()=>{
  const first=store.getOrdinaryAttentionFact('watch'),db=new DatabaseSync(file);try{
   for(const state of ['blocked','accepted'])db.prepare("UPDATE work_projections SET data_json=json_set(data_json,'$.revision',json_extract(data_json,'$.revision')+1,'$.executionState',?) WHERE watch_id='watch'").run(state);
  }finally{db.close();}
  expect(()=>store.getOrdinaryAttentionFact('watch')).toThrow('attention_source_unverified');store.setFreshness('watch','fresh');expect(()=>store.getOrdinaryAttentionFact('watch')).toThrow('attention_source_unverified');
  store.reconcileSnapshot('watch','epoch',0,'accepted',false);const restored=store.getOrdinaryAttentionFact('watch');expect(restored.revision).toBe(2);expect(restored.factId).not.toBe(first.factId);
 });
 for(const proof of ['snapshot','event'] as const)it(`cannot use a blocked ${proof} to certify a completed projection preserved by the original terminal latch`,()=>{
  const db=new DatabaseSync(file);try{db.exec("UPDATE work_projections SET data_json=json_set(data_json,'$.revision',1,'$.executionState','completed','$.businessOutcome','success') WHERE watch_id='watch'");}finally{db.close();}
  if(proof==='snapshot')store.reconcileSnapshot('watch','epoch',1,'blocked',false);else store.ingest('watch',event('blocked',1));
  expect(store.getProjection('watch')!.executionState).toBe('completed');expect(()=>store.getOrdinaryAttentionFact('watch')).toThrow('attention_source_unverified');
  store.reconcileSnapshot('watch','epoch',1,'completed',false);expect(store.getOrdinaryAttentionFact('watch')).toMatchObject({revision:2,executionState:'completed',businessOutcome:'success'});
 });
 it('rejects raw fact edits and head DELETE/REPLACE without relying on implicit DELETE triggers',()=>{
  const db=new DatabaseSync(file);try{
   expect(()=>db.exec('UPDATE activity_state_facts SET data_json=data_json')).toThrow(/immutable/);
   expect(()=>db.exec('INSERT OR REPLACE INTO activity_state_facts SELECT * FROM activity_state_facts')).toThrow(/immutable/);
   expect(()=>db.exec('DELETE FROM activity_state_heads')).toThrow(/immutable/);
   expect(()=>db.exec('INSERT OR REPLACE INTO activity_state_heads SELECT * FROM activity_state_heads')).toThrow(/immutable/);
  }finally{db.close();}
 });
 it('keeps the actual ordinary state fact after original source event retention removes its transport detail',()=>{
  store.ingest('watch',event('started',1));const running=store.getOrdinaryAttentionFact('watch');expect(store.getDiagnostics().sourceEvents).toBe(1);
  now=91*86400_000;store.pruneRetention();expect(store.getDiagnostics().sourceEvents).toBe(0);expect(store.getOrdinaryAttentionFact('watch')).toEqual(running);
 });
 it('records real executionStarted progress once while model summary text cannot create control facts',()=>{
  store.ingest('watch',{...event('progress',1),executionStarted:true});const running=store.getOrdinaryAttentionFact('watch');expect(running).toMatchObject({revision:2,executionState:'running'});
  store.ingest('watch',{...event('progress',2),summary:'delivery_unknown authorization_required completed'});expect(store.getOrdinaryAttentionFact('watch')).toEqual(running);
 });
 it('does not certify a state-changing history-gap snapshot or recreate a physically lost head',()=>{
  store.reconcileSnapshot('watch','epoch',3,'blocked',true);expect(()=>store.getOrdinaryAttentionFact('watch')).toThrow('attention_source_unverified');
  store.reconcileSnapshot('watch','epoch',3,'blocked',false);const db=new DatabaseSync(file);try{db.exec('DROP TRIGGER activity_state_head_delete; DELETE FROM activity_state_heads');}finally{db.close();}
  expect(()=>store.getOrdinaryAttentionFact('watch')).toThrow(/integrity/);expect(()=>store.reconcileSnapshot('watch','epoch',3,'blocked',false)).toThrow(/integrity/);
 });
 for(const committed of [false,true])it(`keeps original source and metadata atomic through actual COMMIT ${committed?'uncertainty':'failure'}`,()=>{
  const db=(store as unknown as {db:DatabaseSync}).db,exec=db.exec.bind(db),fault=Error('actual ordinary fact COMMIT fault');let armed=true;
  db.exec=(sql:string)=>{if(armed&&sql==='COMMIT'){armed=false;if(committed)exec(sql);throw fault;}return exec(sql);};
  expect(()=>store.ingest('watch',event('blocked',1))).toThrow(fault);db.exec=exec;store.close();store=new ConversationActivityStore(file);
  expect(store.getProjection('watch')!.executionState).toBe(committed?'blocked':'accepted');expect(store.getOrdinaryAttentionFact('watch').revision).toBe(committed?2:1);
 });
});
