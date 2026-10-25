import { expect, it } from 'vitest';
import { createCompoundOperationLedger, createOrGetCompoundOperation, advanceCompoundOperation, retireCompoundOperation, validateCompoundOperationLedger, mergeCompoundOperationLedgers } from '../../../src/runtime/sol-pi/compound-operation.js';
const input={dispatch:{sessionIdentity:'sess',hostProviderInvocationId:'provider',originalToolUseId:'tool-1'},inputHash:'a'.repeat(64),toolName:'write' as const,ownerId:'host',requestSource:'agent' as const,scopeId:'scope',permissionGeneration:1};
it('binds the original durable dispatch key to one operation and rejects conflicting input',()=>{
 const first=createOrGetCompoundOperation(createCompoundOperationLedger(),input);
 const retry=createOrGetCompoundOperation(first.ledger,input);expect(retry.created).toBe(false);expect(retry.operation.id).toBe(first.operation.id);
 expect(()=>createOrGetCompoundOperation(first.ledger,{...input,inputHash:'b'.repeat(64)})).toThrow('dispatch_identity_conflict');
 const different=createOrGetCompoundOperation(first.ledger,{...input,dispatch:{...input.dispatch,hostProviderInvocationId:'new-request'}});expect(different.operation.id).not.toBe(first.operation.id);
});
it('requires ordered durable phases and preserves reservations after restart',()=>{
 const first=createOrGetCompoundOperation(createCompoundOperationLedger(),input);const id=first.operation.id;
 expect(()=>advanceCompoundOperation(first.ledger,id,{stage:'validation_started'})).toThrow();
 let ledger=advanceCompoundOperation(first.ledger,id,{stage:'edit_started',finalInputHash:'b'.repeat(64)});
 ledger=validateCompoundOperationLedger(JSON.parse(JSON.stringify(ledger)));
 expect(ledger.operations[0].reservation.recordBytes).toBe(32768);
 ledger=advanceCompoundOperation(ledger,id,{stage:'edit_committed',file:{path:'/fixture/file',beforeHash:null,afterHash:'c'.repeat(64)}});
 ledger=advanceCompoundOperation(ledger,id,{stage:'validation_started',physicalExecution:{sessionIdentity:'sess',compoundOperationId:id,validationInvocationId:ledger.operations[0].validationInvocationId,executionIdentity:'engine-reservation',scopeDigest:'d'.repeat(64)}});
 ledger=advanceCompoundOperation(ledger,id,{stage:'settled',validation:{status:'failed',exitCode:2}});
 expect(ledger.operations[0].editStatus).toBe('succeeded');expect(ledger.operations[0].validation.exitCode).toBe(2);
 expect(()=>mergeCompoundOperationLedgers(ledger,first.ledger)).toThrow();
});
it('retains the original dispatch identity in a tombstone and never re-executes it',()=>{
 const first=createOrGetCompoundOperation(createCompoundOperationLedger(),input);let ledger=advanceCompoundOperation(first.ledger,first.operation.id,{stage:'settled',editStatus:'denied'});
 ledger=retireCompoundOperation(ledger,first.operation.id);
 expect(ledger.operations).toHaveLength(0);expect(ledger.tombstones[0].dispatch).toEqual(input.dispatch);
 const retry=createOrGetCompoundOperation(ledger,input);expect(retry.created).toBe(false);expect(retry.operation.id).toBe(first.operation.id);
 expect(()=>createOrGetCompoundOperation(ledger,{...input,inputHash:'c'.repeat(64)})).toThrow();
});
it('refuses capacity before a new operation and rejects reservation corruption',()=>{
 let ledger=createCompoundOperationLedger();for(let n=0;n<256;n++)ledger=createOrGetCompoundOperation(ledger,{...input,dispatch:{...input.dispatch,originalToolUseId:'tool-'+n}}).ledger;
 expect(()=>createOrGetCompoundOperation(ledger,{...input,dispatch:{...input.dispatch,originalToolUseId:'overflow'}})).toThrow('compound_capacity');
 const corrupt=structuredClone(ledger);corrupt.operations[0].reservation.recordBytes=0;
 expect(()=>validateCompoundOperationLedger(corrupt)).toThrow();
});
it('preserves unknown facts without manufacturing a successful edit or validation',()=>{
 const first=createOrGetCompoundOperation(createCompoundOperationLedger(),input);
 const started=advanceCompoundOperation(first.ledger,first.operation.id,{stage:'edit_started',finalInputHash:'b'.repeat(64)});
 const unknown=advanceCompoundOperation(started,first.operation.id,{stage:'outcome_unknown'});
 expect(unknown.operations[0].editStatus).toBe('unknown');expect(unknown.operations[0].validation.status).toBe('not_started');
 expect(()=>advanceCompoundOperation(unknown,first.operation.id,{stage:'validation_started'})).toThrow();
 expect(()=>retireCompoundOperation(unknown,first.operation.id)).toThrow();
});
it('cannot settle a successful edit or validation without traversing its started phase',()=>{
 const first=createOrGetCompoundOperation(createCompoundOperationLedger(),input),id=first.operation.id;
 expect(()=>advanceCompoundOperation(first.ledger,id,{stage:'settled',editStatus:'succeeded',finalInputHash:'b'.repeat(64),file:{path:'/fixture/file',beforeHash:null,afterHash:'c'.repeat(64)}})).toThrow();
 const started=advanceCompoundOperation(first.ledger,id,{stage:'edit_started',finalInputHash:'b'.repeat(64)});
 expect(()=>advanceCompoundOperation(started,id,{stage:'settled',editStatus:'succeeded',file:{path:'/fixture/file',beforeHash:null,afterHash:'c'.repeat(64)},validation:{status:'succeeded',exitCode:0}})).toThrow();
 const committed=advanceCompoundOperation(started,id,{stage:'edit_committed',file:{path:'/fixture/file',beforeHash:null,afterHash:'c'.repeat(64)}});
 expect(()=>advanceCompoundOperation(committed,id,{stage:'settled',validation:{status:'succeeded',exitCode:0}})).toThrow();
});
it('requires an exact durable physical execution identity before validation and never swaps it',()=>{
 const first=createOrGetCompoundOperation(createCompoundOperationLedger(),input),id=first.operation.id;
 let ledger=advanceCompoundOperation(first.ledger,id,{stage:'edit_started',finalInputHash:'b'.repeat(64)});
 ledger=advanceCompoundOperation(ledger,id,{stage:'edit_committed',file:{path:'/fixture/file',beforeHash:null,afterHash:'c'.repeat(64)}});
 expect(()=>advanceCompoundOperation(ledger,id,{stage:'validation_started'})).toThrow();
 const expected={sessionIdentity:'sess',compoundOperationId:id,validationInvocationId:(first.operation as any).validationInvocationId,executionIdentity:'host-engine-reservation',scopeDigest:'d'.repeat(64)};
 expect(()=>advanceCompoundOperation(ledger,id,{stage:'validation_started',physicalExecution:{...expected,sessionIdentity:'another'}} as any)).toThrow();
 const started=advanceCompoundOperation(ledger,id,{stage:'validation_started',physicalExecution:expected} as any);
 expect(validateCompoundOperationLedger(JSON.parse(JSON.stringify(started))).operations[0]).toMatchObject({physicalExecution:expected});
 expect(()=>advanceCompoundOperation(started,id,{stage:'settled',validation:{status:'succeeded',exitCode:0},physicalExecution:{...expected,executionIdentity:'replacement'}} as any)).toThrow();
});
