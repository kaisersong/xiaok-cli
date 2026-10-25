import {expect,it} from 'vitest';
import {createCompoundOperationLedger,createOrGetCompoundOperation,validateCompoundOperationLedger,mergeCompoundOperationLedgers} from '../../../src/runtime/sol-pi/compound-operation.js';
import {createOrGetDirectOperation,advanceDirectOperation,retireDirectOperation} from '../../../src/runtime/sol-pi/compound-direct-operation.js';
const input={dispatch:{sessionIdentity:'s',hostProviderInvocationId:'p',originalToolUseId:'t'},inputHash:'a'.repeat(64),toolName:'bash',ownerId:'host',requestSource:'agent' as const,scopeId:'scope',permissionGeneration:1};
it('direct mutations share duplicate identity and permanent tombstones with fusion',()=>{
 const created=createOrGetDirectOperation(createCompoundOperationLedger(),input);
 expect(createOrGetDirectOperation(created.ledger,input).created).toBe(false);
 expect(()=>createOrGetCompoundOperation(created.ledger,{...input,toolName:'write'})).toThrow('dispatch_identity_conflict');
 const done=advanceDirectOperation(created.ledger,created.operation.id,{stage:'settled',outcome:'denied'});
 const retired=retireDirectOperation(done,created.operation.id);
 expect(createOrGetDirectOperation(retired,input).created).toBe(false);
 expect(()=>mergeCompoundOperationLedgers(retired,created.ledger)).toThrow();
});
it('rejects skipped successful phases and preserves unknown as a nonterminal latch',()=>{
 const c=createOrGetDirectOperation(createCompoundOperationLedger(),input);
 expect(()=>advanceDirectOperation(c.ledger,c.operation.id,{stage:'settled',outcome:'completed',quiescence:'isolated_tree'})).toThrow();
 const started=advanceDirectOperation(c.ledger,c.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)});
 expect(()=>advanceDirectOperation(started,c.operation.id,{stage:'settled',outcome:'completed'})).toThrow();
 const unknown=advanceDirectOperation(started,c.operation.id,{stage:'outcome_unknown',outcome:'unknown'});
 expect(()=>retireDirectOperation(unknown,c.operation.id)).toThrow();
 expect(()=>advanceDirectOperation(unknown,c.operation.id,{stage:'settled',outcome:'completed',quiescence:'isolated_tree'})).toThrow();
 expect(validateCompoundOperationLedger(unknown).directOperations?.[0].stage).toBe('outcome_unknown');
});
it('counts direct and fusion against one active-record quota',()=>{
 let ledger=createCompoundOperationLedger();
 for(let i=0;i<128;i++)ledger=createOrGetCompoundOperation(ledger,{...input,toolName:'write',dispatch:{...input.dispatch,originalToolUseId:`f${i}`}}).ledger;
 for(let i=0;i<128;i++)ledger=createOrGetDirectOperation(ledger,{...input,dispatch:{...input.dispatch,originalToolUseId:`d${i}`}}).ledger;
 expect(()=>createOrGetDirectOperation(ledger,{...input,dispatch:{...input.dispatch,originalToolUseId:'overflow'}})).toThrow('compound_capacity');
});
it('records a main message commit separately from file or process quiescence and cannot reconcile unknown automatically',()=>{
 const c=createOrGetDirectOperation(createCompoundOperationLedger(),{...input,toolName:'send_message'});
 const metadataCommit={adapter:'desktop-service-metadata-v1' as const,kind:'send' as const,operationId:'main-op',requestHash:'c'.repeat(64),resultHash:'d'.repeat(64),groupId:'group',actorId:'actor',epoch:1};
 const receipt={stage:'settled' as const,outcome:'completed' as const,quiescence:'metadata_commit' as const,metadataCommit};
 expect(()=>advanceDirectOperation(c.ledger,c.operation.id,receipt)).toThrow();
 const started=advanceDirectOperation(c.ledger,c.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)});
 const settled=advanceDirectOperation(started,c.operation.id,receipt);
 expect(settled.directOperations![0]).toMatchObject({physicalExecution:null,metadataCommit,quiescence:'metadata_commit'});
 expect(settled.directOperations![0]).not.toHaveProperty('fileFacts');
 const unknown=advanceDirectOperation(started,c.operation.id,{stage:'outcome_unknown',outcome:'unknown'});
 expect(()=>advanceDirectOperation(unknown,c.operation.id,receipt)).toThrow();
 const changed=structuredClone(settled);changed.directOperations![0].metadataCommit!.operationId='other';expect(()=>mergeCompoundOperationLedgers(settled,changed)).toThrow();
 const file=createOrGetDirectOperation(createCompoundOperationLedger(),{...input,toolName:'write'}),fileStarted=advanceDirectOperation(file.ledger,file.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)});
 expect(()=>advanceDirectOperation(fileStarted,file.operation.id,receipt)).toThrow();
});
