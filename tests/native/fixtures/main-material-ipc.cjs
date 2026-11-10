'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {syncBuiltinESMExports}=require('node:module'),{pathToFileURL}=require('node:url');
const [repo,root]=process.argv.slice(2);
process.env.XIAOK_CONFIG_DIR=path.join(root,'config');fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const facts={pid:process.pid,productionQualified:false,getterCalls:0,phases:[]};
const file=path.join(root,'input.txt');fs.writeFileSync(file,'Actual original knowledge IPC file.');
let failRead=false,releaseTail;const tail=new Promise(yes=>releaseTail=yes),nativeRead=fsp.readFile;
fsp.readFile=function(target,...args){if(path.resolve(String(target))===file&&failRead){
 const error=Error();Object.defineProperty(error,'message',{get(){facts.getterCalls++;return 'private SDK detail';}});Object.defineProperty(error,Symbol('actual_sdk_tail'),{value:tail});return Promise.reject(error);
 }return nativeRead.call(this,target,...args);};syncBuiltinESMExports();
let window,services,user,material,materialApi;
async function run(){
 await app.whenReady();const base=pathToFileURL(path.join(repo,'desktop/dist/main/desktop/electron/'));
 const {resolveDesktopServiceScope}=await import(new URL('desktop-service-scope.js',base));
 const {createMainDshControlSource}=await import(new URL('main-dsh-control-source.js',base));
 const {createDesktopServices}=await import(new URL('desktop-services.js',base));
 const {createKSwarmService}=await import(new URL('kswarm-service.js',base));
 const {registerDesktopIpc}=await import(new URL('ipc.js',base));materialApi=await import(new URL('main-material-source.js',base));
 const dataRoot=path.join(root,'desktop'),workspaceRoot=path.join(root,'workspace');fs.mkdirSync(workspaceRoot,{recursive:true});
 const actual=resolveDesktopServiceScope({dataRoot,workspaceRoot}),scope={profileId:actual.profileId,workspaceId:actual.workspaceId};
 const html=path.join(root,'index.html'),preload=path.join(root,'preload.cjs');fs.writeFileSync(html,'<!doctype html><title>Material IPC</title>');
 fs.writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('knowledge',(method,...args)=>ipcRenderer.invoke('desktop:kb:'+method,...args));\n");
 window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadFile(html);
 user=createMainDshControlSource({window,scope,isTrustedUrl:url=>url===pathToFileURL(html).href});
 const kswarm=createKSwarmService({desktopProjectScope:scope});
 services=createDesktopServices({dataRoot,workspaceRoot,kswarmService:kswarm,runner:async()=>{throw Error('fixture_runner_must_not_start');},materialUserSource:user,knowledgeDbPath:path.join(root,'profile','knowledge.db')});
 material=await materialApi.createMainMaterialSource({userSource:user,services});
 await registerDesktopIpc(ipcMain,window,services,{materialSource:material,materialUserSource:user});facts.phases.push('registered_original_handlers');
 const call=(method,...args)=>window.webContents.executeJavaScript(`window.knowledge(${JSON.stringify(method)},...${JSON.stringify(args)})`);
 const collection=await call('createCollection',{name:'Original Source',embeddingModelId:'fixture-unused',embeddingDim:3});
 const input={collectionId:collection.id,kind:'file',title:'Original file',filePath:file,mimeType:'text/plain'};
 const good=await call('addSource',input);assert.equal(good.parseStatus,'parsed');facts.parsed=true;
 facts.phases.push('parsed_original_file');failRead=true;
 let settled=false;const pending=call('addSource',{...input,title:'SDK failure'});pending.then(()=>settled=true,()=>settled=true);
 await new Promise(yes=>setTimeout(yes,20));assert.equal(settled,false);facts.waitedForTail=true;releaseTail();
 const bad=await pending;assert.equal(bad.parseStatus,'failed');assert.equal(bad.parseError,'');assert.equal(facts.getterCalls,0);facts.failed=true;
 await assert.rejects(materialApi.sealAndDrainMainMaterialSource(material));facts.sourceRemainsUnconfirmed=true;
 user.seal();await user.drain();assert.equal((await services.disposeMultiAgent()).drained,true);window.destroy();facts.ok=true;
}
run().then(()=>{fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));app.exit(0);},async error=>{
 releaseTail();Object.assign(facts,{ok:false,error:String(error),stack:error?.stack});fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));console.error(error);
 try{if(user){user.seal();await user.drain();}}catch{}try{if(services)await services.disposeMultiAgent();}catch{}app.exit(1);
});
