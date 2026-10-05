import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {DatabaseSync} from 'node:sqlite';
import {createKbTools} from '../../electron/kb-tools.js';
import {createKbStoreSqlite} from '../../electron/kb-store-sqlite.js';
import {createAssistantCandidatePromotionTargets} from '../../electron/assistant-controller.js';
import type {AssistantPromotionTargetInput} from '../../electron/assistant-candidate-promotion.js';
let root:string,store:ReturnType<typeof createKbStoreSqlite>,input:AssistantPromotionTargetInput;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'assistant-knowledge-'));store=createKbStoreSqlite(join(root,'kb.sqlite'));const col=store.createCollection({name:'Original',embeddingModelId:'test',embeddingDim:1});input={candidateId:'candidate',loopRunId:'run',targetId:'assistant-source:candidate',title:'原始标题',content:'多段 Unicode 正文 🌱。\n'.repeat(150),scope:'global',collectionId:col.id,provenance:{kind:'assistant_candidate',candidateId:'candidate',loopRunId:'run',evidenceRefs:[{kind:'task',id:'task'}]}};});
afterEach(()=>{store.close();rmSync(root,{recursive:true,force:true});});
function target(){return createAssistantCandidatePromotionTargets({memoryStore:{} as never,memoryBackend:'layered',kbStore:store});}
function sourceInput(){return {sourceId:input.targetId,clientRequestKey:'assistant-candidate:'+input.candidateId,collectionId:input.collectionId!,kind:'paste' as const,title:input.title,text:input.content,parseStatus:'pending' as const,metadata:{assistantCandidateId:input.candidateId,assistantRunId:input.loopRunId,assistantEvidenceRefs:input.provenance.evidenceRefs}};}
it('actual target persists exact body and searchable chunks atomically and idempotently after reopening',async()=>{
 const first=await target().ensureKnowledge(input);const source=store.getSource(input.targetId)!;
 expect(source.parseStatus).toBe('parsed');expect(source.chunkCount).toBeGreaterThan(1);expect(store.getSourceWithContent(input.targetId)?.text).toBe(input.content);
 const search=createKbTools(store,{} as never).find(tool=>tool.definition.name==='kb_search')!;expect(await search.execute({query:'Unicode',collection_id:input.collectionId})).toContain('原始标题');
 const chunks=store.listChunks(input.targetId).map(c=>c.id);store.close();store=createKbStoreSqlite(join(root,'kb.sqlite'));
 input.provenance.evidenceRefs=[{id:'task',kind:'task'}];expect(await target().ensureKnowledge(input)).toEqual(first);expect(store.listChunks(input.targetId).map(c=>c.id)).toEqual(chunks);expect(store.listSources(input.collectionId!)).toHaveLength(1);
});
it('repairs an exact historical pending record without replacing its stable target',async()=>{
 store.addSource(sourceInput(),'user');await target().ensureKnowledge(input);expect(store.getSource(input.targetId)?.parseStatus).toBe('parsed');expect(store.getSourceWithContent(input.targetId)?.text).toBe(input.content);expect(store.listSources(input.collectionId!)).toHaveLength(1);
});
it.each(['chunks','finalize','readback'] as const)('rolls back source and body if %s fails',async mode=>{
 const db=store._db as DatabaseSync;
 db.exec(mode==='chunks'?"CREATE TRIGGER break_body BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT,'body_fault'); END":mode==='finalize'?"CREATE TRIGGER break_parse BEFORE UPDATE OF parse_status ON sources WHEN NEW.parse_status='parsed' BEGIN SELECT RAISE(ABORT,'parse_fault'); END":"CREATE TRIGGER change_body AFTER UPDATE OF parse_status ON sources WHEN NEW.parse_status='parsed' BEGIN UPDATE chunks SET text='changed' WHERE source_id=NEW.id; END");
 await expect(target().ensureKnowledge(input)).rejects.toThrow();expect(store.getSource(input.targetId)).toBeUndefined();expect(store.listChunks(input.targetId)).toEqual([]);expect(store.getCollection(input.collectionId!)?.chunkCountCached).toBe(0);
});
it('rejects altered durable content, selection and title without overwriting',async()=>{
 await target().ensureKnowledge(input);const db=store._db as DatabaseSync;
 for(const change of [{title:'changed'},{content:'changed'},{collectionId:'other'}])await expect(target().ensureKnowledge({...input,...change})).rejects.toThrow();
 db.prepare('UPDATE chunks SET text=? WHERE source_id=?').run('tampered',input.targetId);
 await expect(target().ensureKnowledge(input)).rejects.toThrow();expect(store.listChunks(input.targetId)[0].text).toBe('tampered');
});
it('refuses agent or scheduler requests and forged stable identities at the actual store entry',()=>{
 for(const requestSource of ['agent','scheduler'])expect(()=>store.ensureAssistantSource!(sourceInput(),requestSource as never)).toThrow();
 for(const change of [{sourceId:'other'},{clientRequestKey:'other'},{kind:'url'},{unexpected:true}])expect(()=>store.ensureAssistantSource!({...sourceInput(),...change} as never,'user')).toThrow();
 expect(store.listSources(input.collectionId!)).toEqual([]);
});
it('refuses an outer transaction without committing or rolling back its owner',()=>{
 const db=store._db as DatabaseSync;db.exec('BEGIN IMMEDIATE');try{expect(()=>store.ensureAssistantSource!(sourceInput(),'user')).toThrow('outer_transaction');expect(db.isTransaction).toBe(true);expect(store.getSource(input.targetId)).toBeUndefined();}finally{db.exec('ROLLBACK');}
});
it('does not borrow another source with the same content or erase a prior pending target',async()=>{
 const other=store.addSource({collectionId:input.collectionId!,kind:'paste',title:'other'},'user');
 const {computeKnowledgeContentHash}=await import('../../electron/kb-source-identity.js');store.claimSourceContentHash(other.id,computeKnowledgeContentHash(input.content),'user');
 store.addSource(sourceInput(),'user');await expect(target().ensureKnowledge(input)).rejects.toThrow();expect(store.getSource(other.id)).toBeDefined();expect(store.getSource(input.targetId)?.parseStatus).toBe('pending');expect(store.listChunks(input.targetId)).toEqual([]);
});
it('never reads accessor-bearing input while checking the durable store contract',()=>{
 let reads=0;const malformed={...sourceInput(),get text(){reads++;return input.content;}};
 expect(()=>store.ensureAssistantSource!(malformed,'user')).toThrow();expect(reads).toBe(0);expect(store.getSource(input.targetId)).toBeUndefined();
});
it('rejects a chunk moved to a different collection by an SQL trigger',async()=>{
 const other=store.createCollection({name:'Other',embeddingModelId:'test',embeddingDim:1}),db=store._db as DatabaseSync;
 db.prepare("CREATE TEMP TABLE selected_collection(id TEXT)").run();db.prepare('INSERT INTO selected_collection VALUES(?)').run(other.id);
 db.exec("CREATE TEMP TRIGGER move_chunk AFTER UPDATE OF parse_status ON sources WHEN NEW.parse_status='parsed' BEGIN UPDATE chunks SET collection_id=(SELECT id FROM selected_collection) WHERE source_id=NEW.id; END");
 await expect(target().ensureKnowledge(input)).rejects.toThrow();expect(store.getSource(input.targetId)).toBeUndefined();expect(store.listChunks(input.targetId)).toEqual([]);
});
