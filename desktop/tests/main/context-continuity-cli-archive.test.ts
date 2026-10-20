import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {CliArchiveImporter} from '../../electron/context-continuity/cli-archive.js';
const cleanups:Array<()=>void>=[];afterEach(()=>{for(const f of cleanups.splice(0).reverse())f();});
async function setup(){
 const root=mkdtempSync(join(tmpdir(),'xiaok-cli-archive-')),sessions=join(root,'sessions'),store=new FileSessionStore(sessions),service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'profile'}),actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}),()=>service.close());
 await store.save({sessionId:'sess_archive',cwd:root,createdAt:1,updatedAt:2,lineage:['sess_archive'],messages:[{role:'user',content:[{type:'text',text:'SAME_PUBLIC_TEXT'}]},{role:'assistant',content:[{type:'thinking',thinking:'PRIVATE_REASONING_CANARY'},{type:'text',text:'SAME_PUBLIC_TEXT'}]},{role:'user',content:[{type:'tool_result',tool_use_id:'private-tool',content:'PRIVATE_RESULT_CANARY'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 return {root,sessions,store,service,actor,importer:new CliArchiveImporter(service,actor,sessions),path:join(sessions,'sess_archive.json')};
}
it('imports actual FileSessionStore text as exact unknown versions without a fake Task or receipt',async()=>{
 const f=await setup(),list=await f.importer.list({});expect(list.items[0]?.sessionId).toBe('sess_archive');
 const p=await f.importer.preview({sessionId:'sess_archive',operationId:'preview'});expect(p.messageCount).toBe(2);
 const imported=await f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'claim'}),c=f.service.getConversation(f.actor,imported.conversationId)!;
 expect(c.coverage).toBe('partial');expect(c.taskIds).toEqual([]);expect(c.currentTaskId).toBeNull();
 const messages=f.service.listMessages(f.actor,c.id);expect(messages).toHaveLength(2);expect(messages[0].messageId).not.toBe(messages[1].messageId);expect(messages.map(m=>m.executionState)).toEqual(['unknown','unknown']);expect(JSON.stringify(messages)).not.toContain('PRIVATE_');expect(f.service.store.db.prepare('SELECT * FROM source_settlements').all()).toEqual([]);
 const result=f.service.searchHistory(f.actor,{query:'SAME_PUBLIC_TEXT',sourceKinds:['cli_session']});expect(result.hits).toHaveLength(2);
 const page=f.service.resolveReference(f.actor,{refId:result.hits[1].refId});expect(page.messages).toHaveLength(1);expect(page.messages[0].messageId).toBe(result.hits[1].messageId);expect(page.messages[0].visibilityBasis).toBe('user_claimed_archive');
});
it('reimport is idempotent and later CLI writes cannot change a committed exact reference',async()=>{
 const f=await setup(),p=await f.importer.preview({sessionId:'sess_archive',operationId:'p'}),a=await f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'a'});
 expect(await f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'a2'})).toEqual(a);expect(f.service.searchHistory(f.actor,{query:'SAME_PUBLIC_TEXT'}).hits).toHaveLength(2);
 const hit=f.service.searchHistory(f.actor,{query:'SAME_PUBLIC_TEXT'}).hits[0],snapshot=(await f.store.load('sess_archive'))!;snapshot.messages.push({role:'assistant',content:[{type:'text',text:'NEW_CONTENT'}]});await f.store.save(snapshot);
 expect(f.service.resolveReference(f.actor,{refId:hit.refId}).messages[0].text).toBe('SAME_PUBLIC_TEXT');expect(await f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'a'})).toEqual(a);await expect(f.importer.preview({sessionId:'sess_archive',operationId:'changed'})).rejects.toThrow('cli_source_changed');
});
it('preview source replacement fails before canonical claim commits',async()=>{
 const f=await setup(),p=await f.importer.preview({sessionId:'sess_archive',operationId:'p'}),bytes=JSON.parse(readFileSync(f.path,'utf8'));bytes.messages[0].content[0].text='CHANGED';writeFileSync(f.path,JSON.stringify(bytes));
 await expect(f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'a'})).rejects.toThrow('cli_source_changed');expect(f.service.listConversations(f.actor)).toEqual([]);
});
it('deletion preserves source identity and forbids new-operation or changed-file resurrection',async()=>{
 const f=await setup(),p=await f.importer.preview({sessionId:'sess_archive',operationId:'p'}),a=await f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'a'});f.service.tombstoneConversation(f.actor,a.conversationId);
 await expect(f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'b'})).rejects.toThrow('not_readable');await expect(f.importer.preview({sessionId:'sess_archive',operationId:'p2'})).rejects.toThrow('not_readable');
 const bytes=JSON.parse(readFileSync(f.path,'utf8'));bytes.updatedAt=3;writeFileSync(f.path,JSON.stringify(bytes));await expect(f.importer.preview({sessionId:'sess_archive',operationId:'p3'})).rejects.toThrow('not_readable');expect(f.service.searchHistory(f.actor,{query:'SAME_PUBLIC_TEXT'}).hits).toEqual([]);
});
it('dependency metadata is not laundered by archive claim',async()=>{
 for(const extra of [{continuityDependencies:[]},{memoryRefs:['unverified-memory']},{appliedCheckpoint:{id:'unverified'}},{storeRevision:1}]){const f=await setup(),bytes=JSON.parse(readFileSync(f.path,'utf8'));Object.assign(bytes,extra);writeFileSync(f.path,JSON.stringify(bytes));await expect(f.importer.preview({sessionId:'sess_archive',operationId:'p'})).rejects.toThrow('cli_source_unsupported');}
});
it('never follows arbitrary identifiers or symlinked source files',async()=>{
 const f=await setup();await expect(f.importer.preview({sessionId:'../sess_archive',operationId:'p'})).rejects.toThrow();const target=join(f.root,'elsewhere.json');writeFileSync(target,readFileSync(f.path));rmSync(f.path);symlinkSync(target,f.path);await expect(f.importer.preview({sessionId:'sess_archive',operationId:'p2'})).rejects.toThrow('cli_source_unavailable');
});
it('reply fences require the original actor/object and current preview file',async()=>{
 const f=await setup(),p=await f.importer.preview({sessionId:'sess_archive',operationId:'p'});expect(()=>f.importer.assertReply(structuredClone(p),f.actor)).toThrow();expect(()=>f.importer.assertReply(p,{...f.actor})).toThrow();chmodSync(f.path,0o666);expect(()=>f.importer.assertReply(p,f.actor)).toThrow('cli_source_unavailable');
});
it('unqualified ownership and Agent calls cannot produce archives',async()=>{
 const f=await setup(),agent=new CliArchiveImporter(f.service,{...f.actor,requestSource:'agent',taskId:'fake'},f.sessions);await expect(agent.list({})).rejects.toThrow();const unsupported=new CliArchiveImporter(f.service,f.actor,f.sessions,{ownerUid:()=>undefined});await expect(unsupported.list({})).rejects.toThrow('cli_source_unavailable');expect(f.service.listConversations(f.actor)).toEqual([]);
});
it('committed claim acknowledgement and references survive removal of the live CLI root',async()=>{
 const f=await setup(),p=await f.importer.preview({sessionId:'sess_archive',operationId:'p'}),input={previewId:p.previewId,manifestHash:p.manifestHash,operationId:'c'},claimed=await f.importer.claim(input),hit=f.service.searchHistory(f.actor,{query:'SAME_PUBLIC_TEXT'}).hits[0];rmSync(f.sessions,{recursive:true});
 expect(await f.importer.claim(input)).toEqual(claimed);expect(f.service.resolveReference(f.actor,{refId:hit.refId}).messages[0].text).toBe('SAME_PUBLIC_TEXT');
});
it('rejects malformed UTF8 instead of silently canonicalizing replacement characters',async()=>{
 const f=await setup(),bytes=readFileSync(f.path),at=bytes.indexOf('SAME_PUBLIC_TEXT');bytes[at]=0xff;writeFileSync(f.path,bytes);await expect(f.importer.preview({sessionId:'sess_archive',operationId:'p'})).rejects.toThrow('cli_source_unsupported');
});
it('current canonical corruption or individual deletion denies old exact archive references',async()=>{
 for(const action of ['corrupt','delete']){const f=await setup(),p=await f.importer.preview({sessionId:'sess_archive',operationId:'p'});await f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'c'});const hit=f.service.searchHistory(f.actor,{query:'SAME_PUBLIC_TEXT'}).hits[0];
  if(action==='delete')f.service.deleteMessage(f.actor,{conversationId:hit.conversationId,messageId:hit.messageId});else{const row=f.service.store.db.prepare('SELECT record FROM message_versions WHERE message_id=?').get(hit.messageId)!;const m=JSON.parse(String(row.record));m.observedAt++;f.service.store.db.prepare('UPDATE message_versions SET record=? WHERE message_id=?').run(JSON.stringify(m),hit.messageId);}
  expect(()=>f.service.resolveReference(f.actor,{refId:hit.refId})).toThrow();await expect(f.importer.preview({sessionId:'sess_archive',operationId:'p2'})).rejects.toThrow();
 }
});
it('a public createConversation operation cannot cause import to convert an existing conversation',async()=>{
 const f=await setup(),original=f.service.createConversation(f.actor,{operationId:'cli:claim',title:'CLI: sess_archive'}),p=await f.importer.preview({sessionId:'sess_archive',operationId:'p'}),claimed=await f.importer.claim({previewId:p.previewId,manifestHash:p.manifestHash,operationId:'claim'});
 expect(claimed.conversationId).not.toBe(original.id);expect(f.service.getConversation(f.actor,original.id)?.gtdBucket).toBe(original.gtdBucket);expect(f.service.listMessages(f.actor,original.id)).toEqual([]);
});
it('a changed original actor object cannot reuse its preview proof',async()=>{
 const f=await setup(),p=await f.importer.preview({sessionId:'sess_archive',operationId:'p'});f.actor.actorId='desktop-user:another';expect(()=>f.importer.assertReply(p,f.actor)).toThrow('cli_archive_proof_unavailable');
});
