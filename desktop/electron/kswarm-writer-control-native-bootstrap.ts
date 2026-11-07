import {app,BrowserWindow,webContents,type WebContents,type Session} from 'electron';
import {types} from 'node:util';
import {randomBytes} from 'node:crypto';
import type {KSwarmService} from './kswarm-service.js';
import {readKSwarmOwnedControlServiceScope} from './kswarm-service.js';
import {readKSwarmWriterControlBootstrap,assertKSwarmWriterControlBootstrapLocal,type KSwarmWriterControlSource} from './kswarm-writer-control-source.js';
const apply=Reflect.apply,isProxy=types.isProxy,isArray=Array.isArray,freeze=Object.freeze,create=Object.create;
const descriptors=Object.getOwnPropertyDescriptors,ownKeys=Reflect.ownKeys,own=Object.hasOwn,prototype=Object.getPrototypeOf,objectPrototype=Object.prototype;
const nativeReady=app.isReady,nativeWindows=BrowserWindow.getAllWindows,nativeWindowId=BrowserWindow.fromId,nativeWindowContents=BrowserWindow.fromWebContents,nativeContentsId=webContents.fromId;
const charCode=String.prototype.charCodeAt;
type Scope=Readonly<{profileId:string;workspaceId:string}>;
interface Birth {window:BrowserWindow;contents:WebContents;session:Session}
interface LaunchRecord {source:KSwarmWriterControlSource;service:KSwarmService;scope?:Scope;birth?:Birth;nonce?:string;minting:boolean;checking:boolean;poisoned:boolean;used:boolean}
const capsules=new WeakMap<object,LaunchRecord>(),sources=new WeakMap<object,LaunchRecord>();
const getCapsule=capsules.get.bind(capsules),setCapsule=capsules.set.bind(capsules),getSource=sources.get.bind(sources),setSource=sources.set.bind(sources);
let minting:LaunchRecord|undefined;
const denied=()=>Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');
function fields(raw:unknown,names:readonly string[]):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||isProxy(raw)||isArray(raw)||prototype(raw)!==objectPrototype&&prototype(raw)!==null)throw denied();
 const rows=descriptors(raw),keys=ownKeys(rows);if(keys.length!==names.length)throw denied();
 for(let i=0;i<names.length;i++){const row=rows[names[i]!];if(!row||!row.enumerable||!own(row,'value'))throw denied();}
 const output=create(null);for(let i=0;i<names.length;i++)output[names[i]!]=rows[names[i]!]!.value;return output;
}
function scopeData(raw:unknown):Scope {
 const value=fields(raw,['profileId','workspaceId']);for(const key of ['profileId','workspaceId']){const text=value[key];if(typeof text!=='string'||text.length!==64)throw denied();for(let i=0;i<64;i++){const n=apply(charCode,text,[i]);if(!(n>=48&&n<=57||n>=97&&n<=102))throw denied();}}
 return freeze({profileId:value.profileId as string,workspaceId:value.workspaceId as string});
}
function sameScope(a:Scope,b:Scope){if(a.profileId!==b.profileId||a.workspaceId!==b.workspaceId)throw denied();}
/** Membership is checked before reading anything from the supplied candidate. */
function nativeWindow(candidate:unknown):Birth {
 if(!candidate||typeof candidate!=='object'||isProxy(candidate)||!apply(nativeReady,app,[]))throw denied();
 const windows=apply(nativeWindows,BrowserWindow,[]) as BrowserWindow[];let found=false;
 for(let i=0;i<windows.length;i++)if(windows[i]===candidate)found=true;
 if(!found)throw denied();const window=candidate as BrowserWindow;
 if(window.isDestroyed()||apply(nativeWindowId,BrowserWindow,[window.id])!==window)throw denied();
 const contents=window.webContents;if(contents.isDestroyed()||apply(nativeWindowContents,BrowserWindow,[contents])!==window||apply(nativeContentsId,webContents,[contents.id])!==contents)throw denied();
 return {window,contents,session:contents.session};
}
function current(record:LaunchRecord):void {
 if(record.poisoned)throw denied();if(record.checking){record.poisoned=true;throw denied();}record.checking=true;
 try{
  const binding=readKSwarmWriterControlBootstrap(record.source,record.service),actualScope=readKSwarmOwnedControlServiceScope(record.service,record.source.admission);
  sameScope(record.scope!,scopeData(binding.scope));sameScope(record.scope!,actualScope);
  const actual=nativeWindow(binding.window);if(actual.session!==record.birth!.session)throw denied();
  sameScope(record.scope!,readKSwarmOwnedControlServiceScope(record.service,record.source.admission));assertKSwarmWriterControlBootstrapLocal(record.source,record.service);if(record.poisoned)throw denied();
 }finally{record.checking=false;}
}
/** Main composition only. It authenticates a native bootstrap birth, not a user
 * request or a daemon. A new process cannot attach this grant to an old owner. */
export function createDesktopWriterControlLaunchCapsule(raw:{source:KSwarmWriterControlSource;service:KSwarmService;window:BrowserWindow}):object {
 if(minting){minting.poisoned=true;throw denied();}
 const args=fields(raw,['source','service','window']),source=args.source as KSwarmWriterControlSource,service=args.service as KSwarmService;
 if(!source||typeof source!=='object'||isProxy(source)||getSource(source))throw denied();
 const record:LaunchRecord={source,service,minting:true,checking:false,poisoned:false,used:false};minting=record;
 try{
  const birth=nativeWindow(args.window),binding=readKSwarmWriterControlBootstrap(source,service);if(binding.window!==birth.window)throw denied();
  const scope=scopeData(binding.scope);sameScope(scope,readKSwarmOwnedControlServiceScope(service,source.admission));
  const bytes=randomBytes(32),alphabet='0123456789abcdef';let nonce='';for(let i=0;i<bytes.length;i++){const byte=bytes[i]!;nonce+=alphabet[byte>>>4]!+alphabet[byte&15]!;}
  const final=nativeWindow(binding.window);if(final.contents!==birth.contents||final.session!==birth.session)throw denied();
  sameScope(scope,readKSwarmOwnedControlServiceScope(service,source.admission));assertKSwarmWriterControlBootstrapLocal(source,service);if(record.poisoned)throw denied();
  record.scope=scope;record.birth=birth;record.nonce=nonce;record.minting=false;
  const capsule=freeze(create(null));setSource(source,record);setCapsule(capsule,record);return capsule;
 }catch(error){if(record.poisoned)setSource(source,record);record.poisoned=true;throw error;}finally{minting=undefined;}
}
export interface DesktopWriterControlLaunch {readonly scope:Scope;readonly mainLaunchNonce:string;assertCurrent():void;assertLocal():void}
/** Exactly one launch attempt. The caller must still hold the actual spawned
 * ChildProcess and complete the independent inherited-IPC installation. */
export function consumeDesktopWriterControlLaunchCapsule(capsule:object,raw:{source:KSwarmWriterControlSource;service:KSwarmService;scope:Scope}):DesktopWriterControlLaunch {
 const record=getCapsule(capsule);if(!record)throw denied();if(record.checking){record.poisoned=true;throw denied();}
 const args=fields(raw,['source','service','scope']);if(args.source!==record.source||args.service!==record.service)throw denied();sameScope(record.scope!,scopeData(args.scope));
 if(record.used||record.poisoned||record.minting)throw denied();record.used=true;current(record);
 return freeze({scope:record.scope!,mainLaunchNonce:record.nonce!,assertCurrent:()=>current(record),assertLocal(){
  if(record.poisoned||record.checking||record.minting||!record.used)throw denied();assertKSwarmWriterControlBootstrapLocal(record.source,record.service);
  sameScope(record.scope!,readKSwarmOwnedControlServiceScope(record.service,record.source.admission));if(record.poisoned||record.checking)throw denied();
 }});
}
