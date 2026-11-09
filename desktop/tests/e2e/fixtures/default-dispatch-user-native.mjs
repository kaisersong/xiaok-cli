import {app,BrowserWindow,ipcMain} from 'electron';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const compiled=resolve(dirname(fileURLToPath(import.meta.url)),'../../../dist/main/desktop/electron');
const root=process.env.XIAOK_DISPATCH_SOURCE_FIXTURE_ROOT;
if(!root)throw Error('fixture_root_required');
const configRoot=join(root,'config');
mkdirSync(configRoot,{recursive:true,mode:0o700});
process.env.XIAOK_CONFIG_DIR=configRoot;
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const {createDefaultDispatchUserSource,readDefaultDispatchUserBootstrap}=await import(join(compiled,'default-dispatch-user-source.js'));
 const {MainUserSubmissionOwner,readOriginalDefaultDispatchOwner}=await import(join(compiled,'main-user-submission.js'));
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},actor={requestSource:'user',actorId:'desktop-user:'+scope.profileId};
 const preload=join(root,'preload.cjs'),html=join(root,'index.html');
 writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixtureDispatch',()=>ipcRenderer.invoke('fixture:dispatch'));\n");
 writeFileSync(html,'<!doctype html><html lang="en"><body><button id="dispatch">Dispatch current plan</button><output id="result"></output><script>document.querySelector("button").onclick=async()=>{try{const r=await window.fixtureDispatch();document.querySelector("output").textContent=JSON.stringify(r);}catch(e){document.querySelector("output").textContent=JSON.stringify({error:String(e)});}}</script></body></html>');
 const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const events=[];for(const name of ['did-start-navigation','did-frame-finish-load','did-finish-load','did-stop-loading'])window.webContents.on(name,(_event,...args)=>events.push({event:name,args,loading:window.webContents.isLoadingMainFrame()}));
 const source=createDefaultDispatchUserSource({window,scope,isTrustedUrl(url){return url.startsWith('file:')&&fileURLToPath(url)===html;}});
 const baseline={navigation:window.webContents.listenerCount('did-start-navigation'),destroyed:window.webContents.listenerCount('destroyed'),closed:window.listenerCount('closed')};
 const bootstrap=readDefaultDispatchUserBootstrap(source);assert.equal(bootstrap.window,window);assert.equal(bootstrap.contents,window.webContents);assert.equal(bootstrap.session,window.webContents.session);assert.deepEqual(bootstrap.scope,scope);bootstrap.assertCurrent();bootstrap.assertLocal();assert.throws(()=>source.assertAdmission(bootstrap,actor));
 const observations=new WeakMap(),observation=Object.freeze({});observations.set(observation,{scope,projectId:'p',planRevision:1,dispatchGeneration:0,bindingDigest:'c'.repeat(64),taskSetDigest:'d'.repeat(64)});
 const observationSource={resolve(frame){const data=observations.get(frame);if(!data)throw Error('fixture_observation_foreign');return{data,assertCurrent(){}};}};
 const owner=new MainUserSubmissionOwner({dataRoot:root,...scope,defaultDispatchSource:observationSource,defaultDispatchUserAdmission:source.assertAdmission}),binding=readOriginalDefaultDispatchOwner(owner,observationSource,source.assertAdmission);
 const frames=[];let calls=0,lastAction;
 ipcMain.handle('fixture:dispatch',event=>{
  let frame;try{frame=source.open(event,'p','user');}catch(error){events.push({event:'source-open-failed',error:String(error),stack:error.stack,loading:window.webContents.isLoadingMainFrame(),sameFrame:event.senderFrame===window.webContents.mainFrame});throw error;}frames.push(frame);calls++;
  lastAction=binding.capture(observation,frame.proof,actor);
  const record=binding.read(lastAction,actor);bootstrap.assertCurrent();bootstrap.assertLocal();
  return{actionId:record.actionId,calls,ready:app.isReady(),nativeSender:event.sender===window.webContents,nativeMainFrame:event.senderFrame===window.webContents.mainFrame,originalBootstrap:true,originalABinding:true,journalFiles:readdirSync(join(root,'conversation-projects','user-submissions')).filter(name=>name.endsWith('.json')).length};
 });
 globalThis.dispatchUserNative={ready:false,events,async navigate(){const old=frames.at(-1);assert.ok(old);await window.loadFile(html);assert.throws(()=>old.assertCurrent());bootstrap.assertCurrent();return{revoked:old.signal.aborted,bootstrapStillSameSession:bootstrap.session===window.webContents.session};},async close(){owner.seal();await source.drain();for(const frame of frames)assert.throws(()=>frame.assertCurrent());assert.throws(()=>bootstrap.assertLocal());assert.throws(()=>binding.read(lastAction,actor));ipcMain.removeHandler('fixture:dispatch');const facts={baseline,after:{navigation:window.webContents.listenerCount('did-start-navigation'),destroyed:window.webContents.listenerCount('destroyed'),closed:window.listenerCount('closed')},allRevoked:frames.every(f=>f.signal.aborted),bootstrapRevoked:true,calls,notFullProductMain:true,controlledBObservation:true};window.destroy();return facts;}};
 globalThis.dispatchUserNative.probeSdkFate=async kind=>{
  const probe=createDefaultDispatchUserSource({window,scope,isTrustedUrl:()=>true}),boot=readDefaultDispatchUserBootstrap(probe);
  let resolveFirst,rejectFirst,releaseSecond;const first=new Promise((yes,no)=>{resolveFirst=yes;rejectFirst=no;}),second=new Promise(yes=>{releaseSecond=yes;}),initial=Error('actual-native-sdk-wrapper-failure');
  if(kind==='stack')Object.defineProperty(initial,'stack',{value:first});else Object.defineProperty(initial,'raw',{value:first});
  if(kind==='returned')Object.defineProperty(first,Symbol('actual-sdk-symbol-sibling'),{value:second});
  const target=window,original=target.isDestroyed,own=Object.getOwnPropertyDescriptor(target,'isDestroyed');let nativeCalls=0,caught,wasThrown=false,finished=false;
  Object.defineProperty(target,'isDestroyed',{configurable:true,writable:true,value:function(...args){const value=Reflect.apply(original,this,args);assert.equal(value,false);nativeCalls++;if(kind==='returned')return first;throw initial;}});
  let draining;
  try{
   try{boot.assertCurrent();}catch(error){caught=error;wasThrown=true;}
   assert.equal(wasThrown,true);if(kind!=='returned')assert.equal(caught,initial);
   if(own)Object.defineProperty(target,'isDestroyed',own);else delete target.isDestroyed;
   draining=probe.drain().then(()=>{finished=true;},()=>{finished=true;});
   await new Promise(yes=>setImmediate(yes));assert.equal(finished,false);
   if(kind==='rejected')rejectFirst(Error('actual-native-sdk-outcome',{cause:second}));else resolveFirst(kind==='returned'?false:{next:second});
   await new Promise(yes=>setImmediate(yes));assert.equal(finished,false);
   releaseSecond();await draining;assert.equal(finished,true);assert.throws(()=>boot.assertCurrent());
   return{kind,nativeCalls,actualNativeCalledBeforeFault:true,heldAfterFirstOutcome:true,heldUntilSecondSettlement:true,sourceRemainsDenied:true,notNativeNQualification:true};
  }finally{
   if(own)Object.defineProperty(target,'isDestroyed',own);else delete target.isDestroyed;
   resolveFirst(undefined);releaseSecond();if(draining)await draining;else await probe.drain().catch(()=>{});
  }
 };
 await window.loadFile(html);globalThis.dispatchUserNative.ready=true;
}).catch(error=>{globalThis.dispatchUserNative={ready:true,error:String(error),stack:error.stack};console.error(error);});
