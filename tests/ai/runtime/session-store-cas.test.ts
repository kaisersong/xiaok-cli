import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { SQLiteSessionStore } from '../../../src/ai/runtime/session-store/sqlite-store.js';
import { computeSessionHistoryDigest, type PersistedSessionSnapshot, type StoredSessionSnapshot } from '../../../src/ai/runtime/session-store/store.js';
import { createSessionExecutionAuthority, createSessionExecutionContext } from '../../../src/ai/runtime/session-store/execution-authority.js';
const roots:string[]=[];const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const f of cleanups.splice(0))f();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
function snapshot():PersistedSessionSnapshot{return {sessionId:'sess_cas',cwd:process.cwd(),createdAt:1,updatedAt:1,lineage:['sess_cas'],messages:[{role:'user',content:[{type:'text',text:'original'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]};}
for(const kind of ['file','sqlite'] as const){
 it(`${kind}: durable CAS rejects stale history/revision and forged/released lease`,async()=>{
  const root=mkdtempSync(join(tmpdir(),'session-cas-'));roots.push(root);
  const store=kind==='file'?new FileSessionStore(root):new SQLiteSessionStore(join(root,'sessions.sqlite'));
  if(store instanceof SQLiteSessionStore)cleanups.push(()=>store.dispose());
  await store.save(snapshot());const initial=(await store.load('sess_cas'))!;
  expect(initial.storeRevision).toBe(1);expect(initial.historyDigest).toBe(computeSessionHistoryDigest(initial));
  const authority=createSessionExecutionAuthority({root,sessionIdentity:'sess_cas',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanups.push(()=>authority.dispose());
  const lease=await authority.acquire({invocationId:'compact',kind:'compaction'});
  await expect(store.save(initial)).rejects.toThrow();
  const ledger={version:1 as const,currency:'USD',generation:0,policies:[{grantId:'grant',maxCalls:2,maxCostUnits:100,expiresAt:Date.now()+60000}],reservations:[],commits:[]};
  await lease.releaseAfterDrain();
  await expect(store.save({...initial,semanticCompaction:ledger})).rejects.toThrow();
  const nextLease=await authority.acquire({invocationId:'next',kind:'compaction'});
  const next={...initial,semanticCompaction:ledger,messages:[{role:'user' as const,content:[{type:'text' as const,text:'summary'}]}]};
  const input={expectedStoreRevision:initial.storeRevision!,expectedHistoryDigest:initial.historyDigest!,nextSnapshot:next,lease:nextLease};
  await expect(store.compareAndSave({...input,lease:{...nextLease}})).rejects.toThrow();
  await expect(store.compareAndSave({...input,expectedHistoryDigest:'0'.repeat(64)})).rejects.toThrow();
  const committed=await store.compareAndSave(input);expect(committed.storeRevision).toBe(2);
  await expect(store.compareAndSave(input)).rejects.toThrow();
  await expect(store.save(initial)).rejects.toThrow();
  const loaded=(await store.load('sess_cas'))!;expect(loaded.messages).toEqual(next.messages);expect(loaded.semanticCompaction).toEqual(ledger);
  await nextLease.releaseAfterDrain();
  await store.save({...loaded,semanticCompaction:undefined});
  expect((await store.load('sess_cas'))!.semanticCompaction).toEqual(ledger);
  const fork = await store.fork('sess_cas');
  expect((await store.load(fork.sessionId))!.semanticCompaction).toEqual(ledger);
  await expect(store.save({...loaded,semanticCompaction:{...ledger,policies:[]}})).rejects.toThrow();
  await expect(store.compareAndSave({...input,expectedStoreRevision:2,expectedHistoryDigest:committed.historyDigest})).rejects.toThrow();
 });
}
it('refuses a fork when the actual FileStore source disappears after load', async()=>{
 const root=mkdtempSync(join(tmpdir(),'session-fork-missing-'));roots.push(root);const store=new FileSessionStore(root);await store.save(snapshot());
 const load=store.load.bind(store);store.load=async id=>{const result=await load(id);const {unlinkSync}=await import('node:fs');unlinkSync(join(root,id+'.json'));return result;};
 await expect(store.fork('sess_cas')).rejects.toThrow('session_fork_source_missing');
});
for (const kind of ['file','sqlite'] as const) it(`${kind}: commit notification is durable, isolated and beforeCommit cannot escape synchronously`, async()=>{
 const root=mkdtempSync(join(tmpdir(),'session-notify-'));roots.push(root);
 const store=kind==='file'?new FileSessionStore(root):new SQLiteSessionStore(join(root,'sessions.sqlite'));
 if(store instanceof SQLiteSessionStore)cleanups.push(()=>store.dispose());
 const notifications:StoredSessionSnapshot[]=[];
 const unsubscribe=store.onCommit(value=>{notifications.push(value);value.messages=[];});
 await store.save(snapshot());
 expect(notifications[0].storeRevision).toBe(1);
 const initial=(await store.load('sess_cas'))!;expect(initial.messages).toHaveLength(1);
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'sess_cas',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanups.push(()=>authority.dispose());
 const lease=await authority.acquire({invocationId:'notify',kind:'compaction'});
 try {
  const input={expectedStoreRevision:1,expectedHistoryDigest:initial.historyDigest!,nextSnapshot:initial,lease};
  await expect(store.compareAndSave({...input,beforeCommit:()=>{throw Error('revoked');}})).rejects.toThrow('revoked');
  await expect(store.compareAndSave({...input,beforeCommit:(()=>Promise.reject(Error('async denied'))) as ()=>void})).rejects.toThrow('session_commit_hook_must_be_synchronous');
  expect((await store.load('sess_cas'))!.storeRevision).toBe(1);expect(notifications).toHaveLength(1);
  await store.compareAndSave({...input,beforeCommit:()=>lease.assertCurrent()});expect(notifications[1].storeRevision).toBe(2);
 }finally{await lease.releaseAfterDrain();}
 unsubscribe();const loaded=(await store.load('sess_cas'))!;await store.save(loaded);expect(notifications).toHaveLength(2);
 store.onCommit(()=>{throw Error('listener failed');});
 await expect(store.save((await store.load('sess_cas'))!)).rejects.toThrow('listener failed');
 expect((await store.load('sess_cas'))!.storeRevision).toBe(4);
});
it('SQLite beforeCommit cannot nest a durable save or publish a rolled-back notification',async()=>{
 const root=mkdtempSync(join(tmpdir(),'session-reentrant-'));roots.push(root);const store=new SQLiteSessionStore(join(root,'sessions.sqlite'));cleanups.push(()=>store.dispose());await store.save(snapshot());
 const initial=(await store.load('sess_cas'))!;const authority=createSessionExecutionAuthority({root,sessionIdentity:'sess_cas',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanups.push(()=>authority.dispose());const lease=await authority.acquire({invocationId:'nested',kind:'compaction'});
 const events:number[]=[];store.onCommit(s=>{events.push(s.storeRevision!);});let nested:Promise<void>|undefined;
 try{await expect(store.compareAndSave({expectedStoreRevision:1,expectedHistoryDigest:initial.historyDigest!,nextSnapshot:initial,lease,beforeCommit:()=>{nested=store.save({...initial,messages:[]},{lease});void nested.catch(()=>{});throw Error('outer cancelled');}})).rejects.toThrow('outer cancelled');
 await expect(nested).rejects.toThrow('session_commit_reentrant');expect(events).toEqual([]);expect((await store.load('sess_cas'))!.storeRevision).toBe(1);
 const unsubscribe=store.onCommit(value=>{nested=store.save(value,{lease});void nested.catch(()=>{});});
 await store.compareAndSave({expectedStoreRevision:1,expectedHistoryDigest:initial.historyDigest!,nextSnapshot:initial,lease});
 await expect(nested).rejects.toThrow('session_commit_reentrant');unsubscribe();expect(events).toEqual([2]);expect((await store.load('sess_cas'))!.storeRevision).toBe(2);
 }finally{await lease.releaseAfterDrain();}
});
for(const kind of ['file','sqlite'] as const) it(`${kind}: protected ordinary save cannot adopt a new revision while retaining a stale history basis`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'session-basis-'));roots.push(root);
 const store=kind==='file'?new FileSessionStore(root):new SQLiteSessionStore(join(root,'sessions.sqlite'));
 if(store instanceof SQLiteSessionStore)cleanups.push(()=>store.dispose());
 await store.save(snapshot());const old=(await store.load('sess_cas'))!;
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'sess_cas',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanups.push(()=>authority.dispose());
 const lease=await authority.acquire({invocationId:'publish-new-history',kind:'compaction'});
 try{await store.compareAndSave({expectedStoreRevision:old.storeRevision!,expectedHistoryDigest:old.historyDigest!,nextSnapshot:{...old,messages:[{role:'user',content:[{type:'text',text:'another writer'}]}]},lease});}finally{await lease.releaseAfterDrain();}
 const current=(await store.load('sess_cas'))!;
 await expect(store.save({...old,executionProtected:true,storeRevision:current.storeRevision})).rejects.toThrow('session_store_stale_history');
 expect((await store.load('sess_cas'))!.messages).toEqual(current.messages);
});
