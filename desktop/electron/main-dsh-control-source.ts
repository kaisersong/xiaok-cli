import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import electron,{type BrowserWindow,type IpcMainInvokeEvent,type WebContents} from 'electron';
import {createHash,Hash} from 'node:crypto';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {readOriginalDshUserControlPort} from './desktop-multi-agent-store.js';
import {types} from 'node:util';
import {createIntrinsicSet,appendIntrinsic,settleIntrinsicOperations,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from './ipc-native-promise.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {readOriginalDesktopApplicationWindowOwnerView,type DesktopApplicationWindowOwner} from './desktop-application-window-owner.js';
import type {IngressOwner} from './desktop-shutdown-coordinator.js';
import {join} from 'node:path';
import {KB_ADD_SOURCE_SCHEMA} from '../shared/knowledge-ipc-contract.js';
const own=Object.hasOwn,keys=Object.keys,isArray=Array.isArray;
const apply=Reflect.apply,freeze=Object.freeze,create=Object.create,prototype=Object.getPrototypeOf;
const isProxy=types.isProxy,isAsync=types.isAsyncFunction,isPromise=types.isPromise,descriptor=Object.getOwnPropertyDescriptor;
const NativePromise=Promise,nativeThen=Promise.prototype.then,NativeWeakMap=WeakMap,NativeNumber=Number,objectPrototype=Object.prototype,arrayPrototype=Array.prototype;
const NativeError=Error,NativeAbortController=AbortController;
const descriptors=Object.getOwnPropertyDescriptors,ownKeys=Reflect.ownKeys,exec=RegExp.prototype.exec,finite=Number.isFinite,integer=Number.isSafeInteger,is=Object.is,charCode=String.prototype.charCodeAt,byteLength=Buffer.byteLength;
const originalHash=createHash,hashUpdate=Hash.prototype.update,hashDigest=Hash.prototype.digest,originalFunctionPrototype=Function.prototype;
const originalAbort=AbortController.prototype.abort,signalGetter=descriptor(AbortController.prototype,'signal')!.get!,abortedGetter=descriptor(AbortSignal.prototype,'aborted')!.get!;
const denied=()=>new NativeError('MAIN_DSH_USER_AUTHORITY_REQUIRED');
type Scope=Readonly<{profileId:string;workspaceId:string}>;
export type MainDshControlPurpose='enroll_authority'|'mandate_control'|'policy_control';
export interface MainDshControlView {readonly storageScope:Scope;readonly principalId:string;readonly purpose:MainDshControlPurpose;readonly bodyHash:string;assertCurrent():void;assertLocal():void}
export interface MainDshControlFrame {readonly proof:object;readonly bodyHash:string;readonly signal:AbortSignal;assertCurrent():void;assertLocal():void;release():void}
export interface MainModelProbeEventBody {readonly schemaVersion:1;readonly purpose:'test_provider_connection';readonly providerId:string;readonly modelId:string|null}
export interface MainModelProbeEventView {readonly storageScope:Scope;readonly principalId:string;readonly body:MainModelProbeEventBody;readonly bodyHash:string;readonly signal:AbortSignal;assertCurrent():void;assertLocal():void}
export interface MainMaterialEventBody {
  readonly schemaVersion: 1;
  readonly purpose: 'kb_add_source_file';
  readonly input: Readonly<{
    collectionId: string;
    kind: 'file';
    title: string;
    filePath: string;
    [key: string]: unknown;
  }>;
}
export interface MainMaterialEventView {
  readonly storageScope: Scope;
  readonly principalId: string;
  readonly body: MainMaterialEventBody;
  readonly bodyHash: string;
  readonly signal: AbortSignal;
  readonly knowledgeDatabasePath: string;
  assertCurrent(): void;
  assertLocal(): void;
}
export interface MainDshControlSource {
 bindStore(store:object):void;
 openModelProbe(event:IpcMainInvokeEvent,body:unknown,requestSource:'user'|'agent'|'scheduler'):MainDshControlFrame;
 openMaterialRead(event:IpcMainInvokeEvent,body:unknown,requestSource:'user'|'agent'|'scheduler'):MainDshControlFrame;
 open(event:IpcMainInvokeEvent,purpose:MainDshControlPurpose,body:unknown,requestSource:'user'|'agent'|'scheduler'):MainDshControlFrame;
 resolve(frame:object,purpose:string):Readonly<{data:unknown;assertCurrent():void}>;
 seal():void;drain():Promise<void>;readonly ingress:IngressOwner;
}
type PrivateReader=(frame:object,store:unknown,purpose:unknown,hash:unknown)=>MainDshControlView;
const bindingWeakGet=WeakMap.prototype.get;
const originalControlBindings=new NativeWeakMap<object,Readonly<{storageScope:Scope;principalId:string;assertLocal():void}>>();
/** Original birth identity only. This does not read Native SDKs or grant effects. */
export function readOriginalMainDshControlSourceBinding(source:unknown):Readonly<{storageScope:Scope;principalId:string;assertLocal():void}>{
 const row=apply(bindingWeakGet,originalControlBindings,[source]) as Readonly<{storageScope:Scope;principalId:string;assertLocal():void}>|undefined;
 if(!row)throw denied();return row;
}
const originalProbeSources=new NativeWeakMap<object,(proof:unknown)=>MainModelProbeEventView>();
const originalMaterialSources=new NativeWeakMap<object,(proof:unknown)=>MainMaterialEventView>();
/** Actual Main file-ingestion event only. This issues no M, N or DSH grant. */
export function readOriginalMainMaterialEvent(
  source: unknown,
  proof: unknown,
): MainMaterialEventView {
  const read = apply(sourceGet, originalMaterialSources, [source]) as
    | ((proof: unknown) => MainMaterialEventView)
    | undefined;
  if (!read) throw new NativeError('MAIN_MATERIAL_EVENT_REQUIRED');
  return read(proof);
}
function materialBody(value: unknown): MainMaterialEventBody {
  if (!value || typeof value !== 'object' || isProxy(value)) throw denied();
  const names = ownKeys(value);
  if (names.length !== 3) throw denied();
  for (let i = 0; i < names.length; i++)
    if (
      names[i] !== 'schemaVersion' &&
      names[i] !== 'purpose' &&
      names[i] !== 'input'
    )
      throw denied();
  const schema = descriptor(value, 'schemaVersion'),
    purpose = descriptor(value, 'purpose'),
    input = descriptor(value, 'input');
  if (
    !schema ||
    !purpose ||
    !input ||
    !own(schema, 'value') ||
    !own(purpose, 'value') ||
    !own(input, 'value') ||
    schema.value !== 1 ||
    purpose.value !== 'kb_add_source_file'
  )
    throw denied();
  const parsed = KB_ADD_SOURCE_SCHEMA.safeParse(input.value);
  if (
    !parsed.success ||
    parsed.data.kind !== 'file' ||
    typeof parsed.data.filePath !== 'string' ||
    !parsed.data.filePath.length
  )
    throw denied();
  return value as MainMaterialEventBody;
}
const originalSources=new NativeWeakMap<object,PrivateReader>(),sourceGet=WeakMap.prototype.get,sourceSet=WeakMap.prototype.set,sourceDelete=WeakMap.prototype.delete;
/** A user provenance observation, never an enrollment or mutation grant. */
export function readOriginalMainDshControl(source:unknown,frame:object,store:unknown,purpose:unknown,hash:unknown):MainDshControlView {
 const read=source&&typeof source==='object'?apply(sourceGet,originalSources,[source]) as PrivateReader|undefined:undefined;
 if(!read)throw denied();return read(frame,store,purpose,hash);
}
/** User event provenance only; no DSH/M/N/model/Tools authorization. */
export function readOriginalMainModelProbeEvent(source:unknown,proof:unknown):MainModelProbeEventView {
 const read=apply(sourceGet,originalProbeSources,[source]) as ((proof:unknown)=>MainModelProbeEventView)|undefined;
 if(!read)throw new NativeError('MAIN_MODEL_PROBE_EVENT_REQUIRED');return read(proof);
}
function probeBody(value:unknown):MainModelProbeEventBody {
 if(!value||typeof value!=='object'||isProxy(value))throw denied();
 const names=ownKeys(value);if(names.length!==4)throw denied();
 for(let i=0;i<names.length;i++)if(names[i]!=='schemaVersion'&&names[i]!=='purpose'&&names[i]!=='providerId'&&names[i]!=='modelId')throw denied();
 const schema=descriptor(value,'schemaVersion'),purpose=descriptor(value,'purpose'),provider=descriptor(value,'providerId'),model=descriptor(value,'modelId');
 if(!schema||!purpose||!provider||!model||!own(schema,'value')||!own(purpose,'value')||!own(provider,'value')||!own(model,'value')||schema.value!==1||purpose.value!=='test_provider_connection')throw denied();
 function id(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=256&&apply(exec,/^\S(?:[\s\S]*\S)?$/,[value])!==null&&apply(exec,/\0/,[value])===null;}
 if(!id(provider.value)||model.value!==null&&!id(model.value))throw denied();
 return value as MainModelProbeEventBody;
}
function validPurpose(value:unknown):value is MainDshControlPurpose{return value==='enroll_authority'||value==='mandate_control'||value==='policy_control';}
function frozenData<T>(value:T):T{
 if(value&&typeof value==='object'){const rows=descriptors(value),names=ownKeys(rows);for(let i=0;i<names.length;i++){const row=rows[names[i] as string]!;if(own(row,'value'))frozenData(row.value);}freeze(value);}return value;
}
/** Bounded preflight runs before the existing IPC copier can allocate/descend. */
function captureControlBody(raw:unknown):unknown {
 let nodes=0,bytes=0;const active=createIntrinsicSet<object>();
 function text(value:string){
  bytes+=byteLength(value,'utf8');if(bytes>262144)throw denied();
  for(let i=0;i<value.length;i++){const code=apply(charCode,value,[i]) as number;if(code>=0xd800&&code<=0xdbff){const next=apply(charCode,value,[++i]) as number;if(!(next>=0xdc00&&next<=0xdfff))throw denied();}else if(code>=0xdc00&&code<=0xdfff)throw denied();}
 }
 function walk(value:unknown,depth:number):void{
  if(depth>32||++nodes>16384)throw denied();
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='string'){text(value);return;}
  if(typeof value==='number'){if(!finite(value)||is(value,-0))throw denied();return;}
  if(!value||typeof value!=='object'||isProxy(value)||active.has(value))throw denied();
  const array=isArray(value),proto=prototype(value);if(array?proto!==arrayPrototype&&proto!==null:proto!==objectPrototype&&proto!==null)throw denied();
  const rows=descriptors(value),names=ownKeys(rows);if(names.length>16385)throw denied();
  let length=0;if(array){const slot=rows.length;if(!slot||!own(slot,'value')||typeof slot.value!=='number'||!integer(slot.value)||slot.value<0||slot.value>16384)throw denied();length=slot.value;if(names.length!==length+1)throw denied();}
  active.add(value);
  try{for(let i=0;i<names.length;i++){const name=names[i]!;if(typeof name!=='string')throw denied();if(array&&name==='length')continue;const row=rows[name]!;if(!row.enumerable||!own(row,'value'))throw denied();text(name);if(array&&(apply(exec,/^(0|[1-9]\d*)$/,[name])===null||NativeNumber(name)>=length))throw denied();walk(row.value,depth+1);}}finally{active.delete(value);}
 }
 if(!raw||typeof raw!=='object'||isArray(raw))throw denied();walk(raw,0);
 const data=captureIpcData(raw,'MAIN_DSH_CONTROL_BODY_INVALID');if(byteLength(canonicalVerificationJson(data),'utf8')>262144)throw denied();return frozenData(data);
}
/** Main-only native event provenance. This does not mint Native N, a durable
 * authority epoch, a mandate, a budget, an egress permit or an A/B grant. */
export function createMainDshControlSource(options:({window:BrowserWindow;windowOwner?:never}|{windowOwner:DesktopApplicationWindowOwner<BrowserWindow>;window?:never})&{scope:Scope;isTrustedUrl(url:string):boolean}):MainDshControlSource {
 if(!options||typeof options!=='object'||isProxy(options))throw denied();
 const fields=descriptors(options),names=ownKeys(fields);if(names.length!==3)throw denied();
 for(let i=0;i<names.length;i++){const key=names[i]!;if(key!=='window'&&key!=='windowOwner'&&key!=='scope'&&key!=='isTrustedUrl'||!own(fields[key as string]!,'value'))throw denied();}
 if(!fields.scope||!fields.isTrustedUrl||Boolean(fields.window)===Boolean(fields.windowOwner))throw denied();
 const windowOwner=fields.windowOwner?.value;
 let candidate=fields.window?.value as BrowserWindow;
 const policy=fields.isTrustedUrl!.value as (url:string)=>boolean;
 if(!electron||typeof electron!=='object'||isProxy(electron))throw denied();
 if(fields.window&&(!candidate||typeof candidate!=='object'||isProxy(candidate)))throw denied();
 if(typeof policy!=='function'||isProxy(policy)||isAsync(policy)||prototype(policy)!==originalFunctionPrototype)throw new NativeError('MAIN_DSH_USER_SYNCHRONOUS_SOURCE_REQUIRED');
 const scopeData=captureIpcData(fields.scope!.value,'MAIN_DSH_USER_SCOPE_INVALID');
 if(!scopeData||keys(scopeData).length!==2||typeof scopeData.profileId!=='string'||typeof scopeData.workspaceId!=='string'||apply(exec,/^[a-f0-9]{64}$/,[scopeData.profileId])===null||apply(exec,/^[a-f0-9]{64}$/,[scopeData.workspaceId])===null)throw denied();
 const scope=freeze({profileId:scopeData.profileId,workspaceId:scopeData.workspaceId});
 let birth:{window:BrowserWindow;contents:WebContents;session:WebContents['session']}|undefined,contents:WebContents,installing=false,windowOwnerEpoch:number|undefined,windowOwnerLocal:(()=>void)|undefined;
 type ProofRow={purpose:MainDshControlPurpose;bodyHash:string;data:unknown;frame:MainDshControlFrame};
 const probeProofs=new NativeWeakMap<object,{body:MainModelProbeEventBody;frame:MainDshControlFrame}>();
 const materialProofs=new NativeWeakMap<object,{body:MainMaterialEventBody;frame:MainDshControlFrame;knowledgeDatabasePath:string}>();
 const proofs=new NativeWeakMap<object,ProofRow>(),get=(proof:object)=>apply(sourceGet,proofs,[proof]) as ProofRow|undefined,put=(proof:object,row:ProofRow)=>{apply(sourceSet,proofs,[proof,row]);},remove=(proof:object)=>{apply(sourceDelete,proofs,[proof]);};
 const principalId='desktop-user:'+scope.profileId;let boundStore:object|undefined;
 let app:typeof electron.app,windowApi:typeof electron.BrowserWindow,contentsApi:typeof electron.webContents,ready:Function,windows:Function,windowId:Function,windowContents:Function,contentsId:Function;
 const retained=createIntrinsicSet<unknown>();
 const active=createIntrinsicSet<{abort:AbortController}>(),roots=createIntrinsicSet<{completion:Promise<void>}>(),tails=createIntrinsicSet<{raw:Promise<unknown>;completion:Promise<void>}>(),unknown=createIntrinsicSet<unknown>(),failures:unknown[]=[];
 let sealed=false,checking=false,epoch=0,pending=true,sourceFault:unknown,sourceFaultPresent=false,disposed=false,closing:Promise<void>|undefined;
 function remember(error:unknown){for(let i=0;i<failures.length;i++)if(failures[i]===error)return;appendIntrinsic(failures,error);}
 function fault(error:unknown){if(!sourceFaultPresent){sourceFault=error;sourceFaultPresent=true;remember(error);revoke();}}
 function live(){if(checking||sealed||sourceFaultPresent)throw sourceFaultPresent?sourceFault:denied();}
 function retain(raw:unknown){
  if(retained.has(raw))return;retained.add(raw);
  if(!isPromise(raw)||isProxy(raw)){unknown.add(raw);try{inventory(raw);}catch(error){remember(error);}return;}
  let complete!:()=>void;const row={raw,completion:new NativePromise<void>(yes=>{complete=yes;})};tails.add(row);
  try{inventory(raw);if(descriptor(raw,'then'))throw denied();assertStandardIpcPromise(raw,'MAIN_DSH_USER_TAIL_UNKNOWN');apply(nativeThen,raw,[(value:unknown)=>settled(value,false),(error:unknown)=>settled(error,true)]);}
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
  if(typeof fn!=='function'||isProxy(fn)||isAsync(fn)||prototype(fn)!==originalFunctionPrototype)throw new NativeError('MAIN_DSH_USER_SYNCHRONOUS_SOURCE_REQUIRED');
  const complete=reserve();checking=true;
  try{
   const raw:unknown=apply(fn,receiver,args);
   // Fixed inventory inspection must retain known siblings even when the
   // returned envelope itself is rejected for forbidden metadata.
   inspect?.(raw);
   if(unsafeSdkValue(raw)||!accept(raw)){fault(new NativeError('MAIN_DSH_USER_SOURCE_UNCONFIRMED'));if(raw!==null&&(typeof raw==='object'||typeof raw==='function'))retain(raw);throw sourceFault;}
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
 function nativeReferences(){
  if(ready)return;
  app=property(()=>electron.app,(v):v is typeof app=>object(v));
  windowApi=property(()=>electron.BrowserWindow,(v):v is typeof windowApi=>typeof v==='function');
  contentsApi=property(()=>electron.webContents,(v):v is typeof contentsApi=>object(v));
  const callable=(v:unknown):v is Function=>typeof v==='function';
  ready=property(()=>app.isReady,callable);windows=property(()=>windowApi.getAllWindows,callable);windowId=property(()=>windowApi.fromId,callable);windowContents=property(()=>windowApi.fromWebContents,callable);contentsId=property(()=>contentsApi.fromId,callable);
 }
 function nativeBirth(){
  nativeReferences();
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
  sdk(windows,windowApi,[],(value):value is BrowserWindow[]=>isArray(value)&&!isProxy(value),false,inspect);
  if(invalidInventory){fault(new NativeError('MAIN_DSH_USER_SOURCE_UNCONFIRMED'));throw sourceFault;}if(!found)throw denied();
  if(method(candidate,'isDestroyed',[],bool))throw denied();
  const id=property(()=>candidate.id,(v):v is number=>typeof v==='number'&&integer(v));
  sdk(windowId,windowApi,[id],(v):v is BrowserWindow=>v===candidate);
  const wc=property(()=>candidate.webContents,(v):v is WebContents=>object(v)) as WebContents;
  if(method(wc,'isDestroyed',[],bool))throw denied();
  sdk(windowContents,windowApi,[wc],(v):v is BrowserWindow=>v===candidate);
  const wcId=property(()=>wc.id,(v):v is number=>typeof v==='number'&&integer(v));
  sdk(contentsId,contentsApi,[wcId],(v):v is WebContents=>v===wc);
  const session=property(()=>wc.session,(v):v is WebContents['session']=>object(v));
  return{window:candidate,contents:wc,session};
 }
 function trusted(url:string){if(!sdk(policy,undefined,[url],bool)){revoke();throw denied();}live();}
 function revoke(){epoch++;pending=true;const rows=active.snapshot();for(let i=0;i<rows.length;i++)try{apply(originalAbort,rows[i]!.abort,[denied()]);}catch(error){remember(error);try{inventory(error);}catch(failure){remember(failure);unknown.add(error);}}}
 const navigation=(_event:unknown,_url:string,_inPlace:boolean,mainFrame:boolean)=>{if(mainFrame)revoke();};
 const loaded=()=>{if(sealed)return;const observedEpoch=epoch;try{if(!method(contents,'isDestroyed',[],bool)&&!method(contents,'isLoadingMainFrame',[],bool)&&epoch===observedEpoch&&!sealed&&!sourceFaultPresent)pending=false;}catch(error){remember(error);seal();}};
 const lost=()=>{revoke();};
 const cleanups:Array<()=>void>=[];
 function dispose(){if(disposed||installing)return;disposed=true;for(let i=0;i<cleanups.length;i++)try{cleanups[i]!();}catch(error){remember(error);}}
 function ownerView(){
  return sdk(readOriginalDesktopApplicationWindowOwnerView,undefined,[windowOwner],(value):value is Readonly<{window:BrowserWindow|null;viewEpoch:number;assertLocal():void}>=>{
   if(!value||typeof value!=='object'||isProxy(value))return false;const rows=descriptors(value),names=ownKeys(rows);
   return names.length===3&&!!rows.window&&own(rows.window,'value')&&!!rows.viewEpoch&&own(rows.viewEpoch,'value')&&integer(rows.viewEpoch.value)&&rows.viewEpoch.value>0&&!!rows.assertLocal&&own(rows.assertLocal,'value')&&typeof rows.assertLocal.value==='function'&&!isProxy(rows.assertLocal.value)&&(rows.window.value===null||object(rows.window.value));
  });
 }
 function refreshWindow(){
  if(!fields.windowOwner)return;
  const view=ownerView();
  if(birth&&(birth.window!==view.window||windowOwnerEpoch!==view.viewEpoch)){
   revoke();dispose();
   // Cleanup faults are sticky and retain their raw tails. Never install the
   // new view after an uncertain off(), including a synchronous reentry.
   live();if(unknown.size)throw denied();
   cleanups.length=0;birth=undefined;disposed=false;
  }
  if(!view.window){revoke();throw denied();}
  candidate=view.window;windowOwnerEpoch=view.viewEpoch;windowOwnerLocal=view.assertLocal;live();view.assertLocal();
 }
 function seal(){if(!sealed){sealed=true;revoke();}dispose();}
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
 function assertNative(){try{if(fields.windowOwner){const view=ownerView();if(!birth||view.window!==birth.window||view.viewEpoch!==windowOwnerEpoch)throw denied();}const current=nativeBirth();if(!birth||current.contents!==contents||current.session!==birth.session)throw denied();}catch(error){revoke();throw error;}}
 function bindStore(store:object):void{
  live();if(boundStore){if(store!==boundStore)throw denied();return;}
  readOriginalDshUserControlPort(store,source);live();if(boundStore&&boundStore!==store)throw denied();boundStore=store;
 }
 function open(event:IpcMainInvokeEvent,purpose:MainDshControlPurpose,body:unknown,requestSource:'user'|'agent'|'scheduler'):MainDshControlFrame {
  live();if(requestSource!=='user'||!boundStore||!validPurpose(purpose))throw denied();return captureEventFrame(event,purpose,body,requestSource);
 }
 function openModelProbe(event:IpcMainInvokeEvent,body:unknown,requestSource:'user'|'agent'|'scheduler'):MainDshControlFrame {
  live();if(requestSource!=='user')throw denied();return captureEventFrame(event,'model_probe',body,requestSource);
 }
 function openMaterialRead(event:IpcMainInvokeEvent,body:unknown,requestSource:'user'|'agent'|'scheduler'):MainDshControlFrame {
  live();if(requestSource!=='user')throw denied();return captureEventFrame(event,'material_read',body,requestSource);
 }
 function captureEventFrame(event:IpcMainInvokeEvent,purpose:MainDshControlPurpose|'model_probe'|'material_read',body:unknown,requestSource:'user'|'agent'|'scheduler'):MainDshControlFrame {
  live();if(requestSource!=='user')throw denied();
  if(!event||typeof event!=='object'||isProxy(event))throw denied();
  refreshWindow();initialize();assertNative();const originalFrame=property(()=>contents.mainFrame,(v):v is WebContents['mainFrame']=>object(v)),capturedEpoch=epoch,ownerLocal=windowOwnerLocal,abort=new NativeAbortController(),signal=apply(signalGetter,abort,[]) as AbortSignal,row={abort};let released=false;
  function pureLocal(){live();if(released||apply(abortedGetter,signal,[])||capturedEpoch!==epoch||pending)throw denied();if(ownerLocal)try{ownerLocal();}catch(error){revoke();throw error;}}
  function local(){
   pureLocal();if(method(contents,'isLoadingMainFrame',[],bool)||property(()=>contents.mainFrame,(v):v is WebContents['mainFrame']=>object(v))!==originalFrame||property(()=>event.sender,(value):value is WebContents=>object(value))!==contents||property(()=>event.senderFrame,(value):value is WebContents['mainFrame']|null=>value===null||object(value))!==originalFrame)throw denied();assertNative();pureLocal();
  }
  function current(){local();trusted(property(()=>originalFrame.url,(v):v is string=>typeof v==='string'));local();}
  current();const data=captureControlBody(body),probe=purpose==='model_probe'?probeBody(data):undefined,material=purpose==='material_read'?materialBody(data):undefined,hash=originalHash('sha256');
  const knowledgeDatabasePath=material?join(method(app,'getPath',['userData'],(value):value is string=>typeof value==='string'&&value.length>0),'knowledge.db'):undefined;
  apply(hashUpdate,hash,[canonicalVerificationJson(material?['main_material_event_v1',scope,principalId,material]:probe?['main_model_probe_event_v1',scope,principalId,probe]:['main_dsh_control_request_v1',purpose,scope,principalId,data])]);const bodyHash=apply(hashDigest,hash,['hex']) as string;pureLocal();
  const proof=freeze(create(null)) as object;
  const frame=freeze({proof,bodyHash,signal,assertCurrent:current,assertLocal:pureLocal,release(){if(released)return;released=true;remove(proof);apply(sourceDelete,probeProofs,[proof]);apply(sourceDelete,materialProofs,[proof]);active.delete(row);try{apply(originalAbort,abort,[denied()]);}catch(error){remember(error);try{inventory(error);}catch(failure){remember(failure);unknown.add(error);}}}});
  current();pureLocal();if(material)apply(sourceSet,materialProofs,[proof,{body:material,frame,knowledgeDatabasePath:knowledgeDatabasePath!}]);else if(probe)apply(sourceSet,probeProofs,[proof,{body:probe,frame}]);else if(validPurpose(purpose))put(proof,{purpose,bodyHash,data,frame});else throw denied();active.add(row);return frame;
 }
 function resolve(proof:object,purpose:string){
  const row=get(proof);if(!row||row.purpose!==purpose)throw denied();row.frame.assertCurrent();row.frame.assertLocal();return freeze({data:row.data,assertCurrent:row.frame.assertCurrent});
 }
 const read:PrivateReader=(proof,store,purpose,hash)=>{
  const row=get(proof);if(!row)throw denied();if(store!==boundStore||!boundStore||purpose!==row.purpose||hash!==row.bodyHash)throw denied();
  row.frame.assertCurrent();row.frame.assertLocal();return freeze({storageScope:scope,principalId,purpose:row.purpose,bodyHash:row.bodyHash,assertCurrent:row.frame.assertCurrent,assertLocal:row.frame.assertLocal});
 };
 function drain():Promise<void>{
  if(closing)return closing;seal();
  closing=(async()=>{
   // An original raw's final outcome may reveal further original child tails.
   // Register those before completing its row, then join the next frontier.
   while(roots.size||tails.size){
    const outcomes=await settleIntrinsicOperations(roots.snapshot(),row=>row.completion);for(let i=0;i<outcomes.length;i++)if(outcomes[i]!.status==='rejected')remember((outcomes[i] as PromiseRejectedResult).reason);
    const result=await settleIntrinsicOperations(tails.snapshot(),row=>row.completion);for(let i=0;i<result.length;i++)if(result[i]!.status==='rejected')remember((result[i] as PromiseRejectedResult).reason);
   }
   if(unknown.size)remember(new NativeError('MAIN_DSH_USER_SOURCE_UNCONFIRMED',{cause:sourceFault}));
   if(failures.length===1)throw failures[0];if(failures.length)throw aggregateIntrinsicErrors(failures,'MAIN_DSH_USER_SOURCE_UNCONFIRMED');
  })();return closing;
 }
 const ingress:IngressOwner={name:'main-dsh-control-source',stopAccepting:seal,abortAllActive:seal,drain(deadlineMs){return new NativePromise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),Math.max(0,deadlineMs));apply(nativeThen,drain(),[()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);}]);});}};
 const source=freeze({bindStore,open,openModelProbe,openMaterialRead,resolve,seal,drain,ingress});
 apply(sourceSet,originalMaterialSources,[source,(proof:unknown)=>{const row=apply(sourceGet,materialProofs,[proof]) as {body:MainMaterialEventBody;frame:MainDshControlFrame;knowledgeDatabasePath:string}|undefined;if(!row)throw new NativeError('MAIN_MATERIAL_EVENT_REQUIRED');row.frame.assertCurrent();row.frame.assertLocal();return freeze({storageScope:scope,principalId,body:row.body,bodyHash:row.frame.bodyHash,signal:row.frame.signal,knowledgeDatabasePath:row.knowledgeDatabasePath,assertCurrent:row.frame.assertCurrent,assertLocal:row.frame.assertLocal});}]);
 apply(sourceSet,originalControlBindings,[source,freeze({storageScope:scope,principalId,assertLocal:live})]);
 apply(sourceSet,originalProbeSources,[source,(proof:unknown)=>{const row=apply(sourceGet,probeProofs,[proof]) as {body:MainModelProbeEventBody;frame:MainDshControlFrame}|undefined;if(!row)throw new NativeError('MAIN_MODEL_PROBE_EVENT_REQUIRED');row.frame.assertCurrent();row.frame.assertLocal();return freeze({storageScope:scope,principalId,body:row.body,bodyHash:row.frame.bodyHash,signal:row.frame.signal,assertCurrent:row.frame.assertCurrent,assertLocal:row.frame.assertLocal});}]);
 apply(sourceSet,originalSources,[source,read]);return source;
}
