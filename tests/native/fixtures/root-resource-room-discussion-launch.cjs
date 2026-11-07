'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const [bundle,domain,result,userData,brokerService,brokerServer]=process.argv.slice(2);
const fixtureConfig=path.join(fs.realpathSync(domain),'fixture-config');
fs.mkdirSync(fixtureConfig,{recursive:true,mode:0o700});process.env.XIAOK_CONFIG_DIR=fixtureConfig;
const app=require('electron').app;
app.setPath('userData',userData);app.disableHardwareAcceleration();
const cleanup=[],scenario=process.env.XIAOK_ROOM_LAUNCH_SCENARIO??'normal';let agents=['agent-a','agent-b'];
async function run(){
 const phase=value=>fs.writeFileSync(result+'.phase.json',JSON.stringify({pid:process.pid,phase:value}));phase('before-ready');await app.whenReady();phase('before-import');
 const api=await import(pathToFileURL(bundle).href);phase('after-import');
 const {createBrokerService}=await import(pathToFileURL(brokerService).href);
 const {createServer}=await import(pathToFileURL(brokerServer).href);
 if(scenario==='capacity'||scenario==='queued_cancel'){const limits=await import(pathToFileURL(path.resolve(path.dirname(brokerService),'../room/constants.js')).href);agents=Array.from({length:limits.ROOM_MAX_ACTIVE_AGENT_MEMBERS},(_,i)=>'agent-'+String(i).padStart(2,'0'));}
 const broker=createBrokerService({dbPath:path.join(domain,'actual-broker.sqlite')});
 const server=createServer({broker,roomService:broker.room,roomDesktopToken:'actual-room-fixture'});
 await server.listen(0,'127.0.0.1');
 cleanup.push(async()=>{await server.close();broker.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const client=api.createCollaborationRoomBrokerClient({token:'actual-room-fixture',fetchImpl:(url,init)=>fetch(base+new URL(String(url)).pathname,init)});
 const created=await client.createRoom({title:'actual Native Room',memberAgentIds:agents});
 assert.equal(created.ok,true);
 const sent=await client.sendRoomMessage({roomId:created.room.roomId,text:'original source actual message',responsePolicy:'mentioned',mentions:agents.map(logicalAgentId=>({kind:'agent',logicalAgentId})),idempotencyKey:'original-native-message'});
 assert.equal(sent.ok,true);
 let effects=0;const effectRootStates=[],effectConsumption=[],effectReleases=[];let modelPermit,processPermit;let releaseErrorTail;const errorTail=new Promise(yes=>releaseErrorTail=yes),businessFailure=Error('original room business failure');Object.defineProperty(businessFailure,Symbol('actual-room-held-error-tail'),{value:errorTail});
 const services=api.createDesktopServices({dataRoot:path.join(domain,'desktop'),runner:async input=>{effects++;globalThis.actualRoomEffects=effects;const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});try{effectRootStates.push(db.prepare('SELECT state FROM root_resources ORDER BY enqueue_seq LIMIT 1').get()?.state);globalThis.actualRoomStates=effectRootStates;const consumed=db.prepare("SELECT COUNT(*) n FROM root_resource_receipts WHERE kind='launch_consumed'").get().n;effectConsumption.push(consumed);globalThis.actualRoomConsumption=effectConsumption;}finally{db.close();}if(scenario==='capacity'||scenario==='queued_cancel')await new Promise(yes=>effectReleases.push(yes));if(scenario==='held_children'){const context=api.readCurrentOriginalRootExecutionContext();assert.ok(context);modelPermit=await owner.physical.acquireModel(context,'actual-room-held-model','a'.repeat(64));processPermit=await owner.physical.acquireProcess(context,'actual-room-held-process','b'.repeat(64));}if(scenario==='held_failure')throw businessFailure;if(scenario==='undefined_failure')throw undefined;await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'native-room',stepId:'native-room',note:'actual controlled room runner'});},kswarmService:{request:async()=>new Response('{}'),getDesktopMutationToken:()=>''}});
 cleanup.push(()=>services.closeTaskSourceWritersForMigration());
 const workspace=new api.RoomWorkspaceLocalStore(path.join(domain,'workspace.sqlite'));
 cleanup.push(()=>workspace.close());
 const noClaim=async()=>{throw Error('legacy direct runtime must not claim');};
 const runtimeOptions={store:workspace,broker:{get:async()=>({ok:true,config:null}),request:noClaim},wake:{claimWake:client.claimWake,completeWake:client.completeWake},execute:services.runCollaborationRoomAgentTask,ensureProtocol:async()=>{}};const runtime=api.createRoomWorkspaceRuntime(runtimeOptions);
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
 phase('before-bind');await api.bindOriginalMainRoomDiscussionAdmission(owner,runtime,source);phase('after-bind');
 let foreignGetters=0,lateRunnerGetters=0;const foreignRelation=new Proxy({},{get(){foreignGetters++;throw Error('foreignRelation get');},getOwnPropertyDescriptor(){foreignGetters++;throw Error('foreignRelation descriptor');}});
 await assert.rejects(api.bindOriginalMainRoomDiscussionAdmission(owner,foreignRelation,source));assert.throws(()=>port.awaitRoomLaunch(foreignRelation));
 const foreignRuntime=api.createRoomWorkspaceRuntime({...runtimeOptions});await assert.rejects(api.bindOriginalMainRoomDiscussionAdmission(owner,foreignRuntime,source));await foreignRuntime.shutdown();assert.equal(foreignGetters,0);
 Object.defineProperty(runtimeOptions,'execute',{configurable:true,get(){lateRunnerGetters++;throw Error('late runner getter');}});

 const input={roomId:created.room.roomId,roomMessageId:sent.message.messageId,logicalAgentIds:[agents[0]]};
 const proofs=await source.acceptMessage(input);assert.equal(proofs.length,1);const queued=await port.enqueueRoom(proofs[0]);
 const envelope=JSON.parse(JSON.stringify(api.readOriginalRoomRuntimeAcceptance(runtime,services.runCollaborationRoomAgentTask).read(source,proofs[0])));
 const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});
 const policy=db.prepare('SELECT capacity FROM root_resource_policy').get();
 if(scenario==='capacity'||scenario==='queued_cancel'){
  assert.ok(agents.length>policy.capacity,'actual broker fanout must cover original N+1');const ids=agents.slice(0,policy.capacity+1),accepted=await source.acceptMessage({...input,logicalAgentIds:ids}),envelopes=Array.from(accepted,proof=>JSON.parse(JSON.stringify(api.readOriginalRoomRuntimeAcceptance(runtime,services.runCollaborationRoomAgentTask).read(source,proof))));
  const runs=envelopes.map(envelope=>runtime.run(envelope));for(const raw of runs)void raw.catch(()=>{});
  const deadline=Date.now()+10000;while(effects<policy.capacity&&Date.now()<deadline)await new Promise(yes=>setTimeout(yes,5));
  assert.equal(effects,policy.capacity);await new Promise(yes=>setTimeout(yes,20));assert.equal(effects,policy.capacity,'N+1 actual runner is still queued');
  const before=db.prepare('SELECT state FROM root_resources').all();assert.equal(before.filter(row=>row.state==='queued').length,1);assert.equal(before.filter(row=>row.state==='reserved').length,policy.capacity);
  if(scenario==='queued_cancel'){
   const outcomes=runs.map(raw=>raw.then(()=>({ok:true}),error=>({ok:false,error})));await runtime.cancelRoom(input.roomId);
   const ended=await Promise.race([Promise.allSettled([runs[runs.length-1]]),new Promise(yes=>setTimeout(()=>yes('not-settled'),1000))]);assert.notEqual(ended,'not-settled','queued cancellation must wake its original waiter');assert.equal(effects,policy.capacity);
   const middle=db.prepare('SELECT state FROM root_resources').all();assert.equal(middle.filter(row=>row.state==='cancelled_before_launch').length,1);assert.equal(middle.filter(row=>row.state==='released').length,0);
   while(effectReleases.length)effectReleases.shift()();await Promise.all(outcomes);const records=db.prepare('SELECT state FROM root_resources').all();assert.equal(records.filter(row=>row.state==='released').length,policy.capacity);db.close();return {ok:true,pid:process.pid,scenario,effects,capacity:policy.capacity,queuedCancelled:true,activeHeldUntilActualCompletion:true,records};
  }
  effectReleases.shift()();while(effects<policy.capacity+1&&Date.now()<deadline)await new Promise(yes=>setTimeout(yes,5));assert.equal(effects,policy.capacity+1);
  while(effectReleases.length)effectReleases.shift()();await Promise.all(runs);
  const records=db.prepare('SELECT state FROM root_resources').all();assert.ok(records.every(row=>row.state==='released'));
  const replay=runtime.run(envelopes[0]);assert.equal(replay,runs[0]);await replay;assert.equal(effects,policy.capacity+1);db.close();
  return {ok:true,pid:process.pid,scenario,effects,capacity:policy.capacity,oneQueuedBeforeRelease:true,sameReplayPromise:true,records};
 }
 if(scenario==='sync_entry_fault'){
  let faultHits=0;const originalFreeze=Object.freeze;Object.freeze=function(...args){const value=Reflect.apply(originalFreeze,Object,args);if(String(new Error().stack).includes('runCollaborationRoomAgentTask (')){Object.freeze=originalFreeze;faultHits++;throw businessFailure;}return value;};
  const raw=runtime.run(envelope),outcome=raw.then(value=>({ok:true,value}),error=>({ok:false,error}));let settled=false;void outcome.then(()=>settled=true);
  const deadline=Date.now()+3000;while(faultHits===0&&Date.now()<deadline)await new Promise(yes=>setTimeout(yes,2));Object.freeze=originalFreeze;assert.equal(faultHits,1);assert.equal(effects,0);await new Promise(yes=>setTimeout(yes,20));assert.equal(settled,false);releaseErrorTail();
  const result=await outcome;assert.equal(result.ok,false);let first=result.error;while(first&&first.cause!==undefined)first=first.cause;assert.equal(first,businessFailure,'same original SDK throw remains primary');assert.equal(db.prepare("SELECT COUNT(*) n FROM root_resources WHERE state='released'").get().n,0,'constructor entered with no original handle keeps N unknown');db.close();return {ok:true,pid:process.pid,scenario,effects,constructorEnteredNoHandle:true,firstCauseSame:true,rootHeldUnknown:true};
 }
 if(scenario==='held_children'){
  const raw=runtime.run(envelope);let settled=false;void raw.then(()=>settled=true,()=>settled=true);const deadline=Date.now()+3000;while(!processPermit&&Date.now()<deadline)await new Promise(yes=>setTimeout(yes,2));assert.ok(modelPermit);assert.ok(processPermit);await new Promise(yes=>setTimeout(yes,20));assert.equal(settled,false);assert.equal(db.prepare("SELECT COUNT(*) n FROM root_resources WHERE state='released'").get().n,0);
  await owner.physical.cancelModel(modelPermit);await new Promise(yes=>setTimeout(yes,10));assert.equal(settled,false,'same-root P still holds Root N');await owner.physical.cancelProcess(processPermit);await raw;
  assert.equal(db.prepare("SELECT COUNT(*) n FROM root_resources WHERE state='released'").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE state='released'").get().n,2);db.close();return {ok:true,pid:process.pid,scenario,effects,sameRootModelAndProcessJoined:true,childrenKnownNotStarted:true};
 }
 if(scenario==='held_failure'||scenario==='undefined_failure'){
  const raw=runtime.run(envelope),outcome=raw.then(value=>({ok:true,value}),error=>({ok:false,error}));let settled=false;void outcome.then(()=>settled=true);
  const deadline=Date.now()+3000;while(effects===0&&Date.now()<deadline)await new Promise(yes=>setTimeout(yes,2));assert.equal(effects,1);
  if(scenario==='held_failure'){await new Promise(yes=>setTimeout(yes,20));assert.equal(settled,false);assert.equal(db.prepare("SELECT COUNT(*) n FROM root_resources WHERE state='released'").get().n,0);releaseErrorTail();}
  const result=await outcome;assert.equal(result.ok,false);assert.equal(result.error,scenario==='held_failure'?businessFailure:undefined);assert.equal(db.prepare("SELECT COUNT(*) n FROM root_resources WHERE state='released'").get().n,1);db.close();return {ok:true,pid:process.pid,scenario,effects,heldTailJoined:scenario==='held_failure',firstCauseSame:true,negativePhysicalReleased:true};
 }
 phase('before-run');const original=runtime.run(envelope),outcome=await original;phase('after-run');assert.equal(runtime.run(envelope),original);await original;
 const records=db.prepare('SELECT state FROM root_resources').all();db.close();
 assert.equal(effects,1,'actual original Services business runner entered');
 assert.equal(effectConsumption[0],1,'actual business SDK requires original Native launch_consumed receipt');
 assert.equal(outcome.ok,true);assert.equal(lateRunnerGetters,0);assert.equal(foreignGetters,0);assert.equal(records[0].state,'released','physical known runner must finish original root');
 return {ok:true,pid:process.pid,effects,effectRootStates,effectConsumption,foreignGetters,lateRunnerGetters,capacity:policy.capacity,queuedKey:queued.record.executionKey,records};
}
run().then(async facts=>{for(const work of cleanup.reverse())try{await work();}catch{}fs.writeFileSync(result,JSON.stringify(facts));app.exit(0);},async error=>{for(const work of cleanup.reverse())try{await work();}catch{}fs.writeFileSync(result,JSON.stringify({ok:false,pid:process.pid,error:error.stack,effects:globalThis.actualRoomEffects??null,states:globalThis.actualRoomStates??null,consumption:globalThis.actualRoomConsumption??null}));app.exit(1);});
