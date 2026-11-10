'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const [bundle,domain,result,userData,brokerService,brokerServer]=process.argv.slice(2);
const fixtureConfig=path.join(fs.realpathSync(domain),'fixture-config');
fs.mkdirSync(fixtureConfig,{recursive:true,mode:0o700});process.env.XIAOK_CONFIG_DIR=fixtureConfig;
const app=require('electron').app;
app.setPath('userData',userData);app.disableHardwareAcceleration();
const cleanup=[];
async function run(){
 await app.whenReady();
 const api=await import(pathToFileURL(bundle).href);
 const {createBrokerService}=await import(pathToFileURL(brokerService).href);
 const {createServer}=await import(pathToFileURL(brokerServer).href);
 const broker=createBrokerService({dbPath:path.join(domain,'actual-broker.sqlite')});
 const server=createServer({broker,roomService:broker.room,roomDesktopToken:'actual-room-fixture'});
 await server.listen(0,'127.0.0.1');
 cleanup.push(async()=>{await server.close();broker.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const client=api.createCollaborationRoomBrokerClient({token:'actual-room-fixture',fetchImpl:(url,init)=>fetch(base+new URL(String(url)).pathname,init)});
 const created=await client.createRoom({title:'actual Native Room',memberAgentIds:['agent-a','agent-b']});
 assert.equal(created.ok,true);
 const sent=await client.sendRoomMessage({roomId:created.room.roomId,text:'original source actual message',responsePolicy:'mentioned',mentions:[{kind:'agent',logicalAgentId:'agent-a'},{kind:'agent',logicalAgentId:'agent-b'}],idempotencyKey:'original-native-message'});
 assert.equal(sent.ok,true);
 let effects=0;
 const services=api.createDesktopServices({dataRoot:path.join(domain,'desktop'),runner:async()=>{effects++;throw Error('component must not execute');},kswarmService:{request:async()=>new Response('{}'),getDesktopMutationToken:()=>''}});
 cleanup.push(()=>services.closeTaskSourceWritersForMigration());
 const workspace=new api.RoomWorkspaceLocalStore(path.join(domain,'workspace.sqlite'));
 cleanup.push(()=>workspace.close());
 const noClaim=async()=>{throw Error('legacy direct runtime must not claim');};
 const runtime=api.createRoomWorkspaceRuntime({store:workspace,broker:{get:noClaim,request:noClaim},wake:{claimWake:noClaim,completeWake:noClaim},execute:services.runCollaborationRoomAgentTask,ensureProtocol:noClaim});
 cleanup.push(()=>runtime.shutdown());
 const dispatcher=api.createCollaborationRoomWakeDispatcher({brokerClient:client,execute:services.runCollaborationRoomAgentTask,executeTurn:runtime.run,canExecute:async()=>true});
 const source=api.createOriginalRoomTurnSource({dispatcher,runtime,services,scope:{profileId:'actual-profile',workspaceId:'actual-workspace'}});
 cleanup.push(()=>source.drain());
 const store=new api.FileTaskSnapshotStore(path.join(domain,'tasks'));
 const population=api.createTaskSourceWriterPopulation(store);
 let hostRun=async()=>{throw Error('Host SDK not authorized');};
 const host=population.createHost({materialRegistry:new api.MaterialRegistry({workspaceRoot:path.join(domain,'workspace'),maxBytes:1024}),runner:()=>hostRun()});
 cleanup.push(()=>population.close());
 const identity=await api.readOriginalTaskHostIdentityIO(host,store).initialize();
 const owner=api.createOriginalMainRootAdmissionOwner({roomSource:source,host,store});
 const port=api.createOriginalMainRoomRootAdmissionPort({roomSource:source,host,store});
 assert.equal(owner.room,port);
 assert.equal(typeof owner.physical,'object');
 assert.equal(typeof owner.physical.acquireModel,'function');
 assert.equal(typeof api.assertOriginalMainDshPhysicalComposition,'function');
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('untrusted');},getOwnPropertyDescriptor(){traps++;throw Error('untrusted');}});
 assert.throws(()=>api.assertOriginalMainDshPhysicalComposition(foreign,foreign,foreign,foreign),/COMPOSITION_REQUIRED/);assert.equal(traps,0);
 assert.equal(api.createOriginalMainRootAdmissionOwner({roomSource:source,host,store}),owner);
 assert.throws(()=>api.createOriginalMainRootAdmissionOwner({roomSource:source,host:{...host},store}),/OWNER_ALREADY_BOUND/);
 cleanup.push(()=>port.drain());
 const input={roomId:created.room.roomId,roomMessageId:sent.message.messageId,logicalAgentIds:['agent-a','agent-b']};
 const proofs=await source.acceptMessage(input);
 assert.equal(proofs.length,2);
 const first=await port.enqueueRoom(proofs[0]);
 const repeated=await port.enqueueRoom(proofs[0]);
 assert.equal(first.record.executionKey,repeated.record.executionKey);
 const second=await port.enqueueRoom(proofs[1]);
 assert.notEqual(first.record.executionKey,second.record.executionKey);
 const metadata=JSON.parse(first.record.metadataJson);
 assert.equal(metadata.hostId,identity.hostId);
 assert.equal(metadata.subject.messageId,input.roomMessageId);
 const reservation=await port.claimNext();assert.ok(reservation);
 const consumed=await port.consumeLaunch(reservation);
 assert.equal(consumed.newlyConsumed,true);
 assert.equal((await port.consumeLaunch(reservation)).newlyConsumed,false);
 const parent=api.readOriginalMainRootExecutionContext(owner,reservation);
 let resourceDone,resourceFail;const resources=new Promise((yes,no)=>{resourceDone=yes;resourceFail=no;});
 hostRun=async()=>{
  try{
   const context=api.readCurrentOriginalTaskRunnerResourceContext();assert.ok(context);
   assert.equal(api.readOriginalTaskRunnerResourceContext(context,host,store).parentRef,parent);
   const models=[],processes=[];
   for(let i=0;i<4;i++)models.push(await owner.physical.acquireModel(context,'model-'+i,'a'.repeat(64)));
   let fifthDone=false;const fifthRaw=owner.physical.acquireModel(context,'model-4','a'.repeat(64)),fifth=fifthRaw.then(value=>{fifthDone=true;return value;});
   let processRaw,processOutcome;
   if(process.env.XIAOK_ROOT_ACQUIRE_NEGATIVE_FACT==='1'){
    for(let i=0;i<2;i++)processes.push(await owner.physical.acquireProcess(context,'queued-worker-'+i,'b'.repeat(64)));
    processRaw=owner.physical.acquireProcess(context,'queued-worker-2','b'.repeat(64));
    processOutcome=processRaw.then(value=>({kind:'granted',value}),error=>({kind:'denied',error}));
   }
   await new Promise(yes=>setImmediate(yes));assert.equal(fifthDone,false);
   if(process.env.XIAOK_ROOT_PARENT_REVOKE==='1'){
    await runtime.shutdown();
    const result=fifth.then(value=>({kind:'granted',value}),error=>({kind:'denied',error}));
    const cancellations=await Promise.allSettled(models.map(value=>owner.physical.cancelModel(value)));
    if(processRaw){
     const stopped=await Promise.allSettled(processes.map(value=>owner.physical.cancelProcess(value)));
     for(const result of stopped)if(result.status==='rejected')throw result.reason;
     assert.equal((await processOutcome).kind,'denied');await owner.physical.cancelProcess(processRaw);await owner.physical.cancelProcess(processRaw);
     await assert.rejects(async()=>owner.physical.cancelModel(processRaw),/NOT_CANCELLABLE/);
    }
    const outcome=await result;
    if(outcome.kind==='granted')await owner.physical.cancelModel(outcome.value);
    for(const result of cancellations)if(result.status==='rejected')throw result.reason;
    assert.equal(outcome.kind,'denied','withdrawn original parent must not grant the queued SDK permit');
    if(process.env.XIAOK_ROOT_ACQUIRE_NEGATIVE_FACT==='1'){
     await owner.physical.cancelModel(fifthRaw);await owner.physical.cancelModel(fifthRaw);
     await assert.rejects(async()=>owner.physical.cancelProcess(fifthRaw),/NOT_CANCELLABLE/);
     await assert.rejects(async()=>owner.physical.cancelModel(fifth),/NOT_CANCELLABLE/);
     let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('trap');},getOwnPropertyDescriptor(){traps++;throw Error('trap');}});
     await assert.rejects(async()=>owner.physical.cancelModel(foreign),/NOT_CANCELLABLE/);assert.equal(traps,0);
     const initialRaw=owner.physical.acquireModel(context,'model-pre-entry-refusal','a'.repeat(64));
     await assert.rejects(initialRaw);await owner.physical.cancelModel(initialRaw);
     const initialProcessRaw=owner.physical.acquireProcess(context,'worker-pre-entry-refusal','b'.repeat(64));
     await assert.rejects(initialProcessRaw);await owner.physical.cancelProcess(initialProcessRaw);
    }
    const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});
    try{assert.equal(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE state IN ('reserved','queued')").get().n,0);}finally{db.close();}
    resourceDone();return;
   }
   const cancelledModel=models[0];await owner.physical.cancelModel(cancelledModel);models[0]=await fifth;
   assert.throws(()=>owner.physical.consumeModel(cancelledModel),/PERMIT_REQUIRED/);
   for(let i=0;i<2;i++)processes.push(await owner.physical.acquireProcess(context,'worker-'+i,'b'.repeat(64)));
   let thirdDone=false;const third=owner.physical.acquireProcess(context,'worker-2','b'.repeat(64)).then(value=>{thirdDone=true;return value;});
   await new Promise(yes=>setImmediate(yes));assert.equal(thirdDone,false);
   const cancelled=processes[0];await owner.physical.cancelProcess(cancelled);processes[0]=await third;
   assert.throws(()=>owner.physical.consumeProcess(cancelled),/PERMIT_REQUIRED/);
   for(const value of models)await owner.physical.cancelModel(value);
   for(const value of processes)await owner.physical.cancelProcess(value);
   const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'));
   try{
    assert.equal(db.prepare("SELECT count(*) AS n FROM root_physical_resources WHERE state='reserved'").get().n,0);
    const classes=db.prepare('SELECT DISTINCT execution_class FROM root_physical_resources').all();assert.deepEqual(classes.map(x=>x.execution_class),['room_discussion']);
    assert.equal(db.prepare('SELECT claim_seq FROM root_resource_policy').get().claim_seq,1);
   }finally{db.close();}
   resourceDone();
  }catch(error){resourceFail(error);throw error;}
 };
 await api.runWithOriginalRootExecutionContext(parent,()=>host.createTask({prompt:'original Native descendant resource path',materials:[]}));
 await resources;await host.drain();

 assert.equal(effects,0);
 return {actualMain:true,actualBroker:true,actualHostIdentity:identity.hostId,opaqueAcceptedSource:true,nativeConsumedOnce:true,modelEffects:effects,notProductNQualification:true};
}
let failed=false,primary;
run().then(async facts=>{
 for(let i=cleanup.length-1;i>=0;i--)try{await cleanup[i]();}catch(error){if(!failed){failed=true;primary=error;}}
 if(failed)throw primary;
 fs.writeFileSync(result+'.tmp',JSON.stringify({pid:process.pid,ok:true,...facts}),{flag:'wx',mode:0o600});fs.renameSync(result+'.tmp',result);
},async error=>{
 for(let i=cleanup.length-1;i>=0;i--)try{await cleanup[i]();}catch{}
 throw error;
}).catch(error=>{failed=true;process.stderr.write((error?.stack||String(error))+'\n');fs.writeFileSync(result,JSON.stringify({pid:process.pid,ok:false,error:error?.stack||String(error)}));}).finally(()=>app.exit(failed?1:0));
