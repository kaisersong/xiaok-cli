import {it,expect} from 'vitest';
import {prepareManagedTurn,advanceManagedTurn,validateManagedTurnLedger,mergeManagedTurnLedgers} from '../../../src/runtime/sol-pi/compound-managed-turn.js';
const facts={admissionId:'actor-admission',childSessionId:'child',operationId:'main-operation',turnId:'turn-one',rootEpoch:1,inputHash:'a'.repeat(64),closureDigest:'b'.repeat(64)};
it('keeps each actual Main operation immutable and requires old turn drain before a new generation',()=>{
 const first=prepareManagedTurn(undefined,facts);expect(first.created).toBe(true);expect(first.record.generation).toBe(1);
 expect(prepareManagedTurn(first.ledger,facts).created).toBe(false);
 expect(()=>prepareManagedTurn(first.ledger,{...facts,inputHash:'c'.repeat(64)})).toThrow(/identity/);
 expect(()=>prepareManagedTurn(first.ledger,{...facts,operationId:'next',turnId:'turn-two'})).toThrow(/pending/);
 expect(()=>advanceManagedTurn(first.ledger,1,{state:'active'})).toThrow(/applied/);
 const applied=advanceManagedTurn(first.ledger,1,{state:'prepared',appliedDigest:'d'.repeat(64)});
 const active=advanceManagedTurn(applied,1,{state:'active'});
 expect(()=>advanceManagedTurn(active,1,{state:'drained'})).toThrow(/transition/);
 const retiring=advanceManagedTurn(active,1,{state:'retiring'});
 const drained=advanceManagedTurn(retiring,1,{state:'drained'});
 const next=prepareManagedTurn(drained,{...facts,operationId:'next',turnId:'turn-two'});expect(next.record.generation).toBe(2);
 expect(()=>advanceManagedTurn(next.ledger,1,{state:'active'})).toThrow();
 expect(()=>mergeManagedTurnLedgers(next.ledger,drained)).toThrow(/regression/);
 expect(validateManagedTurnLedger(next.ledger).records).toHaveLength(2);
});
it('preserves unknown and applied failures without allowing cancellation to wash away work',()=>{
 let ledger=prepareManagedTurn(undefined,facts).ledger;
 ledger=advanceManagedTurn(ledger,1,{state:'prepared',appliedDigest:'d'.repeat(64)});
 expect(()=>advanceManagedTurn(ledger,1,{state:'cancelled_before_activation'})).toThrow(/applied/);
 ledger=advanceManagedTurn(ledger,1,{state:'unknown'});
 expect(()=>advanceManagedTurn(ledger,1,{state:'drained'})).toThrow(/transition/);
 expect(()=>prepareManagedTurn(ledger,{...facts,operationId:'next',turnId:'two'})).toThrow(/pending/);
 expect(()=>validateManagedTurnLedger({...ledger,extra:true})).toThrow();
});
it('bounds retained turns and rejects source-identity or epoch regression',()=>{
 let ledger=prepareManagedTurn(undefined,facts).ledger;
 ledger=advanceManagedTurn(ledger,1,{state:'cancelled_before_activation'});
 expect(()=>prepareManagedTurn(ledger,{...facts,operationId:'next',turnId:'next',childSessionId:'other'})).toThrow();
 const epochTwo=prepareManagedTurn(ledger,{...facts,operationId:'two',turnId:'two',rootEpoch:2});
 let next=advanceManagedTurn(epochTwo.ledger,2,{state:'cancelled_before_activation'});
 expect(()=>prepareManagedTurn(next,{...facts,operationId:'old-epoch',turnId:'old-epoch'})).toThrow(/epoch/);
 for(let generation=3;generation<=128;generation++){next=prepareManagedTurn(next,{...facts,rootEpoch:2,operationId:`op-${generation}`,turnId:`turn-${generation}`}).ledger;next=advanceManagedTurn(next,generation,{state:'cancelled_before_activation'});}
 expect(()=>prepareManagedTurn(next,{...facts,rootEpoch:2,operationId:'too-many',turnId:'too-many'})).toThrow(/capacity/);
});
it('is retained by the real compound ledger merge and cannot disappear from a newer snapshot',async()=>{
 const {createCompoundOperationLedger,validateCompoundOperationLedger,mergeCompoundOperationLedgers}=await import('../../../src/runtime/sol-pi/compound-operation.js');
 const base=createCompoundOperationLedger(),managedTurns=prepareManagedTurn(undefined,facts).ledger;
 const actual=validateCompoundOperationLedger({...base,generation:1,managedTurns});
 expect(actual.managedTurns).toEqual(managedTurns);
 expect(()=>mergeCompoundOperationLedgers(actual,{...base,generation:2})).toThrow(/regression/);
});
it('keeps an active turn in the actual filesystem inventory and blocks deletion census',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');
 const {createSessionExecutionAuthority,createSessionExecutionContext}=await import('../../../src/ai/runtime/session-store/execution-authority.js');
 const {createCompoundOperationLedger}=await import('../../../src/runtime/sol-pi/compound-operation.js');
 const {inspectCompoundSourceInventory}=await import('../../../src/runtime/sol-pi/compound-source-inventory.js');
 const {holdCompoundDeletionCensus}=await import('../../../src/ai/runtime/session-store/compound-deletion-census.js');
 const root=mkdtempSync(join(tmpdir(),'managed-turn-census-')),store=new FileSessionStore(root),sessionId='child';
 const snapshot={sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]};await store.save(snapshot);
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'test',scopeId:'test'})}),lease=await authority.acquire({invocationId:'turn',kind:'compound'});
 try{
  const old=(await store.load(sessionId))!,turn=prepareManagedTurn(undefined,facts).ledger,applied=advanceManagedTurn(turn,1,{state:'prepared',appliedDigest:'c'.repeat(64)}),managedTurns=advanceManagedTurn(applied,1,{state:'active'});
  await store.compareAndSave({expectedStoreRevision:old.storeRevision!,expectedHistoryDigest:old.historyDigest!,nextSnapshot:{...old,compoundOperations:{...createCompoundOperationLedger(),generation:1,managedTurns}},lease});
  const durable=(await store.load(sessionId))!;
  expect(inspectCompoundSourceInventory([root]).snapshots[0].hasUnsettledExecution).toBe(true);
  expect(()=>holdCompoundDeletionCensus(root,durable,0)).toThrow(/unsettled/);
 }finally{await lease.releaseAfterDrain();authority.dispose();rmSync(root,{recursive:true,force:true});}
});
