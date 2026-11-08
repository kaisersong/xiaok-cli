/** Same-Core negative SDK custody. No issuer, Native API, verifier, callback,
 * table or path can be supplied. Returned cuts never grant an effect. */
import {types} from 'node:util';
import {closeOptionalOriginalProtectedKSwarmServicePort,readOptionalOriginalProtectedKSwarmServicePortFate} from './kswarm-protected-service-binding.js';
import {closeOriginalProtectedKSwarmChild,readOptionalOriginalProtectedKSwarmChildPortFate} from './kswarm-protected-child.js';
import {createRoomTurnCustody,type RoomTurnCustody} from './original-room-turn-custody.js';
import {appendIntrinsic,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import type {MainDshCoreCloseFailure} from './main-dsh-bootstrap-types.js';
const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,define=Object.defineProperty,freeze=Object.freeze,create=Object.create,NativeError=Error,NativePromise=Promise,then=Promise.prototype.then,apply=Reflect.apply;
type Cut=Readonly<{sourceEntered:boolean;first?:MainDshCoreCloseFailure;unconfirmed?:{raw:unknown}}>;
const denied=()=>new NativeError('DSH_MAIN_KSWARM_CLEANUP_UNCONFIRMED');
/** Pure error assembly. Only the private Main flow consumes these boxes. */
export function combineOriginalMainDshCoreCloseError(first:MainDshCoreCloseFailure,extra?:{raw:unknown}):unknown{
 const errors:unknown[]=[];appendIntrinsic(errors,first.raw);
 if(first.secondary)for(let i=0;i<first.secondary.length;i++)appendIntrinsic(errors,first.secondary[i]);
 if(extra)appendIntrinsic(errors,extra.raw);if(errors.length===1)return first.raw;
 const result=aggregateIntrinsicErrors(errors,'DSH_MAIN_CORE_CLOSE_UNCONFIRMED');define(result,'cause',{__proto__:null,value:first.raw,writable:true,configurable:true} as PropertyDescriptor);return result;
}
export function createOriginalMainDshKSwarmCleanup(){
 const serviceClose=createRoomTurnCustody(),serviceJoin=createRoomTurnCustody(),sourceClose=createRoomTurnCustody(),sourceJoin=createRoomTurnCustody();
 let closing:Promise<Cut>|undefined,originalPort:object|undefined;
 const raws:unknown[]=[];
 function method(value:object,name:string):Function{const row=descriptor(value,name);if(!row||!own(row,'value')||typeof row.value!=='function'||types.isProxy(row.value))throw denied();return row.value;}
 async function join(stock:RoomTurnCustody,view:object):Promise<void>{
  appendIntrinsic(raws,view);if(types.isProxy(view)||types.isPromise(view)){stock.inventory(view);throw new NativeError('DSH_MAIN_KSWARM_FATE_INVALID',{cause:view});}
  const wait=method(view,'waitPhysicalKnown');
  await stock.sdk(()=>view,undefined,[],{accept:raw=>raw===view,consumer:wait,strictProxyGraph:true});
  const raw=await stock.consumeResource(wait,view,[]);appendIntrinsic(raws,raw);if(raw!==undefined)throw new NativeError('DSH_MAIN_KSWARM_FATE_NONVOID',{cause:raw});
 }
 const close=(port:object):Promise<Cut>=>{
  if(!port||typeof port!=='object'||types.isProxy(port))return new NativePromise((_yes,no)=>no(denied()));
  if(closing)return port===originalPort?closing:new NativePromise((_yes,no)=>no(denied()));
  originalPort=port;let yes!:(cut:Cut)=>void,no!:(raw:unknown)=>void;closing=new NativePromise<Cut>((resolve,reject)=>{yes=resolve;no=reject;});define(closing,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);
  const run=(async():Promise<Cut>=>{
   let first:MainDshCoreCloseFailure|undefined,unconfirmed:{raw:unknown}|undefined,serviceResult:{raw:unknown}|undefined;
   const remember=(raw:unknown)=>{appendIntrinsic(raws,raw);if(!first)first={raw};else if(raw!==first.raw){first.secondary??=[];appendIntrinsic(first.secondary,raw);}};
   const block=(raw:unknown)=>{remember(raw);unconfirmed??={raw};};
   try{const raw=await serviceClose.sdk(closeOptionalOriginalProtectedKSwarmServicePort,undefined,[port]);appendIntrinsic(raws,raw);serviceResult={raw};if(raw!==null&&raw!==undefined)block(new NativeError('DSH_MAIN_KSWARM_SERVICE_NONVOID',{cause:raw}));}catch(raw){remember(raw);}
   const fate=readOptionalOriginalProtectedKSwarmChildPortFate(port);
   if(fate){
    try{const raw=await sourceClose.sdk(closeOriginalProtectedKSwarmChild,undefined,[port]);appendIntrinsic(raws,raw);if(raw!==undefined)block(new NativeError('DSH_MAIN_KSWARM_SOURCE_NONVOID',{cause:raw}));}catch(raw){remember(raw);}
    try{await join(sourceJoin,fate);}catch(raw){block(raw);}
   }
   // Service and Source inventories are independent; one rejection never skips
   // the other's fixed negative SDK or physical join.
   const service=readOptionalOriginalProtectedKSwarmServicePortFate(port);
   if(service){
    if(serviceResult&&serviceResult.raw!==undefined)block(denied());
    try{await join(serviceJoin,service);}catch(raw){block(raw);}
   }else if(!serviceResult||serviceResult.raw!==null)block(denied());
   const stocks=[serviceClose,serviceJoin,sourceClose,sourceJoin];
   for(let i=0;i<stocks.length;i++)try{await stocks[i]!.waitPhysicalKnown();}catch(raw){block(raw);}
   const cut=create(null);define(cut,'sourceEntered',{__proto__:null,value:fate!==null,enumerable:true} as PropertyDescriptor);define(cut,'first',{__proto__:null,value:first,enumerable:true} as PropertyDescriptor);define(cut,'unconfirmed',{__proto__:null,value:unconfirmed,enumerable:true} as PropertyDescriptor);return freeze(cut) as Cut;
  })();define(run,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);apply(then,run,[yes,no]);return closing;
 };
 return freeze({close});
}
