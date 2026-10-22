import {types} from 'node:util';
// Test-only caller observations. Never settle, inspect or replace original work.
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,push=Array.prototype.push;
const freeze=Object.freeze,create=Object.create;
export function createOwnedSessionShutdownProbe(){
 const records=new WeakMap();let observerErrors=0;
 const fail=record=>{observerErrors++;if(record)record.observerErrors++;};
 function record(session,kind){
  let state,event;
  try{
   state=apply(get,records,[session]);
   if(!state){fail();return;}
   if(kind!=='execution'&&kind!=='transport'&&kind!=='tail'){fail(state);return;}
   event=create(null);event.kind=kind;event.returned=false;
   apply(push,state.events,[event]);
  }catch{fail(state);}
  return event;
 }
 return freeze({
  register(session){
   if((typeof session!=='object'||session===null)&&typeof session!=='function')throw Error('owned_session_probe_registration');
   if(apply(get,records,[session]))throw Error('owned_session_probe_duplicate_registration');
   const state=create(null);state.events=[];state.observerErrors=0;apply(set,records,[session,state]);
  },
  stop(session,kind,invoke){
   const event=record(session,kind);
   let original;
   try{original=invoke();}
   catch(error){try{if(event)event.error=error;}catch{fail();}throw error;}
   try{if(event){event.raw=original;event.returned=true;}}catch{fail();}
   return original;
  },
  tail(session){record(session,'tail');},
  snapshot(session){
   const state=apply(get,records,[session]);if(!state)throw Error('owned_session_probe_not_registered');
   const events=[];for(const event of state.events)apply(push,events,[freeze({...event})]);
   return freeze({events:freeze(events),observerErrors:state.observerErrors});
  },
  quality(){return {observerErrors};},
 });
}
export const ownedSessionShutdownProbe=createOwnedSessionShutdownProbe();
export const observeOwnedSessionStop=(session,kind,invoke)=>ownedSessionShutdownProbe.stop(session,kind,invoke);
export const observeOwnedSessionTail=session=>ownedSessionShutdownProbe.tail(session);

// Known failure classification only; never a healthy cleanup/release receipt.
// Capture native readers before any caller code; no user getter or coercion.
const serviceStopNative=Object.freeze({descriptor:Object.getOwnPropertyDescriptor,ownKeys:Reflect.ownKeys,
 prototype:Object.getPrototypeOf,hasOwn:Object.hasOwn,isArray:Array.isArray,isProxy:types.isProxy,
 isNativeError:types.isNativeError,aggregatePrototype:AggregateError.prototype,arrayPrototype:Array.prototype});
export function isKnownOwnedSessionServiceStopFailure(slot,bodyAccepted,physical,error){
 if(slot!=='finally_service_stop'||bodyAccepted!==true||physical===undefined||physical===null||serviceStopNative.isProxy(physical))return false;
 const accepted=serviceStopNative.descriptor(physical,'error');
 if(!accepted||!serviceStopNative.hasOwn(accepted,'value'))return false;
 const original=accepted.value;
 if(original===null||original===undefined||serviceStopNative.isProxy(original)||!serviceStopNative.isNativeError(original))return false;
 if(error===null||error===undefined||error===original||serviceStopNative.isProxy(error)||!serviceStopNative.isNativeError(error)||serviceStopNative.prototype(error)!==serviceStopNative.aggregatePrototype)return false;
 const keys=serviceStopNative.ownKeys(error);
 for(let index=0;index<keys.length;index++){const key=keys[index];if(key!=='stack'&&key!=='message'&&key!=='cause'&&key!=='errors')return false;}
 const message=serviceStopNative.descriptor(error,'message'),cause=serviceStopNative.descriptor(error,'cause'),entries=serviceStopNative.descriptor(error,'errors');
 if(!message||!serviceStopNative.hasOwn(message,'value')||message.value!=='multi_agent_cleanup_unconfirmed'||!cause||!serviceStopNative.hasOwn(cause,'value')||cause.value!==original||!entries||!serviceStopNative.hasOwn(entries,'value'))return false;
 const values=entries.value;
 if(values===null||serviceStopNative.isProxy(values)||!serviceStopNative.isArray(values)||serviceStopNative.prototype(values)!==serviceStopNative.arrayPrototype)return false;
 const length=serviceStopNative.descriptor(values,'length'),item=serviceStopNative.descriptor(values,'0');
 return !!length&&serviceStopNative.hasOwn(length,'value')&&length.value===1&&serviceStopNative.ownKeys(values).length===2&&!!item&&serviceStopNative.hasOwn(item,'value')&&item.value===original;
}
