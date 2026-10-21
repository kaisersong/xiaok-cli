import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,it,expect} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';
const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
it.each(['provider','turn'] as const)('root CAS permanently reserves a child identity before publication and keeps %s within the same budget',async(recordKind)=>{
 const root=mkdtempSync(join(tmpdir(),'tree-budget-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=new FileSessionStore(root),sessionIdentity='tree-root';
 await store.save({sessionId:sessionIdentity,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());
 const journal=createCompoundSessionJournal({store,root,sessionIdentity,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>{}});
 const lease=await authority.acquire({invocationId:'tree',kind:'compound'});
 try{
  const input={dispatch:{sessionIdentity:'child',hostProviderInvocationId:'request',originalToolUseId:'call'},inputHash:'a'.repeat(64),recordKind};
  const first=await journal.reserveTreeAllocation(input,lease);
  expect(first.created).toBe(true);
  // No child snapshot was published: the root reservation must still survive.
  expect(await store.load('child')).toBeNull();
  const durable=(await store.load(sessionIdentity))!;
  expect(durable.compoundOperations!.treeBudget!.allocations).toHaveLength(1);
  expect(await journal.reserveTreeAllocation(input,lease)).toMatchObject({created:false,allocationId:first.allocationId});
  await expect(journal.reserveTreeAllocation({...input,inputHash:'b'.repeat(64)},lease)).rejects.toThrow('compound_tree_identity_conflict');
  const next=structuredClone(durable);delete next.compoundOperations!.treeBudget;next.compoundOperations!.generation++;
  await expect(store.compareAndSave!({expectedStoreRevision:durable.storeRevision!,expectedHistoryDigest:durable.historyDigest!,nextSnapshot:next,lease})).rejects.toThrow('compound_tree_regression');
  await store.save({...durable,sessionId:'child',storeRevision:undefined,historyDigest:undefined,executionProtected:undefined,compoundOperations:undefined});
  const childAuthority=createSessionExecutionAuthority({root,sessionIdentity:'child',hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>childAuthority.dispose());
  const childJournal=createCompoundSessionJournal({store,root,sessionIdentity:'child',ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>{},
   reserveMutation:async(identity)=>{const reserved=await journal.reserveTreeAllocation({...identity,recordKind:'native'},lease);if(!reserved.created)throw Error('old_tree_reservation');}});
  const childLease=await childAuthority.acquire({invocationId:'child-native',kind:'compound'});
  try{
   const call={hostProviderInvocationId:'native-request',originalToolUseId:'tool',inputHash:'c'.repeat(64),toolName:'write',permissionGeneration:0};
   expect((await childJournal.createOrGetDirect(call,childLease)).created).toBe(true);
   expect((await store.load(sessionIdentity))!.compoundOperations!.treeBudget!.allocations).toHaveLength(2);
   expect((await childJournal.createOrGetDirect(call,childLease)).created).toBe(false);
  }finally{await childLease.releaseAfterDrain();}
  let rejected=false,count=2;
  for(let i=1;i<=256;i++){
   try{await journal.reserveTreeAllocation({...input,dispatch:{...input.dispatch,sessionIdentity:`child-${i}`}},lease);count++;}
   catch(error){expect(String(error)).toContain('compound_tree_capacity');rejected=true;break;}
  }
  expect(rejected).toBe(true);expect(count).toBeLessThan(256);
  const full=(await store.load(sessionIdentity))!;
  expect(full.compoundOperations!.treeBudget!.allocations).toHaveLength(count);
  // The failed child never got a free local budget; exact duplicate is free
  // only as a non-executing lookup of the original root reservation.
  expect(await journal.reserveTreeAllocation(input,lease)).toMatchObject({created:false,allocationId:first.allocationId});
 }finally{await lease.releaseAfterDrain();}
},30000);
