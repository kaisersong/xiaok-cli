'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{createHook}=require('node:async_hooks');
const [repo,root,scenario]=process.argv.slice(2);
process.env.XIAOK_CONFIG_DIR=path.join(root,'config');fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const facts={pid:process.pid,scenario,productionQualified:false,phases:[],workerBirths:0,workersRemaining:0,fakeDisposeCalls:0};
const workers=new Set();let armed=false,reenter;
const hook=createHook({init(id,type){if(type==='WORKER'){workers.add(id);facts.workerBirths++;if(armed&&reenter)reenter();}},destroy(id){workers.delete(id);}});hook.enable();
let armNativeFailure=false,nativeFailure;const originalDlopen=process.dlopen;
process.dlopen=function(module,filename,...rest){const result=originalDlopen.call(this,module,filename,...rest);if(path.basename(filename)==='main_bootstrap.node'){
 const original=module.exports.assertOriginalMainIssuerCurrent;
 module.exports.assertOriginalMainIssuerCurrent=function(...args){const raw=original.apply(this,args);if(armNativeFailure){armNativeFailure=false;throw nativeFailure;}return raw;};
 }return result;};
let source,user,window,api;
async function run(){
 await app.whenReady();
 const base=pathToFileURL(path.join(repo,'desktop/dist/main/desktop/electron/'));
 const control=await import(new URL('main-dsh-control-source.js',base));api=await import(new URL('main-dsh-service-sources.js',base));
 const {resolveDesktopServiceScope}=await import(new URL('desktop-service-scope.js',base));
 const dataRoot=path.join(root,'desktop'),workspaceRoot=path.join(root,'workspace');fs.mkdirSync(workspaceRoot,{recursive:true});
 const actual=resolveDesktopServiceScope({dataRoot,workspaceRoot}),scope={profileId:actual.profileId,workspaceId:actual.workspaceId};
 const html=path.join(root,'index.html');fs.writeFileSync(html,'<!doctype html><title>Source birth</title>');
 window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadFile(html);
 user=control.createMainDshControlSource({window,scope,isTrustedUrl:url=>url===pathToFileURL(html).href});
 source=api.createOriginalMainDshServiceSources({scope,userSource:user});
 assert.equal(api.createOriginalMainDshServiceSources({scope,userSource:user}),source);
 const actor=Object.freeze({requestSource:'user',principalId:'desktop-main-window'}),options={dataRoot,workspaceRoot,harnessUserActor:actor};
 reenter=()=>{assert.throws(()=>api.prepareOriginalMainDshServiceSources(source,options),/DSH_MAIN_SERVICE_SOURCES_REQUIRED/);facts.reentrantPrepareRejected=true;};
 armed=true;const preparing=api.prepareOriginalMainDshServiceSources(source,options);
 assert.throws(()=>api.prepareOriginalMainDshServiceSources(source,options),/DSH_MAIN_SERVICE_SOURCES_REQUIRED/);facts.secondPrepareRejected=true;
 facts.phases.push('prepare_reserved');
 if(scenario==='prepare_close'){
  const closing=api.closeOriginalMainDshStartupSources(source);await preparing;await closing;
 }else{
  await preparing;facts.phases.push('prepared');
  const ready=api.readOriginalMainDshPreparedSources(source);
  ready.runtime.dispose=async()=>{facts.fakeDisposeCalls++;throw Error('mutable_public_dispose');};
  if(scenario==='unclaimed'){
   const lease=api.claimOriginalMainDshServiceSources(source,scope);
   assert.throws(()=>api.claimOriginalMainDshServiceSources(source,scope),/DSH_MAIN_SERVICE_SOURCES_REQUIRED/);
   await api.closeOriginalMainDshStartupSources(lease);
  }else{
   const {createKSwarmService}=await import(new URL('kswarm-service.js',base));
   const {createDesktopServices,readOriginalMainDshServicesBinding}=await import(new URL('desktop-services.js',base));
   const service=createKSwarmService({desktopProjectScope:scope,ownedDshAdmission:ready.businessSource.admission});
   if(scenario==='services'){
    const services=createDesktopServices({dataRoot,workspaceRoot,kswarmService:service,harnessOptimizationUserActor:actor,dshServiceSources:source,knowledgeDbPath:path.join(root,'profile','knowledge.db')});
    const binding=readOriginalMainDshServicesBinding(services,source);await binding.constructionReady;
    facts.phases.push('service_ready');assert.equal(binding.lease.runtime,ready.runtime);assert.equal(binding.lease.runtimePromise,ready.runtimePromise);
    await services.getHarnessOptimizationConfig();await services.getHarnessOptimizationConfig();assert.equal(facts.workerBirths,1);
    assert.throws(()=>api.closeOriginalMainDshStartupSources(source),/DSH_MAIN_SERVICE_SOURCES_REQUIRED/);
    const closed=await services.disposeMultiAgent();assert.equal(closed.drained,true);facts.servicesDrained=true;
   }else{
   let release;const tail=new Promise(yes=>release=yes);nativeFailure=Error('actual_native_bind_failure');
   Object.defineProperty(nativeFailure,Symbol('bind_sdk_tail'),{value:tail});armNativeFailure=true;
   let caught,present=false;
   try{createDesktopServices({dataRoot,workspaceRoot,kswarmService:service,harnessOptimizationUserActor:actor,dshServiceSources:source,knowledgeDbPath:path.join(root,'profile','knowledge.db')});}catch(raw){caught=raw;present=true;}
   assert.equal(present,true);assert.equal(caught,nativeFailure);facts.originalCausePreserved=true;
   let finished=false;const closing=api.closeOriginalMainDshStartupSources(source);closing.then(()=>finished=true,()=>finished=true);
   await new Promise(yes=>setTimeout(yes,20));assert.equal(finished,false);facts.heldNativeTailJoined=true;
   release();await assert.rejects(closing,error=>error===nativeFailure);
   }
  }
 }
 facts.phases.push('closed');
 assert.throws(()=>api.readOriginalMainDshPreparedSources(source),/DSH_MAIN_SERVICE_SOURCES_REQUIRED/);
 user.seal();await user.drain();window.destroy();
 for(let i=0;i<50&&workers.size;i++)await new Promise(yes=>setTimeout(yes,10));
 facts.workersRemaining=workers.size;assert.equal(workers.size,0);assert.equal(facts.workerBirths,1);assert.equal(facts.fakeDisposeCalls,0);
 facts.ok=true;
}
run().then(()=>{hook.disable();fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));app.exit(0);},async error=>{
 Object.assign(facts,{ok:false,error:String(error),stack:error?.stack,workersRemaining:workers.size});
 fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));console.error(error);
 try{if(source)await api.closeOriginalMainDshStartupSources(source);}catch{}
 hook.disable();app.exit(1);
});
