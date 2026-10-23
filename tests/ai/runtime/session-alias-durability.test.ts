import {mkdtempSync,rmSync,mkdirSync,realpathSync,lstatSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {it,expect,vi} from 'vitest';
const failure=vi.hoisted(()=>({inode:0}));
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return{...fs,fsyncSync(fd:number){const stat=fs.fstatSync(fd);if(stat.isDirectory()&&stat.ino===failure.inode)throw Error('alias_marker_directory_sync_failed');return fs.fsyncSync(fd);}};});
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {computeSessionHistoryDigest} from '../../../src/ai/runtime/session-store/store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
it('does not release the durable reference when the exact marker directory failed to flush its unlink',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'alias-durability-'))),holderRoot=join(root,'desktop'),canonical=join(root,'canonical');mkdirSync(holderRoot);
 const authority=createSessionExecutionAuthority({root:canonical,sessionIdentity:'source',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:'alias'})});
 const lease=await authority.acquire({invocationId:'alias-install',kind:'recovery'});
 try{
  const store=new FileSessionStore(canonical),snapshot={...new AgentSessionState().exportSnapshot(),sessionId:'source',cwd:root};
  await store.compareAndSave({nextSnapshot:snapshot,expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
  const binding={aliasId:'alias',holderId:'task',holderRoot,targetSessionId:'source',domainInitializationId:'domain',domainGeneration:1};
  await store.registerSessionAlias({...binding,requestSource:'user',lease});
  failure.inode=lstatSync(join(holderRoot,'.canonical-session-aliases')).ino;
  await expect(store.releaseSessionAlias({...binding,requestSource:'user',lease})).rejects.toThrow('alias_marker_directory_sync_failed');
  expect(await new FileSessionStore(canonical).getSessionAliases('source')).toMatchObject([{state:'release_pending'}]);
  failure.inode=0;await store.releaseSessionAlias({...binding,requestSource:'user',lease});
  expect(await store.getSessionAliases('source')).toEqual([]);
 }finally{failure.inode=0;await lease.releaseAfterDrain();authority.dispose();rmSync(root,{recursive:true,force:true});}
});
