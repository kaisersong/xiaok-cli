import {mkdtempSync,rmSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {it,expect,afterEach} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {computeSessionHistoryDigest} from '../../../src/ai/runtime/session-store/store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
const cleanup:Array<()=>void>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'session-aliases-'))),holderRoot=join(root,'desktop');mkdirSync(holderRoot);
 cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const canonical=join(root,'canonical'),store=new FileSessionStore(canonical),session=new AgentSessionState();
 session.restoreSnapshot({...session.exportSnapshot(),sessionId:'canonical-session',cwd:root});
 const authority=createSessionExecutionAuthority({root:canonical,sessionIdentity:'canonical-session',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:'alias'})});
 cleanup.push(()=>authority.dispose());
 const lease=await authority.acquire({invocationId:'alias-install',kind:'recovery'});cleanup.push(()=>lease.releaseAfterDrain());
 await store.compareAndSave({nextSnapshot:session.exportSnapshot(),expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
 const binding={aliasId:'alias-one',holderRoot,holderId:'desktop-task',targetSessionId:'canonical-session',domainInitializationId:'domain-one',domainGeneration:1};
 return{root,holderRoot,canonical,store,lease,binding};
}
it('durably records a real initialized session without a closure, across store instances',async()=>{
 const f=await fixture();await f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease});
 const other=new FileSessionStore(f.canonical);
 expect(await other.getSessionAliases('canonical-session')).toMatchObject([{...f.binding,state:'active'}]);
 expect((await other.load('canonical-session'))?.executionProtected).toBe(true);
});
it('rejects a conflicting mapping and preserves an explicitly released alias tombstone',async()=>{
 const f=await fixture();await f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease});
 await expect(f.store.registerSessionAlias({...f.binding,holderId:'other-task',requestSource:'user',lease:f.lease})).rejects.toThrow(/alias/);
 await expect(f.store.releaseSessionAlias({...f.binding,requestSource:'agent',lease:f.lease})).rejects.toThrow(/source/);
 await f.store.releaseSessionAlias({...f.binding,requestSource:'user',lease:f.lease});
 expect(await f.store.getSessionAliases('canonical-session')).toEqual([]);
 await expect(f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease})).rejects.toThrow(/released/);
});
it('does not interpret a missing marker as removal of the canonical reference',async()=>{
 const f=await fixture();const result=await f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease});
 rmSync(result.markerPath);
 expect(await new FileSessionStore(f.canonical).getSessionAliases('canonical-session')).toHaveLength(1);
 expect(existsSync(result.markerPath)).toBe(false);
});
it('refuses registration without the exact live target lease before touching holder metadata',async()=>{
 const f=await fixture();await f.lease.releaseAfterDrain();
 await expect(f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease})).rejects.toThrow();
 expect(existsSync(join(f.holderRoot,'.canonical-session-aliases'))).toBe(false);
});
it('blocks a second real store deletion before receipt or source mutation, even without a closure',async()=>{
 const f=await fixture();await f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease});
 let receipts=0;
 await expect(new FileSessionStore(f.canonical).deleteSession({requestSource:'user',sessionId:'canonical-session',executionLease:f.lease,receipts:{begin(){receipts++;return 'a'.repeat(64);},complete(){}}})).rejects.toThrow('session_referenced_by_canonical_alias');
 expect(receipts).toBe(0);expect(await f.store.load('canonical-session')).not.toBeNull();
});
it('retains unknown marker files and refuses further alias mutation instead of claiming a bounded clean namespace',async()=>{
 const f=await fixture();await f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease});
 const {writeFileSync}=await import('node:fs');const unknown=join(f.holderRoot,'.canonical-session-aliases','user-data');writeFileSync(unknown,'keep');
 await expect(f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease})).rejects.toThrow('session_alias_unknown_marker');
 expect(existsSync(unknown)).toBe(true);
});
it('reads only the canonical history and refuses missing route markers instead of falling back to a stale holder snapshot',async()=>{
 const f=await fixture(),registered=await f.store.registerSessionAlias({...f.binding,requestSource:'user',lease:f.lease});
 const canonical=(await f.store.load('canonical-session'))!;
 canonical.messages=[{role:'user',content:[{type:'text',text:'new canonical intent'}]}];
 await f.store.compareAndSave({nextSnapshot:canonical,expectedStoreRevision:canonical.storeRevision!,expectedHistoryDigest:canonical.historyDigest!,lease:f.lease});
 expect((await f.store.loadSessionAlias(f.binding))?.snapshot.messages).toEqual(canonical.messages);
 rmSync(registered.markerPath);
 await expect(f.store.loadSessionAlias(f.binding)).rejects.toThrow('session_alias_route_unavailable');
});
