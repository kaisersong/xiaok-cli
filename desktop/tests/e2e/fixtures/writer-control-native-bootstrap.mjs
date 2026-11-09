import {app,BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join,basename,isAbsolute} from 'node:path';
import {lstatSync,realpathSync,writeFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
const compiled=resolve(dirname(fileURLToPath(import.meta.url)),'../../../dist/main/desktop/electron');
const resultTarget=process.env.XIAOK_WRITER_BOOTSTRAP_RESULT_FILE;
if(typeof resultTarget!=='string'||!isAbsolute(resultTarget)||basename(resultTarget)!=='bootstrap-result.json')throw Error('native_bootstrap_result_target_required');
const resultRoot=dirname(resultTarget),rootStat=lstatSync(resultRoot),canonicalRoot=realpathSync(resultRoot);
if(rootStat.isSymbolicLink()||!rootStat.isDirectory()||typeof process.getuid==='function'&&rootStat.uid!==process.getuid()||dirname(canonicalRoot)!==realpathSync(tmpdir())||!/^xiaok-artifact-runtime-e2e-[A-Za-z0-9]{6}$/.test(basename(canonicalRoot)))throw Error('native_bootstrap_result_target_invalid');
const finalResult=join(canonicalRoot,'bootstrap-result.json');let publicationAttempted=false;
function publishResult(result){if(publicationAttempted)throw Error('native_bootstrap_duplicate_publication');publicationAttempted=true;const pending=finalResult+'.pending';writeFileSync(pending,JSON.stringify(result),{flag:'wx',mode:0o600});renameSync(pending,finalResult);}
app.on('window-all-closed',()=>{});
globalThis.writerControlBootstrapResult={ready:false};
app.whenReady().then(async()=>{
 const {createDesktopWriterControlLaunchCapsule:mint,consumeDesktopWriterControlLaunchCapsule:consume}=await import(compiled+'/kswarm-writer-control-native-bootstrap.js');
 const {createKSwarmWriterControlSource}=await import(compiled+'/kswarm-writer-control-source.js');
 const {createKSwarmService,sealAndDrainKSwarmServiceInstance}=await import(compiled+'/kswarm-service.js');
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},services=[],sources=[],windows=[];const cases={};let getterCalls=0,result,bodyError;
 const makeWindow=()=>{const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.push(window);return window;};
 const makeService=admission=>{const service=createKSwarmService({activityOwnerPending:true,desktopProjectScope:scope,ownedControlAdmission:admission});services.push(service);return service;};
 const sourceFor=(getWindow,getScope=()=>scope)=>{const source=createKSwarmWriterControlSource({getWindow,getScope,isTrustedUrl:()=>true});sources.push(source);return source;};
 try{
  const first=makeWindow(),second=makeWindow();let current=first;const source=sourceFor(()=>current),service=makeService(source.admission),other=makeService(()=>{});source.bindService(service);
  const badFirst=sourceFor(()=>first),badFirstService=makeService(badFirst.admission);badFirst.bindService(badFirstService);assert.throws(()=>mint({source:badFirst,service:other,window:first}));assert.ok(mint({source:badFirst,service:badFirstService,window:first}));cases.wrongMintDoesNotReserve=true;
  const capsule=mint({source,service,window:first});assert.deepEqual(Reflect.ownKeys(capsule),[]);cases.nativeMintOpaque=true;const foreignSource=sourceFor(()=>first);foreignSource.bindService(service);assert.throws(()=>mint({source:foreignSource,service,window:first}));cases.foreignOriginalAdmissionDenied=true;
  assert.throws(()=>consume({...capsule},{source,service,scope}));cases.copiedCapsuleDenied=true;
  assert.throws(()=>consume(capsule,{source,service:other,scope}));cases.wrongServiceDenied=true;
  assert.throws(()=>consume(capsule,{source,service,scope:{...scope,workspaceId:'c'.repeat(64)}}));cases.wrongScopeDenied=true;
  assert.throws(()=>mint({source,service,window:first}));cases.duplicateMintDenied=true;
  const fake={get id(){getterCalls++;throw Error('fake id');},get webContents(){getterCalls++;throw Error('fake webContents');}};
  assert.throws(()=>mint({source:{...source},service,window:first}));cases.copiedSourceDenied=true;
  assert.throws(()=>mint({source,service,window:fake}));assert.equal(getterCalls,0);cases.fakeWindowNoGetters=true;
  const proxy=new Proxy(first,{get(){getterCalls++;throw Error('proxy');},getPrototypeOf(){getterCalls++;throw Error('proxy');}});assert.throws(()=>mint({source,service,window:proxy}));assert.equal(getterCalls,0);cases.proxyWindowNoTraps=true;
  const wrongWindowSource=sourceFor(()=>first),wrongWindowService=makeService(wrongWindowSource.admission);wrongWindowSource.bindService(wrongWindowService);assert.throws(()=>mint({source:wrongWindowSource,service:wrongWindowService,window:second}));cases.foreignNativeWindowDenied=true;
  const fakeServiceSource=sourceFor(()=>first),fakeService={};fakeServiceSource.bindService(fakeService);assert.throws(()=>mint({source:fakeServiceSource,service:fakeService,window:first}));cases.fakeServiceDenied=true;
  const unbound=sourceFor(()=>first),unboundService=makeService(unbound.admission);assert.throws(()=>mint({source:unbound,service:unboundService,window:first}));unbound.bindService(unboundService);assert.ok(mint({source:unbound,service:unboundService,window:first}));cases.unboundSourceDenied=true;
  const original=consume(capsule,{source,service,scope});original.assertCurrent();assert.match(original.mainLaunchNonce,/^[a-f0-9]{64}$/);assert.deepEqual(original.scope,scope);cases.originalConsume=true;
  assert.equal(typeof original.assertLocal,'function');const nativeDestroyed=first.isDestroyed;let localSdkCalls=0;first.isDestroyed=function(){localSdkCalls++;throw Error('pure launch fence called Native SDK');};try{original.assertLocal();}finally{first.isDestroyed=nativeDestroyed;}assert.equal(localSdkCalls,0);cases.originalPureLocalFence=true;
  assert.throws(()=>consume(capsule,{source,service,scope}));cases.consumeOnce=true;
  current=null;assert.throws(()=>original.assertCurrent());current=second;first.destroy();original.assertCurrent();cases.originalSessionReplacement=true;
  source.seal();assert.throws(()=>original.assertCurrent());cases.sourceSealRevokes=true;
  let closingService;let closeArmed=false,closingWork;const isDestroyed=second.isDestroyed;
  const closingSource=sourceFor(()=>second,()=>{if(closeArmed){closeArmed=false;second.isDestroyed=function(){closingWork=sealAndDrainKSwarmServiceInstance(closingService);return Reflect.apply(isDestroyed,second,[]);};}return scope;});closingService=makeService(closingSource.admission);closingSource.bindService(closingService);
  const closingCapsule=mint({source:closingSource,service:closingService,window:second}),closingLaunch=consume(closingCapsule,{source:closingSource,service:closingService,scope});closeArmed=true;
  try{assert.throws(()=>closingLaunch.assertCurrent());}finally{second.isDestroyed=isDestroyed;}await closingWork;cases.nativeHookServiceCloseDenied=true;
  const nonceSource=sourceFor(()=>second),nonceService=makeService(nonceSource.admission);nonceSource.bindService(nonceService);const toString=Buffer.prototype.toString;let nonceHooks=0;
  Buffer.prototype.toString=function(encoding,...args){if(encoding==='hex'&&this.length===32){nonceHooks++;nonceSource.seal();}return Reflect.apply(toString,this,[encoding,...args]);};
  let nonceCapsule;try{nonceCapsule=mint({source:nonceSource,service:nonceService,window:second});}finally{Buffer.prototype.toString=toString;}assert.equal(nonceHooks,0);consume(nonceCapsule,{source:nonceSource,service:nonceService,scope}).assertCurrent();cases.noNonceSerializerHook=true;
  let armed=false,nested=0,reentrant,reentrantService;reentrant=sourceFor(()=>second,()=>{if(armed){armed=false;try{mint({source:reentrant,service:reentrantService,window:second});}catch{nested++;}}return scope;});reentrantService=makeService(reentrant.admission);reentrant.bindService(reentrantService);armed=true;
  assert.throws(()=>mint({source:reentrant,service:reentrantService,window:second}));assert.equal(nested,1);cases.swallowedMintReentryDenied=true;
  const missing=sourceFor(()=>second),missingService=makeService();missing.bindService(missingService);assert.throws(()=>mint({source:missing,service:missingService,window:second}));cases.missingOriginalAdmissionDenied=true;
  const wrapped=sourceFor(()=>second),wrappedService=makeService((...args)=>wrapped.admission(...args));wrapped.bindService(wrappedService);assert.throws(()=>mint({source:wrapped,service:wrappedService,window:second}));cases.wrappedOriginalAdmissionDenied=true;
  result={ready:true,cases,getterCalls,nativeAppReady:app.isReady(),processPid:process.pid,qualification:'actual Electron bootstrap component; no daemon grant or product Main positive'};
 }catch(error){bodyError=error;}
 const cleanupErrors=[];
 for(const source of sources)try{source.seal();}catch(error){cleanupErrors.push(error);}
 for(const source of sources)try{await source.drain();}catch(error){cleanupErrors.push(error);}
 for(const service of services)try{await sealAndDrainKSwarmServiceInstance(service);}catch(error){cleanupErrors.push(error);}
 for(const window of windows)try{if(!window.isDestroyed())window.destroy();}catch(error){cleanupErrors.push(error);}
 if(bodyError||cleanupErrors.length){const error=new AggregateError([...(bodyError?[bodyError]:[]),...cleanupErrors],'native_bootstrap_fixture_failed',{cause:bodyError??cleanupErrors[0]});error.bodyError=bodyError;error.cleanupErrors=cleanupErrors;throw error;}
 globalThis.writerControlBootstrapResult=result;publishResult(result);
}).catch(error=>{const result={ready:true,processPid:process.pid,error:String(error),stack:error.stack,bodyError:error.bodyError?String(error.bodyError):undefined,cleanupErrors:error.cleanupErrors?.map(value=>String(value))};globalThis.writerControlBootstrapResult=result;console.error(error);try{publishResult(result);}catch(publishError){console.error(publishError);}});
