'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict');
const {syncBuiltinESMExports}=require('node:module'),{pathToFileURL}=require('node:url');
const [repo,root]=process.argv.slice(2);
process.env.XIAOK_CONFIG_DIR=path.join(root,'config');fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const facts={pid:process.pid,productionQualified:false,phases:[]},paths=[],sockets=new Set();let server,window,services,controller,user;
async function run(){
 await app.whenReady();
 const cert=fs.readFileSync(path.join(repo,'tests/fixtures/sol-pi-tls/cert.pem')),key=fs.readFileSync(path.join(repo,'tests/fixtures/sol-pi-tls/key.pem'));
 server=https.createServer({cert,key},(request,response)=>{paths.push(request.url);response.setHeader('Content-Type','application/json');
  if(request.url==='/user')response.end(JSON.stringify({id:12,node_id:'U_12',login:'person'}));
  else if(request.url==='/repos/octo/demo')response.end(JSON.stringify({id:123,node_id:'R_123',name:'demo',owner:{id:13,login:'octo'}}));
  else {response.statusCode=404;response.end('{}');}
 });server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});await new Promise(yes=>server.listen(0,'127.0.0.1',yes));
 const origin=`https://127.0.0.1:${server.address().port}`,nativeRequest=https.request;
 https.request=function(url,options,callback){assert.equal(url.origin,'https://api.github.com');return nativeRequest.call(https,new URL(url.pathname+url.search,origin),{...options,ca:cert},callback);};syncBuiltinESMExports();
 const base=pathToFileURL(path.join(repo,'desktop/dist/main/desktop/electron/'));
 const sources=await import(new URL('main-dsh-service-sources.js',base)),controls=await import(new URL('main-dsh-control-source.js',base));
 const {resolveDesktopServiceScope}=await import(new URL('desktop-service-scope.js',base));
 const {createDesktopServices,readOriginalMainDshServicesBinding}=await import(new URL('desktop-services.js',base));
 const {createKSwarmService}=await import(new URL('kswarm-service.js',base));
 const {createDshDesktopController}=await import(new URL('dsh-desktop-controller.js',base)),{registerDshSettingsIpc}=await import(new URL('dsh-settings-typed-ipc.js',base));
 const {readOriginalDshDesktopState}=await import(new URL('desktop-multi-agent-store.js',base));
 const dataRoot=path.join(root,'desktop'),workspaceRoot=path.join(root,'workspace');fs.mkdirSync(workspaceRoot,{recursive:true});
 const resolved=resolveDesktopServiceScope({dataRoot,workspaceRoot}),scope={profileId:resolved.profileId,workspaceId:resolved.workspaceId};
 const html=path.join(root,'index.html'),preload=path.join(root,'preload.cjs');fs.writeFileSync(html,'<!doctype html><title>Original controller</title>');
 fs.writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('dsh',(method,input)=>input===undefined?ipcRenderer.invoke('desktop:dsh:'+method):ipcRenderer.invoke('desktop:dsh:'+method,input));\n");
 window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadFile(html);
 user=controls.createMainDshControlSource({window,scope,isTrustedUrl:url=>url===pathToFileURL(html).href});
 const capsule=sources.createOriginalMainDshServiceSources({scope,userSource:user}),actor=Object.freeze({requestSource:'user',principalId:'desktop-main-window'});
 await sources.prepareOriginalMainDshServiceSources(capsule,{dataRoot,workspaceRoot,harnessUserActor:actor});
 const prepared=sources.readOriginalMainDshPreparedSources(capsule);
 const kswarm=createKSwarmService({desktopProjectScope:scope,ownedDshAdmission:prepared.businessSource.admission});
 services=createDesktopServices({dataRoot,workspaceRoot,kswarmService:kswarm,harnessOptimizationUserActor:actor,dshServiceSources:capsule,knowledgeDbPath:path.join(root,'profile','knowledge.db')});
 const binding=readOriginalMainDshServicesBinding(services,capsule);await binding.constructionReady;
 controller=createDshDesktopController({scope,realm:prepared.realm,store:binding.store,userSource:user,runtime:prepared.runtime,sourcePopulation:prepared.sourcePopulation,budgetSource:prepared.budgetSource});
 const originalDisconnect=controller.disconnect;
 registerDshSettingsIpc(ipcMain,{...controller,async disconnect(...args){try{return await originalDisconnect(...args);}catch(error){
  const codes=[];let value=error;for(let i=0;i<8&&value&&typeof value==='object';i++){const message=Object.getOwnPropertyDescriptor(value,'message'),cause=Object.getOwnPropertyDescriptor(value,'cause');codes.push(message&&Object.hasOwn(message,'value')&&typeof message.value==='string'?message.value:'unconfirmed');value=cause&&Object.hasOwn(cause,'value')?cause.value:undefined;}
  facts.disconnectFailureCodes=codes;throw error;
 }}},user);
 const call=(method,input)=>window.webContents.executeJavaScript(`window.dsh(${JSON.stringify(method)},${JSON.stringify(input)})`);
 const state=await call('getState');assert.equal(state.domain,null);
 await assert.rejects(call('configureSetup',{schemaVersion:1,setupId:'missing-tenant',candidateRepository:{owner:'octo',repo:'demo'},selection:{kind:'label_ids',match:'all',labelIds:['7']},issueRefs:[],minimumIntervalMs:1000,expectedRevision:0}));assert.equal(paths.length,0);
 await call('configureBudget',{schemaVersion:1,tenantId:'tenant-a',mandateId:'native-budget',mandateRevision:1,tokenLimit:1000,costLimitUsd:'1.000001',validUntil:'2027-01-01T00:00:00Z'});
 await call('setMode',{schemaVersion:1,scopeKind:'global',sourceBindingId:null,mode:'observe',expectedRevision:0});
 let current;
 for(const tenantId of ['tenant-a','tenant-b']){
  for(const scopeKind of ['tenant','workspace'])await call('setMode',{schemaVersion:1,scopeKind,tenantId,sourceBindingId:null,mode:'observe',expectedRevision:0});
  await call('configureSetup',{schemaVersion:1,tenantId,setupId:'setup-'+tenantId,candidateRepository:{owner:'octo',repo:'demo'},selection:{kind:'label_ids',match:'all',labelIds:['7']},issueRefs:[],minimumIntervalMs:1000,expectedRevision:0});
  current=await call('connect',{schemaVersion:1,kind:'setup',setupId:'setup-'+tenantId,configurationRevision:1,operationId:'connect-'+tenantId,secret:'isolated-controller-token'});
 }
 assert.equal(current.sources.length,2);assert.equal(current.sources.filter(row=>row.connection==='connected').length,2);assert.equal(paths.length,4);facts.phases.push('two_tenants_connected');
 const raw=()=>readOriginalDshDesktopState(prepared.realm,binding.store,prepared.realm,scope);
 const account=raw().sourceSetups.find(row=>row.configuration.setupId==='setup-tenant-a').configuration.accountId;
 await call('configureSetup',{schemaVersion:1,tenantId:'tenant-a',setupId:'setup-tenant-a',candidateRepository:{owner:'octo',repo:'demo'},selection:{kind:'label_ids',match:'all',labelIds:['7']},issueRefs:[],minimumIntervalMs:2000,expectedRevision:1});
 assert.equal(raw().sourceSetups.find(row=>row.configuration.setupId==='setup-tenant-a').configuration.accountId,account);facts.existingAccountPreserved=true;
 current=await call('setMode',{schemaVersion:1,scopeKind:'tenant',tenantId:'tenant-a',sourceBindingId:null,mode:'off',expectedRevision:1});
 assert.equal(current.sources.find(row=>row.tenantId==='tenant-a').mode,'off');assert.equal(current.sources.find(row=>row.tenantId==='tenant-b').mode,'observe');facts.crossTenantModeIsolated=true;
 const a=current.sources.find(row=>row.tenantId==='tenant-a');current=await call('disconnect',{schemaVersion:1,sourceBindingId:a.sourceBindingId,configurationRevision:a.configurationRevision});
 assert.equal(current.sources.find(row=>row.tenantId==='tenant-a').connection,'credential_required');assert.equal(paths.length,4);
 assert.equal(JSON.stringify(current).includes('isolated-controller-token'),false);
 controller.ingress.stopAccepting();controller.ingress.abortAllActive('fixture_shutdown');assert.equal(await controller.ingress.drain(2000),true);await controller.close();
 facts.servicesDrained=(await services.disposeMultiAgent()).drained;assert.equal(facts.servicesDrained,true);user.seal();await user.drain();window.destroy();
 for(const socket of sockets)socket.destroy();await new Promise(yes=>server.close(yes));facts.requests=paths.length;facts.ok=true;
}
run().then(()=>{fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));app.exit(0);},async error=>{
 Object.assign(facts,{ok:false,error:String(error),stack:error?.stack,requests:paths.length});fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));console.error(error);
 try{if(controller){controller.ingress.stopAccepting();controller.ingress.abortAllActive('failed_fixture');await controller.close();}}catch{}
 try{if(services)await services.disposeMultiAgent();}catch{}
 for(const socket of sockets)socket.destroy();if(server)server.close();app.exit(1);
});
