// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {captureCanonicalStoreState} from '../../electron/context-continuity/sync-canonical-state.js';

function fixture(){const root=mkdtempSync(join(tmpdir(),'continuity-semantic-state-')),service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'profile'}),actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'};return {service,actor,close(){service.close();rmSync(root,{recursive:true,force:true});}};}
it('hashes actual canonical rowsets deterministically, including exact original source revisions and new semantic tables',()=>{
 const f=fixture();try{
  const a=captureCanonicalStoreState(f.service.store.db),c=f.service.createConversation(f.actor,{operationId:'create'}),b=captureCanonicalStoreState(f.service.store.db);expect(b.publicationHash).not.toBe(a.publicationHash);expect(captureCanonicalStoreState(f.service.store.db)).toEqual(b);
  f.service.store.db.exec('CREATE TABLE extra_semantic_rows (id TEXT PRIMARY KEY, value TEXT NOT NULL)');const schema=captureCanonicalStoreState(f.service.store.db);expect(schema.publicationHash).not.toBe(b.publicationHash);
  f.service.store.db.prepare('INSERT INTO extra_semantic_rows VALUES (?,?)').run('exact','PUBLIC_CANONICAL_STATE');expect(captureCanonicalStoreState(f.service.store.db).publicationHash).not.toBe(schema.publicationHash);expect(c.id).toBeTruthy();
 }finally{f.close();}
});
it('the real grant revoke changes the policy digest and contributes only typed monotonic public facts',()=>{
 const f=fixture();try{
  const source=f.service.createConversation(f.actor,{operationId:'source'}),target=f.service.createConversation(f.actor,{operationId:'target'});f.service.recordMessage(f.actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'unicode source / identity',sourceDataEpoch:'source_epoch',sourceMessageId:'original-user-input',sourceRevision:10,role:'user',text:'ORIGINAL_UNKNOWN_USER_INPUT',executionState:'unknown'});
  const current=f.service.getConversation(f.actor,source.id)!,ref=f.service.createReference(f.actor,{conversationId:source.id,expectedRevision:current.revision,operationId:'ref'}),grant=f.service.attachReference(f.actor,{refId:ref.refId,targetConversationId:target.id,operationId:'attach'}),before=captureCanonicalStoreState(f.service.store.db);
  f.service.revokeGrant(f.actor,{grantId:grant.grantId});const after=captureCanonicalStoreState(f.service.store.db);expect(after.policyHash).not.toBe(before.policyHash);expect(after.stickyFacts).toHaveLength(1);expect(after.stickyFacts[0]).toMatchObject({kind:'grant',revision:2});expect(after.stickyFacts[0].id).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(after.stickyFacts)).not.toContain('ORIGINAL_UNKNOWN_USER_INPUT');
 }finally{f.close();}
});
it('excludes only self-referential head/operational metadata, and refuses schema tricks or an actual oversized row',()=>{
 const f=fixture();try{
  f.service.store.db.exec('CREATE TABLE IF NOT EXISTS sync_store_state (key TEXT PRIMARY KEY,value TEXT NOT NULL)');const before=captureCanonicalStoreState(f.service.store.db);f.service.store.db.prepare('INSERT INTO sync_store_state VALUES (?,?)').run('head','OS_FACT_NOT_A_COMMIT');expect(captureCanonicalStoreState(f.service.store.db)).toEqual(before);
  f.service.store.db.exec('CREATE TABLE extra_semantic_rows (id TEXT PRIMARY KEY,value TEXT NOT NULL)');f.service.store.db.prepare('INSERT INTO extra_semantic_rows VALUES (?,?)').run('large','x'.repeat(33*1024*1024));expect(()=>captureCanonicalStoreState(f.service.store.db)).toThrow('canonical_store_state_unavailable');
 }finally{f.close();}
});
it('does not mistake a literal sqliteX prefix for a SQLite internal sqlite_ table',()=>{
 const f=fixture();try{
  const before=captureCanonicalStoreState(f.service.store.db);f.service.store.db.exec('CREATE TABLE sqliteXsemantic (id TEXT PRIMARY KEY,value TEXT NOT NULL)');const created=captureCanonicalStoreState(f.service.store.db);expect(created.publicationHash).not.toBe(before.publicationHash);
  f.service.store.db.prepare('INSERT INTO sqliteXsemantic VALUES (?,?)').run('original','first');const inserted=captureCanonicalStoreState(f.service.store.db);expect(inserted.publicationHash).not.toBe(created.publicationHash);f.service.store.db.prepare('UPDATE sqliteXsemantic SET value=? WHERE id=?').run('second','original');expect(captureCanonicalStoreState(f.service.store.db).publicationHash).not.toBe(inserted.publicationHash);
 }finally{f.close();}
});
