import {app,BrowserWindow,ipcMain} from 'electron';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=process.env.XIAOK_DSH_USER_NATIVE_ROOT,compiled=process.env.XIAOK_DSH_USER_NATIVE_COMPILED;
if(!root||!compiled)throw Error('isolated_fixture_paths_required');
process.env.XIAOK_CONFIG_DIR=join(root,'config');mkdirSync(process.env.XIAOK_CONFIG_DIR,{mode:0o700});
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const {createMainDshControlSource,readOriginalMainDshControl}=await import(pathToFileURL(join(compiled,'main-dsh-control-source.js')).href);
 const {DesktopMultiAgentStore}=await import(pathToFileURL(join(compiled,'desktop-multi-agent-store.js')).href);
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},html=join(root,'index.html'),preload=join(root,'preload.cjs');
 writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('control',purpose=>ipcRenderer.invoke('fixture:dsh-control',purpose));\n");
 writeFileSync(html,'<!doctype html><html><body><button id="control">Control</button><output id="result"></output><script>document.querySelector("button").onclick=async()=>{try{document.querySelector("output").textContent=JSON.stringify(await window.control("mandate_control"));}catch(e){document.querySelector("output").textContent=JSON.stringify({error:String(e)});}}</script></body></html>');
 const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const baseline={navigation:window.webContents.listenerCount('did-start-navigation'),destroyed:window.webContents.listenerCount('destroyed'),closed:window.listenerCount('closed')};
 const source=createMainDshControlSource({window,scope,isTrustedUrl:url=>url.startsWith('file:')&&fileURLToPath(url)===html});
 const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:source});source.bindStore(store);const frames=[];let calls=0;
 ipcMain.handle('fixture:dsh-control',(event,purpose)=>{
  const body={schemaVersion:1,expectedHeadRevision:0,request:'explicit-native-user'},frame=source.open(event,purpose,body,'user');frames.push(frame);calls++;
  const view=readOriginalMainDshControl(source,frame.proof,store,purpose,frame.bodyHash);view.assertCurrent();view.assertLocal();assert.deepEqual(source.resolve(frame.proof,purpose).data,Object.assign(Object.create(null),body));
  return {calls,bodyHash:view.bodyHash,purpose:view.purpose,principalId:view.principalId,nativeSender:event.sender===window.webContents,nativeMainFrame:event.senderFrame===window.webContents.mainFrame,originalStoreBinding:true,noAuthorityEpoch:!('authorityEpoch' in view)};
 });
 globalThis.dshUserNative={ready:false,async navigate(){const old=frames.at(-1);assert.ok(old);await window.loadFile(html);assert.throws(()=>old.assertCurrent());return {revoked:old.signal.aborted};},async probe(){
  const old=frames.at(-1);assert.ok(old);const original=window.isDestroyed,own=Object.getOwnPropertyDescriptor(window,'isDestroyed');let nativeCalls=0,releaseFirst,releaseLast,done=false;
  const first=new Promise(yes=>{releaseFirst=yes;}),last=new Promise(yes=>{releaseLast=yes;}),raw=Error('actual-native-sdk-wrapper');Object.defineProperty(raw,'stack',{value:first});Object.defineProperty(raw,Symbol('sibling'),{value:last});
  Object.defineProperty(window,'isDestroyed',{configurable:true,writable:true,value:function(...args){const result=Reflect.apply(original,this,args);assert.equal(result,false);nativeCalls++;throw raw;}});
  let draining;
  try{assert.throws(()=>readOriginalMainDshControl(source,old.proof,store,'mandate_control',old.bodyHash),error=>error===raw);assert.equal(old.signal.aborted,true);
   if(own)Object.defineProperty(window,'isDestroyed',own);else delete window.isDestroyed;
   draining=source.drain().then(()=>{done=true;},()=>{done=true;});await new Promise(yes=>setImmediate(yes));assert.equal(done,false);releaseFirst();await new Promise(yes=>setImmediate(yes));assert.equal(done,false);releaseLast();await draining;
   return {nativeCalls,rawIdentity:true,signalRevoked:true,heldUntilBothSettled:true,notNativeNQualification:true};
  }finally{if(own)Object.defineProperty(window,'isDestroyed',own);else delete window.isDestroyed;releaseFirst();releaseLast();if(draining)await draining;}
 },async close(){try{await source.drain();}catch{}store.close();ipcMain.removeHandler('fixture:dsh-control');for(const frame of frames)assert.throws(()=>frame.assertCurrent());const result={allRevoked:frames.every(f=>f.signal.aborted),baseline,after:{navigation:window.webContents.listenerCount('did-start-navigation'),destroyed:window.webContents.listenerCount('destroyed'),closed:window.listenerCount('closed')},notFullProductMain:true};window.destroy();return result;}};
 await window.loadFile(html);globalThis.dshUserNative.ready=true;
}).catch(error=>{globalThis.dshUserNative={ready:true,error:String(error),stack:error.stack};console.error(error);});
