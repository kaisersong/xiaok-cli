import {createRoomTurnCustody} from './original-room-turn-custody.js';
const apply=Reflect.apply,define=Object.defineProperty,create=Object.create,assign=Object.assign,NativePromise=Promise,then=Promise.prototype.then,NativeError=Error,freeze=Object.freeze;
// Metadata association only. This consumer closes no Native/DB resource and
// supplies no physical fate beyond this fixed function's visible own graph.
const releaseFunctionMetadata=()=>{};
/** Internal Core closure. Only Core's private realm table publishes these
 * methods; this factory grants no issuer, role, file family, or Core lease. */
export function createOriginalMainDshComponentCustody(fn:Function|undefined,receiver:object,issuer:object,local:()=>void){
 const stock=fn?createRoomTurnCustody():undefined;
 const metadata=fn?freeze(assign(create(null),{fn})):undefined;
 let pending:Promise<void>|undefined,entered=false,closing=false;
 function assert():Promise<void>|null{
  local();if(closing)throw new NativeError('DSH_MAIN_SERVICE_COMPONENT_CLOSED');if(!fn)return null;
  if(pending)return pending;
  let yes!:()=>void,no!:(raw:unknown)=>void;
  pending=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});define(pending,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);
  const operation=(async()=>{
   let first:{raw:unknown}|undefined;
   try{
    // Fixed function identity is a resource solely for the original custody's
    // strict full own/symbol graph walker, never an authorization classifier.
    await stock!.sdk(()=>metadata,undefined,[],{accept:value=>{if(value!==metadata)return false;entered=true;return true;},consumer:releaseFunctionMetadata,strictProxyGraph:true});
    await stock!.waitKnown();local();if(closing)throw new NativeError('DSH_MAIN_SERVICE_COMPONENT_CLOSED');
    stock!.syncVoid(()=>{const raw=apply(fn,receiver,[issuer]);if(raw!==undefined)throw new NativeError('DSH_MAIN_SERVICE_COMPONENT_NONVOID',{cause:raw});},undefined,[]);
   }catch(raw){first={raw};stock!.inventory(raw);}
   // The post-SDK scan also runs on bare-undefined and unknown rejection.
   if(entered)try{await stock!.consumeResource(releaseFunctionMetadata,metadata!,[]);}catch(raw){first??={raw};stock!.inventory(raw);}
   try{await stock!.waitPhysicalKnown();}catch(raw){first??={raw};}
   if(first)throw first.raw;local();if(closing)throw new NativeError('DSH_MAIN_SERVICE_COMPONENT_CLOSED');
  })();apply(then,operation,[yes,no]);return pending;
 }
 function join():Promise<void>{
  closing=true;
  // Repeated final phases rescan the same original metadata after prior joins;
  // a failed positive/current gate never blocks this fixed negative consumer.
  const operation=(async()=>{
   if(pending)try{await pending;}catch{/* First positive cause remains in its exact Promise and Source row. */}
   let first:{raw:unknown}|undefined;
   if(entered)try{await stock!.consumeResource(releaseFunctionMetadata,metadata!,[]);}catch(raw){first={raw};stock!.inventory(raw);}
   if(stock)try{await stock.waitPhysicalKnown();}catch(raw){first??={raw};}
   if(first)throw first.raw;
  })();define(operation,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);return operation;
 }
 return freeze({assert,join});
}
