'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const [bundle,root,scenario]=process.argv.slice(2);process.env.XIAOK_CONFIG_DIR=path.join(root,'config');fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const facts={pid:process.pid,scenario,productionQualified:false,foreignGetterCalls:0};
const nativeFetch=globalThis.fetch;let scopedBrokerOrigin;
const brokerFetch=scenario==='scoped_room'?function(input,init){const url=new URL(String(input));assert.ok(url.hostname==='127.0.0.1'||url.hostname==='localhost');assert.equal(url.port,'4318');assert.ok(scopedBrokerOrigin);return nativeFetch(new URL(url.pathname+url.search,scopedBrokerOrigin),init);}:nativeFetch;
if(scenario==='scoped_room')globalThis.fetch=brokerFetch;
let actualHttpRequests=0;require('node:diagnostics_channel').channel('undici:request:create').subscribe(()=>actualHttpRequests++);
const workers=new Set();require('node:async_hooks').createHook({init(id,type){if(type==='WORKER')workers.add(id);},destroy(id){workers.delete(id);}}).enable();
let armRootFailure=false,releaseRootTail;const rootTail=new Promise(yes=>releaseRootTail=yes),nativeFailure=Error('actual_root_bind_failure');Object.defineProperty(nativeFailure,Symbol('native_bind_tail'),{value:rootTail});
const originalDlopen=process.dlopen;process.dlopen=function(module,filename,...rest){const raw=originalDlopen.call(this,module,filename,...rest);if(scenario==='partial_bind'&&path.basename(filename)==='root_resource_authority_main.node'){
 const namespace=module.exports,original=namespace.assertOriginalMainIssuerCurrent,descriptors=Object.getOwnPropertyDescriptors(namespace);
 descriptors.assertOriginalMainIssuerCurrent={value:function(...args){const result=original.apply(namespace,args);if(armRootFailure){armRootFailure=false;facts.rootFailureEntered=true;throw nativeFailure;}return result;},enumerable:true};
 // The genuine Native exports are immutable. Fault injection changes only this
 // loader delivery; the original DLL/function and its actual result stay live.
 module.exports=Object.defineProperties(Object.create(null),descriptors);
}return raw;};
let releasePollTail,pollReentry;const pollTail=new Promise(yes=>releasePollTail=yes);
if(scenario==='polling_tail'||scenario==='polling_reentry'||scenario==='polling_controller_stop'){
 const timers=require('node:timers/promises'),original=timers.setTimeout;
 timers.setTimeout=function(...args){const raw=original.apply(this,args);facts.delaySdkCalls=(facts.delaySdkCalls??0)+1;if(scenario==='polling_tail')Object.defineProperty(raw,Symbol('actual_delay_sdk_tail'),{value:pollTail});if(pollReentry)pollReentry();return raw;};require('node:module').syncBuiltinESMExports();
}
let stateReads=0,restorePrepare;
if(scenario.startsWith('polling')){
 const {DatabaseSync}=require('node:sqlite'),originalPrepare=DatabaseSync.prototype.prepare;
 DatabaseSync.prototype.prepare=function(sql,...args){if(typeof sql==='string'&&sql.includes('SELECT * FROM dsh_a_domains WHERE scope_id=?'))stateReads++;return originalPrepare.call(this,sql,...args);};
 restorePrepare=()=>{DatabaseSync.prototype.prepare=originalPrepare;};
}
let services,api,user,material,workspace,window,sources,service,roomServer,roomBroker,roomInput,scopedClients;
let lateBrokerSource;
if(scenario==='close_during_broker_birth'){
 const originalFreeze=Object.freeze;Object.freeze=function(value,...rest){const raw=Reflect.apply(originalFreeze,Object,[value,...rest]);if(!lateBrokerSource&&value&&typeof value==='object'&&Object.hasOwn(value,'prepareOwner')&&Object.hasOwn(value,'applyControl')&&Object.hasOwn(value,'reconcileControls')){Object.freeze=originalFreeze;lateBrokerSource=raw;facts.stoppedInsideRealBrokerBirth=true;api.stopOriginalMainDshRuntimeComposition(services,sources);}return raw;};
}
async function closeTestRoomBroker(){if(roomServer){const current=roomServer;roomServer=undefined;await current.close();}if(roomBroker){roomBroker.close();roomBroker=undefined;}}
let healthy=false;const ownedChildren=[];
async function run(){
 await app.whenReady();api=await import(pathToFileURL(bundle).href);
 const dataRoot=path.join(root,'desktop'),workspaceRoot=path.join(root,'workspace');fs.mkdirSync(workspaceRoot);const resolved=api.resolveDesktopServiceScope({dataRoot,workspaceRoot}),scope={profileId:resolved.profileId,workspaceId:resolved.workspaceId};
 const html=path.join(root,'index.html');fs.writeFileSync(html,'<!doctype html><title>Original Main composition</title>');window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadFile(html);
 user=api.createMainDshControlSource({window,scope,isTrustedUrl:url=>url===pathToFileURL(html).href});sources=api.createOriginalMainDshServiceSources({scope,userSource:user});const actor=Object.freeze({requestSource:'user',principalId:'desktop-main-window'});
 await api.prepareOriginalMainDshServiceSources(sources,{dataRoot,workspaceRoot,harnessUserActor:actor});const lease=api.readOriginalMainDshPreparedSources(sources);
 const serviceOptions={desktopProjectScope:scope,ownedDshAdmission:lease.businessSource.admission};
 if(scenario.startsWith('polling')){
  const entry=path.resolve(__dirname,'../../../../kswarm/test/fixtures/owned-dsh-business/entry.js');process.env.KSWARM_SERVER_PATH=entry;fs.mkdirSync(path.join(root,'business'));
  globalThis.fetch=async input=>{const url=new URL(String(input));assert.ok(url.hostname==='127.0.0.1'&&['/health','/agents'].includes(url.pathname),'only controlled health/agent inventory is available');if(url.pathname==='/agents')return new Response(JSON.stringify({ok:true,agents:[]}));facts.controlledHealthRequests=(facts.controlledHealthRequests??0)+1;return new Response(JSON.stringify(url.port==='4400'?{ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:api.computeKSwarmServiceSourceHash(entry)}}:{ok:true}),{status:url.port==='4400'&&!healthy?503:200});};
  serviceOptions.findPortOwner=async()=>null;serviceOptions.killStalePortOwner=async()=>{throw Error('unrelated_process_must_not_be_killed');};
  serviceOptions.spawnProcess=(_exe,args,options)=>{assert.ok(args.includes(entry));const child=require('node:child_process').spawn(process.execPath,[entry],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:'1',DSH_BUSINESS_ROOT:path.join(root,'business'),DSH_BUSINESS_SCOPE:JSON.stringify(scope)}}),row={pid:child.pid,closed:false};ownedChildren.push(row);child.on('message',message=>{if(message.protocol==='fixture_ready')healthy=true;});child.stdout?.on('data',()=>{});child.stderr?.on('data',v=>process.stderr.write(v));child.once('close',(code,signal)=>{healthy=false;Object.assign(row,{closed:true,code,signal});});return child;};
 }
 service=api.createKSwarmService(serviceOptions);
 services=api.createDesktopServices({dataRoot,workspaceRoot,kswarmService:service,harnessOptimizationUserActor:actor,dshServiceSources:sources,materialUserSource:user,modelProbeUserSource:user,knowledgeDbPath:path.join(root,'profile','knowledge.db')});const binding=api.readOriginalMainDshServicesBinding(services,sources);await binding.constructionReady;
 material=await api.createMainMaterialSource({userSource:user,services});workspace=new api.RoomWorkspaceLocalStore(path.join(root,'room.sqlite'));const forbidden=async()=>{throw Error('construction_must_not_execute_remote_sdk');};
 const rawClient=api.createCollaborationRoomBrokerClient({token:service.getIntentBrokerRoomToken(),fetchImpl:brokerFetch});let client=rawClient,roomWorkspaceBroker={get:forbidden,request:forbidden};
 if(scenario==='scoped_room'){
  const {createBrokerService}=await import(pathToFileURL(path.resolve(__dirname,'../../../../intent-broker/src/broker/service.js')).href),{createServer}=await import(pathToFileURL(path.resolve(__dirname,'../../../../intent-broker/src/http/server.js')).href);
  roomBroker=createBrokerService({dbPath:path.join(root,'actual-room-broker.sqlite')});roomServer=createServer({broker:roomBroker,roomService:roomBroker.room,roomDesktopToken:service.getIntentBrokerRoomToken()});await roomServer.listen(0,'127.0.0.1');scopedBrokerOrigin='http://127.0.0.1:'+roomServer.address().port;
  const rawWorkspace=api.createRoomWorkspaceBrokerClient({token:service.getIntentBrokerRoomToken(),isMutationOwner:()=>true,fetchImpl:brokerFetch});
  scopedClients=api.createRoomProjectScopeGuard({roomClient:rawClient,workspaceBroker:rawWorkspace,kswarmRequest:forbidden});client=scopedClients.roomClient;roomWorkspaceBroker=scopedClients.workspaceBroker;
  const created=await rawClient.createRoom({title:'actual scoped Main Room',memberAgentIds:['agent-a']});assert.equal(created.ok,true);
  const sent=await rawClient.sendRoomMessage({roomId:created.room.roomId,text:'actual scoped Main input',responsePolicy:'mentioned',mentions:[{kind:'agent',logicalAgentId:'agent-a'}],idempotencyKey:'actual-main-scoped-room'});assert.equal(sent.ok,true);roomInput={roomId:created.room.roomId,roomMessageId:sent.message.messageId,logicalAgentIds:['agent-a']};
 }
 const runtime=api.createRoomWorkspaceRuntime({kswarmService:service,store:workspace,broker:roomWorkspaceBroker,wake:{claimWake:client.claimWake,completeWake:client.completeWake},execute:services.runCollaborationRoomAgentTask,executeProject:services.runWorkspaceProjectTask,ensureProtocol:scenario==='scoped_room'?async()=>{}:forbidden});
 const dispatcher=api.createCollaborationRoomWakeDispatcher({brokerClient:client,execute:services.runCollaborationRoomAgentTask,executeTurn:runtime.run,canExecute:async()=>true});
 if(scenario==='scoped_room'){
  const beforeBindHttp=actualHttpRequests;api.bindOriginalScopedRoomWakeDispatcher(dispatcher,service);api.bindOriginalScopedRoomWakeDispatcher(dispatcher,service);assert.equal(actualHttpRequests,beforeBindHttp);facts.earlyScopedBindingHttpRequests=actualHttpRequests-beforeBindHttp;
 }
 const directBridge=api.createKSwarmRuntimeBridge({kswarmService:service,runDesktopTask:services.runKSwarmHandoffTask,runWorkspaceTask:input=>runtime.runProjectTask(input),allowedRoots:[workspaceRoot],submitResult:forbidden});
 const input={services,sources,roomRuntime:runtime,roomDispatcher:dispatcher,directBridge,materialSource:material,brokerClient:rawClient};
 const foreign=new Proxy({},{get(){facts.foreignGetterCalls++;throw Error('trap');},getOwnPropertyDescriptor(){facts.foreignGetterCalls++;throw Error('trap');}});assert.throws(()=>api.composeOriginalMainDshRuntime({...input,services:foreign}));assert.equal(facts.foreignGetterCalls,0);
 assert.throws(()=>api.composeOriginalMainDshRuntime({...input,brokerClient:foreign}));assert.equal(facts.foreignGetterCalls,0);
 const wrongBrokerToken=api.createCollaborationRoomBrokerClient({token:'foreign-constructor-token',fetchImpl:brokerFetch});assert.throws(()=>api.composeOriginalMainDshRuntime({...input,brokerClient:wrongBrokerToken}));
 let foreignBrokerTransport=0;const wrongBrokerTransport=api.createCollaborationRoomBrokerClient({token:service.getIntentBrokerRoomToken(),fetchImpl:()=>{foreignBrokerTransport++;throw Error('foreign broker transport');}});assert.throws(()=>api.composeOriginalMainDshRuntime({...input,brokerClient:wrongBrokerTransport}));assert.equal(foreignBrokerTransport,0);facts.foreignBrokerTransportCalls=foreignBrokerTransport;
 if(scenario==='foreign_direct'){
  const foreignDirect=api.createKSwarmRuntimeBridge({kswarmService:service,runDesktopTask:forbidden,allowedRoots:[workspaceRoot],submitResult:forbidden});
  assert.throws(()=>api.composeOriginalMainDshRuntime({...input,directBridge:foreignDirect}));facts.foreignOriginalRunnerRejected=true;
  await runtime.shutdown();await api.sealAndDrainMainMaterialSource(material);user.seal();await user.drain();facts.servicesDrained=(await services.disposeMultiAgent()).drained;assert.equal(facts.servicesDrained,true);workspace.close();window.destroy();facts.ok=true;return;
 }
 if(scenario==='partial_bind')armRootFailure=true;
 const beforeCompositionHttp=actualHttpRequests,pending=api.composeOriginalMainDshRuntime(input);facts.samePromise=api.composeOriginalMainDshRuntime(input)===pending;assert.equal(facts.samePromise,true);assert.throws(()=>api.composeOriginalMainDshRuntime({...input,roomDispatcher:{...dispatcher}}));
 if(scenario==='partial_bind'){
  let settled=false;pending.then(()=>settled=true,()=>settled=true);
  for(let i=0;i<100&&!facts.rootFailureEntered;i++)await new Promise(yes=>setTimeout(yes,2));assert.equal(facts.rootFailureEntered,true);
  await new Promise(yes=>setTimeout(yes,20));assert.equal(settled,false);facts.waitedForNativeTail=true;
  await services.getHarnessOptimizationConfig();facts.originalBudgetStillAlive=true;
  releaseRootTail();await assert.rejects(pending,error=>error===nativeFailure);facts.originalCausePreserved=true;
  await assert.rejects(api.closeOriginalMainDshRuntimeComposition(services,sources),error=>error===nativeFailure);facts.closeRetainsFailure=true;assert.throws(()=>api.composeOriginalMainDshRuntime(input));
 }else if(scenario==='close_during_broker_birth'){
  await assert.rejects(pending);await api.closeOriginalMainDshRuntimeComposition(services,sources);assert.equal(facts.stoppedInsideRealBrokerBirth,true);assert.ok(lateBrokerSource);assert.throws(()=>api.readOriginalMainDshBrokerControlSource(lateBrokerSource,lease.realm,binding.store));assert.throws(()=>api.composeOriginalMainDshRuntime(input));facts.lateBrokerReturnClosed=true;
 }else if(scenario==='close_during_birth'){
  const closing=api.closeOriginalMainDshRuntimeComposition(services,sources);await assert.rejects(pending);await closing;assert.throws(()=>api.composeOriginalMainDshRuntime(input));facts.closedBeforeCompletion=true;
 }else{
  const proof=await pending;assert.equal(actualHttpRequests,beforeCompositionHttp,'original complete composition does not send Broker/Source HTTP');facts.constructorHttpRequests=actualHttpRequests-beforeCompositionHttp;api.readOriginalMainDshRuntimeCompletion(services,sources,proof);const view=api.readOriginalMainDshRuntimeBinding(services,sources,proof);assert.equal(view.controller.getState instanceof Function,true);assert.equal(view.owner.physical.acquireModel instanceof Function,true);
  const originalBrokerSource=await api.createMainDshBrokerControlSource({services,sources,client:rawClient});assert.equal(api.readOriginalMainDshBrokerControlSource(originalBrokerSource,lease.realm,binding.store),originalBrokerSource);facts.sameBrokerSource=true;
  api.assertOriginalDshDesktopControllerAccepting(view.controller);assert.throws(()=>api.assertOriginalDshDesktopControllerAccepting(foreign));assert.equal(facts.foreignGetterCalls,0);
  assert.equal(api.readOriginalMainDshAdmissionCoordinator(view.coordinator,lease.realm,binding.store,lease.runtime,lease.budgetSource),view.coordinator);assert.throws(()=>api.readOriginalMainDshAdmissionCoordinator({...view.coordinator},lease.realm,binding.store,lease.runtime,lease.budgetSource));facts.sameOriginalCoordinator=true;
  assert.throws(()=>api.readOriginalMainDshRuntimeCompletion(services,sources,{...proof}));
  await api.startOriginalMainDshServicesRecovery(services,sources,proof);await binding.ready;await assert.rejects(api.startOriginalMainDshServicesRecovery(services,sources,{}));const state=await view.controller.getState();assert.equal(state.schemaVersion,1);assert.equal(state.domain,null);
  if(scenario==='scoped_room'){
   const frame=api.createRoomTurnCustody(),acceptance=api.readOriginalRoomWakeAcceptance(dispatcher);
   try{const accepted=await frame.root(()=>acceptance.collect(roomInput,frame));assert.equal(accepted.length,1,'actual Main scoped factory must reach its original Room source');facts.scopedRoomCandidates=accepted.length;facts.metadataOnlyNoBusinessSdk=true;}finally{await frame.drain();}
  }
  if(scenario==='startup_failure'){
   let actualFailure;try{await fs.promises.stat(path.join(root,'missing-startup-resource'));}catch(raw){actualFailure=raw;}
   assert.ok(actualFailure);Object.defineProperty(actualFailure,Symbol('actual_startup_error_tail'),{value:rootTail});
   assert.equal(typeof api.rejectOriginalMainDshRuntimeStartup,'function');
   let settled=false;const rejected=api.rejectOriginalMainDshRuntimeStartup(services,sources,proof,actualFailure);rejected.then(()=>settled=true,()=>settled=true);
   assert.throws(()=>api.readOriginalMainDshRuntimeCompletion(services,sources,proof));await new Promise(yes=>setTimeout(yes,20));assert.equal(settled,false);await services.getHarnessOptimizationConfig();facts.startupFailureHeldBudget=true;
   releaseRootTail();await assert.rejects(rejected,raw=>raw===actualFailure);facts.startupOriginalCausePreserved=true;assert.throws(()=>api.composeOriginalMainDshRuntime(input));
  }
  if(scenario==='startup_undefined'){
   assert.throws(()=>api.rejectOriginalMainDshRuntimeStartup(foreign,sources,proof,undefined));assert.equal(facts.foreignGetterCalls,0);
   const rejected=api.rejectOriginalMainDshRuntimeStartup(services,sources,proof,undefined);
   assert.equal(api.rejectOriginalMainDshRuntimeStartup(services,sources,proof,Error('secondary_startup_failure')),rejected);
   let didReject=false;await rejected.then(()=>assert.fail('startup must reject'),raw=>{didReject=true;assert.equal(raw,undefined);});assert.equal(didReject,true);facts.startupUndefinedPreserved=true;assert.throws(()=>api.composeOriginalMainDshRuntime(input));
  }
  if(scenario.startsWith('polling')){
   assert.equal(typeof api.startOriginalMainDshRuntimePolling,'function','fixed Main poll owner must exist');
   await service.start();await api.startOriginalMainDshServicesRemoteRecovery(services,sources,proof);
   if(scenario==='polling_reentry')pollReentry=()=>api.stopOriginalMainDshRuntimeComposition(services,sources);
   const polling=api.startOriginalMainDshRuntimePolling(services,sources,proof);
   if(scenario==='polling_reentry'){
    await assert.rejects(polling);await api.closeOriginalMainDshRuntimeComposition(services,sources);facts.reentrantStopJoined=true;assert.equal(facts.delaySdkCalls,1);
   }else{
    assert.equal(api.startOriginalMainDshRuntimePolling(services,sources,proof),polling);await polling;
    if(scenario==='polling_controller_stop'){
     view.controller.ingress.stopAccepting();await new Promise(yes=>setTimeout(yes,1400));assert.equal(facts.delaySdkCalls,1,'stopped original Controller must stop the Main poll loop');
     await assert.rejects(api.closeOriginalMainDshRuntimeComposition(services,sources));facts.stoppedControllerNotRetried=true;
    }else if(scenario==='polling_tail'){
     let closed=false;const closing=api.closeOriginalMainDshRuntimeComposition(services,sources);closing.then(()=>closed=true,()=>closed=true);await new Promise(yes=>setTimeout(yes,20));assert.equal(closed,false);facts.pollHeldTailJoined=true;await services.getHarnessOptimizationConfig();releasePollTail();await closing;
    }else{
     const before=stateReads;await new Promise(yes=>setTimeout(yes,1250));assert.ok(stateReads>before);facts.actualTickStateReads=stateReads-before;
     await api.closeOriginalMainDshRuntimeComposition(services,sources);const closed=stateReads;await new Promise(yes=>setTimeout(yes,1100));assert.equal(stateReads,closed);facts.noTickAfterClose=true;
    }
   }
   restorePrepare();await api.sealAndDrainKSwarmServiceInstance(service);facts.ownedChildren=ownedChildren;assert.ok(ownedChildren.every(row=>row.closed));
  }

  if(scenario==='polling_controller_stop')await assert.rejects(api.closeOriginalMainDshRuntimeComposition(services,sources));else await api.closeOriginalMainDshRuntimeComposition(services,sources);assert.throws(()=>api.readOriginalMainDshRuntimeCompletion(services,sources,proof));assert.throws(()=>api.readOriginalMainDshBrokerControlSource(originalBrokerSource,lease.realm,binding.store));facts.completeThenClosed=true;
 }
 await runtime.shutdown();await api.sealAndDrainMainMaterialSource(material);user.seal();await user.drain();facts.servicesDrained=(await services.disposeMultiAgent()).drained;assert.equal(facts.servicesDrained,!['partial_bind','polling_controller_stop'].includes(scenario));if(scenario==='partial_bind'){await new Promise(yes=>setImmediate(yes));facts.workersRetainedUntilExit=workers.size;assert.ok(workers.size>0);}workspace.close();window.destroy();await closeTestRoomBroker();facts.ok=true;
}
run().then(()=>{fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));app.exit(0);},async error=>{releaseRootTail();releasePollTail();Object.assign(facts,{ok:false,error:String(error),stack:error?.stack});fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));console.error(error);try{if(services)await services.disposeMultiAgent();}catch{}try{if(service)await api.sealAndDrainKSwarmServiceInstance(service);}catch{}try{await closeTestRoomBroker();}catch{}app.exit(1);});
