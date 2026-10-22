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
   const state=create(null);state.events=[];state.suspendFailures=[];state.observerErrors=0;apply(set,records,[session,state]);
  },
  stop(session,kind,invoke){
   const event=record(session,kind);
   let original;
   try{original=invoke();}
   catch(error){try{if(event)event.error=error;}catch{fail();}throw error;}
   try{if(event){event.raw=original;event.returned=true;}}catch{fail();}
   return original;
  },
  suspendFailure(session,error){
   let state;
   try{
    state=apply(get,records,[session]);if(!state){fail();return;}
    if(state.suspendFailures.length!==0)fail(state);
    const entry=create(null);entry.error=error;apply(push,state.suspendFailures,[entry]);
   }catch{fail(state);}
  },
  tail(session){record(session,'tail');},
  snapshot(session){
   const state=apply(get,records,[session]);if(!state)throw Error('owned_session_probe_not_registered');
   const events=[];for(const event of state.events)apply(push,events,[freeze({...event})]);
   const suspendFailures=[];for(const entry of state.suspendFailures)apply(push,suspendFailures,[freeze({...entry})]);
   return freeze({events:freeze(events),suspendFailures:freeze(suspendFailures),observerErrors:state.observerErrors});
  },
  quality(){return {observerErrors};},
 });
}
export const ownedSessionShutdownProbe=createOwnedSessionShutdownProbe();
export const observeOwnedSessionStop=(session,kind,invoke)=>ownedSessionShutdownProbe.stop(session,kind,invoke);
export const observeOwnedSessionTail=session=>ownedSessionShutdownProbe.tail(session);
export const observeOwnedSessionSuspendFailure=(session,error)=>ownedSessionShutdownProbe.suspendFailure(session,error);

// Known failure classification only; never a healthy cleanup/release receipt.
// Capture native readers before any caller code; no user getter or coercion.
// Private native shape only. The fresh sample and its descriptor never escape.
const OwnedNativeAggregateError=AggregateError;
const OwnedNativeAggregatePrototype=OwnedNativeAggregateError.prototype;
const serviceStopNative=Object.freeze({descriptor:Object.getOwnPropertyDescriptor,ownKeys:Reflect.ownKeys,
 prototype:Object.getPrototypeOf,hasOwn:Object.hasOwn,isArray:Array.isArray,isProxy:types.isProxy,
 isNativeError:types.isNativeError,aggregatePrototype:OwnedNativeAggregatePrototype,arrayPrototype:Array.prototype});

const trustedOwnedStack=(()=>{
 const template=create(null);template.mode='unknown';template.get=undefined;template.set=undefined;template.enumerable=undefined;template.configurable=undefined;
 try{
  const sample=new OwnedNativeAggregateError([],'owned_native_stack_shape');
  const descriptor=serviceStopNative.descriptor(sample,'stack');
  if(descriptor===undefined)template.mode='absent';
  else{
   const keys=serviceStopNative.ownKeys(descriptor);
   const flags=serviceStopNative.hasOwn(descriptor,'enumerable')&&typeof descriptor.enumerable==='boolean'&&serviceStopNative.hasOwn(descriptor,'configurable')&&typeof descriptor.configurable==='boolean';
   if(flags){template.enumerable=descriptor.enumerable;template.configurable=descriptor.configurable;}
   if(flags&&keys.length===4&&serviceStopNative.hasOwn(descriptor,'value')&&serviceStopNative.hasOwn(descriptor,'writable')&&typeof descriptor.writable==='boolean')template.mode='data';
   else if(flags&&keys.length===4&&serviceStopNative.hasOwn(descriptor,'get')&&serviceStopNative.hasOwn(descriptor,'set')&&(descriptor.get===undefined||typeof descriptor.get==='function')&&(descriptor.set===undefined||typeof descriptor.set==='function')&&(typeof descriptor.get==='function'||typeof descriptor.set==='function')){
    template.mode='accessor';template.get=descriptor.get;template.set=descriptor.set;template.enumerable=descriptor.enumerable;template.configurable=descriptor.configurable;
   }
  }
 }catch{/* Unknown native shape never authorizes an accessor. */}
 return freeze(template);
})();
function isKnownSingleOwnedSessionServiceStopFailure(slot,bodyAccepted,physical,error){
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

function strictOwnedArray(value,length){
 if(value===null||value===undefined||serviceStopNative.isProxy(value)||!serviceStopNative.isArray(value)||serviceStopNative.prototype(value)!==serviceStopNative.arrayPrototype)return;
 const size=serviceStopNative.descriptor(value,'length');
 if(!size||!serviceStopNative.hasOwn(size,'value')||size.value!==length||serviceStopNative.ownKeys(value).length!==length+1)return;
 const values=[];
 for(let i=0;i<length;i++){const item=serviceStopNative.descriptor(value,String(i));if(!item||!serviceStopNative.hasOwn(item,'value'))return;apply(push,values,[item.value]);}
 return values;
}
function strictOwnedAggregate(value,message,hasCause){
 if(value===null||value===undefined||serviceStopNative.isProxy(value)||!serviceStopNative.isNativeError(value)||serviceStopNative.prototype(value)!==serviceStopNative.aggregatePrototype)return;
 for(const key of serviceStopNative.ownKeys(value))if(key!=='stack'&&key!=='message'&&key!=='errors'&&!(hasCause&&key==='cause'))return;
 const stack=serviceStopNative.descriptor(value,'stack');
 if(stack&&!serviceStopNative.hasOwn(stack,'value')){
  if(trustedOwnedStack.mode!=='accessor'||!serviceStopNative.hasOwn(stack,'get')||!serviceStopNative.hasOwn(stack,'set')||stack.get!==trustedOwnedStack.get||stack.set!==trustedOwnedStack.set||stack.enumerable!==trustedOwnedStack.enumerable||stack.configurable!==trustedOwnedStack.configurable)return;
 }
 const m=serviceStopNative.descriptor(value,'message'),entries=serviceStopNative.descriptor(value,'errors'),cause=serviceStopNative.descriptor(value,'cause');
 if(!m||!serviceStopNative.hasOwn(m,'value')||m.value!==message||!entries||!serviceStopNative.hasOwn(entries,'value'))return;
 if(hasCause?(!cause||!serviceStopNative.hasOwn(cause,'value')):cause!==undefined)return;
 return {entries:entries.value,cause:cause?.value};
}
function strictOwnedPhysical(value,leaf){
 const aggregate=strictOwnedAggregate(value,'agent_model_physical_drain_unconfirmed',false);
 const values=aggregate&&strictOwnedArray(aggregate.entries,1);return Boolean(values&&values[0]===leaf);
}
export function isKnownOwnedSessionServiceStopFailure(slot,bodyAccepted,physical,error,suspendFailures,originalJournalFailure){
 // Preserve the original strict one-P branch without widening its semantics.
 if(isKnownSingleOwnedSessionServiceStopFailure(slot,bodyAccepted,physical,error))return true;
 if(slot!=='finally_service_stop'||bodyAccepted!==true||physical===null||physical===undefined||serviceStopNative.isProxy(physical))return false;
 const accepted=serviceStopNative.descriptor(physical,'error');if(!accepted||!serviceStopNative.hasOwn(accepted,'value'))return false;
 if(originalJournalFailure===undefined||originalJournalFailure===null||serviceStopNative.isProxy(originalJournalFailure)||!serviceStopNative.isNativeError(originalJournalFailure))return false;
 const close=accepted.value,captures=strictOwnedArray(suspendFailures,1);if(!captures)return false;
 const capture=captures[0];if(capture===null||capture===undefined||serviceStopNative.isProxy(capture))return false;
 const idleDescriptor=serviceStopNative.descriptor(capture,'error');if(!idleDescriptor||!serviceStopNative.hasOwn(idleDescriptor,'value')||serviceStopNative.ownKeys(capture).length!==1)return false;
 const idle=idleDescriptor.value;
 if(idle===close||!strictOwnedPhysical(close,originalJournalFailure)||!strictOwnedPhysical(idle,originalJournalFailure))return false;
 const aggregate=strictOwnedAggregate(error,'multi_agent_cleanup_unconfirmed',true),values=aggregate&&strictOwnedArray(aggregate.entries,2);
 return Boolean(values&&aggregate.cause===idle&&values[0]===idle&&values[1]===close);
}
