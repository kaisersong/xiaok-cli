'use strict';
// Genuine Core/Owner/Source integration. All network traffic remains loopback.
module.exports = function protectedCoreModelSdk(options) {
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 const {types}=require('node:util'),{pathToFileURL}=require('node:url'),https=require('node:https');
 const config=path.join(options.root,'config');fs.mkdirSync(config,{recursive:true,mode:0o700});
 process.env.XIAOK_CONFIG_DIR=config;
 const {app,BrowserWindow,ipcMain}=require('electron');app.setPath('userData',path.join(options.root,'userData'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
 const held=[];globalThis.originalProtectedCoreSdkHeld=held;
 function cause(raw,depth=0){held.push(raw);if(depth>4||raw===null||typeof raw!=='object'||types.isProxy(raw))return {kind:typeof raw};const out={};for(const key of ['message','code','stack','cause','errors']){const d=Object.getOwnPropertyDescriptor(raw,key);if(!d)continue;if(!Object.hasOwn(d,'value')){out[key]='accessor-not-read';continue;}if(typeof d.value==='string')out[key]=d.value;else if(key==='cause')out[key]=cause(d.value,depth+1);else if(key==='errors'&&Array.isArray(d.value))out[key]=d.value.map(v=>cause(v,depth+1));}return out;}
 app.whenReady().then(async()=>{
  const facts={kind:'protected-core-model-sdk',pid:process.pid,actualMain:process.type==='browser',productionQualified:false,readonlyCovered:false,modelConstructs:0,serverRequests:0,getterHits:0,negative:[]};
  let api,realm,core,lease,session,groups,budget,budgetSource,user,services,owner,window,server,roomStore,population,runtime,roomSource,hook;
  const sockets=new Set(),requests=[];let fault=false,first;
  const golden=path.join(options.root,'protected-model-golden.json');
  const phase=fs.existsSync(golden)?'restored':'fresh';facts.phase=phase;
  const negative=(name,fn)=>{let row={name,state:'entered'};facts.negative.push(row);try{const raw=fn();held.push(raw);if(raw&&typeof raw.then==='function'){row.state='pending';const joined=raw.then(()=>{row.state='fulfilled';},error=>{row.state='rejected';row.cause=cause(error);});held.push(joined);return joined;}row.state='fulfilled';}catch(error){row.state='rejected';row.cause=cause(error);}return Promise.resolve();};
  try {
   assert.equal(facts.actualMain,true);
   const cert=fs.readFileSync(path.join(options.repo,'tests/fixtures/sol-pi-tls/cert.pem')),key=fs.readFileSync(path.join(options.repo,'tests/fixtures/sol-pi-tls/key.pem'));
   server=https.createServer({cert,key},(req,res)=>{facts.serverRequests++;let body='';req.on('data',part=>{body+=part;});req.on('end',()=>{assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer private-loopback-only');const parsed=JSON.parse(body);assert.equal(parsed.model,'fixture-wire');assert.ok(JSON.stringify(parsed.messages).includes('ping'));assert.ok(!parsed.tools||parsed.tools.length===0);res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});});
   server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
   await new Promise(yes=>server.listen(0,'127.0.0.1',yes));const origin='https://127.0.0.1:'+server.address().port;
   const originalRequest=https.request;
   https.request=function(input,requestOptions,callback){assert.equal(input.origin,origin,'external HTTPS refused');assert.equal(input.pathname,'/v1/chat/completions');facts.modelConstructs++;const raw=Reflect.apply(originalRequest,https,[input,{...requestOptions,ca:cert},callback]);held.push(raw);requests.push(raw);if(fault){Object.defineProperty(raw,Symbol('original-request-unknown-tail'),{get(){facts.getterHits++;throw Error('unknown accessor must not execute');}});}return raw;};
   require('node:module').syncBuiltinESMExports();
   fs.writeFileSync(path.join(config,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'fixture-provider',defaultModelId:'fixture-model',providers:{'fixture-provider':{type:'custom',protocol:'openai_legacy',apiKey:'private-loopback-only',baseUrl:origin+'/v1'}},models:{'fixture-model':{provider:'fixture-provider',model:'fixture-wire',label:'Fixture',capabilities:[]}}}),{mode:0o600});
   api=await import(pathToFileURL(options.bundle).href);
   const serviceOptions={dataRoot:path.join(options.root,'desktop'),workspaceRoot:path.join(options.root,'workspace'),runner:async()=>{throw Error('business runner not used');},kswarmService:{request:async()=>{throw Error('broker unused');},getDesktopMutationToken:()=>''}};
   fs.mkdirSync(serviceOptions.workspaceRoot,{recursive:true});const scope=api.resolveDesktopServiceScope(serviceOptions);
   const preload=path.join(options.root,'protected-probe-preload.cjs');fs.writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('protectedProbe',{go:()=>ipcRenderer.invoke('fixture:protected-core-model')});");
   window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload}});
   user=api.createMainDshControlSource({window,scope:{profileId:scope.profileId,workspaceId:scope.workspaceId},isTrustedUrl:url=>url.startsWith('data:text/html,')});
   realm=api.createMainDshBootstrapAuthority();core=api.prepareOriginalMainDshCoreInfrastructure(realm);await api.startOriginalMainDshCoreInfrastructure(core);
   facts.protectedAdmission=api.readOriginalMainDshAdmissionDatabase(realm)!==null;assert.equal(facts.protectedAdmission,true);
   budgetSource=api.createMainDshBudgetAuthoritySource({realm,userSource:user});
   budget=await api.createHarnessOptimizationRuntime({dataRoot:path.join(options.root,'budget'),profileId:scope.profileId,workspaceId:scope.workspaceId,authorizeUser:()=>false,manifestLookup:()=>undefined,dshBudgetAuthoritySource:budgetSource,originalCoreLease:core});
   const budgetState=await budget.api.read();assert.equal(budgetState.status,'ready');assert.equal(budgetState.config.enabled,false);
   groups=new api.DesktopMultiAgentStore(path.join(options.root,'groups.sqlite'),{dshAdmissionSource:realm,dshUserControlSource:user,dshBudgetBinding:{runtime:budget,exactConstructorSource:budgetSource}});
   realm.bindStore(groups);budgetSource.bindStore(groups);user.bindStore(groups);
   lease=api.prepareOriginalMainDshInstalledRootPool(realm,groups);session=await api.openOriginalMainDshInstalledRootPool(lease);
   const rootApi=api.loadOriginalMainResourceAuthority();assert.equal(await api.readOriginalMainDshCoreBootstrap(lease,session),phase);
   assert.equal(typeof rootApi.fixtureReadPhysicalSnapshot,'function');
   services=api.createDesktopServices({...serviceOptions,modelProbeUserSource:user});
   const unused=async()=>{throw Error('unused Room IO');};roomStore=new api.RoomWorkspaceLocalStore(path.join(options.root,'room.sqlite'));
   runtime=api.createRoomWorkspaceRuntime({store:roomStore,broker:{get:unused,request:unused},wake:{claimWake:unused,completeWake:unused},execute:services.runCollaborationRoomAgentTask,ensureProtocol:unused});
   const client=api.createCollaborationRoomBrokerClient({token:'fixture-unused',fetchImpl:unused});
   const dispatcher=api.createCollaborationRoomWakeDispatcher({brokerClient:client,execute:services.runCollaborationRoomAgentTask,executeTurn:runtime.run,canExecute:async()=>true});
   roomSource=api.createOriginalRoomTurnSource({dispatcher,runtime,services,scope:{profileId:scope.profileId,workspaceId:scope.workspaceId}});
   const taskStore=new api.FileTaskSnapshotStore(path.join(options.root,'tasks'));population=api.createTaskSourceWriterPopulation(taskStore);
   const host=population.createHost({materialRegistry:new api.MaterialRegistry({workspaceRoot:serviceOptions.workspaceRoot,maxBytes:1024}),runner:unused});await api.readOriginalTaskHostIdentityIO(host,taskStore).initialize();
   owner=api.createOriginalMainRootAdmissionOwner({roomSource,host,store:taskStore});
   await api.bindOriginalMainDshPhysicalPort(owner,realm,groups,budget,budgetSource);api.bindOriginalMainModelProbeAdmission(owner,user,services);
   facts.noLegacyRoot= !fs.existsSync(path.join(options.nativeRoot,'root-resource-v1.sqlite'));assert.equal(facts.noLegacyRoot,true);
   const snapshot=()=>rootApi.fixtureReadPhysicalSnapshot(session).rows;
   if(phase==='fresh'){
    assert.deepEqual(snapshot(),[]);let actualContext;
    hook=require('node:async_hooks').createHook({init(_id,type){if(type==='PROMISE'){const context=api.readCurrentOriginalRootExecutionContext();if(context&&api.readOriginalMainModelProbeResourceContext(context,user,services))actualContext=context;}}});hook.enable();
    ipcMain.handle('fixture:protected-core-model',async event=>{const frame=user.openModelProbe(event,{schemaVersion:1,purpose:'test_provider_connection',providerId:'fixture-provider',modelId:null},'user');try{return await services.testProviderConnection({providerId:'fixture-provider'},'user',frame.proof);}finally{frame.release();}});
    await window.loadURL('data:text/html,protected-core-probe');
    const normal=await window.webContents.executeJavaScript('window.protectedProbe.go()');assert.equal(normal.success,true);assert.ok(actualContext);
    let rows=snapshot();assert.equal(rows.length,1);assert.equal(rows[0].state,'released');assert.equal(rows[0].executionClass,'admission_probe');assert.equal(facts.modelConstructs,1);assert.equal(facts.serverRequests,1);facts.normal=rows[0];
    fault=true;const unknown=await window.webContents.executeJavaScript('window.protectedProbe.go()').catch(error=>{held.push(error);return {success:false};});assert.equal(unknown.success,false);
    rows=snapshot();assert.equal(rows.length,2);assert.equal(rows.filter(row=>row.state==='released').length,1);assert.equal(rows.filter(row=>row.state==='reserved'||row.state==='unknown').length,1);assert.equal(facts.modelConstructs,2);assert.equal(facts.getterHits,0);
    facts.unknown=rows.find(row=>row.state!=='released');facts.rows=rows;
    fs.writeFileSync(golden,JSON.stringify({kind:'protected-model-history-v1',rows}),{flag:'wx',mode:0o600});
   }else{
    facts.rows=snapshot();assert.deepEqual(facts.rows,JSON.parse(fs.readFileSync(golden,'utf8')).rows);assert.equal(facts.modelConstructs,0);assert.equal(facts.serverRequests,0);facts.coldNoNewSdk=true;
   }
   facts.historyPersisted=true;
  }catch(raw){first={raw};facts.first=cause(raw);}
  if(hook)hook.disable();
  // Unknown custody is not force-settled. These original negative operations
  // remain strongly retained through the intentional restart boundary.
  const ownerDrain=owner?negative('owner',()=>owner.drain()):Promise.resolve();
  if(phase==='restored')await ownerDrain;
  if(runtime)await negative('room-runtime',()=>runtime.shutdown());
  if(roomSource)await negative('room-source',()=>roomSource.drain());
  if(population)await negative('task-population',()=>population.close());
  if(services)await negative('services',()=>services.closeTaskSourceWritersForMigration());
  if(roomStore)await negative('room-store',()=>roomStore.close());
  if(budget)await negative('budget',()=>budget.dispose());
  if(groups)await negative('A-store',()=>groups.close());
  if(user)await negative('user-source',()=>user.drain());
  if(core){const closing=negative('core',()=>api.closeOriginalMainDshCoreInfrastructure(core));if(phase==='restored')await closing;}
  for(const request of requests)request.destroy();
  if(server){for(const socket of sockets)socket.destroy();await new Promise(yes=>server.close(yes));}
  await new Promise(yes=>setImmediate(yes));facts.openSockets=sockets.size;facts.requestClosed=requests.map(value=>value.closed);assert.equal(facts.openSockets,0);
  if(window)window.destroy();facts.windows=BrowserWindow.getAllWindows().length;facts.dockVisible=app.dock.isVisible();assert.equal(facts.windows,0);assert.equal(facts.dockVisible,false);
  if(phase==='restored'&&facts.negative.some(row=>row.state!=='fulfilled'))first??={raw:Error('cold cleanup unconfirmed')};
  facts.failed=first!==undefined;facts.explicitRestartWithHeld=phase==='fresh'&&!facts.failed;
  fs.writeFileSync(path.join(options.root,'protected-core-model-'+phase+'.json'),JSON.stringify(facts,null,2)+'\n');process.stdout.write(JSON.stringify(facts)+'\n');
  app.exit(facts.failed?1:0);
 }).catch(raw=>{globalThis.originalProtectedCoreSdkFatal=raw;process.stderr.write(JSON.stringify({kind:'protected-core-sdk-fatal',cause:cause(raw)})+'\n');app.exit(1);});
};
