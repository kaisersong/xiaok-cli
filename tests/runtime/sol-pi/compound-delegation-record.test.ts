import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,it,expect} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';
const clean:Array<()=>void>=[];afterEach(()=>{for(const f of clean.splice(0).reverse())f();});
it('real parent CAS binds one child, closes its generation monotonically and never lets completed text alone clear the gate',async()=>{
 const root=mkdtempSync(join(tmpdir(),'delegation-record-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),sessionIdentity='parent';await store.save({sessionId:sessionIdentity,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:'host',scopeId:'scope'})});clean.push(()=>authority.dispose());const journal=createCompoundSessionJournal({store,root,sessionIdentity,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>{}});const lease=await authority.acquire({invocationId:'parent',kind:'compound'});
 try{
  const prepared=await journal.createOrGetDirect({hostProviderInvocationId:'request',originalToolUseId:'tool',inputHash:'a'.repeat(64),toolName:'subagent',permissionGeneration:0},lease);
  const delegation={version:1 as const,admissionId:'admission',childSessionIdentity:'child',childStoreRoot:root,generation:1,state:'live' as const,childPhase:'not_started' as const};
  await journal.advanceDirect(prepared.operation.id,{stage:'started',finalInputHash:'b'.repeat(64),delegation},lease);
  expect((await store.load(sessionIdentity))!.compoundOperations!.directOperations![0].delegation).toEqual(delegation);
  await expect(journal.advanceDirect(prepared.operation.id,{stage:'started',delegation:{...delegation,childSessionIdentity:'other',childPhase:'running'}},lease)).rejects.toThrow();
  await expect(journal.advanceDirect(prepared.operation.id,{stage:'settled',outcome:'completed',quiescence:'delegated_tree'},lease)).rejects.toThrow();
  await journal.advanceDirect(prepared.operation.id,{stage:'started',delegation:{...delegation,childPhase:'running'}},lease);
  const revoked={...delegation,generation:2,state:'revoked' as const,childPhase:'running' as const};
  await journal.advanceDirect(prepared.operation.id,{stage:'started',delegation:revoked},lease);
  await expect(journal.advanceDirect(prepared.operation.id,{stage:'started',delegation:{...revoked,state:'live',generation:3}},lease)).rejects.toThrow();
  await journal.advanceDirect(prepared.operation.id,{stage:'settled',outcome:'failed',quiescence:'delegated_tree',delegation:{...revoked,state:'closed',childPhase:'drained'}},lease);
  const record=(await store.load(sessionIdentity))!.compoundOperations!.directOperations![0];expect(record).toMatchObject({stage:'settled',quiescence:'delegated_tree',delegation:{generation:2,state:'closed',childPhase:'drained'}});
 }finally{await lease.releaseAfterDrain();}
});
