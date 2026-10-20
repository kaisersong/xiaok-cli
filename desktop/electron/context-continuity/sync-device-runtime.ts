import {app} from 'electron';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {types} from 'node:util';

type Data=Record<string,unknown>;
export interface DesktopSyncDeviceOptions {
 dataRoot:string;identity:Data;deviceId:string;logicalProfileId:string;baseUrl:string;ca?:string;
}
type OriginalOwner={kind:string;sync:Function;assertControlCurrent:Function;sealOutgoing:Function;pushOutgoing:Function;publishCanonicalSource:Function;captureCanonicalScopes:Function;getCanonicalStoreAnchor:Function;recordCanonicalStoreAnchor:Function;recordCanonicalStorePolicy:Function;captureCanonicalSourceControls:Function;recordCanonicalSourceStoreAnchor:Function;close:Function};
export interface DesktopSyncDevice {
 readonly kind:'desktop-sync-device';
 sync(scope:Data,options:Data):Promise<unknown>;
 assertControlCurrent(receipt:unknown):void;
 sealOutgoing(scope:Data,request:Data,options:Data):Promise<unknown>;
 pushOutgoing(scope:Data,request:Data,options:Data):Promise<unknown>;
 publishCanonicalSource(services:object,proof:object,options:Data):Promise<unknown>;
 captureCanonicalScopes(scopes:Data[],options:Data):Promise<unknown>;
 captureCanonicalSourceControls(scopes:Data[],options:Data):Promise<unknown>;
 recordCanonicalSourceStoreAnchor(control:unknown,request:Data):unknown;
 getCanonicalStoreAnchor(binding:Data):unknown;
 recordCanonicalStoreAnchor(incoming:unknown,request:Data):unknown;
 recordCanonicalStorePolicy(request:Data):unknown;
 close():Promise<void>;
}
type SourceIdentityData=Readonly<{identityHash:string;rootKeyId:string;syncGroupId:string;deviceId:string;logicalProfileId:string}>;
type State={key:string;phase:'opening'|'live'|'closing'|'unknown'|'closed';owner?:OriginalOwner;close?:Promise<void>;sourceIdentity?:SourceIdentityData;sourceControls?:(owner:OriginalOwner,receipt:unknown)=>unknown;incoming?:(owner:OriginalOwner,receipt:unknown)=>unknown;anchor?:(owner:OriginalOwner,receipt:unknown)=>unknown};
// Strong retention is intentional: unknown physical closure must not let GC
// finalize the original journal/namespace and admit a replacement owner.
const reservations=new Map<string,State>(),bindings=new WeakMap<DesktopSyncDevice,State>();
const unavailable=()=>new Error('desktop_sync_device_unavailable');
const startupQualified=process.platform==='darwin'&&process.arch==='arm64'&&process.type==='browser'&&process.versions.electron==='39.8.10'&&process.versions.node==='22.22.1'&&process.env.ELECTRON_RUN_AS_NODE!=='1';
const originalGetAppPath=startupQualified?app.getAppPath:undefined;
const originalAppRoot=originalGetAppPath?Reflect.apply(originalGetAppPath,app,[]):undefined;
const originalPackaged=startupQualified?app.isPackaged:undefined,originalResources=startupQualified?process.resourcesPath:undefined;
let applicationRootUnavailable=false;
function assertOriginalAppRoot(){
 if(applicationRootUnavailable||!originalGetAppPath||Reflect.apply(originalGetAppPath,app,[])!==originalAppRoot||app.isPackaged!==originalPackaged||process.resourcesPath!==originalResources){applicationRootUnavailable=true;throw unavailable();}
}
function qualifiedRuntime(){
 if(process.platform!=='darwin'||process.arch!=='arm64'||process.type!=='browser'||process.versions.electron!=='39.8.10'||process.versions.node!=='22.22.1'||process.env.ELECTRON_RUN_AS_NODE==='1')throw new Error('desktop_sync_runtime_unqualified');
}
function copyData(value:unknown,depth=0):unknown {
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(!value||typeof value!=='object'||types.isProxy(value)||depth>12||Object.getOwnPropertySymbols(value).length)throw unavailable();
 if(Array.isArray(value)){
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(value.length>100||Object.keys(descriptors).length!==value.length+1)throw unavailable();
  const items=[];
  for(let i=0;i<value.length;i++){const descriptor=descriptors[String(i)];if(!descriptor?.enumerable||!('value'in descriptor))throw unavailable();items.push(copyData(descriptor.value,depth+1));}
  return Object.freeze(items);
 }
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw unavailable();
 const result:Data=Object.create(null);
 for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(value))){
  if(!descriptor.enumerable||!('value'in descriptor)||key==='then')throw unavailable();
  result[key]=copyData(descriptor.value,depth+1);
 }
 return Object.freeze(result);
}
function name(value:unknown):string {if(typeof value!=='string'||value.length<1||value.length>256)throw unavailable();return value;}
/** Path derivation only. This never creates credentials or repairs an identity. */
export function desktopSyncDevicePaths(dataRoot:string,identity:{rootKeyId:unknown;syncGroupId:unknown;deviceId:unknown}){
 if(typeof dataRoot!=='string'||!path.isAbsolute(dataRoot))throw unavailable();
 const digest=createHash('sha256').update(JSON.stringify([name(identity.rootKeyId),name(identity.syncGroupId),name(identity.deviceId)])).digest('hex');
 const root=path.join(dataRoot,'context-continuity','sync-devices',digest);
 return Object.freeze({stateDir:path.join(root,'state'),witnessDir:path.join(root,'witness')});
}
function checkedTree(root:string){
 if(realpathSync(root)!==root)throw unavailable();
 let count=0;
 function visit(file:string){
  const stat=lstatSync(file);if(stat.isSymbolicLink()||++count>3000)throw unavailable();
  if(stat.isDirectory()){for(const child of readdirSync(file)){if(child==='node_modules')throw unavailable();visit(path.join(file,child));}}
  else if(!stat.isFile())throw unavailable();
 }
 visit(root);
}
function fixedServices(){
 assertOriginalAppRoot();
 const root=originalPackaged?path.join(originalResources!,'services'):path.resolve(originalAppRoot!,'..','services');
 if(realpathSync(root)!==root)throw unavailable();
 const sync=path.join(root,'continuity-sync'),device=path.join(root,'continuity-device');
 const packages=[
  [sync,'@xiaok/continuity-sync','0.1.0'],[device,'@xiaok/continuity-device','0.1.0'],
  [path.join(sync,'node_modules/libsodium-wrappers'),'libsodium-wrappers','0.8.4'],
  [path.join(sync,'node_modules/libsodium'),'libsodium','0.8.4'],
  [path.join(device,'node_modules/@napi-rs/keyring'),'@napi-rs/keyring','2.1.1'],
  [path.join(device,'node_modules/@napi-rs/keyring-darwin-arm64'),'@napi-rs/keyring-darwin-arm64','2.1.1'],
 ];
 for(const [directory,pkg,version]of packages){
  if(realpathSync(directory)!==directory)throw unavailable();
  const metadata=JSON.parse(readFileSync(path.join(directory,'package.json'),'utf8'));
  if(metadata.name!==pkg||metadata.version!==version)throw unavailable();
  if(pkg==='libsodium'&&metadata.exports?.['.']?.import!=='./dist/modules-esm/libsodium.mjs')throw unavailable();
  if(pkg==='libsodium-wrappers'&&metadata.exports?.['.']?.import?.default!=='./dist/modules-esm/libsodium-wrappers.mjs')throw unavailable();
  // Source and private dependency trees are small; reject symlinks and hidden
  // nested node_modules before Node can resolve an ancestor/global fallback.
  checkedTree(directory===sync||directory===device?path.join(directory,'src'):directory);
 }
 for(const directory of [sync,device])for(const segment of ['package.json','node_modules',...(directory===device?['node_modules/@napi-rs']:[])]){
  const file=path.join(directory,segment);if(lstatSync(file).isSymbolicLink()||realpathSync(file)!==file)throw unavailable();
 }
 const entry=path.join(sync,'src/device-owner.mjs'),backend=path.join(device,'src/os-backend.mjs');
 function resolution(from:string,specifier:string,expected:string){if(createRequire(pathToFileURL(from)).resolve(specifier)!==expected)throw unavailable();}
 resolution(entry,'libsodium-wrappers',path.join(sync,'node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js'));
 resolution(path.join(sync,'node_modules/libsodium-wrappers/dist/modules-esm/libsodium-wrappers.mjs'),'libsodium',path.join(sync,'node_modules/libsodium/dist/modules/libsodium.js'));
 resolution(backend,'@napi-rs/keyring-darwin-arm64',path.join(device,'node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node'));
 resolution(backend,'@napi-rs/keyring-darwin-arm64/package.json',path.join(device,'node_modules/@napi-rs/keyring-darwin-arm64/package.json'));
 return entry;
}
function live(state:State){if(state.phase!=='live'||reservations.get(state.key)!==state||!state.owner)throw unavailable();}
function synchronous(value:unknown){if(value!==undefined){if(value instanceof Promise)void value.catch(()=>{});throw unavailable();}}
export function assertDesktopSyncDevice(device:DesktopSyncDevice):void{const state=bindings.get(device);if(!state)throw unavailable();live(state);}
/** Fixed main friend only. Never reveals or substitutes the original owner. */
export function assertOriginalDesktopSyncRawOwner(device:DesktopSyncDevice,owner:object):void{
 const state=bindings.get(device);if(!state)throw unavailable();live(state);
 if(state.owner!==owner)throw unavailable();live(state);
}
/** Fixed tuple DATA only. Fresh signed writer/control/OS proofs are still required. */
export function desktopCanonicalSourceIdentityData(device:DesktopSyncDevice):SourceIdentityData{
 const state=bindings.get(device);if(!state)throw unavailable();live(state);if(!state.sourceIdentity)throw unavailable();return state.sourceIdentity;
}
export function assertDesktopSyncIncoming(device:DesktopSyncDevice,receipt:unknown):void {
 const state=bindings.get(device);if(!state)throw unavailable();live(state);
 synchronous(state.incoming!(state.owner!,receipt));live(state);
}
/** Original full writer/control FACT only; never source/COMMIT authority. */
export function assertDesktopSyncSourceControls(device:DesktopSyncDevice,receipt:unknown):void{
 const state=bindings.get(device);if(!state)throw unavailable();live(state);synchronous(state.sourceControls!(state.owner!,receipt));live(state);
}
/** Current OS anchor fact only. A separate original canonical COMMIT capability
 * is still required for every readable publication; this is never sufficient. */
export function assertDesktopSyncStoreAnchor(device:DesktopSyncDevice,receipt:unknown):void {
 const state=bindings.get(device);if(!state)throw unavailable();live(state);
 synchronous(state.anchor!(state.owner!,receipt));live(state);
}

/** Main-only, existing OS credentials only. No test mode, caller module path,
 * native provider, canonical publication, or execution authority is accepted. */
export async function openDesktopSyncDevice(input:DesktopSyncDeviceOptions):Promise<DesktopSyncDevice>{
 qualifiedRuntime();
 const options=copyData(input)as unknown as DesktopSyncDeviceOptions;
 const allowed=['dataRoot','identity','deviceId','logicalProfileId','baseUrl','ca'];
 if(Object.keys(options).some(key=>!allowed.includes(key))||!options.identity)throw unavailable();
 for(const value of [options.deviceId,options.logicalProfileId,options.baseUrl])name(value);
 if(options.ca!==undefined&&typeof options.ca!=='string')throw unavailable();
 const paths=desktopSyncDevicePaths(options.dataRoot,{...options.identity,deviceId:options.deviceId}as {rootKeyId:unknown;syncGroupId:unknown;deviceId:unknown});
 const key=JSON.stringify([options.identity.rootKeyId,options.identity.syncGroupId,options.deviceId]);
 if(reservations.has(key))throw new Error('desktop_sync_device_busy');
 const state:State={key,phase:'opening'};reservations.set(key,state);
 let originalClose:Function|undefined;
 const close=():Promise<void>=>{
  if(state.close)return state.close;
  let resolve!:()=>void,reject!:(reason:unknown)=>void;
  state.close=new Promise<void>((a,b)=>{resolve=a;reject=b;});state.phase='closing';
  try{
   const operation=Reflect.apply(originalClose!,state.owner,[]);
   if(!(operation instanceof Promise))throw unavailable();
   void operation.then((result:unknown)=>{
    try{synchronous(result);state.phase='closed';reservations.delete(key);state.owner=undefined;resolve();}
    catch(error){state.phase='unknown';reject(error);}
   },(error:unknown)=>{state.phase='unknown';reject(error);});
  }catch(error){state.phase='unknown';reject(error);}
  return state.close;
 };
 try{
  const entry=fixedServices();
  const module=await import(pathToFileURL(entry).href);
  if(typeof module.openExistingDeviceOwner!=='function'||typeof module.assertOriginalIncoming!=='function'||typeof module.assertOriginalStoreAnchor!=='function'||typeof module.assertOriginalSourceControls!=='function'||typeof module.assertOriginalCanonicalMainFriendReady!=='function')throw unavailable();
  const {dataRoot:_,...ownerOptions}=options;
  state.owner=module.openExistingDeviceOwner({...ownerOptions,...paths})as OriginalOwner;
  // Capture once from the genuine instance; public prototype replacement later
  // cannot change the original incoming receipt assertion or these operations.
  originalClose=state.owner.close;state.incoming=module.assertOriginalIncoming;state.anchor=module.assertOriginalStoreAnchor;state.sourceControls=module.assertOriginalSourceControls;
  if(state.owner.kind!=='os-device-owner'||typeof originalClose!=='function')throw unavailable();
  await module.assertOriginalCanonicalMainFriendReady(state.owner);assertOriginalAppRoot();
  const normalized=JSON.stringify(options.identity,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  state.sourceIdentity=Object.freeze({identityHash:createHash('sha256').update(normalized).digest('hex'),rootKeyId:name(options.identity.rootKeyId),syncGroupId:name(options.identity.syncGroupId),deviceId:options.deviceId,logicalProfileId:options.logicalProfileId});
  const operations=Object.fromEntries(['sync','assertControlCurrent','sealOutgoing','pushOutgoing','publishCanonicalSource','captureCanonicalScopes','captureCanonicalSourceControls','recordCanonicalSourceStoreAnchor','getCanonicalStoreAnchor','recordCanonicalStoreAnchor','recordCanonicalStorePolicy'].map(method=>{
   const operation=state.owner![method as keyof OriginalOwner];if(typeof operation!=='function')throw unavailable();return [method,operation];
  }));
  const run=async(method:string,args:unknown[])=>{live(state);const result=await Reflect.apply(operations[method],state.owner,args);live(state);return result;};
  const device:DesktopSyncDevice=Object.freeze({kind:'desktop-sync-device' as const,
   sync:(scope:Data,request:Data)=>run('sync',[scope,request]),
   assertControlCurrent:(receipt:unknown)=>{live(state);synchronous(Reflect.apply(operations.assertControlCurrent,state.owner,[receipt]));live(state);},
   sealOutgoing:(scope:Data,request:Data,source:Data)=>run('sealOutgoing',[scope,request,source]),
   pushOutgoing:(scope:Data,request:Data,source:Data)=>run('pushOutgoing',[scope,request,source]),
   publishCanonicalSource:(services:object,proof:object,source:Data)=>run('publishCanonicalSource',[device,services,proof,source]),
   captureCanonicalScopes:async(scopes:Data[],request:Data)=>{const result=await run('captureCanonicalScopes',[scopes,request]);assertDesktopSyncIncoming(device,result);return result;},
   captureCanonicalSourceControls:async(scopes:Data[],request:Data)=>{const result=await run('captureCanonicalSourceControls',[scopes,request]);assertDesktopSyncSourceControls(device,result);return result;},
   recordCanonicalSourceStoreAnchor:(control:unknown,request:Data)=>{assertDesktopSyncSourceControls(device,control);const result=Reflect.apply(operations.recordCanonicalSourceStoreAnchor,state.owner,[control,request]);assertDesktopSyncStoreAnchor(device,result);return result;},
   getCanonicalStoreAnchor:(binding:Data)=>{live(state);const result=Reflect.apply(operations.getCanonicalStoreAnchor,state.owner,[binding]);assertDesktopSyncStoreAnchor(device,result);return result;},
   recordCanonicalStoreAnchor:(incoming:unknown,request:Data)=>{assertDesktopSyncIncoming(device,incoming);const result=Reflect.apply(operations.recordCanonicalStoreAnchor,state.owner,[incoming,request]);assertDesktopSyncStoreAnchor(device,result);return result;},
   recordCanonicalStorePolicy:(request:Data)=>{live(state);const result=Reflect.apply(operations.recordCanonicalStorePolicy,state.owner,[request]);assertDesktopSyncStoreAnchor(device,result);return result;},
   close,
  });
  bindings.set(device,state);state.phase='live';return device;
 }catch(error){
  if(state.owner){try{await close();}catch{/* strong reservation retained until physical main exit */}}
  else{state.phase='closed';reservations.delete(key);}
  throw error;
 }
}
