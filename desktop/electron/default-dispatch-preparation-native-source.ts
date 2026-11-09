import * as preparationElectron from 'electron';
import type {WebContents} from 'electron';
type BrowserWindow=import('electron').BrowserWindow;
// Node may inspect ordinary Desktop services without a Native app. Namespace
// observation keeps loading passive; the original SDK gates still deny use.
const {app,BrowserWindow,webContents}=preparationElectron;
import {types} from 'node:util';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {scanTaskStoreSdkChildren} from '../../src/runtime/task-host/source-sdk-children.js';
import {createIntrinsicSet,appendIntrinsic,settleIntrinsicOperations,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from './ipc-native-promise.js';
import type {IngressOwner} from './desktop-shutdown-coordinator.js';
const apply=Reflect.apply,get=Reflect.get,descriptor=Object.getOwnPropertyDescriptor,descriptors=Object.getOwnPropertyDescriptors,keys=Reflect.ownKeys,own=Object.hasOwn;
const create=Object.create,freeze=Object.freeze,define=Object.defineProperty,prototype=Object.getPrototypeOf;
const isProxy=types.isProxy,isPromise=types.isPromise,isAsync=types.isAsyncFunction,isArray=Array.isArray,integer=Number.isSafeInteger;
const P=Promise,then=P.prototype.then,asyncPrototype=prototype(async()=>{}),NativeError=Error;
const nativeNumber=Number,nativeString=String;
const weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set;
type Scope=Readonly<{profileId:string;workspaceId:string}>;
export interface DefaultDispatchPreparationNativeBirth {
 readonly window:BrowserWindow;readonly contents:WebContents;readonly session:WebContents['session'];readonly scope:Scope;readonly sourceEpoch:number;
 assertLocal():void;assertCurrent():void;
}
export interface DefaultDispatchPreparationNativeSource {activate():void;seal():void;drain():Promise<void>;readonly ingress:IngressOwner}
export interface OriginalPreparationNativeComposition {readonly identity:object;readonly scope:Scope;assertLocal():void}
export interface OriginalPreparationNativeObservationSettlement {assertKnown():void;waitKnown():Promise<void>}
interface Membership {composition():Readonly<OriginalPreparationNativeComposition>;read():DefaultDispatchPreparationNativeBirth;assertBirth(birth:unknown):void;acquireLease():object;leaseCurrent(lease:unknown):void;leaseLocal(lease:unknown):void;releaseLease(lease:unknown):void;leaseSettlement(lease:unknown):Readonly<OriginalPreparationNativeObservationSettlement>}
const sources=new WeakMap<object,Membership>(),births=new WeakMap<object,object>();
const denied=()=>new NativeError('DEFAULT_DISPATCH_PREPARATION_NATIVE_SOURCE_REQUIRED');
function inert<T>(value:T):T{const result=create(null);const rows=descriptors(value as object),names=keys(rows);for(let i=0;i<names.length;i++)define(result,names[i]!,rows[names[i] as string]!);return freeze(result);}
function membership(source:unknown):Membership{const row=source&&typeof source==='object'?apply(weakGet,sources,[source]) as Membership|undefined:undefined;if(!row)throw denied();return row;}
/** Passive factory identity only. No Native SDK lookup or birth is implied. */
export function readOriginalPreparationNativeComposition(source:unknown):Readonly<OriginalPreparationNativeComposition>{return membership(source).composition();}
/** Availability only; it never authenticates a work, Host or B capability. */
export function readDefaultDispatchPreparationNativeBirth(source:unknown):DefaultDispatchPreparationNativeBirth{return membership(source).read();}
export function assertDefaultDispatchPreparationNativeBirth(source:unknown,birth:unknown):void{membership(source).assertBirth(birth);}
/** Native lifecycle only. This handle grants no Host/B/filesystem permission. */
export function acquireOriginalPreparationNativeObservationLease(source:unknown):object{return membership(source).acquireLease();}
export function assertOriginalPreparationNativeObservationCurrent(source:unknown,lease:unknown):void{membership(source).leaseCurrent(lease);}
export function assertOriginalPreparationNativeObservationLocal(source:unknown,lease:unknown):void{membership(source).leaseLocal(lease);}
export function releaseOriginalPreparationNativeObservationLease(source:unknown,lease:unknown):void{membership(source).releaseLease(lease);}
/** Physical SDK fate only. Revocation stays effective; this never grants a
 * Work, Host or N permission and never waits for this lease's own completion. */
export function readOriginalPreparationNativeObservationSettlement(source:unknown,lease:unknown):Readonly<OriginalPreparationNativeObservationSettlement>{return membership(source).leaseSettlement(lease);}

/** Passive construction lets Main register this owner before its first Native
 * lookup. Its brand and lifetime are independent of every user/config source. */
export function createDefaultDispatchPreparationNativeSource(options:{window:BrowserWindow;scope:Scope;isTrustedUrl(url:string):boolean}):DefaultDispatchPreparationNativeSource{
 if(!options||typeof options!=='object'||isProxy(options))throw denied();
 const rows=descriptors(options),names=keys(rows);if(names.length!==3)throw denied();
 for(const name of ['window','scope','isTrustedUrl'])if(!own(rows,name)||!own(rows[name]!,'value'))throw denied();
 const candidateValue:unknown=rows.window!.value,policyValue:unknown=rows.isTrustedUrl!.value;
 if(!candidateValue||typeof candidateValue!=='object'||isProxy(candidateValue)||typeof policyValue!=='function'||isProxy(policyValue)||isAsync(policyValue)||prototype(policyValue)===asyncPrototype)throw denied();
 const candidate=candidateValue as BrowserWindow,policy=policyValue as (url:string)=>boolean;
 const data=captureDispatchBusinessData(rows.scope!.value) as Scope;
 const hex=(value:unknown)=>{if(typeof value!=='string'||value.length!==64)return false;for(let i=0;i<64;i++)if(!(value[i]!>='0'&&value[i]!<='9'||value[i]!>='a'&&value[i]!<='f'))return false;return true;};
 if(!data||keys(data).length!==2||!hex(data.profileId)||!hex(data.workspaceId))throw denied();
 const scope=inert({profileId:data.profileId,workspaceId:data.workspaceId});
 const active=createIntrinsicSet<{completion:Promise<void>}>(),tails=createIntrinsicSet<{raw:unknown;completion:Promise<void>}>(),seen=createIntrinsicSet<object>(),unknown=createIntrinsicSet<unknown>();
 const failures:unknown[]=[],cleanup:Array<()=>void>=[];
 interface Lease {epoch:number;accepted:boolean;released:boolean;birth:DefaultDispatchPreparationNativeBirth;completion:Promise<void>;finish():void;settlement:Readonly<OriginalPreparationNativeObservationSettlement>|undefined}
 const leases=new WeakMap<object,Lease>(),accepted=createIntrinsicSet<Lease>();
 const installedContents=createIntrinsicSet<object>();let installedClosed=false;
 let sealed=false,checking=false,epoch=0,birth:DefaultDispatchPreparationNativeBirth|undefined,closing:Promise<void>|undefined;
 let native:{ready:Function;windows:Function;windowId:Function;windowContents:Function;contentsId:Function}|undefined;
 const remember=(error:unknown)=>appendIntrinsic(failures,error);
 function local(lease?:Lease){if(checking){remember(denied());revoke(true);throw denied();}if(failures.length||unknown.size||lease&&(lease.released||lease.epoch!==epoch)||sealed&&!(lease?.accepted))throw denied();}
 function reserve(){let finish!:()=>void;const row={completion:new P<void>(yes=>{finish=yes;})};define(row.completion,'constructor',{__proto__:null,value:P} as PropertyDescriptor);active.add(row);return()=>{active.delete(row);finish();};}
 function retain(raw:unknown){
  if(!raw||typeof raw!=='object'&&typeof raw!=='function')return;
  if(seen.has(raw))return;seen.add(raw);
  const inventory=scanTaskStoreSdkChildren(raw,isPromise(raw));
  for(let i=0;i<inventory.unknowns.length;i++)unknown.add(inventory.unknowns[i]);
  for(let i=0;i<inventory.promises.length;i++)retain(inventory.promises[i]);
  if(!isPromise(raw)||isProxy(raw)){unknown.add(raw);return;}
  let finish!:()=>void;const row={raw,completion:new P<void>(yes=>{finish=yes;})};define(row.completion,'constructor',{__proto__:null,value:P} as PropertyDescriptor);tails.add(row);
  try{assertStandardIpcPromise(raw,'DEFAULT_DISPATCH_PREPARATION_NATIVE_OBSERVER_UNKNOWN');apply(then,raw,[(value:unknown)=>{retainSettlement(value);tails.delete(row);finish();},(error:unknown)=>{remember(error);retainSettlement(error);tails.delete(row);finish();}]);}
  catch(error){unknown.add(raw);remember(error);tails.delete(row);finish();}
 }
 function retainSettlement(value:unknown){const inventory=scanTaskStoreSdkChildren(value);for(let i=0;i<inventory.unknowns.length;i++)unknown.add(inventory.unknowns[i]);for(let i=0;i<inventory.promises.length;i++)retain(inventory.promises[i]);}
 function unsafe(raw:unknown):boolean{
  if(!raw||typeof raw!=='object'&&typeof raw!=='function')return false;
  if(isProxy(raw)||isPromise(raw))return true;
  let cursor:object|null=raw;for(let i=0;cursor&&i<64;i++){if(isProxy(cursor)||descriptor(cursor,'then'))return true;cursor=prototype(cursor);}return cursor!==null;
 }
 function sdk<T>(fn:Function,receiver:unknown,args:unknown[],accept:(value:unknown)=>value is T,cleaning=false,inspect?:(value:unknown)=>void,lease?:Lease):T{
  if(!cleaning)local(lease);const complete=reserve(),previous=checking;checking=true;
  try{
   if(typeof fn!=='function'||isProxy(fn)||isAsync(fn)||prototype(fn)===asyncPrototype)throw denied();
   const raw=apply(fn,receiver,args);inspect?.(raw);
   if(unsafe(raw)||!accept(raw)){retain(raw);remember(new NativeError('DEFAULT_DISPATCH_PREPARATION_NATIVE_SOURCE_UNCONFIRMED'));throw failures[failures.length-1];}
   return raw;
  }catch(error){remember(error);retainSettlement(error);throw error;}
  finally{checking=previous;complete();}
 }
 const bool=(value:unknown):value is boolean=>typeof value==='boolean';
 const func=(value:unknown):value is Function=>typeof value==='function';
 const object=(value:unknown):value is object=>!!value&&typeof value==='object'&&!isProxy(value)&&!isPromise(value);
 function property<T>(receiver:object,name:string,accept:(value:unknown)=>value is T,cleaning=false,lease?:Lease):T{const value=sdk(()=>apply(get,undefined,[receiver,name]),undefined,[],accept,cleaning,undefined,lease);if(!cleaning)local(lease);return value;}
 function method<T>(receiver:object,name:string,args:unknown[],accept:(value:unknown)=>value is T,cleaning=false,lease?:Lease):T{const fn=property(receiver,name,func,cleaning,lease),value=sdk(fn,receiver,args,accept,cleaning,undefined,lease);if(!cleaning)local(lease);return value;}
 function bindings(){if(!native)native={ready:property(app,'isReady',func),windows:property(BrowserWindow,'getAllWindows',func),windowId:property(BrowserWindow,'fromId',func),windowContents:property(BrowserWindow,'fromWebContents',func),contentsId:property(webContents,'fromId',func)};return native;}
 function checkNative(original?:DefaultDispatchPreparationNativeBirth,lease?:Lease){
  // The accepted row is explicit at every SDK seam. Entry/bootstrap checks
  // still use the ordinary sealed gate; no shared allow-closing flag exists.
  const local=()=>nativeLocal(lease),sdk=<T>(fn:Function,receiver:unknown,args:unknown[],accept:(value:unknown)=>value is T,cleaning=false,inspect?:(value:unknown)=>void)=>nativeSdk(fn,receiver,args,accept,cleaning,inspect,lease);
  const property=<T>(receiver:object,name:string,accept:(value:unknown)=>value is T)=>nativeProperty(receiver,name,accept,false,lease);
  const method=<T>(receiver:object,name:string,args:unknown[],accept:(value:unknown)=>value is T)=>nativeMethod(receiver,name,args,accept,false,lease);
  local();const observed=epoch,b=bindings();if(!sdk(b.ready,app,[],bool))throw denied();local();
  let found=false,invalid=false;
  sdk(b.windows,BrowserWindow,[],(value):value is BrowserWindow[]=>isArray(value)&&!isProxy(value),false,all=>{
   if(!isArray(all)||isProxy(all))return;const ds=descriptors(all) as unknown as PropertyDescriptorMap,length=descriptor(all,'length')?.value;if(!integer(length)||length<0||length>65536){retain(all);invalid=true;return;}
   const names=keys(ds);if(names.length!==length+1){invalid=true;unknown.add(all);}for(let i=0;i<names.length;i++){
    const name=names[i]!,row=ds[name as string]!;if(name==='length')continue;
    if(!own(row,'value')){invalid=true;unknown.add(all);continue;}
    const index=typeof name==='string'?nativeNumber(name):-1,indexed=typeof name==='string'&&integer(index)&&index>=0&&index<length&&nativeString(index)===name;
    if(!indexed){invalid=true;unknown.add(all);}
    if(unsafe(row.value)){retain(row.value);invalid=true;continue;}
    if(indexed&&row.value===candidate)found=true;
   }
  });local();if(invalid){remember(new NativeError('DEFAULT_DISPATCH_PREPARATION_NATIVE_SOURCE_UNCONFIRMED'));throw denied();}if(!found)throw denied();
  if(method(candidate,'isDestroyed',[],bool))throw denied();
  const id=property(candidate,'id',(value):value is number=>typeof value==='number'&&integer(value));
  sdk(b.windowId,BrowserWindow,[id],(value):value is BrowserWindow=>value===candidate);local();
  const contents=property(candidate,'webContents',(value):value is WebContents=>object(value));
  if(method(contents,'isDestroyed',[],bool))throw denied();
  if(method(contents,'isLoading',[],bool))throw denied();
  sdk(b.windowContents,BrowserWindow,[contents],(value):value is BrowserWindow=>value===candidate);local();
  const contentId=property(contents,'id',(value):value is number=>typeof value==='number'&&integer(value));
  sdk(b.contentsId,webContents,[contentId],(value):value is WebContents=>value===contents);local();
  const session=property(contents,'session',(value):value is WebContents['session']=>object(value));
  if(original&&(original.contents!==contents||original.session!==session))throw denied();
  const url=method(contents,'getURL',[],(value):value is string=>typeof value==='string');
  if(!sdk(policy,undefined,[url],bool))throw denied();local();if(epoch!==observed)throw denied();return{contents,session,observed};
 }
 const nativeLocal=local,nativeSdk=sdk,nativeProperty=property,nativeMethod=method;
 function seal(){sealed=true;}
 function revoke(permanent=false){if(permanent)sealed=true;epoch++;birth=undefined;}
 function install(receiver:object,event:string,listener:(...args:any[])=>void){
  const off=property(receiver,'off',func);appendIntrinsic(cleanup,()=>{sdk(off,receiver,[event,listener],(value):value is object=>value===receiver,true);});
  method(receiver,'on',[event,listener],(value):value is object=>value===receiver);
 }
 function activate(){
  local();if(birth){birth.assertCurrent();return;}
  const finish=reserve();
  try{
  const observed=checkNative();
  if(!installedClosed){install(candidate,'closed',()=>revoke(true));installedClosed=true;}
  if(!installedContents.has(observed.contents)){
   installedContents.add(observed.contents);
   install(observed.contents,'destroyed',()=>revoke(true));install(observed.contents,'render-process-gone',()=>revoke());
   install(observed.contents,'did-start-navigation',(_event:unknown,_url:unknown,_inPlace:unknown,main:unknown)=>{if(main===true)revoke();});
  }
  const confirmed=checkNative();local();if(confirmed.observed!==observed.observed||confirmed.contents!==observed.contents||confirmed.session!==observed.session)throw denied();
  const value=inert<DefaultDispatchPreparationNativeBirth>({window:candidate,contents:observed.contents,session:observed.session,scope,sourceEpoch:observed.observed,
   assertLocal(){local();if(epoch!==observed.observed||birth!==value)throw denied();},
   assertCurrent(){value.assertLocal();checkNative(value);value.assertLocal();},
  });birth=value;apply(weakSet,births,[value,source]);
  }finally{finish();}
 }
 function drain():Promise<void>{
  if(closing)return closing;seal();
  let resolve!:()=>void,reject!:(error:unknown)=>void;
  closing=new P<void>((yes,no)=>{resolve=yes;reject=no;});define(closing,'constructor',{__proto__:null,value:P} as PropertyDescriptor);
  const work=(async()=>{
   // An on() can call drain from newListener before it actually attaches.
   // Its encompassing setup Root must exit before any corresponding off().
   await settleIntrinsicOperations(active.snapshot(),row=>row.completion);
   // Keep revocation listeners installed while accepted observations own a
   // lease. Their caller releases only after its actual business/Host tails.
   await settleIntrinsicOperations(accepted.snapshot(),row=>row.completion);
   // A rejected on() may still return a known SDK raw that attaches later.
   // Its actual effect must finish before the registered original off().
   for(;;){await settleIntrinsicOperations(active.snapshot(),row=>row.completion);await settleIntrinsicOperations(tails.snapshot(),row=>row.completion);if(!active.size&&!tails.size)break;}
   for(let i=0;i<cleanup.length;i++)try{cleanup[i]!();}catch(error){remember(error);}
   cleanup.length=0;
   for(;;){const calls=active.snapshot();await settleIntrinsicOperations(calls,row=>row.completion);const raws=tails.snapshot();await settleIntrinsicOperations(raws,row=>row.completion);if(!active.size&&!tails.size)break;}
   if(failures.length||unknown.size){const failure=aggregateIntrinsicErrors(failures,'DEFAULT_DISPATCH_PREPARATION_NATIVE_SOURCE_UNCONFIRMED');define(failure,'cause',{__proto__:null,value:failures[0]} as PropertyDescriptor);throw failure;}
  })();define(work,'constructor',{__proto__:null,value:P} as PropertyDescriptor);
  try{assertStandardIpcPromise(work,'DEFAULT_DISPATCH_PREPARATION_NATIVE_INTERNAL_UNKNOWN');apply(then,work,[resolve,reject]);}catch(error){unknown.add(work);remember(error);}
  return closing;
 }
 const ingress=inert<IngressOwner>({name:'default-dispatch-preparation-native-source',stopAccepting:seal,abortAllActive:seal,drain(deadline){return new P<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),Math.max(0,deadline));apply(then,drain(),[()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);}]);});}});
 const composition=inert<OriginalPreparationNativeComposition>({identity:inert({}),scope,assertLocal:local});
 const source=inert<DefaultDispatchPreparationNativeSource>({activate,seal,drain,ingress});
 function leaseRow(value:unknown):Lease{const row=value&&typeof value==='object'?apply(weakGet,leases,[value]) as Lease|undefined:undefined;if(!row||row.released||!row.accepted)throw denied();return row;}
 function leaseSettlement(value:unknown):Readonly<OriginalPreparationNativeObservationSettlement>{
  const row=leaseRow(value);
  if(!row.settlement){
   const assertKnown=()=>{
    leaseRow(value);
    if(unknown.size)throw new NativeError('DEFAULT_DISPATCH_PREPARATION_NATIVE_SETTLEMENT_UNCONFIRMED');
    if(checking||active.size||tails.size)throw new NativeError('DEFAULT_DISPATCH_PREPARATION_NATIVE_SETTLEMENT_PENDING');
   };
   const waitKnown=():Promise<void>=>{
    let resolve!:()=>void,reject!:(error:unknown)=>void;
    const result=new P<void>((yes,no)=>{resolve=yes;reject=no;});define(result,'constructor',{__proto__:null,value:P} as PropertyDescriptor);
    const work=(async()=>{
     for(;;){
      leaseRow(value);
      await settleIntrinsicOperations(active.snapshot(),item=>item.completion);
      await settleIntrinsicOperations(tails.snapshot(),item=>item.completion);
      leaseRow(value);
      if(!active.size&&!tails.size){assertKnown();return;}
     }
    })();define(work,'constructor',{__proto__:null,value:P} as PropertyDescriptor);
    try{assertStandardIpcPromise(work,'DEFAULT_DISPATCH_PREPARATION_NATIVE_INTERNAL_UNKNOWN');apply(then,work,[resolve,reject]);}
    catch(error){unknown.add(work);remember(error);reject(error);}
    return result;
   };
   row.settlement=inert({assertKnown,waitKnown});
  }
  return row.settlement;
 }
 apply(weakSet,sources,[source,{composition(){local();return composition;},read(){local();if(!birth)throw denied();birth.assertLocal();return birth;},assertBirth(value:unknown){if(!value||typeof value!=='object'||apply(weakGet,births,[value])!==source||value!==birth)throw denied();birth.assertCurrent();},
  acquireLease(){
   local();if(!birth)throw denied();
   let finish!:()=>void;const completion=new P<void>(yes=>{finish=yes;});define(completion,'constructor',{__proto__:null,value:P} as PropertyDescriptor);
   const row:Lease={epoch,accepted:false,released:false,birth,completion,finish,settlement:undefined},handle=inert({});accepted.add(row);
   try{checkNative(birth,row);local(row);row.accepted=true;apply(weakSet,leases,[handle,row]);return handle;}
   catch(error){row.released=true;accepted.delete(row);finish();throw error;}
  },
  leaseCurrent(value:unknown){const row=leaseRow(value);local(row);checkNative(row.birth,row);local(row);},
  leaseLocal(value:unknown){local(leaseRow(value));},
  releaseLease(value:unknown){const row=leaseRow(value);row.released=true;accepted.delete(row);row.finish();},
  leaseSettlement,
 } satisfies Membership]);return source;
}
