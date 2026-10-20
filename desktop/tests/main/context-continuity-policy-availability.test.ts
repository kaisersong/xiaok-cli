// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {CliArchiveImporter} from '../../electron/context-continuity/cli-archive.js';

// Original policy ownership metadata only. No Task execution, closure receipt,
// settled state, imported body or model output is synthesized by these tests.
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'continuity-policy-availability-')),service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'profile'}),actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};
 const source=(id:string)=>{const conversation=service.createConversation(actor,{operationId:id});service.bindTask(actor,{conversationId:conversation.id,taskId:id});service.recordMessage(actor,{conversationId:conversation.id,sourceKind:'desktop_task',sourceId:id,sourceDataEpoch:'epoch-'+id,sourceMessageId:'public-user-input',sourceRevision:1,role:'user',text:'PUBLIC_OWNER_METADATA',executionState:'unknown'});return conversation.id;};
 return {root,service,actor,source,close(){service.close();rmSync(root,{recursive:true,force:true});}};
}
it('an unavailable source proof denies this read without permanently revoking an actual original dependency',()=>{
 const f=fixture();try{
  const scope=f.source('source');f.source('consumer');f.service.recordSourceTasks(f.actor,'consumer',['source']);
  f.service.setScopePolicy(id=>{if(id===scope)throw new Error('temporary_current_head_unavailable');return 'readable';});
  expect(()=>f.service.assertTaskReadable('consumer')).toThrow('not_readable');
  expect(f.service.store.db.prepare('SELECT valid FROM task_history_dependencies WHERE task_id=?').get('consumer')?.valid).toBe(1);
  f.service.setScopePolicy(()=>'readable');expect(()=>f.service.assertTaskReadable('consumer')).not.toThrow();
 }finally{f.close();}
});
it('does not permanently revoke a genuine external credential when its claimed archive proof is temporarily unavailable',async()=>{
 const f=fixture();try{
  const sessions=join(f.root,'sessions'),files=new FileSessionStore(sessions);
  await files.save({sessionId:'proof_external',cwd:f.root,createdAt:1,updatedAt:2,lineage:['proof_external'],messages:[{role:'user',content:[{type:'text',text:'GENUINE_CLAIMED_ARCHIVE'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
  const importer=new CliArchiveImporter(f.service,f.actor,sessions),preview=await importer.preview({sessionId:'proof_external',operationId:'preview'}),claimed=await importer.claim({previewId:preview.previewId,manifestHash:preview.manifestHash,operationId:'claim'});
  const source=f.service.getConversation(f.actor,claimed.conversationId)!,target=f.service.createConversation(f.actor,{operationId:'external-target'}),ref=f.service.createReference(f.actor,{conversationId:source.id,expectedRevision:source.revision,operationId:'external-ref'});
  f.service.attachReference(f.actor,{refId:ref.refId,targetConversationId:target.id,operationId:'external-attach'});
  const credential=f.service.issueExternalReader(f.actor,{operationId:'external-issue',refIds:[ref.refId],targetConversationId:target.id}),principal=f.service.authenticateExternalReader(credential.secret);
  expect(f.service.resolveExternalReference(principal,{refId:ref.refId}).messages[0].visibilityBasis).toBe('user_claimed_archive');
  f.service.setScopePolicy(id=>{if(id===source.id)throw new Error('temporary_external_source_unavailable');return 'readable';});
  expect(()=>f.service.authenticateExternalReader(credential.secret)).toThrow('not_readable');
  expect(f.service.store.db.prepare('SELECT revoked FROM external_readers WHERE id=?').get(credential.credentialId)?.revoked).toBe(0);
  expect(f.service.store.db.prepare('SELECT valid FROM external_reader_dependencies WHERE credential_id=?').get(credential.credentialId)?.valid).toBe(1);
  f.service.setScopePolicy(()=>'readable');expect(f.service.authenticateExternalReader(credential.secret).credentialId).toBe(credential.credentialId);
 }finally{f.close();}
});
it('propagates unavailable proof across real recursive dependency rows without washing it into sticky revocation',()=>{
 const f=fixture();try{
  const ancestor=f.source('ancestor');f.source('middle');f.source('consumer');f.service.recordSourceTasks(f.actor,'middle',['ancestor']);f.service.recordSourceTasks(f.actor,'consumer',['middle']);
  f.service.setScopePolicy(id=>{if(id===ancestor)throw new Error('native_floor_temporarily_unavailable');return 'readable';});
  expect(()=>f.service.assertTaskReadable('consumer')).toThrow('not_readable');expect(f.service.store.db.prepare('SELECT valid FROM task_history_dependencies ORDER BY task_id').all().map(row=>row.valid)).toEqual([1,1]);
  f.service.setScopePolicy(()=>'readable');expect(()=>f.service.assertTaskReadable('consumer')).not.toThrow();
 }finally{f.close();}
});
it('denies unknown configured scope results without treating them as either readable or confirmed revocation',()=>{
 for(const value of [undefined,null,false,'unknown',Promise.resolve('readable')]){
  const f=fixture();try{
   const scope=f.source('source');f.source('consumer');f.service.recordSourceTasks(f.actor,'consumer',['source']);
   f.service.setScopePolicy(((id:string)=>id===scope?value:'readable')as never);
   expect(()=>f.service.assertTaskReadable('consumer')).toThrow('not_readable');expect(f.service.store.db.prepare('SELECT valid FROM task_history_dependencies WHERE task_id=?').get('consumer')?.valid).toBe(1);
   f.service.setScopePolicy(()=>'readable');expect(()=>f.service.assertTaskReadable('consumer')).not.toThrow();
  }finally{f.close();}
 }
});
