// @vitest-environment node
import {expect,it} from 'vitest';
import {contextDerivative} from '../fixtures/context-derivative.js';
import {validateCanonicalBundle} from '../../electron/context-continuity/sync-canonical-codec.js';
const build=async()=> (await import('../../electron/context-continuity/sync-canonical-export-data.js')).captureCanonicalExportData;

it('captures actual original Host public projection, exact refs/grants and recursive source dependencies as data only',async()=>{
 const f=await contextDerivative();try{
  const p=f.services.continuity.port(),a=(await f.services.recoverTask(f.sourceTaskId)).snapshot,b=(await f.read()).snapshot;
  const scopes=[a,b].map(snapshot=>({rootKeyId:'root',syncGroupId:'group',logicalProfileId:'logical',conversationId:snapshot.context!.threadId!,branchId:'branch'}));
  const result=(await build())(p.service,p.actor,scopes,[a,b]);expect(validateCanonicalBundle(result)).toEqual(result);
  expect(result[0].messages.some(message=>message.versions.some(version=>version.text==='SOURCE_CANARY'))).toBe(true);
  expect(result[1].messages.some(message=>message.versions.some(version=>version.text==='DERIVED_PRIVATE_SOURCE_CANARY'))).toBe(true);
  const ref=p.service.store.db.prepare('SELECT ref_id FROM context_dependencies WHERE task_id=?').get(b.taskId)!;
  const edges=result[1].messages.flatMap(message=>message.versions.flatMap(version=>version.dependencies));
  expect(edges.some(edge=>edge.kind==='reference'&&edge.reference.refId===ref.ref_id&&edge.scope.conversationId===scopes[0].conversationId)).toBe(true);
  expect(result[0].references.map(ref=>ref.refId)).toContain(ref.ref_id);expect(result[0].grants.length).toBe(1);
  expect(p.service.store.db.prepare('SELECT COUNT(*) AS n FROM effect_owner_receipts WHERE task_id IN (?,?)').get(a.taskId,b.taskId)!.n).toBe(2);
 }finally{await f.close();}
});
it('does not wash an omitted real reference ancestor into an empty dependency list',async()=>{
 const f=await contextDerivative();try{const p=f.services.continuity.port(),b=(await f.read()).snapshot,scope={rootKeyId:'root',syncGroupId:'group',logicalProfileId:'logical',conversationId:b.context!.threadId!,branchId:'branch'};
 const capture=await build();expect(()=>capture(p.service,p.actor,[scope],[b])).toThrow(/canonical_dependency_unavailable/);
 }finally{await f.close();}
});
it('rejects changed raw snapshots, forged public projection and actual revoked dependencies',async()=>{
 const f=await contextDerivative();try{const p=f.services.continuity.port(),a=(await f.services.recoverTask(f.sourceTaskId)).snapshot,b=(await f.read()).snapshot,scopes=[a,b].map(snapshot=>({rootKeyId:'root',syncGroupId:'group',logicalProfileId:'logical',conversationId:snapshot.context!.threadId!,branchId:'branch'})),capture=await build();
 const fake=structuredClone(b);fake.result!.summary='not original Host snapshot';expect(()=>capture(p.service,p.actor,scopes,[a,fake])).toThrow();
 const row=p.service.store.db.prepare("SELECT v.message_id,v.revision,v.record FROM message_versions v JOIN message_anchors a ON a.id=v.message_id WHERE a.source_id=? AND json_extract(v.record,'$.role')='assistant' LIMIT 1").get(a.taskId)!;
 const original=JSON.parse(String(row.record));p.service.store.transaction(()=>p.service.store.db.prepare('UPDATE message_versions SET record=? WHERE message_id=? AND revision=?').run(JSON.stringify({...original,text:'UNAUTHENTICATED_SQL_REWRITE'}),String(row.message_id),Number(row.revision)));
 expect(()=>capture(p.service,p.actor,scopes,[a,b])).toThrow(/canonical_source_projection_mismatch/);
 p.service.store.transaction(()=>p.service.store.db.prepare('UPDATE message_versions SET record=? WHERE message_id=? AND revision=?').run(String(row.record),String(row.message_id),Number(row.revision)));
 f.revoke();expect(()=>capture(p.service,p.actor,scopes,[a,b])).toThrow();
 }finally{await f.close();}
});
it('requires the original source binding and chronological public projection order even without any reference',async()=>{
 const f=await contextDerivative();try{const p=f.services.continuity.port(),conversation=p.service.createConversation(p.actor,{operationId:'unreferenced-source'}),task=await f.services.createTask({prompt:'source',materials:[],context:{threadId:conversation.id}});
 const {vi}=await import('vitest');await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(task.taskId)).toBeTruthy());
 const snapshot=(await f.services.recoverTask(task.taskId)).snapshot,scope={rootKeyId:'root',syncGroupId:'group',logicalProfileId:'logical',conversationId:conversation.id,branchId:'branch'},capture=await build(),db=p.service.store.db;
 const binding=db.prepare('SELECT * FROM source_bindings WHERE id=?').get(task.taskId)!;db.prepare('DELETE FROM source_bindings WHERE id=?').run(task.taskId);
 expect.soft(()=>capture(p.service,p.actor,[scope],[snapshot])).toThrow(/canonical_source_binding_mismatch/);
 db.prepare('INSERT INTO source_bindings VALUES (?,?,?,?)').run(String(binding.kind),String(binding.id),String(binding.epoch),String(binding.conversation_id));
 const anchors=db.prepare('SELECT a.id,a.sequence,v.record FROM message_anchors a JOIN message_versions v ON v.message_id=a.id WHERE a.source_id=? ORDER BY a.sequence').all(task.taskId);expect(anchors.length).toBe(2);
 p.service.store.transaction(()=>{for(const row of anchors)db.prepare('UPDATE message_anchors SET sequence=? WHERE id=?').run(-Number(row.sequence),String(row.id));for(const [i,row]of anchors.entries()){const sequence=Number(anchors[1-i].sequence);db.prepare('UPDATE message_anchors SET sequence=? WHERE id=?').run(sequence,String(row.id));db.prepare('UPDATE message_versions SET record=? WHERE message_id=?').run(JSON.stringify({...JSON.parse(String(row.record)),sequence}),String(row.id));}});
 expect.soft(()=>capture(p.service,p.actor,[scope],[snapshot])).toThrow(/canonical_source_projection_mismatch/);
 }finally{await f.close();}
});

it('denies an invalid original grant without mutating dependency policy during export reads',async()=>{
 const f=await contextDerivative();try{const p=f.services.continuity.port(),a=(await f.services.recoverTask(f.sourceTaskId)).snapshot,b=(await f.read()).snapshot,scopes=[a,b].map(snapshot=>({rootKeyId:'root',syncGroupId:'group',logicalProfileId:'logical',conversationId:snapshot.context!.threadId!,branchId:'branch'})),capture=await build(),db=p.service.store.db,original=db.exec;let writes=0;
 const edge=db.prepare('SELECT * FROM context_dependencies WHERE task_id=?').get(b.taskId)!;db.prepare('UPDATE read_grants SET revoked=1 WHERE id=?').run(String(edge.grant_id));
 try{db.exec=function(sql:string){if(/BEGIN IMMEDIATE/.test(sql))writes++;return original.call(db,sql);};expect(()=>capture(p.service,p.actor,scopes,[a,b])).toThrow();expect(writes).toBe(0);expect(db.prepare('SELECT valid FROM context_dependencies WHERE task_id=?').get(b.taskId)!.valid).toBe(1);}finally{db.exec=original;}
 }finally{await f.close();}
});
it('denies external deleted scope policy without creating a tombstone during export reads',async()=>{
 const f=await contextDerivative();try{const p=f.services.continuity.port(),a=(await f.services.recoverTask(f.sourceTaskId)).snapshot,b=(await f.read()).snapshot,scopes=[a,b].map(snapshot=>({rootKeyId:'root',syncGroupId:'group',logicalProfileId:'logical',conversationId:snapshot.context!.threadId!,branchId:'branch'})),capture=await build(),db=p.service.store.db,original=db.exec;let writes=0;
 p.service.setScopePolicy(id=>id===scopes[0].conversationId?'deleted':'readable');
 try{db.exec=function(sql:string){if(/BEGIN IMMEDIATE/.test(sql))writes++;return original.call(db,sql);};expect(()=>capture(p.service,p.actor,scopes,[a,b])).toThrow();expect(writes).toBe(0);expect(db.prepare('SELECT deleted FROM conversations WHERE id=?').get(scopes[0].conversationId)!.deleted).toBe(0);}finally{db.exec=original;p.service.setScopePolicy(()=>'readable');}
 }finally{await f.close();}
});
