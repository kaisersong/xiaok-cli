'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const [bundle,domain,result,userData,mode]=process.argv.slice(2);
const configRoot=path.join(domain,'fixture-config');fs.mkdirSync(configRoot,{mode:0o700});process.env.XIAOK_CONFIG_DIR=configRoot;
const app=require('electron').app;app.setPath('userData',userData);app.disableHardwareAcceleration();
let bridge,client,owner,creationError,revokeArmed=false,revokeHits=0,lateGetterHits=0;const closes=[];
if(mode.startsWith('source-revoke')){
 const originalDlopen=process.dlopen;process.dlopen=function(module,filename,...rest){const value=Reflect.apply(originalDlopen,this,[module,filename,...rest]);if(path.basename(filename)!=='root_resource_authority_main.node')return value;const original=module.exports,descriptors=Object.getOwnPropertyDescriptors(original),verify=descriptors.assertOriginalModelSdkBridge.value;descriptors.assertOriginalModelSdkBridge={...descriptors.assertOriginalModelSdkBridge,value:function(...args){const raw=Reflect.apply(verify,original,args);if(revokeArmed&&new Error().stack.includes('consumeProcess')){revokeArmed=false;revokeHits++;if(mode==='source-revoke-getter')Object.defineProperty(client,'options',{configurable:true,get(){lateGetterHits++;throw Error('forbidden public options getter');}});else client.options={...client.options};}return raw;}};Object.defineProperty(module,'exports',{value:Object.create(null,descriptors)});process.dlopen=originalDlopen;return value;};
}
function graph(raw){const rows=[];function visit(value){if(!value||typeof value!=='object'||rows.includes(value))return;rows.push(value);visit(value.cause);if(Array.isArray(value.errors))for(const child of value.errors)visit(child);}visit(raw);return rows;}
(async()=>{
 await app.whenReady();const api=await import(pathToFileURL(bundle).href),scope={profileId:'codex-profile',workspaceId:'codex-workspace'},forbidden=async()=>{throw Error('unused fixture effect');};
 const services=api.createDesktopServices({dataRoot:path.join(domain,'desktop'),runner:forbidden,kswarmService:{request:forbidden,getDesktopMutationToken:()=>''}});closes.push(()=>services.closeTaskSourceWritersForMigration());
 const workspace=new api.RoomWorkspaceLocalStore(path.join(domain,'room.sqlite'));closes.push(()=>workspace.close());const runtime=api.createRoomWorkspaceRuntime({store:workspace,broker:{get:forbidden,request:forbidden},wake:{claimWake:forbidden,completeWake:forbidden},execute:services.runCollaborationRoomAgentTask,ensureProtocol:forbidden});closes.push(()=>runtime.shutdown());
 const broker=api.createCollaborationRoomBrokerClient({token:'fixture-unused',fetchImpl:forbidden}),dispatcher=api.createCollaborationRoomWakeDispatcher({brokerClient:broker,execute:services.runCollaborationRoomAgentTask,executeTurn:runtime.run,canExecute:async()=>true}),source=api.createOriginalRoomTurnSource({dispatcher,runtime,services,scope});closes.push(()=>source.drain());
 const script=path.join(domain,'controlled-app-server.cjs');
 fs.writeFileSync(script,`const input=require('node:readline').createInterface({input:process.stdin});const send=x=>console.log(JSON.stringify(x));input.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const ok=result=>send({id:m.id,result});if(m.method==='initialize')ok({serverInfo:'controlled-no-provider'});else if(m.method==='thread/start'||m.method==='thread/resume'){if(${JSON.stringify(mode)}==='rpc-failure')send({id:m.id,error:{code:-32099,message:'controlled-primary'}});else ok({thread:{id:'controlled-thread'}});}else if(m.method==='turn/start'){send({method:'turn/started',params:{threadId:'controlled-thread',turn:{id:'controlled-turn',status:'inProgress'}}});ok({turn:{id:'controlled-turn'}});send({method:'item/agentMessage/delta',params:{threadId:'controlled-thread',turnId:'controlled-turn',itemId:'answer',delta:'controlled response'}});send({method:'turn/completed',params:{threadId:'controlled-thread',turn:{id:'controlled-turn',status:'completed'}}});}else ok({});});process.on('SIGTERM',()=>process.exit(0));`);
 const store=new api.FileTaskSnapshotStore(path.join(domain,'tasks')),population=api.createTaskSourceWriterPopulation(store);closes.push(()=>population.close());
 const originalCreate=api.CodexNativeService.prototype.create;
 api.CodexNativeService.prototype.create=function(...args){return Reflect.apply(originalCreate,this,args).then(value=>value,error=>{creationError=error;throw error;});};
 bridge=new api.CodexTaskBridge({dataRoot:path.join(domain,'codex-bridge'),profileId:'desktop-user:'+scope.profileId,cwd:domain,materialRegistry:new api.MaterialRegistry({workspaceRoot:path.join(domain,'work'),maxBytes:1024}),snapshotStore:store,sourcePopulation:population,createClient:options=>(client=new api.SessionProbe({...options,executable:script,prefixArgs:[]}))});
 await api.readOriginalTaskHostIdentityIO(bridge.host,store).initialize();owner=api.createOriginalMainRootAdmissionOwner({roomSource:source,host:bridge.host,store});await owner.room.claimNext();
 if(mode==='foreign-host'){
   let yes,no;const done=new Promise((a,b)=>{yes=a;no=b;});
   const foreignHost=population.createHost({materialRegistry:new api.MaterialRegistry({workspaceRoot:path.join(domain,'foreign-work'),maxBytes:1024}),runner:async input=>{
     try{let error;try{await bridge.host.options.runner(input);}catch(raw){error=raw;}assert.equal(error?.message,'TASK_RUNNER_ORIGINAL_HOST_CONTEXT_REQUIRED');assert.equal(client,undefined);yes();}catch(raw){no(raw);throw raw;}
   }});
   await foreignHost.createTask({prompt:'Foreign original Host in same Population',materials:[]});await done;await foreignHost.drain();await bridge.dispose();for(const close of closes.reverse())await close();fs.writeFileSync(result,JSON.stringify({ok:true,pid:process.pid,actualMain:true,actualCodexTaskBridge:true,actualForeignHost:true,missingExactHostSdkCalls:0,notProductionQualification:true}));app.exit(0);return;
 }
 revokeArmed=mode.startsWith('source-revoke');
 const task=await bridge.create({prompt:'Controlled native process, no model/provider',materials:[],context:{threadId:'actual-bridge-thread'}},{requestSource:'user',actorId:'desktop-user:'+scope.profileId});
 let terminal;for await(const event of bridge.host.subscribeTask(task.taskId)){if(event.type==='task_terminal'){terminal=event;break;}}
 assert.ok(terminal);await bridge.host.drain();
 const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});let pHeld;
 try{pHeld=db.prepare("SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n;}finally{db.close();}
 if(mode.startsWith('source-revoke')){
   assert.equal(revokeHits,1);assert.equal(lateGetterHits,0);assert.equal(client.pid,undefined);assert.equal(pHeld,0);
   await bridge.dispose();
 }else{
   if(mode==='held'){const summary=bridge.native.list({requestSource:'user',actorId:'desktop-user:'+scope.profileId})[0];assert.equal(summary.status,'error','unknown cleanup cannot keep idle/healthy metadata');}
   assert.ok(client.pid);assert.equal(client.exited,true);assert.throws(()=>process.kill(client.pid,0));assert.equal(pHeld,1,'unknown Codex whole domain must keep original P');
   if(mode==='rpc-failure')assert.ok(graph(creationError).some(error=>error.message==='RPC error -32099: controlled-primary'));
   await assert.rejects(bridge.dispose(),/native_shutdown_unconfirmed/);
 }
 for(const close of closes.reverse())await close();
 fs.writeFileSync(result,JSON.stringify({ok:true,pid:process.pid,actualMain:true,actualCodexTaskBridge:true,actualPopulationHost:true,actualServiceAndSessionProbe:true,taskId:task.taskId,sdkChildPid:client?.pid,sdkChildClosed:client?.exited,pHeld,revokeHits,lateGetterHits,notProductionQualification:true}));app.exit(0);
})().catch(async error=>{try{await bridge?.dispose();}catch{}fs.writeFileSync(result,JSON.stringify({ok:false,pid:process.pid,sdkChildPid:client?.pid,error:error.stack}));app.exit(1);});
