import {it,expect} from 'vitest';import {createHash} from 'node:crypto';
import {validateCompoundDelegationRecord,assertCompoundDelegationTransition} from '../../../src/runtime/sol-pi/compound-delegation-record.js';
import {createCompoundOperationLedger} from '../../../src/runtime/sol-pi/compound-operation.js';
import {createOrGetDirectOperation,advanceDirectOperation,retireDirectOperation} from '../../../src/runtime/sol-pi/compound-direct-operation.js';
const ack=JSON.stringify({agentId:'child',operationId:'turn:operation',status:'applied'});
const record={version:1 as const,admissionId:'admission',childSessionIdentity:'child',childStoreRoot:'/workspace',generation:1,state:'live' as const,childPhase:'running' as const,
 managed:{version:1 as const,groupId:'group',agentId:'child',rootEpoch:1,operationId:'turn:operation',nativeInvocationId:'operation',ackBytes:ack,ackHash:createHash('sha256').update(ack).digest('hex'),ackReady:false,ackPublished:false,resourcesReleasedDigest:null}};
it('retains frozen managed ACK bytes and permits only monotone independent publication/resource facts',()=>{
 expect(()=>validateCompoundDelegationRecord(record)).not.toThrow();
 const ready={...record,managed:{...record.managed,ackReady:true}};expect(()=>assertCompoundDelegationTransition(record,ready)).not.toThrow();
 const published={...ready,managed:{...ready.managed,ackPublished:true,resourcesReleasedDigest:'a'.repeat(64)}};expect(()=>assertCompoundDelegationTransition(ready,published)).not.toThrow();
 expect(()=>assertCompoundDelegationTransition(published,ready)).toThrow();
 expect(()=>assertCompoundDelegationTransition(record,{...record,managed:{...record.managed,ackPublished:true}})).toThrow();
 expect(()=>assertCompoundDelegationTransition(ready,{...ready,managed:{...ready.managed,operationId:'other'}})).toThrow();
 expect(()=>validateCompoundDelegationRecord({...record,managed:{...record.managed,ackBytes:'forged'}})).toThrow();
});
it('does not retire a managed ACK into a lossy generic tombstone',()=>{
 const created=createOrGetDirectOperation(createCompoundOperationLedger(),{dispatch:{sessionIdentity:'parent',hostProviderInvocationId:'provider',originalToolUseId:'call'},inputHash:'a'.repeat(64),toolName:'spawn_agent',ownerId:'host',requestSource:'agent',scopeId:'scope',permissionGeneration:1});
 const initial={...record,childPhase:'not_started' as const,managed:{...record.managed,nativeInvocationId:created.operation.id}};
 const started=advanceDirectOperation(created.ledger,created.operation.id,{stage:'started',finalInputHash:'b'.repeat(64),delegation:initial});
 const closed={...initial,generation:2,state:'closed' as const,childPhase:'drained' as const,managed:{...initial.managed,ackReady:true,ackPublished:true,resourcesReleasedDigest:'c'.repeat(64)}};
 const done=advanceDirectOperation(started,created.operation.id,{stage:'settled',outcome:'completed',quiescence:'delegated_tree',delegation:closed});
 expect(()=>retireDirectOperation(done,created.operation.id)).toThrow('compound_managed_ack_retained');
 expect(done.directOperations?.[0].delegation?.managed?.ackBytes).toBe(ack);
});
