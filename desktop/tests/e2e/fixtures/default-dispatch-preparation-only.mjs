import {app,BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {ChildProcess} from 'node:child_process';
import {join,dirname,resolve,basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync,realpathSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
const compiled=resolve(dirname(fileURLToPath(import.meta.url)),'../../../dist/main/desktop/electron'),target=process.env.XIAOK_PREPARATION_ONLY_RESULT;
if(!target||!isAbsolute(target)||basename(target)!=='preparation-only.json')throw Error('preparation_only_fixture_target_required');
const root=realpathSync(dirname(target)),stat=lstatSync(dirname(target));
if(stat.isSymbolicLink()||!stat.isDirectory()||dirname(root)!==realpathSync(tmpdir())||!/^xiaok-artifact-runtime-e2e-[A-Za-z0-9]{6}$/.test(basename(root)))throw Error('preparation_only_fixture_target_invalid');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const mode=process.env.XIAOK_PREPARATION_ONLY_MODE??'preparation-only';if(!['preparation-only','preparation-held','configuration-only','preparation-invalid'].includes(mode))throw Error('invalid_preparation_fixture_mode');
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},facts={mode,pid:process.pid,clientBirths:0,businessRequests:0,configFrames:0},cleanups=[];
 let bodyError,observedClient,preparationOwner,actualChild,releaseCallback,releaseSdk;
 const originalSet=WeakMap.prototype.set,originalEmit=ChildProcess.prototype.emit;
 WeakMap.prototype.set=function(key,value){const result=Reflect.apply(originalSet,this,[key,value]);if(preparationOwner&&value&&typeof value==='object'&&value.preparationSource===preparationOwner.transportSource&&value.preparationFacet){observedClient=key;facts.clientBirths++;}return result;};
 ChildProcess.prototype.emit=function(event,...args){if(event==='spawn'&&this.spawnargs?.some(value=>typeof value==='string'&&value.endsWith('/conversation-activity/owner-entry.js'))){actualChild=this;facts.childPid=this.pid;const send=this.send;this.send=function(frame,...parameters){if(frame?.protocol==='activity_dispatch_business_v1'&&frame.type==='request')facts.businessRequests++;if(frame?.protocol==='activity_desktop_config_v1')facts.configFrames++;const held=mode==='preparation-held'&&frame?.protocol==='activity_dispatch_business_v1'&&frame.type==='probe';if(held){const callback=parameters[0];parameters[0]=error=>{facts.callbackHeld=true;releaseCallback=()=>callback(error);};}const result=Reflect.apply(send,this,[frame,...parameters]);return held?new Promise(yes=>{releaseSdk=()=>yes();}):result;};}return Reflect.apply(originalEmit,this,[event,...args]);};
 try{
  const {DesktopMultiAgentStore}=await import(join(compiled,'desktop-multi-agent-store.js'));const identity=join(root,'groups.sqlite');new DesktopMultiAgentStore(identity).close();
  const {createDefaultDispatchPreparationNativeSource,readDefaultDispatchPreparationNativeBirth}=await import(join(compiled,'default-dispatch-preparation-native-source.js'));
  const {createDefaultDispatchPreparationOwner}=await import(join(compiled,'default-dispatch-preparation-owner.js'));
  const {createDesktopPreparationCompositionCapsule}=await import(join(compiled,'default-dispatch-preparation-composition-bootstrap.js'));
  const {createKSwarmWriterControlSource}=await import(join(compiled,'kswarm-writer-control-source.js'));
  const {createDesktopWriterControlLaunchCapsule}=await import(join(compiled,'kswarm-writer-control-native-bootstrap.js'));
  const {createKSwarmService,sealAndDrainKSwarmServiceInstance,getKSwarmOwnedPreparationTransport}=await import(join(compiled,'kswarm-service.js'));
  const {ensureDesktopConversationActivityOwner}=await import(join(compiled,'activity-owner-writer-launcher.js'));
  const {FileTaskSnapshotStore}=await import(join(compiled,'../../src/runtime/task-host/snapshot-store.js'));
  const {createTaskSourceWriterPopulation}=await import(join(compiled,'../../src/runtime/task-host/task-runtime-host.js'));
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});cleanups.push(async()=>{if(!window.isDestroyed())window.destroy();});
  const native=createDefaultDispatchPreparationNativeSource({window,scope,isTrustedUrl:()=>false});preparationOwner=createDefaultDispatchPreparationOwner(native);cleanups.push(()=>preparationOwner.drain());
  const source=createKSwarmWriterControlSource({getWindow:()=>window,getScope:()=>scope,isTrustedUrl:()=>false}),service=createKSwarmService({activityOwnerPending:true,desktopProjectScope:scope,ownedControlAdmission:source.admission,ownedPreparationSource:preparationOwner.transportSource,ownedPreparationAdmission:preparationOwner.transportAdmission});source.bindService(service);preparationOwner.bindService(service);
  cleanups.push(()=>source.drain());cleanups.push(()=>sealAndDrainKSwarmServiceInstance(service));
  const store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),host=population.createHost({materialRegistry:{},defaultDispatchPreparationSource:preparationOwner.hostSource,runner:async()=>{throw Error('fixture_execution_denied');}});cleanups.push(()=>population.close());preparationOwner.bindOriginalHost(population,host);
  const capsule=createDesktopWriterControlLaunchCapsule({source,service,window}),preparationCapsule=createDesktopPreparationCompositionCapsule(preparationOwner,service);
  const config={schemaVersion:1,dataRoot:root,profileId:'preparation-only-native-component',actorId:'desktop-user:fixture',identity:{kind:'desktop',path:identity}};
  if(mode==='preparation-invalid')Object.setPrototypeOf(preparationOwner.transportSource.resolveWork,Object.getPrototypeOf(async()=>{}));
  const activity=await ensureDesktopConversationActivityOwner(config,{source,service,capsule,...(mode==='configuration-only'?{}:{preparationBootstrap:{owner:preparationOwner,capsule:preparationCapsule}})});cleanups.push(async()=>activity.dispose());
  const status=await activity.request('status');facts.activityReady=status.ready;assert.equal(status.ready,true);
  if(mode!=='preparation-only'&&mode!=='preparation-held'){assert.throws(()=>getKSwarmOwnedPreparationTransport(service,preparationOwner.transportSource,preparationOwner.transportAdmission));facts.preparationDenied=true;assert.equal(facts.clientBirths,0);return;}
  const facet=getKSwarmOwnedPreparationTransport(service,preparationOwner.transportSource,preparationOwner.transportAdmission);facts.facetAvailable=true;assert.equal(facts.clientBirths,1);assert.ok(observedClient);
  assert.throws(()=>facet.openWork('p',{childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64)},{requestSource:'scheduler',preparationProof:Object.freeze({}),signal:new AbortController().signal}),/DEFAULT_DISPATCH_PREPARATION_WORK_AUTHORIZATION_UNAVAILABLE/);facts.emptyWorkDenied=true;
  assert.throws(()=>readDefaultDispatchPreparationNativeBirth(native));facts.nativeBirthDenied=true;
  const context={requestSource:'user',admission:Object.freeze({}),signal:new AbortController().signal};
  await assert.rejects(observedClient.readPlan('p',context));await assert.rejects(observedClient.captureDefaultDispatch('p',{},context));await assert.rejects(observedClient.readOperation('p',{},context));facts.userCallsDenied=3;
  assert.equal(facts.businessRequests,0);facts.childPid=actualChild?.pid;
  if(mode==='preparation-held'){
   let settled=false;const closing=sealAndDrainKSwarmServiceInstance(service).then(()=>{settled=true;},()=>{settled=true;});
   try{for(let n=0;n<500&&!facts.callbackHeld;n++)await delay(2);assert.equal(facts.callbackHeld,true);await delay(20);assert.equal(settled,false);assert.equal(actualChild.connected,true);facts.retirementWaitedForActualCallback=true;releaseCallback();releaseCallback=undefined;await delay(20);assert.equal(settled,false);assert.equal(actualChild.connected,true);facts.retirementWaitedForOriginalSdkRaw=true;}
   finally{releaseCallback?.();releaseCallback=undefined;releaseSdk?.();releaseSdk=undefined;await closing;}
  }
 }catch(error){bodyError=error;facts.error=String(error);}
 finally{
  releaseCallback?.();releaseSdk?.();WeakMap.prototype.set=originalSet;ChildProcess.prototype.emit=originalEmit;facts.cleanupErrors=[];facts.childPid=actualChild?.pid;
  for(const close of cleanups.reverse())try{await close();}catch(error){facts.cleanupErrors.push(String(error));}
  writeFileSync(target,JSON.stringify(facts),{flag:'wx',mode:0o600});
 }
 if(bodyError)console.error(bodyError);
}).catch(error=>{console.error(error);writeFileSync(target,JSON.stringify({error:String(error),pid:process.pid}),{flag:'wx',mode:0o600});});
