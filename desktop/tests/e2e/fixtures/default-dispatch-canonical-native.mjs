import {app,BrowserWindow,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {spawn,ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),compiled=join(desktop,'dist/main/desktop/electron'),root=process.env.XIAOK_DISPATCH_CANONICAL_ROOT;
if(!root)throw Error('fixture_root_required');
const trace=(phase,detail={})=>{if(process.env.XIAOK_DISPATCH_CANONICAL_EVIDENCE)appendFileSync(process.env.XIAOK_DISPATCH_CANONICAL_EVIDENCE+'.trace.jsonl',JSON.stringify({phase,...detail})+'\n');};
app.on('window-all-closed',()=>trace('window-all-closed'));app.on('before-quit',()=>trace('before-quit'));process.on('exit',code=>trace('exit',{code}));
const port=async()=>{const s=createServer();await new Promise(yes=>s.listen(0,'127.0.0.1',yes));const p=s.address().port;await new Promise(yes=>s.close(yes));return p;};
app.whenReady().then(async()=>{
 const {registerDefaultDispatchIpc}=await import(join(compiled,'default-dispatch-typed-ipc.js'));
 const {DEFAULT_DISPATCH_CAPTURE_CHANNEL,DEFAULT_DISPATCH_OUTPUT}=await import(join(compiled,'../shared/default-dispatch-ipc-contract.js'));
 const {createDefaultDispatchBusinessController}=await import(join(compiled,'default-dispatch-business-controller.js'));
 const {createDesktopDispatchLaunchCapsule}=await import(join(compiled,'default-dispatch-native-bootstrap.js'));
 const {createKSwarmWriterControlSource}=await import(join(compiled,'kswarm-writer-control-source.js'));
 const {createDesktopWriterControlLaunchCapsule}=await import(join(compiled,'kswarm-writer-control-native-bootstrap.js'));
 const {createKSwarmService,sealAndDrainKSwarmServiceInstance}=await import(join(compiled,'kswarm-service.js'));
 const {ensureDesktopConversationActivityOwner,drainDesktopWriterRelay}=await import(join(compiled,'activity-owner-writer-launcher.js'));
 const {MainUserSubmissionOwner}=await import(join(compiled,'main-user-submission.js'));
 const {DesktopMultiAgentStore}=await import(join(compiled,'desktop-multi-agent-store.js'));
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},html=join(root,'index.html'),preload=join(root,'preload.cjs'),identity=join(root,'groups.sqlite');
 new DesktopMultiAgentStore(identity).close();
 writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('dispatch',()=>ipcRenderer.invoke('desktop:kswarm:default-dispatch:capture',{projectId:'p'}));\n");
 writeFileSync(html,'<!doctype html><button id="dispatch">Dispatch</button><output id="result"></output><script>let calls=0;document.querySelector("button").onclick=async()=>{try{document.querySelector("output").textContent=JSON.stringify({calls:++calls,result:await window.dispatch()});}catch(e){document.querySelector("output").textContent=JSON.stringify({error:String(e)});}}</script>');
 const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}}),trusted=url=>url.startsWith('file:')&&fileURLToPath(url)===html;
 const controller=createDefaultDispatchBusinessController({window,scope,isTrustedUrl:trusted}),source=createKSwarmWriterControlSource({getWindow:()=>window,getScope:()=>scope,isTrustedUrl:trusted});
 const service=createKSwarmService({activityOwnerPending:true,desktopProjectScope:scope,ownedControlAdmission:source.admission,ownedBusinessAdmission:controller.businessAdmission});source.bindService(service);controller.bindService(service);
 const owner=new MainUserSubmissionOwner({dataRoot:root,...scope,defaultDispatchSource:controller.observationSource,defaultDispatchUserAdmission:controller.userAdmission});controller.bindUserOwner(owner);
 const ksData=join(root,'ks'),brokerData=join(root,'broker');mkdirSync(ksData);mkdirSync(brokerData);const ksPort=await port(),brokerPort=await port();
 const ksEntry=resolve(desktop,'../../kswarm/src/server/index.js'),brokerEntry=resolve(desktop,'../../intent-broker/src/cli.js'),seedEntry=resolve(desktop,'../../kswarm/test/fixtures/owned-default-dispatch-business/service-entry.js');
 const seed=spawn(process.execPath,[seedEntry],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DISPATCH_BUSINESS_TEST_ROOT:ksData}});let seedOutput='';seed.stdout.on('data',chunk=>seedOutput+=chunk);seed.stderr.on('data',chunk=>seedOutput+=chunk);const seeded=new Promise(yes=>seed.once('close',code=>yes(code)));
 globalThis.canonicalDispatchNative={ready:false,ownedSeedPid:seed.pid};
 for(let n=0;n<1500&&!seedOutput.includes('OWNED_BUSINESS_SERVICE_READY');n++)await new Promise(yes=>setTimeout(yes,5));assert.match(seedOutput,/OWNED_BUSINESS_SERVICE_READY/);seed.kill('SIGTERM');assert.equal(await seeded,0);
 const brokerConfig=join(brokerData,'broker.json');writeFileSync(brokerConfig,JSON.stringify({server:{host:'127.0.0.1',port:brokerPort,dbPath:join(brokerData,'state.sqlite')},channels:{},relay:{enabled:false}}));
 const expected=file=>({ok:true,'service.entryPath':file,'service.entryHash':createHash('sha256').update(readFileSync(file)).digest('hex')});
 const config={schemaVersion:1,dataRoot:root,profileId:'native-main-business-fixture',actorId:'desktop-user:fixture',identity:{kind:'desktop',path:identity},kswarm:{url:`http://127.0.0.1:${ksPort}`,mutationToken:'fixture-mutation',brokerUrl:`http://127.0.0.1:${brokerPort}`,roomToken:'fixture-room'},managedSources:[
 {name:'broker',executable:process.execPath,entryPath:brokerEntry,args:[brokerEntry],cwd:brokerData,env:{ELECTRON_RUN_AS_NODE:'1',PORT:String(brokerPort),INTENT_BROKER_CONFIG:brokerConfig,INTENT_BROKER_LOCAL_CONFIG:join(brokerData,'none.json'),INTENT_BROKER_DB:join(brokerData,'state.sqlite'),INTENT_BROKER_HEARTBEAT_PATH:join(brokerData,'heartbeat.json'),INTENT_BROKER_DESKTOP_TOKEN:'fixture-room',INTENT_BROKER_KSWARM_TOKEN:'fixture-ks-room'},healthUrl:`http://127.0.0.1:${brokerPort}/health`,expectedHealth:expected(brokerEntry)},
 {name:'kswarm',executable:process.execPath,entryPath:ksEntry,args:[ksEntry],cwd:dirname(dirname(dirname(ksEntry))),env:{ELECTRON_RUN_AS_NODE:'1',KSWARM_DATA_ROOT:ksData,KSWARM_PORT:String(ksPort),BROKER_URL:`http://127.0.0.1:${brokerPort}`,KSWARM_DESKTOP_MUTATION_TOKEN:'fixture-mutation',INTENT_BROKER_KSWARM_TOKEN:'fixture-ks-room',KSWARM_DESKTOP_PROFILE_ID:scope.profileId,KSWARM_DESKTOP_WORKSPACE_ID:scope.workspaceId},healthUrl:`http://127.0.0.1:${ksPort}/health`,expectedHealth:expected(ksEntry)}]};
 let client,actualChild,releaseCallback,releaseSdk,restoreSplice,restoreChannel,retirement;const mode=process.env.XIAOK_DISPATCH_CANONICAL_MODE??'healthy',originalEmit=ChildProcess.prototype.emit;
 ChildProcess.prototype.emit=function(name,...args){if(name==='spawn'&&this.spawnargs?.some(arg=>typeof arg==='string'&&arg.endsWith('/conversation-activity/owner-entry.js'))){actualChild=this;ChildProcess.prototype.emit=originalEmit;if(mode==='species-held'||mode==='splice-held'){const send=this.send;this.send=function(frame,callback){return Reflect.apply(send,this,[frame,error=>{if(frame.type==='request')releaseCallback=()=>callback(error);else callback(error);}]);};}}return Reflect.apply(originalEmit,this,[name,...args]);};
 const state=globalThis.canonicalDispatchNative;state.held=()=>Boolean(releaseCallback);state.release=()=>{releaseCallback?.();releaseCallback=undefined;releaseSdk?.();releaseSdk=undefined;restoreSplice?.();restoreSplice=undefined;restoreChannel?.();restoreChannel=undefined;};state.beginRetire=async()=>{controller.seal();source.seal();trace('retire-sealed');await controller.drain();trace('controller-input-drained');trace('writer-source-not-predrained');assert.ok(actualChild);
 if(mode==='inherited-channel'){const channel=actualChild.channel,original=Object.getPrototypeOf(channel),base=Object.create(original);let hooks=0;Object.defineProperty(base,'then',{get(){hooks++;throw Error('inherited then getter');}});Object.setPrototypeOf(channel,base);restoreChannel=()=>Object.setPrototypeOf(channel,original);state.channelHooks=()=>hooks;}
 if(mode==='splice-held'){const splice=Array.prototype.splice,slice=Array.prototype.slice;restoreSplice=()=>{Array.prototype.splice=splice;};Array.prototype.splice=function(start,...args){if(arguments.length===1&&start===0)return Reflect.apply(slice,this,[]);return Reflect.apply(splice,this,[start,...args]);};}
 if(mode==='connected-held'){const original=actualChild.connected,pending=new Promise(yes=>{releaseSdk=yes;});let valid=original;Object.defineProperty(actualChild,'connected',{configurable:true,get(){return pending;},set(value){valid=value;}});restoreChannel=()=>Object.defineProperty(actualChild,'connected',{configurable:true,writable:true,value:valid});}
 if(mode==='channel-held'){const pending=new Promise(yes=>{releaseSdk=yes;});Object.defineProperty(actualChild,'channel',{configurable:true,get(){return pending;}});}
 if(mode==='disconnect-held'){const disconnect=actualChild.disconnect;actualChild.disconnect=function(){Reflect.apply(disconnect,this,[]);return new Promise(yes=>{releaseSdk=yes;});};}
 const species=Object.getOwnPropertyDescriptor(Promise,Symbol.species);if(mode==='species-held')Object.defineProperty(Promise,Symbol.species,{configurable:true,value:Promise});try{retirement=drainDesktopWriterRelay(service);}finally{Object.defineProperty(Promise,Symbol.species,species);}
 state.retirementSettled=false;retirement.then(()=>{state.retirementSettled=true;state.retirementHealthy=true;trace('retirement-fulfilled');},error=>{state.retirementSettled=true;state.retirementError=String(error);trace('retirement-rejected',{error:String(error),cause:String(error.cause),stack:error.stack});});};
 globalThis.canonicalDispatchNative.close=async()=>{state.release();controller.seal();source.seal();await controller.drain();await source.drain();try{await sealAndDrainKSwarmServiceInstance(service);}catch(error){if(mode==='healthy')throw error;state.serviceCloseError=String(error);}owner.seal();client?.dispose();ipcMain.removeHandler(DEFAULT_DISPATCH_CAPTURE_CHANNEL);window.destroy();return{seedReaped:true,notProductComposition:true};};
 trace('before-original-launch');client=await ensureDesktopConversationActivityOwner(config,{source,service,capsule:createDesktopWriterControlLaunchCapsule({source,service,window}),businessBootstrap:{controller,capsule:createDesktopDispatchLaunchCapsule(controller,service)}});trace('after-original-launch');service.bindActivityOwner(client);
 if(mode==='output-navigation'){const parse=DEFAULT_DISPATCH_OUTPUT.parse.bind(DEFAULT_DISPATCH_OUTPUT);let armed=true;DEFAULT_DISPATCH_OUTPUT.parse=function(raw,...args){const value=parse(raw,...args);if(armed&&value.ok===true){armed=false;state.capturedBeforeWithdrawal=value.operation;window.webContents.emit('did-start-navigation',{},window.webContents.getURL(),false,true,1,1);}return value;};}
 registerDefaultDispatchIpc(ipcMain,controller);await window.loadFile(html);globalThis.canonicalDispatchNative.ready=true;trace('ready');
}).catch(error=>{globalThis.canonicalDispatchNative={...globalThis.canonicalDispatchNative,ready:true,error:String(error),stack:error.stack};console.error(error);});
