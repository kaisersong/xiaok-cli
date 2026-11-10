'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http'),{pathToFileURL}=require('node:url');
const [repo,bundle,root,scenario]=process.argv.slice(2);process.env.XIAOK_CONFIG_DIR=path.join(root,'config');fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const facts={pid:process.pid,productionQualified:false,httpPaths:[],children:[]},workers=new Set();require('node:async_hooks').createHook({init(id,type){if(type==='WORKER')workers.add(id);},destroy(id){workers.delete(id);}}).enable();let api,service,services,user,source,server,brokerStore,window,healthy=false,heldServer,heldOrigin,armed=false,transientArmed=false,transientResponse;const heldRequests=[],controls=[];let tlsServer,controller;const tlsSockets=new Set();let releaseSdkTail;const sdkTail=new Promise(yes=>releaseSdkTail=yes);
async function run(){
 await app.whenReady();
 // Fixture transport forwards only the fixed original local paths to one real
 // ephemeral HTTP server. Every returned Response is from original fetch.
 const nativeFetch=globalThis.fetch;let origin;
 const nativeAbort=AbortController.prototype.abort;let abortDepth=0;AbortController.prototype.abort=function(reason){const direct=abortDepth===0;if(direct&&reason?.message==='BROKER_DSH_CONTROL_CLOSED')facts.abortCalls=(facts.abortCalls??0)+1;abortDepth++;try{return nativeAbort.call(this,reason);}finally{abortDepth--;}};
 globalThis.fetch=function(input,init){const url=new URL(String(input));assert.ok(url.hostname==='127.0.0.1'||url.hostname==='localhost');assert.ok(['4318','4400'].includes(url.port));facts.httpPaths.push({port:url.port,path:url.pathname});if(url.port==='4400'&&url.pathname==='/health')return Promise.resolve(new Response(JSON.stringify({ok:healthy,features:['dynamic_workflows'],service:{entryPath:path.resolve(repo,'../kswarm/test/fixtures/owned-dsh-business/entry.js'),sourceHash:api.computeKSwarmServiceSourceHash(path.resolve(repo,'../kswarm/test/fixtures/owned-dsh-business/entry.js'))}}),{status:healthy?200:503}));return nativeFetch(new URL(url.pathname+url.search,origin),init);};
 // Capture the original Node API before the first product import. Only this
 // fixture's fixed control routes are rewritten to its real ephemeral server.
 if(scenario==='transient_own_unknown'){
 const bytesNative=Response.prototype.arrayBuffer,thenNative=Promise.prototype.then;
 const ownKeysNative=Reflect.ownKeys,descriptorNative=Object.getOwnPropertyDescriptor;
 const transientKey=Symbol('actual-original-response-transient-accessor');
 facts.transientTrace=[];
 Reflect.ownKeys=function(value){
  const result=ownKeysNative(value);
  if(value===transientResponse){
   const stack=new Error().stack,present=!!descriptorNative(value,transientKey);
   facts.transientTrace.push({event:'response_own_keys',present,stack});
   if(present&&/at inventory \(/.test(stack))queueMicrotask(()=>{delete value[transientKey];facts.transientTrace.push({event:'accessor_removed'});});
  }
  return result;
 };
 Response.prototype.arrayBuffer=function(...args){
  const raw=Reflect.apply(bytesNative,this,args);
  if(transientArmed){
   transientArmed=false;const response=this;
   Reflect.apply(thenNative,raw,[()=>{
    transientResponse=response;
    Object.defineProperty(response,transientKey,{configurable:true,get(){facts.transientGetterHits=(facts.transientGetterHits??0)+1;return undefined;}});
    facts.transientTrace.push({event:'accessor_added'});
   },()=>{}]);
  }
  return raw;
 };
 }
 const nativeHttpRequest=http.request;
 http.request=function(input,options,callback){
  const url=input instanceof URL?input:new URL(String(input));
  if(url.origin!=='http://127.0.0.1:4318')return nativeHttpRequest.apply(this,arguments);
  assert.match(url.pathname,/^\/rooms\/admission-control\/(baseline|apply|read)$/);
  assert.equal(url.search,'');assert.equal(options.agent,false);assert.equal(options.headers.connection,'close');
  facts.httpPaths.push({port:url.port,path:url.pathname});facts.controlNodeRequests=(facts.controlNodeRequests??0)+1;
  const held=armed&&(url.pathname.endsWith('/baseline')||url.pathname.endsWith('/read'));
  const raw=nativeHttpRequest.call(this,new URL(held?'/held':url.pathname,held?heldOrigin:origin),options,callback);
  if(held){Object.defineProperty(raw,Symbol('held-sdk-tail'),{value:sdkTail});raw.once('socket',socket=>socket.once('connect',()=>{Object.defineProperty(raw,Symbol('unconfirmed-sdk-accessor'),{get(){facts.getterCalls=(facts.getterCalls??0)+1;throw Error('must-not-call');}});}));}
  return raw;
 };
 require('node:module').syncBuiltinESMExports();
 if(scenario==='off_down'){
  const https=require('node:https'),cert=fs.readFileSync(path.join(repo,'tests/fixtures/sol-pi-tls/cert.pem')),key=fs.readFileSync(path.join(repo,'tests/fixtures/sol-pi-tls/key.pem')),request=https.request;
  tlsServer=https.createServer({cert,key},(req,res)=>{facts.githubInvalidCredentialRequests=(facts.githubInvalidCredentialRequests??0)+1;assert.equal(req.url,'/user');assert.equal(req.headers.authorization,'Bearer deliberately-expired-private-fixture');res.writeHead(401,{'content-type':'application/json'});res.end('{"message":"Bad credentials"}');});tlsServer.on('connection',socket=>{tlsSockets.add(socket);socket.once('close',()=>tlsSockets.delete(socket));});await new Promise(yes=>tlsServer.listen(0,'127.0.0.1',yes));
  const origin='https://127.0.0.1:'+tlsServer.address().port;https.request=function(url,options,callback){assert.equal(url.origin,'https://api.github.com');return request.call(this,new URL(url.pathname+url.search,origin),{...options,ca:cert},callback);};require('node:module').syncBuiltinESMExports();
 }
 api=await import(pathToFileURL(bundle).href);
 const dataRoot=path.join(root,'desktop'),workspaceRoot=path.join(root,'workspace');fs.mkdirSync(workspaceRoot,{recursive:true});const actual=api.resolveDesktopServiceScope({dataRoot,workspaceRoot}),scope={profileId:actual.profileId,workspaceId:actual.workspaceId};
 const html=path.join(root,'index.html');fs.writeFileSync(html,'<!doctype html><title>Original Broker control</title>');window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadFile(html);
 user=api.createMainDshControlSource({window,scope,isTrustedUrl:url=>url===pathToFileURL(html).href});const sources=api.createOriginalMainDshServiceSources({scope,userSource:user}),actor=Object.freeze({requestSource:'user',principalId:'desktop-main-window'});
 await api.prepareOriginalMainDshServiceSources(sources,{dataRoot,workspaceRoot,harnessUserActor:actor});const lease=api.readOriginalMainDshPreparedSources(sources);
 const entry=path.resolve(repo,'../kswarm/test/fixtures/owned-dsh-business/entry.js');process.env.KSWARM_SERVER_PATH=entry;fs.mkdirSync(path.join(root,'business'),{recursive:true});
 service=api.createKSwarmService({desktopProjectScope:scope,ownedDshAdmission:lease.businessSource.admission,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('unrelated_process_must_not_be_killed');},spawnProcess:(_exe,args,options)=>{
  assert.ok(args.includes(entry));const child=require('node:child_process').spawn(process.execPath,[entry],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:'1',DSH_BUSINESS_ROOT:path.join(root,'business'),DSH_BUSINESS_SCOPE:JSON.stringify(scope)}}),row={pid:child.pid,closed:false};facts.children.push(row);child.on('message',message=>{if(message.protocol==='fixture_ready')healthy=true;});child.stdout.on('data',()=>{});child.stderr.on('data',v=>process.stderr.write(v));child.once('close',(code,signal)=>{healthy=false;Object.assign(row,{closed:true,code,signal});});return child;
 }});
 const {createRoomStore}=await import(pathToFileURL(path.resolve(repo,'../intent-broker/src/room/store.js')).href),{createRoomService}=await import(pathToFileURL(path.resolve(repo,'../intent-broker/src/room/service.js')).href),{createServer}=await import(pathToFileURL(path.resolve(repo,'../intent-broker/src/http/server.js')).href);
 brokerStore=createRoomStore({dbPath:path.join(root,'broker.sqlite')});brokerStore.migrate();
 const token=service.getIntentBrokerRoomToken();server=createServer({broker:{},roomService:createRoomService({store:brokerStore}),roomDesktopToken:token,roomKSwarmToken:'isolated-other-system',healthProvider:()=>({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:api.computeKSwarmServiceSourceHash(entry)}})});await server.listen(0,'127.0.0.1');origin='http://127.0.0.1:'+server.address().port;
 services=api.createDesktopServices({dataRoot,workspaceRoot,kswarmService:service,harnessOptimizationUserActor:actor,dshServiceSources:sources,materialUserSource:user,modelProbeUserSource:user,knowledgeDbPath:path.join(root,'profile','knowledge.db')});const binding=api.readOriginalMainDshServicesBinding(services,sources);await binding.constructionReady;await service.start();
 const port=api.readOriginalDshAdmissionPort(binding.store,lease.realm),event={sender:window.webContents,senderFrame:window.webContents.mainFrame},body={schemaVersion:1,expectedDomainRevision:0,ownerDomainIds:[]};
 if(scenario!=='cold_read'){const enrollment=user.open(event,'enroll_authority',body,'user');try{port.enrollAuthority(enrollment.proof,{requestSource:'user',bodyHash:enrollment.bodyHash,bootstrapAuthority:lease.realm});}finally{enrollment.release();}}
 source=await api.createMainDshBrokerControlSource({services,sources,client:api.createCollaborationRoomBrokerClient({token})});
 const reply=await source.prepareOwner(new AbortController().signal),view=api.readOriginalMainDshBrokerReply(reply,lease.realm,binding.store,lease.realm);await view.waitKnown();view.assertKnown();view.assertCurrent();
 assert.equal(view.output.domain.kind,'broker_dsh');assert.equal(view.output.domain.ownerKind,'active_pointer');assert.equal(view.output.visibility.kind,'no_visibility');facts.realBrokerReply=true;
 assert.equal(brokerStore.db.prepare('SELECT count(*) AS n FROM rooms').get().n,0);assert.equal(brokerStore.db.prepare('SELECT count(*) AS n FROM room_admission_receipts').get().n,1);
 assert.equal(typeof port.registerBrokerOwnerDomain,'function','original A must expose a distinct Broker private-receipt registration');
 if(scenario==='forged_reply'){
  const originalRealm=brokerStore.getSourceRealm(),forgedRealm='11111111-1111-4111-8111-111111111111',domain=view.output.domain,r=view.output.receipt,scopeKey=domain.domainId.split(':').at(-1);let rejected=false;
  try{domain.storeId=forgedRealm;domain.domainId='broker-dsh:'+forgedRealm+':'+scopeKey;r.realmId=forgedRealm;r.domainId=domain.domainId;r.durableGuard=api.brokerAdmissionDigest({realmId:forgedRealm,scopeKey,request:r.request,storageRevision:r.storageRevision});}catch(raw){rejected=raw instanceof TypeError;}
  if(!rejected)await assert.rejects(port.registerBrokerOwnerDomain(reply,{requestSource:'scheduler',bootstrapAuthority:lease.realm}),'mutated genuine private reply must never authenticate a different Broker realm');
  else{const registered=await port.registerBrokerOwnerDomain(reply,{requestSource:'scheduler',bootstrapAuthority:lease.realm});assert.equal(registered.registration.storeId,originalRealm);facts.registered=true;}
  facts.deepImmutable=rejected;assert.equal(rejected,true);source.release(reply);await source.close();facts.servicesDrained=(await services.disposeMultiAgent()).drained;await api.sealAndDrainKSwarmServiceInstance(service);user.seal();await user.drain();window.destroy();await server.close();brokerStore.close();facts.ok=true;return;
 }

 const registered=await port.registerBrokerOwnerDomain(reply,{requestSource:'scheduler',bootstrapAuthority:lease.realm});assert.equal(registered.registration.kind,'active_pointer');facts.registered=true;source.release(reply);
 if(scenario==='transient_own_unknown'){
  transientArmed=true;let rejected=false;
  try{await source.prepareOwner(new AbortController().signal);}catch(raw){rejected=true;facts.transientFailure=String(raw);}
  facts.transientRejected=rejected;assert.equal(rejected,true);
  facts.transientGetterHits??=0;assert.equal(facts.transientGetterHits,0);
  assert.equal(facts.transientTrace.filter(row=>row.event==='accessor_added').length,1);
  assert.equal(facts.transientTrace.filter(row=>row.event==='accessor_removed').length,1);
  assert.ok(facts.transientTrace.some(row=>row.event==='response_own_keys'&&row.present&&/at inventory \(/.test(row.stack)),'must hit actual owned-reader inventory while accessor exists');
  assert.ok(facts.transientTrace.some(row=>row.event==='response_own_keys'&&!row.present&&/resourceInventory/.test(row.stack)),'must hit later actual outer rescan after accessor removed');
  let closed=false;try{await source.close();closed=true;}catch(raw){facts.transientCloseFailure=String(raw);}
  facts.transientCloseResolved=closed;
  assert.equal(closed,false,'observed ownUnknown must remain physically unknown across the original Source boundary');
  facts.servicesDisposalAttempted=false;facts.workersRetainedUntilExit=workers.size;assert.ok(workers.size>0);
  await api.sealAndDrainKSwarmServiceInstance(service);user.seal();await user.drain();window.destroy();await server.close();brokerStore.close();facts.ok=true;return;
 }
 if(scenario==='cold_prepare'||scenario==='cold_read'){
  facts.coldRegistration=registered.registration;facts.coldAuthority=api.readOriginalDshDomainMetadata(lease.realm,binding.store,lease.realm,scope);facts.coldReceiptRows=brokerStore.db.prepare('SELECT count(*) AS n FROM room_admission_receipts').get().n;facts.coldRoomRows=brokerStore.db.prepare('SELECT count(*) AS n FROM rooms').get().n;
  const controls=facts.httpPaths.filter(row=>row.path.startsWith('/rooms/admission-control/'));assert.deepEqual(controls.map(row=>row.path),[scenario==='cold_prepare'?'/rooms/admission-control/baseline':'/rooms/admission-control/read']);facts.coldReadOnly=scenario==='cold_read';
  await source.close();facts.servicesDrained=(await services.disposeMultiAgent()).drained;assert.equal(facts.servicesDrained,true);await api.sealAndDrainKSwarmServiceInstance(service);user.seal();await user.drain();window.destroy();await server.close();brokerStore.close();facts.ok=true;return;
 }
 if(scenario==='stop_after_fault'){
  facts.abortCalls=0;facts.getterCalls=0;heldServer=http.createServer((request,response)=>{heldRequests.push({request,response});});await new Promise(yes=>heldServer.listen(0,'127.0.0.1',yes));heldOrigin='http://127.0.0.1:'+heldServer.address().port;armed=true;
  const operations=[];for(let i=0;i<2;i++){const control=new AbortController();controls.push(control);operations.push(source.prepareOwner(control.signal).then(()=>({ok:true}),raw=>({raw})));}
  for(let i=0;i<100&&heldRequests.length!==2;i++)await new Promise(yes=>setTimeout(yes,5));assert.equal(heldRequests.length,2);
  let stopError;try{source.stopAccepting();}catch(raw){stopError=raw;}
  let closeSettled=false;const close=Promise.resolve().then(()=>source.close()).then(()=>{closeSettled=true;return{ok:true};},raw=>{closeSettled=true;return{raw};});await new Promise(yes=>setTimeout(yes,20));facts.closeSettledBeforeTail=closeSettled;facts.abortCallsBeforeCleanup=facts.abortCalls;
  // Always reclaim the fixture's real HTTP even when the product stop gate is
  // the deliberately failing red. This is diagnostic cleanup, never a receipt.
  for(const control of controls)control.abort(Error('fixture_diagnostic_cleanup'));releaseSdkTail();const outcomes=await Promise.all(operations),closed=await close;facts.closeRejected=!closed.ok;facts.closeSameFirstCause=closed.raw===stopError;facts.sdkOutcomes=outcomes.length;assert.equal(facts.abortCallsBeforeCleanup,2);assert.equal(facts.closeSettledBeforeTail,false);assert.equal(facts.closeRejected,true);assert.equal(facts.getterCalls,0);
  await api.sealAndDrainKSwarmServiceInstance(service);user.seal();await user.drain();window.destroy();await new Promise(yes=>heldServer.close(yes));await server.close();brokerStore.close();facts.servicesDisposalAttempted=false;facts.workersRetainedUntilExit=workers.size;assert.ok(facts.workersRetainedUntilExit>0);facts.ok=true;return;
 }

 if(scenario==='off_down'){
  controller=api.createDshDesktopController({scope,realm:lease.realm,store:binding.store,userSource:user,runtime:lease.runtime,sourcePopulation:lease.sourcePopulation,budgetSource:lease.budgetSource,brokerSource:source});
  for(const scopeKind of ['global','tenant','workspace'])await controller.setMode(event,{schemaVersion:1,scopeKind,...(scopeKind==='global'?{}:{tenantId:'isolated-tenant'}),sourceBindingId:null,mode:'observe',expectedRevision:0});
  await controller.configureSetup(event,{schemaVersion:1,tenantId:'isolated-tenant',setupId:'expired-github',candidateRepository:{owner:'octo',repo:'demo'},selection:{kind:'label_ids',match:'all',labelIds:['7']},issueRefs:[],minimumIntervalMs:1000,expectedRevision:0});
  await assert.rejects(controller.connect(event,{schemaVersion:1,kind:'setup',setupId:'expired-github',configurationRevision:1,operationId:'bad-github',secret:'deliberately-expired-private-fixture'}));assert.equal(facts.githubInvalidCredentialRequests,1);
  await source.reconcileControls(new AbortController().signal);
  await server.close();server=null;
  const diagnostic=require('node:diagnostics_channel'),events=[],observe=value=>events.push(value),channels=['undici:request:create','http.client.request.start'].map(name=>diagnostic.channel(name));for(const channel of channels)channel.subscribe(observe);
  let state;try{state=await controller.setMode(event,{schemaVersion:1,scopeKind:'global',sourceBindingId:null,mode:'off',expectedRevision:1});}finally{for(const channel of channels)channel.unsubscribe(observe);}
  facts.offNewHttpRequests=events.length;assert.equal(events.length,0);const rawState=api.readOriginalDshDesktopState(lease.realm,binding.store,lease.realm,scope),global=rawState.modes.find(row=>row.identity.kind==='global');assert.equal(global.value.mode,'off');assert.equal(global.status,'accepted_pending_owner_fence');facts.localOffPersisted=true;facts.brokerPending=true;
  controller.ingress.stopAccepting();controller.ingress.abortAllActive('fixture_shutdown');await controller.close();await source.close();facts.servicesDrained=(await services.disposeMultiAgent()).drained;assert.equal(facts.servicesDrained,true);await api.sealAndDrainKSwarmServiceInstance(service);user.seal();await user.drain();window.destroy();for(const socket of tlsSockets)socket.destroy();await new Promise(yes=>tlsServer.close(yes));brokerStore.close();facts.ok=true;return;
 }
 const controlBody={control:{kind:'mode',identity:{kind:'global'},mode:'off',epoch:1},expectedRevision:0},controlFrame=user.open(event,'policy_control',controlBody,'user');let accepted;
 try{accepted=port.applyControl(controlFrame.proof,{requestSource:'user',bodyHash:controlFrame.bodyHash,bootstrapAuthority:lease.realm});}finally{controlFrame.release();}
 const state=api.readOriginalDshDesktopState(lease.realm,binding.store,lease.realm,scope),pending=state.pendingOwnerCommands.find(row=>row.ownerDomain===registered.registration.domainId);assert.ok(pending,'Broker control must remain pending until its own HTTP receipt');
 assert.equal(typeof port.importBrokerControlReceipt,'function');
 const controlReply=await source.applyControl(pending.commandId,pending.ownerDomain,new AbortController().signal);
 const imported=await port.importBrokerControlReceipt(controlReply,{requestSource:'scheduler',bootstrapAuthority:lease.realm});assert.equal(imported.receipt.kind,'original_broker_control_receipt');source.release(controlReply);facts.appliedAndImported=true;
 for(const axis of ['privacy','egress']){
  const body={control:{kind:'scope_policy',identity:{kind:'global'},axis,allowed:false,epoch:1},expectedRevision:0},frame=user.open(event,'policy_control',body,'user');try{port.applyControl(frame.proof,{requestSource:'user',bodyHash:frame.bodyHash,bootstrapAuthority:lease.realm});}finally{frame.release();}
  const next=api.readOriginalDshDesktopState(lease.realm,binding.store,lease.realm,scope).pendingOwnerCommands.find(row=>row.ownerDomain===registered.registration.domainId);assert.ok(next);
  const actual=await source.applyControl(next.commandId,next.ownerDomain,new AbortController().signal);await port.importBrokerControlReceipt(actual,{requestSource:'scheduler',bootstrapAuthority:lease.realm});source.release(actual);
 }
 facts.brokerAxes=brokerStore.db.prepare('SELECT axis FROM room_admission_heads ORDER BY axis').all().map(row=>row.axis);assert.deepEqual(facts.brokerAxes,['authorization','egress','mode']);

 const after=api.readOriginalDshDesktopState(lease.realm,binding.store,lease.realm,scope);assert.equal(after.pendingOwnerCommands.filter(row=>row.ownerDomain===registered.registration.domainId).length,0);assert.equal(after.modes.find(row=>row.identity.kind==='global').status,'effective');

 await source.close();
 const {DatabaseSync}=require('node:sqlite'),coldDb=new DatabaseSync(path.join(dataRoot,'multi-agent','groups.sqlite'));
 function coldRows(){
  const rows=[{table:'dsh_a_profile',row:coldDb.prepare('SELECT * FROM dsh_a_profile').get()}];
  for(const table of api.DSH_A_AUTHORITY_TABLES)for(const row of coldDb.prepare('SELECT * FROM '+table).all()){api.readDshAuthorityColdRow(table,row);rows.push({table,row});}
  return rows;
 }
 api.validateDshAuthorityColdGraph(coldRows());facts.coldFullGraph=true;
 const table='dsh_a_control_domain_receipts',row=coldDb.prepare("SELECT * FROM dsh_a_control_domain_receipts WHERE json_extract(data_json,'$.kind')='original_broker_control_receipt' LIMIT 1").get();
 const guards=coldDb.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table),old=JSON.parse(row.data_json),broken=JSON.parse(row.data_json);broken.brokerReceipt.request.commandHash='f'.repeat(64);const request=broken.brokerReceipt.request,scopeKey=broken.brokerReceipt.domainId.split(':').at(-1);broken.brokerReceipt.durableGuard=api.brokerAdmissionDigest({realmId:broken.brokerReceipt.realmId,scopeKey,request,storageRevision:broken.brokerReceipt.storageRevision});broken.receiptId='broker-control:'+api.brokerAdmissionDigest(broken.brokerReceipt);const json=api.dshAJson(broken);
 coldDb.exec('BEGIN IMMEDIATE');try{for(const guard of guards)coldDb.exec('DROP TRIGGER '+guard.name);coldDb.prepare('UPDATE dsh_a_control_domain_receipts SET receipt_id=?,receipt_hash=?,data_json=?,body_hash=?,logical_bytes=? WHERE scope_id=? AND operation_id=? AND owner_domain=?').run(broken.receiptId,api.dshAHash(broken),json,api.dshAHash(['dsh-a-authority-row-v1',table,broken]),Buffer.byteLength(json),row.scope_id,row.operation_id,row.owner_domain);for(const guard of guards)coldDb.exec(guard.sql);coldDb.exec('COMMIT');}catch(raw){coldDb.exec('ROLLBACK');throw raw;}
 assert.throws(()=>api.validateDshAuthorityColdGraph(coldRows()),/DSH_A_COLD_BROKER_CONTROL_RELATION/);facts.coldRehashedForeignCommandRejected=true;
 coldDb.exec('BEGIN IMMEDIATE');try{for(const guard of guards)coldDb.exec('DROP TRIGGER '+guard.name);coldDb.prepare('UPDATE dsh_a_control_domain_receipts SET receipt_id=?,receipt_hash=?,data_json=?,body_hash=?,logical_bytes=? WHERE scope_id=? AND operation_id=? AND owner_domain=?').run(row.receipt_id,row.receipt_hash,row.data_json,row.body_hash,row.logical_bytes,row.scope_id,row.operation_id,row.owner_domain);for(const guard of guards)coldDb.exec(guard.sql);coldDb.exec('COMMIT');}catch(raw){coldDb.exec('ROLLBACK');throw raw;}api.validateDshAuthorityColdGraph(coldRows());coldDb.close();
 facts.servicesDrained=(await services.disposeMultiAgent()).drained;assert.equal(facts.servicesDrained,true);await api.sealAndDrainKSwarmServiceInstance(service);user.seal();await user.drain();window.destroy();await server.close();brokerStore.close();facts.ok=true;
}
run().then(()=>{fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));app.exit(0);},async raw=>{
 const chain=[];let value=raw;for(let i=0;i<8&&value&&typeof value==='object';i++){const m=Object.getOwnPropertyDescriptor(value,'message'),c=Object.getOwnPropertyDescriptor(value,'cause');chain.push(m&&Object.hasOwn(m,'value')?m.value:'unknown');value=c&&Object.hasOwn(c,'value')?c.value:undefined;}Object.assign(facts,{ok:false,error:String(raw),stack:raw?.stack,chain});console.error(raw);
 for(const control of controls)control.abort(Error('fixture_diagnostic_cleanup'));releaseSdkTail();if(heldServer)heldServer.close();try{if(controller){controller.ingress.stopAccepting();controller.ingress.abortAllActive('fixture_failure');await controller.close();}}catch{}try{if(source)await source.close();}catch{}try{if(services)facts.servicesDrained=(await services.disposeMultiAgent()).drained;}catch{}try{if(service)await api.sealAndDrainKSwarmServiceInstance(service);}catch{}try{if(user){user.seal();await user.drain();}}catch{}try{if(server)await server.close();}catch{}try{brokerStore?.close();}catch{}for(const socket of tlsSockets)socket.destroy();if(tlsServer)tlsServer.close();fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));app.exit(1);
});
