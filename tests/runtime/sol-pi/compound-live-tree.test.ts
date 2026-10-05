import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';
import {inspectCompoundLiveTree} from '../../../src/runtime/sol-pi/compound-live-tree.js';
import {assertManagedCompoundBranchesCurrent} from '../../../src/runtime/sol-pi/compound-managed-lifecycle.js';
it('reads the actual canonical inventory and rejects an unknown orphan even when no runtime map lists it',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-live-tree-')),store=new FileSessionStore(root),sessionId='root';
 const snapshot={sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]};await store.save(snapshot);
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'test',scopeId:'test'})}),journal=createCompoundSessionJournal({root,store,sessionIdentity:sessionId,ownerId:'test',scopeId:'test',requestSource:'agent',assertCurrent(){}});
 const lease=await authority.acquire({invocationId:'inspect',kind:'compound'});
 try{
  await store.compareAndSave({expectedStoreRevision:1,expectedHistoryDigest:(await store.load(sessionId))!.historyDigest!,nextSnapshot:(await store.load(sessionId))!,lease});
  expect(inspectCompoundLiveTree({treeRoot:{root,sessionIdentity:sessionId,authority,journal},lease,assertLive(){throw Error('not expected');}}).sessionIds).toEqual([sessionId]);
  await journal.createOrGetDirect({hostProviderInvocationId:'request',originalToolUseId:'call',inputHash:'a'.repeat(64),toolName:'write',permissionGeneration:0},lease);
  expect(()=>assertManagedCompoundBranchesCurrent({root,sessionIdentity:sessionId,authority,journal},lease)).toThrow(/supervision_missing/);
  expect(()=>inspectCompoundLiveTree({treeRoot:{root,sessionIdentity:sessionId,authority,journal},lease,assertLive:async()=>{}})).toThrow(/synchronous/);
  await store.save({...snapshot,sessionId:'orphan'});
  expect(()=>inspectCompoundLiveTree({treeRoot:{root,sessionIdentity:sessionId,authority,journal},lease,assertLive(){}})).toThrow(/unregistered/);
 }finally{await lease.releaseAfterDrain();authority.dispose();rmSync(root,{recursive:true,force:true});}
});
