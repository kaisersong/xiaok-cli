import runtime from './broker-runtime-package.cjs';
import type {BrokerNodeRuntime,BrokerRuntimeOptions} from './broker-runtime-package.cjs';
import {createRoomTurnCustody,type RoomTurnCustody} from './original-room-turn-custody.js';
import {createIntrinsicSet,settleIntrinsicOperations,appendIntrinsic,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
export type {BrokerNodeRuntime} from './broker-runtime-package.cjs';
const stocks=createIntrinsicSet<RoomTurnCustody>();
// Only the ordinary packaged Broker uses this compatibility profile. Native
// protected children retain their original Main executable and private Source.
export function resolvePackagedBrokerRuntime(options:BrokerRuntimeOptions):BrokerNodeRuntime|null {
  assertBrokerRuntimeReadsKnown();
  const stock=createRoomTurnCustody();stocks.add(stock);
  try{
    const value=runtime.resolvePackagedBrokerRuntime(options);stock.inventory(value);return value;
  }catch(first){
    try{stock.inventory(first);}catch(second){throw new AggregateError([first,second],'broker_runtime_sdk_inventory',{cause:first});}
    throw first;
  }finally{
    try{stock.assertPhysicalKnown();stocks.delete(stock);}catch{/* Keep original SDK tails, including bare-undefined presence. */}
  }
}
export const brokerRuntimeMatchesHealth = runtime.brokerRuntimeMatchesHealth;
// Fixed negative consumers only; callers cannot clear unknown custody or grant IO.
export function assertBrokerRuntimeReadsKnown():void {
  runtime.assertRuntimeFileReadsKnown();const rows=stocks.snapshot();
  for(let i=0;i<rows.length;i++)rows[i]!.assertPhysicalKnown();
}
export async function waitBrokerRuntimeReadsKnown():Promise<void> {
  const rows=stocks.snapshot(),errors:unknown[]=[];
  const outcomes=await settleIntrinsicOperations(rows,stock=>stock.waitPhysicalKnown());
  for(let i=0;i<outcomes.length;i++){
    const outcome=outcomes[i]!;
    if(outcome.status==='rejected')appendIntrinsic(errors,outcome.reason);else stocks.delete(rows[i]!);
  }
  try{runtime.assertRuntimeFileReadsKnown();}catch(raw){appendIntrinsic(errors,raw);}
  if(errors.length)throw aggregateIntrinsicErrors(errors,'broker_runtime_read_custody_unconfirmed');
}
