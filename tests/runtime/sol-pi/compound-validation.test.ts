import {expect,it,vi} from 'vitest';
import {executeCompoundValidation} from '../../../src/runtime/sol-pi/compound-validation.js';
import {createCompoundOperationLedger,createOrGetCompoundOperation,advanceCompoundOperation} from '../../../src/runtime/sol-pi/compound-operation.js';
function fixture(){
 const original={dispatch:{sessionIdentity:'session',hostProviderInvocationId:'provider',originalToolUseId:'tool'},inputHash:'a'.repeat(64),toolName:'write' as const,ownerId:'host',scopeId:'scope',requestSource:'agent' as const,permissionGeneration:1};
 const created=createOrGetCompoundOperation(createCompoundOperationLedger(),original),id=created.operation.id;
 let ledger=advanceCompoundOperation(created.ledger,id,{stage:'edit_started',finalInputHash:'b'.repeat(64)});
 ledger=advanceCompoundOperation(ledger,id,{stage:'edit_committed',file:{path:'/fixture/file',beforeHash:null,afterHash:'c'.repeat(64)}});
 const record=ledger.operations[0],expected={sessionIdentity:'session',compoundOperationId:id,validationInvocationId:record.validationInvocationId,executionIdentity:'private-engine-id',scopeDigest:'d'.repeat(64)},receipt={};
 // Infrastructure contract double only: no product factory registers this port and
 // this test makes no qualified-engine claim. Production ledger consumer is real.
 const backend={prepareValidationInput:vi.fn(async()=>({materializedInput:{} as any,command:{argv:['/bin/sh','-c','exit 2'],cwdRelative:'.'},scopeDigest:expected.scopeDigest})),execution:{
  reserveExecution:vi.fn(async()=>({executionIdentity:expected.executionIdentity,expected})),
  dispatchExecution:vi.fn(async(_e:any,options:any)=>{expect(ledger.operations[0]).toMatchObject({stage:'validation_started',physicalExecution:expected});options.onStdout('actual-output');return{termination:'terminal' as const,receipt:receipt as any,exitCode:2,outputTruncated:false};}),
  inspectExecution:vi.fn(),assertQuiescent:vi.fn((value:any,identity:any)=>{if(value!==receipt||JSON.stringify(identity)!==JSON.stringify(expected))throw Error('bad receipt');}),
 }};
 const persist=async(change:any)=>{ledger=advanceCompoundOperation(ledger,id,change);};
 const run=async()=>executeCompoundValidation({backend,preparedInput:await backend.prepareValidationInput(),record,actual:{command:'exit 2',workdir:'/fixture',timeoutMs:1000,maxChars:1000},assertCurrent:()=>{},persist});
 return{backend,run,read:()=>ledger.operations[0],expected};
}
it('durable identity precedes dispatch and only exact physical receipt permits terminal',async()=>{
 const f=fixture();expect(await f.run()).toContain('exitCode=2');expect(f.read()).toMatchObject({stage:'settled',editStatus:'succeeded',validation:{status:'failed',exitCode:2}});expect(f.backend.execution.assertQuiescent).toHaveBeenCalledTimes(1);
});
it('lost physical receipt preserves the edit and installs the session unknown fact',async()=>{
 const f=fixture();f.backend.execution.assertQuiescent.mockImplementation(()=>{throw Error('lost engine identity');});expect(await f.run()).toContain('unknown');expect(f.read()).toMatchObject({stage:'outcome_unknown',editStatus:'succeeded',validation:{status:'unknown'}});
});
it('changed staging command or foreign reservation cannot reach dispatch',async()=>{
 const f=fixture();f.backend.prepareValidationInput.mockImplementation(async()=>({materializedInput:{} as any,command:{argv:['/bin/sh','-c','different'],cwdRelative:'.'},scopeDigest:'d'.repeat(64)}));await expect(f.run()).rejects.toThrow('command_changed');expect(f.backend.execution.dispatchExecution).not.toHaveBeenCalled();
 const g=fixture();g.backend.execution.reserveExecution.mockImplementation(async()=>({executionIdentity:'new',expected:{...g.expected,executionIdentity:'new',validationInvocationId:'foreign'}}));await expect(g.run()).rejects.toThrow('reservation_mismatch');expect(g.backend.execution.dispatchExecution).not.toHaveBeenCalled();
});
