import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {computeSessionHistoryDigest} from '../../../src/ai/runtime/session-store/store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundOperationLedger} from '../../../src/runtime/sol-pi/compound-operation.js';
import {createOrGetDirectOperation,advanceDirectOperation} from '../../../src/runtime/sol-pi/compound-direct-operation.js';
import {reserveCompoundTreeAllocation} from '../../../src/runtime/sol-pi/compound-tree-budget.js';
const identity={dispatch:{sessionIdentity:'source',hostProviderInvocationId:'provider',originalToolUseId:'tool'},inputHash:'a'.repeat(64),toolName:'bash',ownerId:'host',requestSource:'agent' as const,scopeId:'scope',permissionGeneration:1};
it.each(['unknown','settled','orphan-allocation'] as const)('actual FileStore deletion retains unconfirmed compound facts: %s',async(kind)=>{
 const root=mkdtempSync(join(tmpdir(),'compound-delete-')),store=new FileSessionStore(root);
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'source',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});
 const lease=await authority.acquire({invocationId:'setup',kind:'recovery'});let receipts=0;
 try{
  const created=createOrGetDirectOperation(createCompoundOperationLedger(),identity);
  let ledger=kind==='unknown'?advanceDirectOperation(advanceDirectOperation(created.ledger,created.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)}),created.operation.id,{stage:'outcome_unknown',outcome:'unknown'}):advanceDirectOperation(created.ledger,created.operation.id,{stage:'settled',outcome:'denied'});
  ledger.treeBudget=reserveCompoundTreeAllocation(undefined,'source',{dispatch:kind==='orphan-allocation'?{...identity.dispatch,originalToolUseId:'missing'}:identity.dispatch,inputHash:identity.inputHash,recordKind:'native'}).budget;
  const snapshot={...new AgentSessionState().exportSnapshot(),sessionId:'source',compoundOperations:ledger,protectedObservationClosure:{version:1 as const,requiresReauthorization:true as const,observations:[]}};
  await store.compareAndSave({nextSnapshot:snapshot,expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
  const deletion=store.deleteSession({requestSource:'user',sessionId:'source',executionLease:lease,receipts:{begin(){receipts++;return 'a'.repeat(64);},complete(){}}});
  if(kind==='settled'){await deletion;expect(await store.load('source')).toBeNull();expect(receipts).toBe(1);}
  else{await expect(deletion).rejects.toThrow(/compound/);expect(receipts).toBe(0);expect(await store.load('source')).not.toBeNull();}
 }finally{await lease.releaseAfterDrain();authority.dispose();rmSync(root,{recursive:true,force:true});}
});
it('keeps the real descendant execution guard through the deletion receipt and rejects an active child first',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-delete-child-')),store=new FileSessionStore(root);
 const authority=(sessionIdentity:string)=>createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});
 const parent=authority('source'),child=authority('child'),parentLease=await parent.acquire({invocationId:'parent',kind:'recovery'}),childLease=await child.acquire({invocationId:'child',kind:'recovery'});let receipts=0;let contested=false;const {default:Database}=await import('better-sqlite3');
 try{
  const created=createOrGetDirectOperation(createCompoundOperationLedger(),{...identity,toolName:'subagent'}),delegation={version:1 as const,admissionId:'admission',childSessionIdentity:'child',childStoreRoot:root,generation:1,state:'live' as const,childPhase:'not_started' as const};
  let ledger=advanceDirectOperation(created.ledger,created.operation.id,{stage:'started',finalInputHash:'b'.repeat(64),delegation});
  ledger=advanceDirectOperation(ledger,created.operation.id,{stage:'started',delegation:{...delegation,childPhase:'running'}});
  ledger=advanceDirectOperation(ledger,created.operation.id,{stage:'started',delegation:{...delegation,generation:2,state:'closed',childPhase:'drained'}});
  ledger=advanceDirectOperation(ledger,created.operation.id,{stage:'settled',outcome:'completed',quiescence:'delegated_tree'});
  ledger.treeBudget=reserveCompoundTreeAllocation(undefined,'source',{dispatch:{sessionIdentity:'child',hostProviderInvocationId:`child:${created.operation.id}`,originalToolUseId:created.operation.id},inputHash:'b'.repeat(64),recordKind:'delegation'}).budget;
  for(const [id,lease,operations] of [['source',parentLease,ledger],['child',childLease,createCompoundOperationLedger()]] as const)await store.compareAndSave({nextSnapshot:{...new AgentSessionState().exportSnapshot(),sessionId:id,compoundOperations:operations,...(id==='source'?{protectedObservationClosure:{version:1 as const,requiresReauthorization:true as const,observations:[]}}:{})},expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
  const request={requestSource:'user' as const,sessionId:'source',executionLease:parentLease,receipts:{begin(){receipts++;const db=new Database(join(root,'.session-execution',createHash('sha256').update('child').digest('hex')+'.sqlite'),{timeout:0});try{db.exec('BEGIN EXCLUSIVE');}catch{contested=true;}finally{db.close();}return 'a'.repeat(64);},complete(){}}};
  await expect(store.deleteSession(request)).rejects.toThrow();expect(receipts).toBe(0);
  await childLease.releaseAfterDrain();await store.deleteSession(request);expect(contested).toBe(true);expect(receipts).toBe(1);
  const after=await child.acquire({invocationId:'after-delete',kind:'recovery'});await after.releaseAfterDrain();
 }finally{await childLease.releaseAfterDrain();await parentLease.releaseAfterDrain();parent.dispose();child.dispose();rmSync(root,{recursive:true,force:true});}
});
it.each(['reserved','dispatched','unknown','settled','cancelled_before_dispatch'] as const)('preserves semantic spend facts until their actual terminal state: %s',async(status)=>{
 const {reserveSemanticCompaction,transitionSemanticReservation}=await import('../../../src/runtime/sol-pi/semantic-compaction-ledger.js');
 const root=mkdtempSync(join(tmpdir(),'semantic-delete-')),store=new FileSessionStore(root),authority=createSessionExecutionAuthority({root,sessionIdentity:'source',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})}),lease=await authority.acquire({invocationId:'setup',kind:'recovery'});let receipts=0;
 try{
  let ledger=reserveSemanticCompaction({version:1,currency:'USD',generation:0,policies:[{grantId:'grant',maxCalls:2,maxCostUnits:100,expiresAt:1000}],reservations:[],commits:[]},{operationId:'op',grantId:'grant',bodyDigest:'a'.repeat(64),sourceHistoryDigest:'a'.repeat(64),model:'deepseek-flash',priceRevision:'a'.repeat(64),maximumCostUnits:40},10);
  if(status==='dispatched'||status==='unknown'||status==='settled')ledger=transitionSemanticReservation(ledger,'op','dispatched');if(status==='unknown'||status==='settled'||status==='cancelled_before_dispatch')ledger=transitionSemanticReservation(ledger,'op',status);
  await store.compareAndSave({nextSnapshot:{...new AgentSessionState().exportSnapshot(),sessionId:'source',semanticCompaction:ledger,protectedObservationClosure:{version:1,requiresReauthorization:true,observations:[]}},expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
  const pending=store.deleteSession({requestSource:'user',sessionId:'source',executionLease:lease,receipts:{begin(){receipts++;return 'a'.repeat(64);},complete(){}}});
  if(status==='settled'||status==='cancelled_before_dispatch'){await pending;expect(receipts).toBe(1);}else{await expect(pending).rejects.toThrow(/semantic/);expect(receipts).toBe(0);}
 }finally{await lease.releaseAfterDrain();authority.dispose();rmSync(root,{recursive:true,force:true});}
});
