// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {CliArchiveImporter} from '../../electron/context-continuity/cli-archive.js';

async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'continuity-policy-mutation-')),service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'profile'}),actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};
 const sessions=join(root,'sessions');await new FileSessionStore(sessions).save({sessionId:'policy_mutation',cwd:root,createdAt:1,updatedAt:2,lineage:['policy_mutation'],messages:[{role:'user',content:[{type:'text',text:'ORIGINAL_CLAIMED_POLICY_EVIDENCE'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const importer=new CliArchiveImporter(service,actor,sessions),preview=await importer.preview({sessionId:'policy_mutation',operationId:'preview'}),claimed=await importer.claim({previewId:preview.previewId,manifestHash:preview.manifestHash,operationId:'claim'}),source=service.getConversation(actor,claimed.conversationId)!,target=service.createConversation(actor,{operationId:'target'}),ref=service.createReference(actor,{conversationId:source.id,expectedRevision:source.revision,operationId:'ref'}),grant=service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'attach'}),credential=service.issueExternalReader(actor,{operationId:'issue',targetConversationId:target.id,refIds:[ref.refId]});
 return {root,service,actor,source,target,ref,grant,credential,close(){service.close();rmSync(root,{recursive:true,force:true});}};
}
function commitFault(service:ContinuityService){
 const db=service.store.db,original=db.exec;let calls=0;
 db.exec=function(sql:string){if(sql==='COMMIT'){calls++;throw new Error('synthetic_actual_commit_failure');}return original.call(this,sql);};
 return {restore(){db.exec=original;},get calls(){return calls;}};
}
it('the real grant revoke uses the original transaction and a failed actual COMMIT cannot persist it',async()=>{
 const f=await fixture(),fault=commitFault(f.service);try{
  expect(()=>f.service.revokeGrant(f.actor,{grantId:f.grant.grantId})).toThrow('synthetic_actual_commit_failure');expect(fault.calls).toBe(1);
  expect(f.service.store.db.prepare('SELECT revoked,revision FROM read_grants WHERE id=?').get(f.grant.grantId)).toEqual({revoked:0,revision:1});
 }finally{fault.restore();f.close();}
});
it('the real external credential revoke also observes the original COMMIT failure',async()=>{
 const f=await fixture(),fault=commitFault(f.service);try{
  expect(()=>f.service.revokeExternalReader(f.actor,f.credential.credentialId)).toThrow('synthetic_actual_commit_failure');expect(fault.calls).toBe(1);
  expect(f.service.store.db.prepare('SELECT revoked FROM external_readers WHERE id=?').get(f.credential.credentialId)?.revoked).toBe(0);
 }finally{fault.restore();f.close();}
});
it('real definitive external contamination updates credential and consumed dependencies atomically',async()=>{
 const f=await fixture();try{
  const principal=f.service.authenticateExternalReader(f.credential.secret);f.service.resolveExternalReference(principal,{refId:f.ref.refId});
  f.service.revokeGrant(f.actor,{grantId:f.grant.grantId});
  f.service.store.db.exec("CREATE TEMP TRIGGER deny_contamination BEFORE UPDATE OF valid ON external_reader_dependencies BEGIN SELECT RAISE(ABORT,'synthetic_dependency_failure'); END");
  expect(()=>f.service.authenticateExternalReader(f.credential.secret)).toThrow('synthetic_dependency_failure');
  expect(f.service.store.db.prepare('SELECT revoked FROM external_readers WHERE id=?').get(f.credential.credentialId)?.revoked).toBe(0);
  expect(f.service.store.db.prepare('SELECT valid FROM external_reader_dependencies WHERE credential_id=?').get(f.credential.credentialId)?.valid).toBe(1);
  f.service.store.db.exec('DROP TRIGGER deny_contamination');expect(()=>f.service.authenticateExternalReader(f.credential.secret)).toThrow('not_readable');
  expect(f.service.store.db.prepare('SELECT revoked FROM external_readers WHERE id=?').get(f.credential.credentialId)?.revoked).toBe(1);
 }finally{f.close();}
});
it('original canonical transactions cannot COMMIT an asynchronous or thenable callback result',async()=>{
 const f=await fixture();try{
  let getterCalls=0;const promise=Promise.resolve('late');Object.defineProperty(promise,'constructor',{get(){getterCalls++;throw new Error('must_not_read_promise_constructor');}});
  for(const result of [promise,{then(){throw new Error('must_not_call_then');}},Object.defineProperty({},'then',{get(){getterCalls++;throw new Error('must_not_read_then');}})]){
   expect(()=>f.service.store.transaction(()=>{f.service.store.db.prepare('INSERT INTO continuity_meta VALUES (?,?)').run('async-test','not-committed');return result;})).toThrow('async_transaction_not_supported');
   expect(f.service.store.db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('async-test')).toBeUndefined();
  }
  expect(getterCalls).toBe(0);
 }finally{f.close();}
});
it('a failed original positive external dependency write emits no reference page and can recover',async()=>{
 const f=await fixture();try{
  const principal=f.service.authenticateExternalReader(f.credential.secret);let page;
  f.service.store.db.exec("CREATE TEMP TRIGGER deny_consumption BEFORE INSERT ON external_reader_dependencies BEGIN SELECT RAISE(ABORT,'synthetic_consumption_failure'); END");
  expect(()=>{page=f.service.resolveExternalReference(principal,{refId:f.ref.refId});}).toThrow('synthetic_consumption_failure');expect(page).toBeUndefined();
  expect(f.service.store.db.prepare('SELECT * FROM external_reader_dependencies').all()).toEqual([]);
  f.service.store.db.exec('DROP TRIGGER deny_consumption');page=f.service.resolveExternalReference(principal,{refId:f.ref.refId});f.service.assertExternalReferenceCurrent(page,principal);expect(page.messages[0].text).toBe('ORIGINAL_CLAIMED_POLICY_EVIDENCE');
 }finally{f.close();}
});
it('nested original policy changes remain part of the actual outer rollback',async()=>{
 const f=await fixture();try{
  expect(()=>f.service.store.policyMutation(()=>{f.service.revokeGrant(f.actor,{grantId:f.grant.grantId});f.service.revokeExternalReader(f.actor,f.credential.credentialId);throw new Error('synthetic_outer_failure');})).toThrow('synthetic_outer_failure');
  expect(f.service.store.db.prepare('SELECT revoked FROM read_grants WHERE id=?').get(f.grant.grantId)?.revoked).toBe(0);expect(f.service.store.db.prepare('SELECT revoked FROM external_readers WHERE id=?').get(f.credential.credentialId)?.revoked).toBe(0);
  const principal=f.service.authenticateExternalReader(f.credential.secret),page=f.service.resolveExternalReference(principal,{refId:f.ref.refId});f.service.assertExternalReferenceCurrent(page,principal);
 }finally{f.close();}
});
