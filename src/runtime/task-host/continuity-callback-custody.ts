import {types} from 'node:util';
import {createRoomTurnCustody} from '../verification/original-sdk-custody.js';
import {appendIntrinsic,createIntrinsicSet,settleIntrinsicOperations} from '../verification/intrinsic-async-collection.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,then=Promise.prototype.then;
const create=Object.create,freeze=Object.freeze,define=Object.defineProperty,isProxy=types.isProxy;
const releaseCallbackMetadata=()=>{};
type Metadata={box:object;stock:ReturnType<typeof createRoomTurnCustody>;entered:boolean;raw:unknown[]};
/** Visible callback metadata only. Its fixed consumer releases no process,
 * stream, database or business resource and confers no execution authority. */
export function createContinuityCallbackCustody(){
 const members=new WeakMap<Function,Metadata>(),rows=createIntrinsicSet<Metadata>();
 function observe(row:Metadata,work:()=>Promise<unknown>):void{
  try{const raw=work();apply(then,raw,[undefined,(error:unknown)=>{appendIntrinsic(row.raw,error);}]);}
  catch(raw){appendIntrinsic(row.raw,raw);row.stock.inventory(raw);}
 }
 function scan(row:Metadata):void{
  if(row.entered)observe(row,()=>row.stock.consumeResource(releaseCallbackMetadata,row.box,[]));
 }
 function capture(fn:Function):Metadata{
  if(typeof fn!=='function'||isProxy(fn))throw Error('PROTECTED_CHILD_CALLBACK_REQUIRED');
  let row=apply(get,members,[fn]) as Metadata|undefined;
  if(row){scan(row);return row;}
  const box=create(null);define(box,'fn',{__proto__:null,value:fn} as PropertyDescriptor);freeze(box);
  row={box,stock:createRoomTurnCustody(),entered:false,raw:[]};apply(set,members,[fn,row]);rows.add(row);
  const original=row;
  // sdk scans synchronously. Observe its original result without inserting an
  // await into EventEmitter registration or callback dispatch.
  observe(row,()=>original.stock.sdk(()=>box,undefined,[],{accept:value=>{if(value!==box)return false;original.entered=true;return true;},consumer:releaseCallbackMetadata,strictProxyGraph:true}));
  scan(row);return row;
 }
 function invoke(fn:Function,receiver:unknown,args:unknown[]):unknown{
  const row=capture(fn);try{return apply(fn,receiver,args);}finally{scan(row);}
 }
 function rescan():Metadata[]{const all=rows.snapshot();for(let index=0;index<all.length;index++)scan(all[index]!);return all;}
 async function waitPhysicalKnown():Promise<void>{
  const results=await settleIntrinsicOperations(rescan(),row=>row.stock.waitPhysicalKnown());let first:{raw:unknown}|undefined;
  for(let index=0;index<results.length;index++)if(results[index]!.status==='rejected')first??={raw:(results[index] as PromiseRejectedResult).reason};
  if(first)throw first.raw;
 }
 function assertPhysicalKnown():void{
  const all=rescan();let first:{raw:unknown}|undefined;
  for(let index=0;index<all.length;index++)try{all[index]!.stock.assertPhysicalKnown();}catch(raw){first??={raw};}
  if(first)throw first.raw;
 }
 return freeze({capture,invoke,waitPhysicalKnown,assertPhysicalKnown});
}
