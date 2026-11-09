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
 const {DesktopApplicationWindowOwner}=await import(pathToFileURL(join(compiled,'desktop-application-window-owner.js')).href);
 const {createMainDshControlSource,readOriginalMainDshControl}=await import(pathToFileURL(join(compiled,'main-dsh-control-source.js')).href);
 const {DesktopMultiAgentStore}=await import(pathToFileURL(join(compiled,'desktop-multi-agent-store.js')).href);
 const html=join(root,'index.html'),preload=join(root,'preload.cjs'),scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
 writeFileSync(preload,"const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('control',()=>ipcRenderer.invoke('fixture:window-control'));\n");
 writeFileSync(html,'<!doctype html><button id="control">Control</button><output id="result"></output><script>document.querySelector("button").onclick=async()=>{try{document.querySelector("output").textContent=JSON.stringify(await window.control());}catch(e){document.querySelector("output").textContent=JSON.stringify({error:String(e)});}}</script>');
 let current=null,boots=0,views=0,calls=0;const frames=[];
 async function create(){const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});current=window;await window.loadFile(html);return window;}
 const owner=new DesktopApplicationWindowOwner({current:()=>current&&!current.isDestroyed()?current:null,bootstrap:async()=>{boots++;return create();},createView:async()=>{views++;return create();}});
 await owner.open();
 const source=createMainDshControlSource({windowOwner:owner,scope,isTrustedUrl:url=>url.startsWith('file:')&&fileURLToPath(url)===html});
 const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:source});source.bindStore(store);
 ipcMain.handle('fixture:window-control',event=>{
  const frame=source.open(event,'mandate_control',{value:1},'user'),value=readOriginalMainDshControl(source,frame.proof,store,'mandate_control',frame.bodyHash);value.assertCurrent();frames.push(frame);calls++;
  return {calls,windowId:current.id,nativeSender:event.sender===current.webContents,nativeFrame:event.senderFrame===current.webContents.mainFrame,principalId:value.principalId,originalStore:true};
 });
 globalThis.dshWindowOwnerNative={ready:true,async replace(){const prior=current,old=frames.at(-1);assert.ok(old);prior.destroy();await owner.open();assert.throws(()=>old.assertCurrent());return {oldRevoked:old.signal.aborted,boots,views,windowId:current.id};},async close(){assert.equal(frames.length,2);assert.throws(()=>frames[0].assertCurrent());frames[1].assertCurrent();assert.equal(boots,1);assert.equal(views,1);await source.drain();store.close();ipcMain.removeHandler('fixture:window-control');const result={boots,views,calls,oldStillRevoked:frames[0].signal.aborted,newRevokedOnClose:frames[1].signal.aborted,sameSourceAndStore:true};current.destroy();return result;}};
}).catch(error=>{globalThis.dshWindowOwnerNative={ready:true,error:String(error),stack:error.stack};console.error(error);});
