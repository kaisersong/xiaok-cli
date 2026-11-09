import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import * as userElectron from 'electron';
import type {IpcMainInvokeEvent,WebContents} from 'electron';
type BrowserWindow=import('electron').BrowserWindow;
const {app,BrowserWindow,webContents}=userElectron;
import {types} from 'node:util';
import {createIntrinsicSet,appendIntrinsic,settleIntrinsicOperations,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from './ipc-native-promise.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import type {SubmissionActor,DefaultDispatchUserAudience} from './main-user-submission.js';
import type {IngressOwner} from './desktop-shutdown-coordinator.js';
const own=Object.hasOwn,keys=Object.keys,isArray=Array.isArray;
const apply=Reflect.apply,freeze=Object.freeze,create=Object.create,prototype=Object.getPrototypeOf,assign=Object.assign;
const isProxy=types.isProxy,isAsync=types.isAsyncFunction,isPromise=types.isPromise,descriptor=Object.getOwnPropertyDescriptor;
const NativePromise=Promise,nativeThen=Promise.prototype.then,asyncPrototype=prototype(async()=>{});
const ready=app?.isReady,windows=BrowserWindow?.getAllWindows,windowId=BrowserWindow?.fromId,windowContents=BrowserWindow?.fromWebContents,contentsId=webContents?.fromId;
const denied=()=>Error('DEFAULT_DISPATCH_USER_AUTHORITY_REQUIRED');
type Scope=Readonly<{profileId:string;workspaceId:string}>;
export interface DefaultDispatchUserBootstrap {
 readonly window:BrowserWindow;readonly contents:WebContents;readonly session:WebContents['session'];readonly scope:Scope;
 assertCurrent():void;assertLocal():void;
}
const bootstrapSources=new WeakMap<object,()=>DefaultDispatchUserBootstrap>(),bootstrapGet=WeakMap.prototype.get,bootstrapSet=WeakMap.prototype.set;
/** Native identity observation only; no user gesture, command or B capability. */
export function readDefaultDispatchUserBootstrap(source:object):DefaultDispatchUserBootstrap{
 const read=apply(bootstrapGet,bootstrapSources,[source]) as (()=>DefaultDispatchUserBootstrap)|undefined;if(!read)throw denied();return read();
}
export interface DefaultDispatchUserFrame {readonly proof:object;readonly signal:AbortSignal;assertCurrent():void;release():void}
export interface DefaultDispatchUserSource {
 open(event:IpcMainInvokeEvent,projectId:string,requestSource:'user'|'agent'|'scheduler'):DefaultDispatchUserFrame;
 assertAdmission(proof:object,actor:SubmissionActor|undefined,audience?:DefaultDispatchUserAudience):void;
 seal():void;drain():Promise<void>;readonly ingress:IngressOwner;
}
/** Main-only user provenance. No configuration admission, B action, model,
 * dispatch grant or transport credential is created by this source. */
export function createDefaultDispatchUserSource(options:{window:BrowserWindow;scope:Scope;isTrustedUrl(url:string):boolean}):DefaultDispatchUserSource {
 const candidate=options.window,policy=options.isTrustedUrl;
 if(!candidate||typeof candidate!=='object'||isProxy(candidate))throw denied();
 if(typeof policy!=='function'||isProxy(policy)||isAsync(policy)||prototype(policy)===asyncPrototype)throw Error('DEFAULT_DISPATCH_USER_SYNCHRONOUS_SOURCE_REQUIRED');
 const scopeData=captureIpcData(options.scope,'DEFAULT_DISPATCH_USER_SCOPE_INVALID');
 if(!scopeData||Object.keys(scopeData).length!==2||typeof scopeData.profileId!=='string'||typeof scopeData.workspaceId!=='string'||!/^[a-f0-9]{64}$/.test(scopeData.profileId)||!/^[a-f0-9]{64}$/.test(scopeData.workspaceId))throw denied();
 const scope=freeze({profileId:scopeData.profileId,workspaceId:scopeData.workspaceId});
 let birth:{window:BrowserWindow;contents:WebContents;session:WebContents['session']}|undefined,contents:WebContents,installing=false;
 const proofs=new WeakMap<object,{projectId:string;frame:DefaultDispatchUserFrame}>(),get=proofs.get.bind(proofs),put=proofs.set.bind(proofs),remove=proofs.delete.bind(proofs);
 const retained=createIntrinsicSet<unknown>();
 const active=createIntrinsicSet<{abort:AbortController}>(),roots=createIntrinsicSet<{completion:Promise<void>}>(),tails=createIntrinsicSet<{raw:Promise<unknown>;completion:Promise<void>}>(),unknown=createIntrinsicSet<unknown>(),failures:unknown[]=[];
 let sealed=false,checking=false,epoch=0,bootstrapEpoch=0,pending=true,sourceFault:unknown,sourceFaultPresent=false,disposed=false,closing:Promise<void>|undefined;
 function remember(error:unknown){for(let i=0;i<failures.length;i++)if(failures[i]===error)return;appendIntrinsic(failures,error);}
 function fault(error:unknown){if(!sourceFaultPresent){sourceFault=error;sourceFaultPresent=true;remember(error);revoke();}}
 function live(){if(checking||sealed||sourceFaultPresent)throw sourceFaultPresent?sourceFault:denied();}
 function retain(raw:unknown){
  if(retained.has(raw))return;retained.add(raw);
  if(!isPromise(raw)||isProxy(raw)){unknown.add(raw);try{inventory(raw);}catch(error){remember(error);}return;}
  let complete!:()=>void;const row={raw,completion:new NativePromise<void>(yes=>{complete=yes;})};tails.add(row);
  try{inventory(raw);if(descriptor(raw,'then'))throw denied();assertStandardIpcPromise(raw,'DEFAULT_DISPATCH_USER_TAIL_UNKNOWN');apply(nativeThen,raw,[(value:unknown)=>settled(value,false),(error:unknown)=>settled(error,true)]);}
  catch{unknown.add(raw);tails.delete(row);}
  function settled(value:unknown,failed:boolean){
   if(failed)remember(value);
   try{inventory(value);}catch(error){remember(error);unknown.add(value);}
   finally{tails.delete(row);complete();}
  }
 }
 function inventory(value:unknown){retainSourceErrorTails(value,(raw,kind)=>{if(kind==='unknown')unknown.add(raw);if(isPromise(raw)&&!isProxy(raw))retain(raw);});}
 function reserve(){let complete!:()=>void;const row={completion:new NativePromise<void>(yes=>{complete=yes;})};roots.add(row);return()=>{roots.delete(row);complete();};}
 function unsafeSdkValue(value:unknown):boolean {
  if(!value||typeof value!=='object'&&typeof value!=='function')return false;
  if(isPromise(value))return true;
  let cursor:object|null=value;
  for(let depth=0;cursor&&depth<64;depth++){
   if(isProxy(cursor)||descriptor(cursor,'then'))return true;
   cursor=prototype(cursor);
  }
  return cursor!==null;
 }
 function sdk<T>(fn:Function,receiver:unknown,args:unknown[],accept:(value:unknown)=>value is T,cleanup=false,inspect?:(value:unknown)=>void):T {
  if(!cleanup)live();
  if(typeof fn!=='function'||isProxy(fn)||isAsync(fn)||prototype(fn)===asyncPrototype)throw Error('DEFAULT_DISPATCH_USER_SYNCHRONOUS_SOURCE_REQUIRED');
  const complete=reserve();checking=true;
  try{
   const raw:unknown=apply(fn,receiver,args);
   // Fixed inventory inspection must retain known siblings even when the
   // returned envelope itself is rejected for forbidden metadata.
   inspect?.(raw);
   if(unsafeSdkValue(raw)||!accept(raw)){fault(Error('DEFAULT_DISPATCH_USER_SOURCE_UNCONFIRMED'));if(raw!==null&&(typeof raw==='object'||typeof raw==='function'))retain(raw);throw sourceFault;}
   return raw;
  }catch(error){fault(error);remember(error);try{inventory(error);}catch(inventoryError){remember(inventoryError);unknown.add(error);}throw error;}finally{checking=false;complete();}
 }
 function property<T>(read:()=>unknown,accept:(value:unknown)=>value is T){return sdk(read,undefined,[],accept);}
 function method<T>(receiver:object,name:string,args:unknown[],accept:(value:unknown)=>value is T){
  const fn=property(()=>(receiver as Record<string,unknown>)[name],(v):v is Function=>typeof v==='function');
  return sdk(fn,receiver,args,accept);
 }
 const bool=(value:unknown):value is boolean=>typeof value==='boolean';
 const object=(value:unknown):value is object=>!!value&&typeof value==='object'&&!isProxy(value)&&!isPromise(value);
 function nativeBirth(){
  if(!sdk(ready,app,[],bool))throw denied();
  let found=false,invalidInventory=false;
  // A Native inventory is still an SDK result. Inspect every own data slot
  // without calling an accessor, and retain every unsafe sibling before deny.
  const inspect=(all:unknown)=>{
   if(!isArray(all)||isProxy(all))return;const length=descriptor(all,'length')!.value as number;
   for(let i=0;i<length;i++){
    const row=descriptor(all,`${i}`);if(!row||!own(row,'value')){invalidInventory=true;continue;}
    if(unsafeSdkValue(row.value)){retain(row.value);invalidInventory=true;continue;}
    if(row.value===candidate)found=true;
   }
  };
  sdk(windows,BrowserWindow,[],(value):value is BrowserWindow[]=>isArray(value)&&!isProxy(value),false,inspect);
  if(invalidInventory){fault(Error('DEFAULT_DISPATCH_USER_SOURCE_UNCONFIRMED'));throw sourceFault;}if(!found)throw denied();
  if(method(candidate,'isDestroyed',[],bool))throw denied();
  const id=property(()=>candidate.id,(v):v is number=>typeof v==='number'&&Number.isSafeInteger(v));
  sdk(windowId,BrowserWindow,[id],(v):v is BrowserWindow=>v===candidate);
  const wc=property(()=>candidate.webContents,(v):v is WebContents=>object(v)) as WebContents;
  if(method(wc,'isDestroyed',[],bool))throw denied();
  sdk(windowContents,BrowserWindow,[wc],(v):v is BrowserWindow=>v===candidate);
  const wcId=property(()=>wc.id,(v):v is number=>typeof v==='number'&&Number.isSafeInteger(v));
  sdk(contentsId,webContents,[wcId],(v):v is WebContents=>v===wc);
  const session=property(()=>wc.session,(v):v is WebContents['session']=>object(v));
  return{window:candidate,contents:wc,session};
 }
 function trusted(url:string){if(!sdk(policy,undefined,[url],bool)){revoke();throw denied();}live();}
 function revoke(){epoch++;pending=true;const rows=active.snapshot();for(let i=0;i<rows.length;i++)try{rows[i]!.abort.abort(denied());}catch(error){remember(error);}}
 const navigation=(_event:unknown,_url:string,_inPlace:boolean,mainFrame:boolean)=>{if(mainFrame)revoke();};
 const loaded=()=>{if(sealed)return;const observedEpoch=epoch;try{if(!method(contents,'isDestroyed',[],bool)&&!method(contents,'isLoadingMainFrame',[],bool)&&epoch===observedEpoch&&!sealed&&!sourceFaultPresent)pending=false;}catch(error){remember(error);seal();}};
 const lost=()=>{bootstrapEpoch++;revoke();};
 const cleanups:Array<()=>void>=[];
 function dispose(){if(disposed||installing)return;disposed=true;for(let i=0;i<cleanups.length;i++)try{cleanups[i]!();}catch(error){remember(error);}}
 function seal(){if(!sealed){sealed=true;bootstrapEpoch++;revoke();}dispose();}
 function initialize(){
  if(birth)return;if(installing)throw denied();installing=true;const complete=reserve();
  try{
   birth=nativeBirth();contents=birth.contents;pending=method(contents,'isLoadingMainFrame',[],bool);
   const listeners:Array<[WebContents|BrowserWindow,string,(...args:any[])=>void]>=[[contents,'did-start-navigation',navigation],[contents,'did-stop-loading',loaded],[contents,'render-process-gone',lost],[contents,'destroyed',lost],[birth.window,'closed',lost]];
   for(let i=0;i<listeners.length;i++){
    const [target,event,handler]=listeners[i]!,off=property(()=>target.off,(v):v is typeof target.off=>typeof v==='function');
    // Cleanup is reserved BEFORE on(): newListener may reenter seal, then
    // attach only after that seal returns. The whole setup root owns it.
    appendIntrinsic(cleanups,()=>{sdk(off,target,[event,handler],(v):v is typeof target=>v===target,true);});
    method(target,'on',[event,handler],(v):v is typeof target=>v===target);live();
   }
  }catch(error){remember(error);sealed=true;revoke();throw error;}
  finally{installing=false;if(sealed)dispose();complete();}
 }
 function assertNative(){try{const current=nativeBirth();if(!birth||current.contents!==contents||current.session!==birth.session)throw denied();}catch(error){bootstrapEpoch++;revoke();throw error;}}
 function open(event:IpcMainInvokeEvent,projectId:string,requestSource:'user'|'agent'|'scheduler'):DefaultDispatchUserFrame {
  live();if(requestSource!=='user')throw denied();
  if(typeof projectId!=='string'||!projectId||projectId.length>256||projectId.trim()!==projectId||projectId.includes('\0')||!event||typeof event!=='object'||isProxy(event))throw denied();
  initialize();assertNative();const originalFrame=property(()=>contents.mainFrame,(v):v is WebContents['mainFrame']=>object(v)),capturedEpoch=epoch,abort=new AbortController(),row={abort};let released=false;
  function pureLocal(){live();if(released||abort.signal.aborted||capturedEpoch!==epoch||pending)throw denied();}
  function local(){
   pureLocal();if(method(contents,'isLoadingMainFrame',[],bool)||property(()=>contents.mainFrame,(v):v is WebContents['mainFrame']=>object(v))!==originalFrame||property(()=>event.sender,(value):value is WebContents=>object(value))!==contents||property(()=>event.senderFrame,(value):value is WebContents['mainFrame']|null=>value===null||object(value))!==originalFrame)throw denied();assertNative();pureLocal();
  }
  function current(){local();trusted(property(()=>originalFrame.url,(v):v is string=>typeof v==='string'));local();}
  const proof=freeze(create(null)) as object;
  const frame=freeze({proof,signal:abort.signal,assertCurrent:current,release(){if(released)return;released=true;remove(proof);active.delete(row);try{abort.abort(denied());}catch(error){remember(error);}}});
  current();put(proof,{projectId,frame});active.add(row);return frame;
 }
 function assertAdmission(proof:object,actor:SubmissionActor|undefined,audience?:DefaultDispatchUserAudience){
  // Private membership FIRST: copied DTOs and hostile arguments are not read.
  const entry=get(proof);if(!entry)throw denied();entry.frame.assertCurrent();
  function validate(){
   const user=captureIpcData(actor,'DEFAULT_DISPATCH_USER_AUTHORITY_REQUIRED');
   if(!user||keys(user).length!==2||!own(user,'requestSource')||!own(user,'actorId')||user.requestSource!=='user'||user.actorId!=='desktop-user:'+scope.profileId)throw denied();
   if(audience!==undefined){const target=captureIpcData(audience,'DEFAULT_DISPATCH_USER_AUTHORITY_REQUIRED');if(!target||keys(target).length!==3||!own(target,'projectId')||!own(target,'action')||!own(target,'scope')||target.projectId!==entry!.projectId||target.action!=='dispatch_current_plan'||!target.scope||typeof target.scope!=='object'||Array.isArray(target.scope)||keys(target.scope).length!==2||!own(target.scope,'profileId')||!own(target.scope,'workspaceId')||target.scope.profileId!==scope.profileId||target.scope.workspaceId!==scope.workspaceId)throw denied();}
  }
  validate();entry.frame.assertCurrent();validate();
 }
 function drain():Promise<void>{
  if(closing)return closing;seal();
  closing=(async()=>{
   // An original raw's final outcome may reveal further original child tails.
   // Register those before completing its row, then join the next frontier.
   while(roots.size||tails.size){
    const outcomes=await settleIntrinsicOperations(roots.snapshot(),row=>row.completion);for(let i=0;i<outcomes.length;i++)if(outcomes[i]!.status==='rejected')remember((outcomes[i] as PromiseRejectedResult).reason);
    const result=await settleIntrinsicOperations(tails.snapshot(),row=>row.completion);for(let i=0;i<result.length;i++)if(result[i]!.status==='rejected')remember((result[i] as PromiseRejectedResult).reason);
   }
   if(unknown.size)remember(Error('DEFAULT_DISPATCH_USER_SOURCE_UNCONFIRMED',{cause:sourceFault}));
   if(failures.length===1)throw failures[0];if(failures.length)throw aggregateIntrinsicErrors(failures,'DEFAULT_DISPATCH_USER_SOURCE_UNCONFIRMED');
  })();return closing;
 }
 const ingress:IngressOwner={name:'default-dispatch-user-source',stopAccepting:seal,abortAllActive:seal,drain(deadlineMs){return new NativePromise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),Math.max(0,deadlineMs));apply(nativeThen,drain(),[()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);}]);});}};
 const source=freeze({open,assertAdmission,seal,drain,ingress});let bootstrap:DefaultDispatchUserBootstrap|undefined;
 apply(bootstrapSet,bootstrapSources,[source,()=>{
  live();initialize();
  if(!bootstrap){const observed=bootstrapEpoch,original=birth!;
   const assertLocal=()=>{live();if(observed!==bootstrapEpoch||birth!==original||contents!==original.contents)throw denied();};
   bootstrap=freeze(assign(create(null),{window:original.window,contents:original.contents,session:original.session,scope,assertLocal,assertCurrent(){assertLocal();assertNative();assertLocal();}}));
  }
  bootstrap!.assertCurrent();return bootstrap!;
 }]);return source;
}
