const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const [bundle,domain,result,userData,mode]=process.argv.slice(2);const configRoot=path.join(domain,'fixture-config');fs.mkdirSync(configRoot,{mode:0o700});process.env.XIAOK_CONFIG_DIR=configRoot;
const app=require('electron').app;app.setPath('userData',userData);app.disableHardwareAcceleration();let native,client,owner;const closes=[];
let revokeArmed=false,revokeHits=0,lateGetterHits=0;
if(mode.startsWith('source-revoke')){
 const originalDlopen=process.dlopen;process.dlopen=function(module,filename,...rest){const value=Reflect.apply(originalDlopen,this,[module,filename,...rest]);if(path.basename(filename)!=='root_resource_authority_main.node')return value;const original=module.exports,descriptors=Object.getOwnPropertyDescriptors(original),verify=descriptors.assertOriginalModelSdkBridge.value;descriptors.assertOriginalModelSdkBridge={...descriptors.assertOriginalModelSdkBridge,value:function(...args){const raw=Reflect.apply(verify,original,args);if(revokeArmed&&new Error().stack.includes('consumeProcess')){revokeArmed=false;revokeHits++;if(mode==='source-revoke-getter')Object.defineProperty(client,'options',{configurable:true,get(){lateGetterHits++;throw Error('forbidden public options getter');}});else client.options={...client.options};}return raw;}};Object.defineProperty(module,'exports',{value:Object.create(null,descriptors)});process.dlopen=originalDlopen;return value;};
}
(async()=>{
 await app.whenReady();const api=await import(pathToFileURL(bundle).href),scope={profileId:'codex-profile',workspaceId:'codex-workspace'},forbidden=async()=>{throw Error('unused fixture effect');};
 const services=api.createDesktopServices({dataRoot:path.join(domain,'desktop'),runner:forbidden,kswarmService:{request:forbidden,getDesktopMutationToken:()=>''}});closes.push(()=>services.closeTaskSourceWritersForMigration());const workspace=new api.RoomWorkspaceLocalStore(path.join(domain,'room.sqlite'));closes.push(()=>workspace.close());const runtime=api.createRoomWorkspaceRuntime({store:workspace,broker:{get:forbidden,request:forbidden},wake:{claimWake:forbidden,completeWake:forbidden},execute:services.runCollaborationRoomAgentTask,ensureProtocol:forbidden});closes.push(()=>runtime.shutdown());const broker=api.createCollaborationRoomBrokerClient({token:'fixture-unused',fetchImpl:forbidden}),dispatcher=api.createCollaborationRoomWakeDispatcher({brokerClient:broker,execute:services.runCollaborationRoomAgentTask,executeTurn:runtime.run,canExecute:async()=>true}),source=api.createOriginalRoomTurnSource({dispatcher,runtime,services,scope});closes.push(()=>source.drain());
 const script=path.join(domain,'controlled-app-server.cjs');fs.writeFileSync(script,"const readline=require('node:readline');const input=readline.createInterface({input:process.stdin});input.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;if(m.method==='thread/start'&&'"+mode+"'==='rpc-failure'){process.stdout.write(JSON.stringify({id:m.id,error:{code:-32099,message:'controlled-primary'}})+'\\n');return;}const result=m.method==='initialize'?{serverInfo:'controlled-no-provider'}:m.method==='thread/start'||m.method==='thread/resume'?{thread:{id:'controlled-thread'}}:{};process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');});process.on('SIGTERM',()=>process.exit(0));");
 const store=new api.FileTaskSnapshotStore(path.join(domain,'tasks')),population=api.createTaskSourceWriterPopulation(store);closes.push(()=>population.close());let yes,no;const done=new Promise((a,b)=>{yes=a;no=b;});const host=population.createHost({materialRegistry:new api.MaterialRegistry({workspaceRoot:path.join(domain,'work'),maxBytes:1024}),runner:async()=>{
  try{
  let forbiddenHits=0;
  const getterOptions={cwd:domain};Object.defineProperty(getterOptions,'executable',{enumerable:true,get(){forbiddenHits++;throw Error('forbidden getter');}});
  assert.throws(()=>new api.SessionProbe(getterOptions),/CODEX_PROCESS_LAUNCH_INVALID/);
  const proxyOptions=new Proxy({}, {get(){forbiddenHits++;throw Error('forbidden proxy');},ownKeys(){forbiddenHits++;throw Error('forbidden ownKeys');}});
  assert.throws(()=>new api.SessionProbe(proxyOptions),/CODEX_PROCESS_LAUNCH_INVALID/);
  class ForeignProbe extends api.SessionProbe{};
  assert.throws(()=>new ForeignProbe({executable:script,cwd:domain}),/CODEX_PROCESS_LAUNCH_INVALID/);
  assert.equal(forbiddenHits,0);
  if(mode==='forged-service'||mode==='forged-session'){
    const session={view:{id:'forged-session',title:'Codex',cwd:domain,status:'disconnected',updatedAt:Date.now(),revision:0,messages:[],approvals:[],queued:0},nativeId:null,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[]};
    native=Object.create(api.CodexNativeService.prototype);Object.assign(native,{disposed:false,stopping:false,notices:new Map(),sessions:new Map([[session.view.id,session]]),db:{prepare(){return{run(){}};},close(){}},options:{profileId:'desktop-user:'+scope.profileId,createClient:options=>(client=new api.SessionProbe({...options,executable:script,prefixArgs:[]}))}});
    if(mode==='forged-session')native=new api.CodexNativeService({dbPath:path.join(domain,'genuine-service.sqlite'),profileId:'desktop-user:'+scope.profileId,createClient:options=>(client=new api.SessionProbe({...options,executable:script,prefixArgs:[]}))});
    let rejected=false;try{await native.connect(session);}catch{rejected=true;}assert.equal(rejected,true,'unborn Service/session must not mint original Source');assert.equal(client?.pid,undefined);await native.dispose();yes();return;
  }
  native=new api.CodexNativeService({dbPath:path.join(domain,'codex.sqlite'),profileId:'desktop-user:'+scope.profileId,createClient:options=>(client=new api.SessionProbe({...options,executable:script,prefixArgs:[]}))});revokeArmed=mode.startsWith('source-revoke');let creationFailed=false,creationError;try{await native.create({requestSource:'user',actorId:'desktop-user:'+scope.profileId},domain);}catch(error){creationFailed=true;creationError=error;}
  if(mode==='foreign-service'){assert.equal(creationFailed,true,'new foreign genuine Service under another original Host must not mint Codex source');assert.equal(client?.pid,undefined);await native.dispose();yes();return;}
  if(mode.startsWith('source-revoke')){
    assert.equal(revokeHits,1);assert.equal(lateGetterHits,0,'Source/cleanup must not invoke a replaced public options getter');assert.equal(creationFailed,true,'post-consume Native SDK Source revocation must deny before actual spawn');assert.equal(client.pid,undefined);
    const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n,0,'known not-started original attempt must return P');}finally{db.close();}
    await native.dispose();yes();return;
  }
  if(mode==='rpc-failure'){
    assert.equal(creationFailed,true);const graph=[];const visit=error=>{if(!error||typeof error!=='object'||graph.includes(error))return;graph.push(error);visit(error.cause);if(Array.isArray(error.errors))for(const child of error.errors)visit(child);};visit(creationError);
    assert.ok(graph.some(error=>error.message==='RPC error -32099: controlled-primary'),'original RPC primary must survive unknown process cleanup');assert.equal(client.exited,true);yes();return;
  }
  assert.equal(mode,'held','fixture mode must execute its dedicated branch');if(creationFailed)throw creationError;assert.ok(client.pid);
  const sourceTicket=api.createOriginalCodexProcessSourceTicket(client),request=api.readOptionalOriginalCodexProcessSourceRequest(sourceTicket);
  assert.equal(api.createOriginalCodexProcessSourceTicket(client),sourceTicket);
  assert.equal(request.sourceKind,'codex_transport');assert.equal(request.operation,'spawn');assert.equal(request.domain,'component_only');
  assert.equal(request.context,api.readCurrentOriginalTaskRunnerResourceContext());assert.equal(request.command,process.execPath);assert.equal(request.argv[0],script);
  assert.equal(request.assertCurrent(),undefined);assert.equal(request.assertLocal(),undefined);
  assert.equal(api.readOptionalOriginalCodexProcessSourceRequest({...sourceTicket}),undefined);
  assert.equal(api.readOptionalOriginalCodexProcessSourceRequest(new Proxy({}, {get(){forbiddenHits++;throw Error('proxy');}})),undefined);assert.equal(forbiddenHits,0);
  fs.writeFileSync(path.join(domain,'sdk-child.json'),JSON.stringify({pid:client.pid}));const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n,1,'actual original Codex app-server process must hold original P before RPC');}finally{db.close();}await assert.rejects(native.dispose(),/native_shutdown_unconfirmed/);assert.equal(client.exited,true);assert.throws(()=>process.kill(client.pid,0));
  const heldDb=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});try{assert.equal(heldDb.prepare("SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n,1,'component close must not refund unknown Codex domain');}finally{heldDb.close();}
  yes();}catch(error){try{await native?.dispose();}catch{}no(error);throw error;}
 }});await api.readOriginalTaskHostIdentityIO(host,store).initialize();owner=api.createOriginalMainRootAdmissionOwner({roomSource:source,host,store});await owner.room.claimNext();
 if(mode==='no-context'){
   const orphan=new api.SessionProbe({executable:script,prefixArgs:[],cwd:domain});await assert.rejects(orphan.connect(),/CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED/);assert.equal(orphan.pid,undefined);await orphan.close();
   native=new api.CodexNativeService({dbPath:path.join(domain,'orphan.sqlite'),profileId:'desktop-user:'+scope.profileId,createClient:options=>(client=new api.SessionProbe({...options,executable:script,prefixArgs:[]}))});
   await assert.rejects(native.create({requestSource:'user',actorId:'desktop-user:'+scope.profileId},domain),/CODEX_PROCESS_ORIGINAL_CONTEXT_REQUIRED/);assert.equal(client.pid,undefined);await native.dispose();
   const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM root_physical_resources').get().n,0);}finally{db.close();}
   for(const close of closes.reverse())await close();fs.writeFileSync(result,JSON.stringify({ok:true,pid:process.pid,actualMain:true,actualNativeBridge:true,missingOriginalContextSdkCalls:0,notProductionQualification:true}));app.exit(0);return;
 }
 await host.createTask({prompt:'Controlled native process, no model/provider',materials:[]});await done;await host.drain();for(const close of closes.reverse())await close();fs.writeFileSync(result,JSON.stringify({ok:true,pid:process.pid,actualMain:true,actualPopulationHost:true,actualServiceAndSessionProbe:true,sdkChildPid:client?.pid,sdkChildClosed:client?.exited,unknownDomainPStillHeld:mode!=='source-revoke',revokeHits,notProductionQualification:true}));app.exit(0);
})().catch(async error=>{try{await native?.dispose();}catch{}fs.writeFileSync(result,JSON.stringify({ok:false,pid:process.pid,sdkChildPid:client?.pid,error:error.stack}));app.exit(1);});
