// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {contextDerivative} from '../fixtures/context-derivative.js';
const load=async()=> (await import('../../electron/context-continuity/sync-canonical-export-freeze.js')).freezeCanonicalExportOrigins;
async function fixture(){const f=await contextDerivative(),p=f.services.continuity.port(),a=(await f.services.recoverTask(f.sourceTaskId)).snapshot,b=(await f.read()).snapshot,scopes=[a,b].map(snapshot=>({rootKeyId:'root',syncGroupId:'group',logicalProfileId:'logical',conversationId:snapshot.context!.threadId!,branchId:'branch'}));return{f,p,a,b,scopes};}
it('freezes metadata only and reuses old immutable origins after another actual clean Task is added',async()=>{
 const {f,p,a,b,scopes}=await fixture();try{const freeze=await load(),first=freeze(p.service,p.actor,scopes,[a,b]),db=p.service.store.db;
 expect(first.versionCount).toBeGreaterThan(0);const before=db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all();expect(before.length).toBe(first.versionCount);expect(JSON.stringify(before)).not.toContain('SOURCE_CANARY');
 const later=await f.services.createTask({prompt:'source',materials:[],context:{threadId:scopes[0].conversationId}});await vi.waitFor(()=>expect(db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(later.taskId)).toBeTruthy());const c=(await f.services.recoverTask(later.taskId)).snapshot;
 const next=freeze(p.service,p.actor,scopes,[a,b,c]);expect(next.versionCount).toBeGreaterThan(first.versionCount);
 for(const row of before)expect(db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' AND id=?").get(String(row.id))).toEqual(row);
 expect(freeze(p.service,p.actor,scopes,[a,b,c])).toEqual(next);
 }finally{await f.close();}
});
it('does not rewrite a frozen old version when its original source dependency ledger changes',async()=>{
 const {f,p,a,b,scopes}=await fixture();try{const freeze=await load();freeze(p.service,p.actor,scopes,[a,b]);const before=p.service.store.db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all();p.service.recordSourceTasks(p.actor,b.taskId,[a.taskId]);expect(()=>freeze(p.service,p.actor,scopes,[a,b])).toThrow(/canonical_export_origin_conflict/);expect(p.service.store.db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all()).toEqual(before);
 }finally{await f.close();}
});
it('does not return success or preserve partial origin metadata when the actual metadata COMMIT throws',async()=>{
 const {f,p,a,b,scopes}=await fixture(),db=p.service.store.db,original=db.exec;try{const freeze=await load();let tripped=false;db.exec=function(sql:string){if(sql.trim()==='COMMIT'&&db.prepare("SELECT 1 FROM operations WHERE kind='canonicalExportVersionV1' LIMIT 1").get()){tripped=true;throw new Error('synthetic_freeze_commit_failed');}return original.call(db,sql);};expect(()=>freeze(p.service,p.actor,scopes,[a,b])).toThrow(/synthetic_freeze_commit_failed/);expect(tripped).toBe(true);expect(db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='canonicalExportVersionV1'").get()!.n).toBe(0);
 }finally{db.exec=original;await f.close();}
});
it('reopens and reuses exact durable origins after actual COMMIT succeeds but the original call then throws',async()=>{
 const {f,p,a,b,scopes}=await fixture(),db=p.service.store.db,original=db.exec;let stopped=false;try{const freeze=await load();let tripped=false;
 db.exec=function(sql:string){if(!tripped&&sql.trim()==='COMMIT'&&db.prepare("SELECT 1 FROM operations WHERE kind='canonicalExportVersionV1' LIMIT 1").get()){original.call(db,sql);tripped=true;throw new Error('synthetic_freeze_after_actual_commit');}return original.call(db,sql);};
 expect(()=>freeze(p.service,p.actor,scopes,[a,b])).toThrow(/synthetic_freeze_after_actual_commit/);db.exec=original;expect(tripped).toBe(true);const persisted=db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all();expect(persisted.length).toBeGreaterThan(0);
 await f.services.disposeMultiAgent();f.services.getKnowledgeBaseStore().close();stopped=true;
 const {ContinuityService}=await import('../../electron/context-continuity/service.js'),{join}=await import('node:path'),reopened=new ContinuityService({dbPath:join(f.root,'continuity.sqlite'),profileId:p.actor.profileId});
 try{const retried=freeze(reopened,p.actor,scopes,[a,b]);expect(retried.versionCount).toBe(persisted.length);expect(reopened.store.db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all()).toEqual(persisted);}finally{reopened.close();}
 }finally{if(!stopped){db.exec=original;await f.close();}else{const {rmSync}=await import('node:fs');rmSync(f.root,{recursive:true,force:true});}}
});
it('rejects corrupted operation identity or result and never cleans a revoked source by regranting it',async()=>{
 const {f,p,a,b,scopes}=await fixture();try{const freeze=await load(),db=p.service.store.db;freeze(p.service,p.actor,scopes,[a,b]);const row=db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id LIMIT 1").get()!;
 db.prepare("UPDATE operations SET request_hash=? WHERE kind='canonicalExportVersionV1' AND id=?").run('f'.repeat(64),String(row.id));expect(()=>freeze(p.service,p.actor,scopes,[a,b])).toThrow(/canonical_export_origin_conflict/);expect(db.prepare("SELECT request_hash FROM operations WHERE kind='canonicalExportVersionV1' AND id=?").get(String(row.id))!.request_hash).toBe('f'.repeat(64));
 db.prepare("UPDATE operations SET request_hash=?,result=? WHERE kind='canonicalExportVersionV1' AND id=?").run(String(row.request_hash),JSON.stringify({...JSON.parse(String(row.result)),sourceClosureHash:'f'.repeat(64)}),String(row.id));expect(()=>freeze(p.service,p.actor,scopes,[a,b])).toThrow(/canonical_export_origin_conflict/);
 db.prepare("UPDATE operations SET result=? WHERE kind='canonicalExportVersionV1' AND id=?").run(String(row.result),String(row.id));const before=db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all(),ref=db.prepare('SELECT ref_id FROM context_dependencies WHERE task_id=?').get(b.taskId)!;
 f.revoke();p.service.attachReference(p.actor,{refId:String(ref.ref_id),targetConversationId:scopes[1].conversationId,operationId:'regrant-does-not-clean-old-source'});expect(()=>freeze(p.service,p.actor,scopes,[a,b])).toThrow();expect(db.prepare("SELECT id,request_hash,result FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all()).toEqual(before);
 }finally{await f.close();}
});

it('asserts exact frozen origins without issuing any new original write transaction',async()=>{
 const {f,p,a,b,scopes}=await fixture(),db=p.service.store.db,original=db.exec;try{
 const module=await import('../../electron/context-continuity/sync-canonical-export-freeze.js'),assertFrozen=(module as unknown as Record<string,Function>).assertFrozenCanonicalExportOrigins;
 expect(()=>assertFrozen(p.service,p.actor,scopes,[a,b],{manifestHash:'f'.repeat(64),versionCount:1})).toThrow();
 const frozen=module.freezeCanonicalExportOrigins(p.service,p.actor,scopes,[a,b]),before=db.prepare("SELECT * FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all();let writes=0;
 db.exec=function(sql:string){if(/BEGIN IMMEDIATE/i.test(sql))writes++;return original.call(db,sql);};
 expect(assertFrozen(p.service,p.actor,scopes,[a,b],frozen)).toEqual(frozen);expect(writes).toBe(0);expect(db.prepare("SELECT * FROM operations WHERE kind='canonicalExportVersionV1' ORDER BY id").all()).toEqual(before);
 db.prepare("UPDATE operations SET request_hash=? WHERE kind='canonicalExportVersionV1' AND id=?").run('f'.repeat(64),String(before[0].id));
 expect(()=>assertFrozen(p.service,p.actor,scopes,[a,b],frozen)).toThrow(/canonical_export_origin_conflict/);expect(writes).toBe(0);
 }finally{db.exec=original;await f.close();}
});
