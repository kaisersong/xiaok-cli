import {createRoomTurnCustody} from '../../../src/runtime/verification/original-sdk-custody.js';
import {createProtectedChildCallbackCustody} from '../protected-child-callback-custody.js';
/** Visible SDK tails only; never a Source, Native receipt or caller qualification. */
export class ContinuitySdkCustody{
 readonly #callbacks=createProtectedChildCallbackCustody();readonly #stocks:ReturnType<typeof createRoomTurnCustody>[]=[];
 captureCallback(fn:Function):void{this.#callbacks.capture(fn);}
 invokeSync<T>(fn:Function,receiver:unknown,args:unknown[]):T{
  this.#callbacks.capture(fn);const stock=createRoomTurnCustody();this.#stocks.push(stock);let value!:T,first:{raw:unknown}|undefined;
  try{stock.syncVoid(()=>{value=Reflect.apply(fn,receiver,args) as T;},undefined,[]);stock.inventory(value);stock.assertPhysicalKnown();}catch(raw){first={raw};}
  try{this.#callbacks.capture(fn);}catch(raw){if(first)throw new AggregateError([first.raw,raw],'continuity_sdk_callback_unconfirmed',{cause:first.raw});throw raw;}if(first)throw first.raw;return value;
 }
 async invoke<T>(fn:Function,receiver:unknown,args:unknown[]):Promise<T>{
  this.#callbacks.capture(fn);const stock=createRoomTurnCustody();this.#stocks.push(stock);let value!:T,first:{raw:unknown}|undefined;
  try{value=await stock.sdk<T>(fn,receiver,args);}catch(raw){first={raw};}
  try{this.#callbacks.capture(fn);}catch(raw){if(first)throw new AggregateError([first.raw,raw],'continuity_sdk_callback_unconfirmed',{cause:first.raw});throw raw;}
  if(first)throw first.raw;return value;
 }

 async waitKnown(){const errors:unknown[]=[];for(const stock of this.#stocks)try{await stock.waitPhysicalKnown();}catch(raw){errors.push(raw);}try{await this.#callbacks.waitPhysicalKnown();}catch(raw){errors.push(raw);}if(errors.length)throw new AggregateError(errors,'continuity_sdk_unconfirmed',{cause:errors[0]});this.assertKnown();}
 assertKnown(){this.#callbacks.assertPhysicalKnown();for(const stock of this.#stocks)stock.assertPhysicalKnown();}
}
