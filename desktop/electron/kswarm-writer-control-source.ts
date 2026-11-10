import {sealDesktopWriterRelay,drainDesktopWriterRelay} from './activity-owner-writer-launcher.js';
import {createIntrinsicSet,settleIntrinsicOperations,appendIntrinsic,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import type {BrowserWindow,IpcMainInvokeEvent,WebContents} from 'electron';
import {types} from 'node:util';
import type {KSwarmService} from './kswarm-service.js';
import type {KSwarmOwnedControlAdmission,KSwarmOwnedControlContext,KSwarmOwnedControlOperation} from './kswarm-owned-control.js';
import {assertStandardIpcPromise} from './ipc-native-promise.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import type {IngressOwner} from './desktop-shutdown-coordinator.js';
const NativePromise=Promise,nativeThen=Promise.prototype.then,apply=Reflect.apply;
const asyncPrototype=Object.getPrototypeOf(async()=>undefined);
type Scope=Readonly<{profileId:string;workspaceId:string}>;
interface WindowEpoch {window:BrowserWindow;contents:WebContents;epoch:number;pending:boolean;dispose():void}
export interface WriterControlFrame {readonly context:KSwarmOwnedControlContext;assertCurrent():void;release():void}
export interface KSwarmWriterControlSource {
 readonly admission:KSwarmOwnedControlAdmission;
 bindService(service:KSwarmService):void;
 openInspect(event:IpcMainInvokeEvent,requestSource:'user'|'agent'|'scheduler'):WriterControlFrame;
 openPrepare(event:IpcMainInvokeEvent,requestSource:'user'|'agent'|'scheduler'):WriterControlFrame;
 seal():void;drain():Promise<void>;readonly ingress:IngressOwner;
}
interface BootstrapBinding {read(service:KSwarmService):{window:BrowserWindow;scope:Scope};assertLocal(service:KSwarmService):void}
const bootstrapBindings=new WeakMap<object,BootstrapBinding>(),getBootstrapBinding=bootstrapBindings.get.bind(bootstrapBindings),setBootstrapBinding=bootstrapBindings.set.bind(bootstrapBindings);
/** Original source identity for native Main bootstrap; no user frame is minted. */
export function readKSwarmWriterControlBootstrap(source:KSwarmWriterControlSource,service:KSwarmService){const entry=getBootstrapBinding(source);if(!entry)throw denied();return entry.read(service);}
export function assertKSwarmWriterControlBootstrapLocal(source:KSwarmWriterControlSource,service:KSwarmService):void{const entry=getBootstrapBinding(source);if(!entry)throw denied();entry.assertLocal(service);}
const denied=()=>Error('WRITER_CONTROL_AUTHORITY_REQUIRED');
function asyncSourceValue(value:unknown):boolean{
 if(!value||typeof value!=='object'&&typeof value!=='function')return false;
 if(types.isPromise(value))return true;
 let cursor:object|null=value;for(let depth=0;cursor&&depth<16;depth++){
  if(types.isProxy(cursor)||Object.getOwnPropertyDescriptor(cursor,'then'))return true;
  cursor=Object.getPrototypeOf(cursor);
 }return cursor!==null;
}
/** Main's configuration provenance. This does not grant project/model/dispatch
 * permission, and its opaque frames never leave this process. */
export function createKSwarmWriterControlSource(options:{getWindow():BrowserWindow|null;getScope():Scope;isTrustedUrl(url:string):boolean}):KSwarmWriterControlSource{
 const getWindow=options.getWindow,getScope=options.getScope,isTrustedUrl=options.isTrustedUrl;
 for(const fn of [getWindow,getScope,isTrustedUrl])if(typeof fn!=='function'||types.isProxy(fn)||types.isAsyncFunction(fn)||Object.getPrototypeOf(fn)===asyncPrototype)throw Error('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');
 let service:KSwarmService|undefined,sealed=false,reading=false,sourceFault:Error|undefined,cleanupFailure:unknown,cleanupFailed=false;
 const drainFailures:unknown[]=[];
 function rememberDrainFailure(error:unknown){for(let i=0;i<drainFailures.length;i++)if(drainFailures[i]===error)return;appendIntrinsic(drainFailures,error);}
 function cleanupFailureObserved(error:unknown){if(!cleanupFailed){cleanupFailed=true;cleanupFailure=error;}rememberDrainFailure(error);}
 const proofs=new WeakMap<object,{operation:KSwarmOwnedControlOperation;scope:Scope;frame:WriterControlFrame;assertLocal():void}>(),getProof=proofs.get.bind(proofs),setProof=proofs.set.bind(proofs),deleteProof=proofs.delete.bind(proofs);
 const windows=new WeakMap<WebContents,WindowEpoch>(),getEpoch=windows.get.bind(windows),setEpoch=windows.set.bind(windows);
 const epochs=createIntrinsicSet<WindowEpoch>(),active=createIntrinsicSet<{record:WindowEpoch;abort:AbortController}>(),unknownRaws=createIntrinsicSet<unknown>();
 const tails=createIntrinsicSet<{raw:Promise<unknown>;completion:Promise<void>}>();
 function poison(){sourceFault??=Error('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');return sourceFault;}
 function live(){if(reading)throw poison();if(sealed||sourceFault||cleanupFailed)throw sourceFault??(cleanupFailed?cleanupFailure:denied());}
 function retain(raw:unknown){
  if(!types.isPromise(raw)){unknownRaws.add(raw);return;}
  let done!:()=>void;const row={raw,completion:new NativePromise<void>(resolve=>{done=resolve;})};tails.add(row);
  try{
   if(Object.getOwnPropertyDescriptor(raw,'then'))throw Error('WRITER_CONTROL_SOURCE_TAIL_UNKNOWN');
   assertStandardIpcPromise(raw,'WRITER_CONTROL_SOURCE_TAIL_UNKNOWN');
   apply(nativeThen,raw,[()=>{tails.delete(row);done();},(error:unknown)=>{rememberDrainFailure(error);tails.delete(row);done();}]);
  }catch{unknownRaws.add(raw);tails.delete(row);}
 }
 function read<T>(fn:(...args:never[])=>unknown,args:unknown[],accept:(value:unknown)=>value is T):T{
  live();reading=true;
  try{
   const value=apply(fn,undefined,args);
   if(asyncSourceValue(value)){retain(value);throw sourceFault??poison();}
   if(sourceFault)throw sourceFault;
   if(!accept(value)){retain(value);throw poison();}
   if(sourceFault)throw sourceFault;return value;
  }finally{reading=false;}
 }
 function currentWindow(){return read(getWindow,[],(value):value is BrowserWindow|null=>value===null||!!value&&typeof value==='object'&&!types.isProxy(value)&&typeof (value as BrowserWindow).isDestroyed==='function'&&!!(value as BrowserWindow).webContents);}
 function domain():Scope{
  const raw=read(getScope,[],(value):value is Scope=>!!value&&typeof value==='object'&&!types.isProxy(value));
  const data=captureIpcData(raw,'WRITER_CONTROL_AUTHORITY_REQUIRED');
  if(!data||Object.keys(data).length!==2||!(['profileId','workspaceId'] as const).every(key=>typeof data[key]==='string'&&/^[a-f0-9]{64}$/.test(data[key])))throw denied();
  return Object.freeze({profileId:data.profileId as string,workspaceId:data.workspaceId as string});
 }
 function revoke(record:WindowEpoch,pending=true){record.epoch++;record.pending=pending;const rows=active.snapshot();for(let i=0;i<rows.length;i++){const row=rows[i]!;if(row.record===record)try{row.abort.abort(denied());}catch(error){cleanupFailureObserved(error);}}}
 function epoch(window:BrowserWindow):WindowEpoch{
  const contents=window.webContents,existing=getEpoch(contents);if(existing){if(existing.window!==window)throw denied();return existing;}
  const record:WindowEpoch={window,contents,epoch:0,pending:contents.isLoadingMainFrame(),dispose:()=>undefined};
  const navigation=(_event:unknown,_url:string,_inPlace:boolean,mainFrame:boolean)=>{if(mainFrame)revoke(record);};
  const loaded=(_event:unknown,mainFrame:boolean)=>{if(mainFrame&&!contents.isDestroyed()&&!contents.isLoadingMainFrame())record.pending=false;};
  const gone=()=>revoke(record);
  const destroyed=()=>{revoke(record);record.dispose();};
  let disposeAttempted=false;record.dispose=()=>{if(disposeAttempted)return;disposeAttempted=true;let failed=false;const steps=[()=>contents.off('did-start-navigation',navigation),()=>contents.off('did-frame-finish-load',loaded),()=>contents.off('render-process-gone',gone),()=>contents.off('destroyed',destroyed),()=>window.off('closed',destroyed)];for(let i=0;i<steps.length;i++)try{steps[i]!();}catch(error){failed=true;cleanupFailureObserved(error);}if(!failed)epochs.delete(record);};
  contents.on('did-start-navigation',navigation);contents.on('did-frame-finish-load',loaded);contents.on('render-process-gone',gone);contents.on('destroyed',destroyed);window.on('closed',destroyed);
  setEpoch(contents,record);epochs.add(record);return record;
 }
 function open(operation:KSwarmOwnedControlOperation,event:IpcMainInvokeEvent,requestSource:'user'|'agent'|'scheduler'):WriterControlFrame{
  live();if(requestSource!=='user'||!service||!event||typeof event!=='object'||types.isProxy(event))throw denied();
  const candidate=currentWindow();if(!candidate||candidate.isDestroyed()||candidate.webContents.isDestroyed())throw denied();const window:BrowserWindow=candidate;
  const record=epoch(window),contents=window.webContents,originalFrame=contents.mainFrame,capturedEpoch=record.epoch,scope=domain();
  const abort=new AbortController(),row={record,abort};let released=false;
  function local(){
   live();if(released||abort.signal.aborted||window.isDestroyed()||contents.isDestroyed()||window.webContents!==contents||contents.mainFrame!==originalFrame
    ||record.epoch!==capturedEpoch||record.pending||contents.isLoadingMainFrame()||event.sender!==contents||event.senderFrame!==originalFrame)throw denied();
  }
  function current(){
   local();if(currentWindow()!==window)throw denied();
   const actual=domain();if(actual.profileId!==scope.profileId||actual.workspaceId!==scope.workspaceId)throw denied();
   if(!read(isTrustedUrl,[originalFrame.url],(value):value is boolean=>typeof value==='boolean'))throw denied();
   if(currentWindow()!==window)throw denied();local();
  }
  const proof=Object.freeze(Object.create(null)),context=Object.freeze({requestSource:'user' as const,admission:proof,signal:abort.signal});
  const frame:WriterControlFrame=Object.freeze({context,assertCurrent:current,release(){if(released)return;released=true;deleteProof(proof);active.delete(row);}});
  current();active.add(row);setProof(proof,{operation,scope,frame,assertLocal:local});return frame;
 }
 const admission:KSwarmOwnedControlAdmission=(proof,audience)=>{
  live();const entry=getProof(proof);if(!entry||audience.operation!==entry.operation||audience.serviceOwner!==service)throw denied();
  entry.frame.assertCurrent();if(audience.scope.profileId!==entry.scope.profileId||audience.scope.workspaceId!==entry.scope.workspaceId)throw denied();entry.assertLocal();
 };
 function seal(){if(sealed)return;sealed=true;if(service)sealDesktopWriterRelay(source,service);const rows=active.snapshot(),records=epochs.snapshot();for(let i=0;i<rows.length;i++){const row=rows[i]!;try{row.abort.abort(denied());active.delete(row);}catch(error){cleanupFailureObserved(error);}}for(let i=0;i<records.length;i++)try{records[i]!.dispose();}catch(error){cleanupFailureObserved(error);}}
 async function drain(){
  seal();
  const outcomes=await settleIntrinsicOperations(tails.snapshot(),row=>row.completion);
  for(let i=0;i<outcomes.length;i++){const outcome=outcomes[i]!;if(outcome.status==='rejected')rememberDrainFailure(outcome.reason);}
  if(service)try{await drainDesktopWriterRelay(service);}catch(error){rememberDrainFailure(error);}
  if(unknownRaws.size)rememberDrainFailure(Error('WRITER_CONTROL_SOURCE_TAIL_UNKNOWN',{cause:sourceFault}));
  if(drainFailures.length===1)throw drainFailures[0];if(drainFailures.length)throw aggregateIntrinsicErrors(drainFailures,'WRITER_CONTROL_SOURCE_DRAIN_UNCONFIRMED');
 }
 const ingress:IngressOwner={name:'kswarm-writer-control-source',stopAccepting:seal,abortAllActive:seal,drain(deadlineMs){
  const raw=drain();return new NativePromise<boolean>(resolve=>{
   const timer=setTimeout(()=>resolve(false),Math.max(0,deadlineMs));
   apply(nativeThen,raw,[()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);}]);
  });
 }};
 const source:KSwarmWriterControlSource=Object.freeze({admission,bindService(value:KSwarmService){live();if(service)throw Error('WRITER_CONTROL_SERVICE_ALREADY_BOUND');service=value;},openInspect:(event:IpcMainInvokeEvent,source:'user'|'agent'|'scheduler')=>open('inspect_writer',event,source),openPrepare:(event:IpcMainInvokeEvent,source:'user'|'agent'|'scheduler')=>open('prepare_initial_plan_writer',event,source),seal,drain,ingress});
 function bootstrapLocal(owner:KSwarmService){live();if(!service||owner!==service)throw denied();}
 setBootstrapBinding(source,{assertLocal:bootstrapLocal,read(owner){
  bootstrapLocal(owner);
  const window=read(getWindow,[],(value):value is BrowserWindow|null=>value===null||!!value&&typeof value==='object'&&!types.isProxy(value));
  if(window===null)throw denied();
  const scope=domain();
  const finalWindow=read(getWindow,[],(value):value is BrowserWindow|null=>value===null||!!value&&typeof value==='object'&&!types.isProxy(value));
  if(window!==finalWindow)throw denied();bootstrapLocal(owner);return Object.freeze({window,scope});
 }});
 return source;
}
