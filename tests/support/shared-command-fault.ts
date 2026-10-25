import {vi} from 'vitest';
import type {Database} from 'better-sqlite3';
import * as dispatcher from '../../src/runtime/verification/shared-capacity-command-dispatch.js';
import {consumeSharedCapacityCommandContext,type CapacityOwner,type CapacityProposal,type CapacityRecord,type CapacityTransaction,type CapacityReservationBatch, type createSharedCapacityLedger} from '../../src/runtime/verification/shared-capacity-ledger.js';
type Ledger=ReturnType<typeof createSharedCapacityLedger>;
type Facts=ReturnType<typeof dispatcher.inspectSharedCapacityCommand>;
/** Test instrumentation only. Injects faults at the fixed dispatcher, never grants
 * a production caller a command/context. Normal writes are tested through installed start. */
export function sharedCommandFault(ledger:Ledger,db:Database){
 function invoke(facts:Facts,effect:(context:dispatcher.SharedCapacityWriteContext)=>void,parent?:dispatcher.SharedCapacityWriteContext){
  const command=Object.freeze({}),inspect=dispatcher.inspectSharedCapacityCommand,execute=dispatcher.executeSharedCapacityCommand;
  const is=vi.spyOn(dispatcher,'inspectSharedCapacityCommand').mockImplementation((c,l,d)=>c===command&&l===ledger&&d===db?facts:inspect(c,l,d));
  const es=vi.spyOn(dispatcher,'executeSharedCapacityCommand').mockImplementation((c,context)=>{if(c!==command)return execute(c,context);consumeSharedCapacityCommandContext(context,ledger,db,command);effect(context);});
  try{return parent?ledger.reserveBatchCommand(command,parent):ledger.reserveCommand(command);}finally{es.mockRestore();is.mockRestore();}
 }
 // A test adapter for historical fault bodies. It is not a public transaction API.
 function injected(work:(transaction:CapacityTransaction)=>unknown){let active=true,used=false,failure:unknown;const transaction={run(database:Database,body:()=>void){if(!active||used||database!==db||!db.inTransaction)throw Error('test_transaction');used=true;try{body();}catch(error){failure=error;throw error;}}};try{const result=work(transaction);if(result!==undefined)throw Error('test_sync');if(failure)throw failure;if(!used)throw Error('test_transaction_unused');}finally{active=false;}}
 return {
  reserveWithCommit(owner:CapacityOwner,proposal:CapacityProposal,work:(allocation:Readonly<{record:Readonly<CapacityRecord>;created:boolean}>,transaction:CapacityTransaction)=>void){const existed=ledger.query(owner,proposal.operationId);return invoke({kind:'reserve',owner,proposal,receipt:undefined},()=>injected(t=>work({record:ledger.query(owner,proposal.operationId)!,created:!existed},t))) as Readonly<{record:Readonly<CapacityRecord>;created:boolean}>;},
  releaseWithCommit(owner:CapacityOwner,operationId:string,receipt:object,work:(transaction:CapacityTransaction)=>void){const record=ledger.query(owner,operationId)!;const {resourceId,generation,partition,bytes,bindingHash}=record;return invoke({kind:'release',owner,proposal:{operationId,resourceId,generation,partition,bytes,bindingHash},receipt},()=>injected(work));},
  importReservations(entries:readonly {owner:CapacityOwner;proposal:CapacityProposal}[],work:(transaction:CapacityTransaction)=>void){return invoke({kind:'import',entries:[...entries]},()=>injected(work));},
  withReservationTransaction(work:(batch:CapacityReservationBatch)=>unknown){return invoke({kind:'transaction'},context=>{const result=work({reserveWithCommit(entries,commit){invoke({kind:'batch',entries},()=>injected(t=>commit(entries.map(e=>({record:ledger.query(e.owner,e.proposal.operationId)!,created:true})),t)),context);}});if(result!==undefined)throw Error('test_sync');});},
 };
}
