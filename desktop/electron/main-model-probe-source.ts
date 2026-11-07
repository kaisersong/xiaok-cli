import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {readOriginalMainModelProbeEvent} from './main-dsh-control-source.js';
import {readOriginalMainModelProbeConfiguration} from './desktop-services.js';

const NativeWeakMap=WeakMap,get=WeakMap.prototype.get,set=WeakMap.prototype.set;
const apply=Reflect.apply,create=Object.create,freeze=Object.freeze,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
const isProxy=types.isProxy,isAsync=types.isAsyncFunction,prototype=Object.getPrototypeOf,functionPrototype=Function.prototype;
const exec=RegExp.prototype.exec,NativeError=Error,uuid=randomUUID;
interface Guard {receiver:object;current:Function;local:Function}
interface Row {
 context:object;source:object;proof:object;services:object;receipt:object;
 scope:Readonly<{profileId:string;workspaceId:string;principalId:string}>;
 executionRef:string;event:Guard;configuration:Guard;claimed:boolean;fault?:{raw:unknown};
}
interface Birth {source:object;services:object;receipt:object;row?:Row;fault?:{raw:unknown}}
const contexts=new NativeWeakMap<object,Row>(),proofs=new NativeWeakMap<object,Birth>();
const denied=()=>new NativeError('MAIN_MODEL_PROBE_RESOURCE_CONTEXT_REQUIRED');
function data(value:unknown,name:string):unknown {
 if(!value||typeof value!=='object'||isProxy(value))throw denied();
 const row=descriptor(value,name);if(!row||!own(row,'value'))throw denied();return row.value;
}
function text(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=256;}
function hex(value:unknown):value is string{return typeof value==='string'&&apply(exec,/^[a-f0-9]{64}$/,[value])!==null;}
function method(value:unknown,name:string):Function {
 const fn=data(value,name);if(typeof fn!=='function'||isProxy(fn)||isAsync(fn)||prototype(fn)!==functionPrototype)throw denied();return fn;
}
function guard(value:unknown):Guard {
 if(!value||typeof value!=='object'||isProxy(value))throw denied();
 return{receiver:value,current:method(value,'assertCurrent'),local:method(value,'assertLocal')};
}
function invoke(value:Guard,local:boolean):void {
 const result=apply(local?value.local:value.current,value.receiver,[]);
 // Preserve a malformed SDK return, including its own/symbol/outcome tails,
 // for the original caller's custody. Never assimilate a foreign thenable.
 if(result!==undefined)throw result;
}
function local(row:Row):void {
 if(row.fault)throw row.fault.raw;
 try{invoke(row.event,true);invoke(row.configuration,true);}catch(raw){row.fault={raw};throw raw;}
}
function current(row:Row):void {
 local(row);
 try{invoke(row.event,false);invoke(row.configuration,false);local(row);}
 catch(raw){if(!row.fault)row.fault={raw};throw raw;}
}
/** Fixed private producer. A user event alone is not a model/resource grant:
 * the configuration receipt must also originate in the exact Services owner. */
export function createOriginalMainModelProbeContext(userSource:object,eventProof:object,services:object,configurationReceipt:object):object {
 if(!eventProof||typeof eventProof!=='object'||isProxy(eventProof))throw denied();
 const prior=apply(get,proofs,[eventProof]) as Birth|undefined;
 if(prior){
  if(prior.source!==userSource||prior.services!==services||prior.receipt!==configurationReceipt)throw denied();
  if(prior.fault)throw prior.fault.raw;if(!prior.row)throw denied();current(prior.row);return prior.row.context;
 }
 // Reserve this original proof before any Source/config SDK or callback. A
 // reentrant creator cannot birth a second context while this one is pending.
 const birth:Birth={source:userSource,services,receipt:configurationReceipt};apply(set,proofs,[eventProof,birth]);
 try{
 const event=readOriginalMainModelProbeEvent(userSource,eventProof);
 const configuration=readOriginalMainModelProbeConfiguration(services,configurationReceipt);
 const body=data(event,'body'),scope=data(event,'storageScope'),profileId=data(scope,'profileId'),workspaceId=data(scope,'workspaceId'),principalId=data(event,'principalId'),bodyHash=data(event,'bodyHash');
 const configScope=data(configuration,'storageScope');
 if(!hex(profileId)||!hex(workspaceId)||principalId!=='desktop-user:'+profileId||!hex(bodyHash)
  ||data(configuration,'userSource')!==userSource||data(configuration,'eventProof')!==eventProof||data(configuration,'bodyHash')!==bodyHash
  ||data(configScope,'profileId')!==profileId||data(configScope,'workspaceId')!==workspaceId||data(configuration,'principalId')!==principalId
  ||data(body,'schemaVersion')!==1||data(body,'purpose')!=='test_provider_connection'
  ||data(configuration,'requestedProviderId')!==data(body,'providerId')||data(configuration,'requestedModelId')!==data(body,'modelId')
  ||!text(data(configuration,'providerId'))||!text(data(configuration,'resolvedModelId'))||!hex(data(configuration,'configDigest')))throw denied();
 const context=freeze(create(null)) as object;
 const row:Row={context,source:userSource,proof:eventProof,services,receipt:configurationReceipt,
  scope:freeze({profileId,workspaceId,principalId}),executionRef:'main-model-probe:'+uuid(),event:guard(event),configuration:guard(configuration),claimed:false};
 current(row);birth.row=row;apply(set,contexts,[context,row]);return context;
 }catch(raw){birth.fault={raw};throw raw;}
}
export interface OriginalMainModelProbeResourceContext {
 readonly scope:Readonly<{profileId:string;workspaceId:string;principalId:string}>;
 readonly executionClass:'admission_probe';readonly executionRef:string;
 assertCurrent():void;assertLocal():void;claimAttempt(attemptId:string,requestDigest:string):void;
}
/** Passive membership first. Foreign/copy contexts return null; an original
 * context from another bound owner is a conflict, never a Host fallback. */
export function readOriginalMainModelProbeResourceContext(context:unknown,exactUserSource:unknown,exactServices:unknown):OriginalMainModelProbeResourceContext|null {
 const row=apply(get,contexts,[context]) as Row|undefined;if(!row)return null;
 if(row.source!==exactUserSource||row.services!==exactServices)throw denied();
 return freeze({scope:row.scope,executionClass:'admission_probe',executionRef:row.executionRef,
  assertCurrent(){current(row);},assertLocal(){local(row);},
  claimAttempt(attemptId:string,requestDigest:string){
   local(row);if(row.claimed||typeof attemptId!=='string'||apply(exec,/^[\x21-\x7e]{1,256}$/,[attemptId])===null||!hex(requestDigest))throw denied();
   // Burn before entering the original Native enqueue. No second physical
   // request, retry, copied context or changed receipt can reopen this proof.
   row.claimed=true;
  }});
}
