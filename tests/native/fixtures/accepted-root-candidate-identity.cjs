'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{spawn}=require('node:child_process'),{types}=require('node:util');
const [bundle,domain,result,userData,repo,kind]=process.argv.slice(2);
process.env.XIAOK_CONFIG_DIR=path.join(domain,'config');fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});
const homeEnvironment={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE},account=os.userInfo();
const accountHome=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workflow-real-get-')));
process.env.XIAOK_WORKFLOW_FIXTURE_HOME=accountHome;
const originalFetch=globalThis.fetch;
const {app,BrowserWindow}=require('electron');app.setPath('userData',userData);app.disableHardwareAcceleration();
const failures=[];let api,network,service,services,runtime,localStore,population,source,owner,echo,echoClosed,proof,heldRelease;
let runnerPhase='control',runnerEntered,runnerRelease,hostCalls=0,retainedFirst,bodyPassed=false;
let actualAccount,obs,networkClosed,ownerState,resourceRows=[],outcome;
const own=Object.getOwnPropertyDescriptor;
function describe(raw){
 if(raw===undefined)return {type:'undefined'};
 if(!raw||typeof raw!=='object'||types.isProxy(raw))return {type:typeof raw,opaque:true};
 const out={type:'object'};for(const key of ['name','message','code','stack']){const d=own(raw,key);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')out[key]=d.value;}return out;
}
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function negative(name,fn){
 let settled=false,answer;const original=Promise.resolve().then(fn);const observed=original.then(()=>{settled=true;answer={name,state:'fulfilled'};},raw=>{settled=true;failures.push({name,raw});answer={name,state:'rejected',error:describe(raw)};});
 // This is only an observation boundary. Pending never certifies closure.
 await Promise.race([observed,new Promise(yes=>setTimeout(yes,1000))]);
 return settled?answer:{name,state:'pending'};
}
function rows(){
 const file=path.join(domain,'root-resource-v1.sqlite');if(!fs.existsSync(file))return [];
 const db=new(require('node:sqlite').DatabaseSync)(file,{readOnly:true});try{return db.prepare('SELECT state,metadata_json FROM root_resources ORDER BY enqueue_seq').all();}finally{db.close();}
}
async function run(){
 await app.whenReady();assert.equal(process.type,'browser');
 // Existing account-isolation helper preserves real uid/gid and HOME values.
 await import(pathToFileURL(path.join(repo,'desktop/tests/support/owned-workflow-child-account-preload.mjs')).href);
 actualAccount=os.userInfo();assert.equal(actualAccount.uid,account.uid);assert.equal(actualAccount.gid,account.gid);assert.equal(actualAccount.homedir,accountHome);assert.deepEqual({HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE},homeEnvironment);
 api=await import(pathToFileURL(bundle).href);
 obs=await import(pathToFileURL(path.join(path.dirname(bundle),'accepted-root-candidate-observation.mjs')).href);
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},forbidden=async()=>{throw Error('fixture_unintended_sdk');};
 process.env.KSWARM_SERVER_PATH=path.resolve(repo,'../kswarm/src/server/index.js');process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';process.env.ELECTRON_RUN_AS_NODE='1';process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT=repo;
 service=api.createKSwarmService({desktopProjectScope:scope,findPortOwner:async()=>null,killStalePortOwner:forbidden,spawnProcess:(_exe,_args,opts)=>{
  assert.equal(echo,undefined);echo=spawn(process.execPath,['--input-type=module','-e',"process.on('message',()=>{});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},10000);"],{...opts,env:{...opts.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe','ipc']});echoClosed=new Promise(yes=>echo.once('close',(code,signal)=>yes({pid:echo.pid,code,signal})));return echo;
 }});
 const module=await import(pathToFileURL(path.join(repo,'desktop/tests/support/owned-workflow-network-fixture.mjs')).href);
 network=await module.createOwnedWorkflowNetworkFixture(null,{project:{id:'project',name:'Candidate identity',goal:'Metadata only'},desktopProjectScope:scope,desktopMutationToken:service.getDesktopMutationToken()});
 const nativeFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{const url=new URL(String(input));if(url.port==='4400'&&url.pathname==='/health'&&!echo)return new Response('{"ok":false}',{status:503});return network.forwardedFetch(input,init);};
 services=api.createDesktopServices({dataRoot:path.join(domain,'desktop'),kswarmService:service,runner:async input=>{
  hostCalls++;if(runnerPhase==='positive'){runnerEntered();await runnerRelease;}
  if(input.emitRuntimeEvent)await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:'turn',intentId:'intent',stepId:'step',note:JSON.stringify({output:{summary:'Original candidate invocation',artifacts:[]}})});
 }});
 localStore=new api.RoomWorkspaceLocalStore(path.join(domain,'workspace.sqlite'));
 const physical=await api.prepareWorkspaceRoot(network.workspace.path);
 localStore.prepareBinding({...physical,bindingId:'binding',roomId:'room',workspaceId:'workspace',hostId:'host',generation:1,requestId:'request',payloadDigest:'fixture-binding',createdBy:'user.local'});localStore.activateBinding('binding',{workspaceId:'workspace',activeBindingId:'binding',generation:1});
 const config={activeBindingId:'binding',workspaceId:'workspace',originHostId:'host',generation:1,revision:1,phase:'active'};
 const gateway={async get(){return{ok:true,config,decisions:[]};},async request(roomId,action,input){return action==='acquire'?{ok:true,claim:{...config,...input,roomId,bindingId:'binding',workspaceId:'workspace',originHostId:'host',generation:1,workspaceRevision:1,protocolVersion:1,hostIncarnation:1,instructionsRevision:0,claimId:'claim-'+input.runId,mappingRevision:1,executionState:'admitted',authorizationState:'valid'}}:{ok:true};}};
 runtime=api.createRoomWorkspaceRuntime({kswarmService:service,store:localStore,broker:gateway,wake:{claimWake:forbidden,completeWake:forbidden},execute:services.runCollaborationRoomAgentTask,ensureProtocol:async()=>{},projectAdapter:{async resolve(){return{mapping:{workFolder:network.workspace.path,artifactsDir:network.workspace.path,mappingRevision:1},task:{id:'original-project-task'}};},async authorize(){return{mapping:{artifactsDir:network.workspace.path}};},async dispatch(){return{ok:true};},async submit(){return{ok:true};}},executeProject:services.runWorkspaceProjectTask});
 const client=api.createCollaborationRoomBrokerClient({token:'fixture-unused',fetchImpl:forbidden});
 const dispatcher=api.createCollaborationRoomWakeDispatcher({brokerClient:client,execute:services.runCollaborationRoomAgentTask,executeTurn:runtime.run,canExecute:async()=>true});
 source=api.createOriginalRoomTurnSource({dispatcher,runtime,services,scope});
 const store=new api.FileTaskSnapshotStore(path.join(domain,'tasks'));population=api.createTaskSourceWriterPopulation(store);
 const host=population.createHost({materialRegistry:new api.MaterialRegistry({workspaceRoot:path.join(domain,'host-workspace'),maxBytes:1024}),runner:forbidden});await api.readOriginalTaskHostIdentityIO(host,store).initialize();
 owner=api.createOriginalMainRootAdmissionOwner({roomSource:source,host,store});
 await service.start();assert.equal(api.readOriginalKSwarmServiceIdentity(service).ownedChild,true);
 const handoff={kind:'kswarm_task_handoff_v1',runId:'control-run',project:{id:'project',name:'Project',goal:'Metadata',workFolder:network.workspace.path},task:{id:'control-task',title:'Control'}};
 const controlPath=path.join(domain,'control.json');fs.writeFileSync(controlPath,JSON.stringify(handoff));
 const directOptions={kswarmService:service,allowedRoots:[domain],runDesktopTask:services.runKSwarmHandoffTask,submitResult:async()=>new Response('{}')};
 const unbound=api.createKSwarmRuntimeBridge(directOptions);assert.equal(api.hasOriginalMainSdkBridgeInstallation(),false);
 assert.deepEqual(await unbound.handleTaskHandoff({handoffPath:controlPath,projectId:'project',taskId:'control-task',runId:'control-run'}),{ok:true});assert.equal(obs.readLastOriginalCandidate('kswarm_direct'),undefined);assert.equal(rows().length,0);
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw undefined;},getOwnPropertyDescriptor(){traps++;throw undefined;}});
 assert.throws(()=>api.readOriginalKSwarmHandoffRoot(unbound,foreign));assert.equal(traps,0);
 const ready=deferred(),held=deferred();runnerEntered=ready.resolve;runnerRelease=held.promise;heldRelease=held.resolve;runnerPhase='positive';
 if(kind==='direct'){
  const rawRead=service.readProjectExecutionStart,rawAssert=service.assertProjectExecutionStartRead;
  const bridge=api.createKSwarmRuntimeBridge(directOptions);await api.bindOriginalMainDirectAdmission(owner,bridge,service);
  const file=path.join(domain,'direct.json'),raw=JSON.stringify({...handoff,runId:'positive-run',task:{id:'positive-task',title:'Positive'}});fs.writeFileSync(file,raw);
  outcome=bridge.handleTaskHandoff({handoffPath:file,projectId:'project',taskId:'positive-task',runId:'positive-run'}).then(value=>({value}),error=>({error}));
  await Promise.race([ready.promise,outcome.then(result=>{if(Object.hasOwn(result,'error'))throw result.error;throw Error('FIXTURE_EXECUTION_RETURNED_BEFORE_RUNNER:'+JSON.stringify(result));})]);proof=obs.readLastOriginalCandidate('kswarm_direct');assert.ok(proof);api.readOriginalKSwarmHandoffRootBinding(bridge,service);
  const view=api.readOriginalKSwarmHandoffRoot(bridge,proof);assert.equal(view.candidateOnly,true);assert.equal(view.kind,'original_kswarm_handoff_root_candidate_v1');assert.equal(view.scope.profileId,scope.profileId);assert.equal(view.scope.workspaceId,scope.workspaceId);assert.equal(view.projectId,'project');assert.equal(view.taskId,'positive-task');assert.equal(view.runId,'positive-run');
  service.readProjectExecutionStart=async()=>{throw Error('replaced_public_read');};service.assertProjectExecutionStartRead=()=>{throw Error('replaced_public_assert');};
  try{api.assertOriginalKSwarmHandoffRootCurrent(bridge,proof);await api.revalidateOriginalKSwarmHandoffRoot(bridge,proof);}finally{service.readProjectExecutionStart=rawRead;service.assertProjectExecutionStartRead=rawAssert;}
  assert.throws(()=>api.readOriginalKSwarmHandoffRoot({...bridge},proof));assert.throws(()=>api.readOriginalKSwarmHandoffRoot(bridge,foreign));assert.throws(()=>api.readOriginalKSwarmHandoffRoot(bridge,{}));assert.throws(()=>api.readOriginalRoomProjectRoot(runtime,proof));assert.equal(traps,0);
  fs.writeFileSync(file,raw+' ');await assert.rejects(api.revalidateOriginalKSwarmHandoffRoot(bridge,proof),/KSWARM_DIRECT_HANDOFF_CHANGED/);fs.writeFileSync(file,raw);assert.throws(()=>api.assertOriginalKSwarmHandoffRootCurrent(bridge,proof),/KSWARM_DIRECT_HANDOFF_CHANGED/);
  held.resolve();await outcome;service.readProjectExecutionStart=rawRead;service.assertProjectExecutionStartRead=rawAssert;
  assert.equal(obs.readLastOriginalCandidate('kswarm_direct'),proof);assert.throws(()=>api.readOriginalKSwarmHandoffRoot(bridge,proof));
 }else{
  assert.equal(kind,'room');await api.bindOriginalMainRoomProjectAdmission(owner,runtime,service);
  const prepared=await runtime.prepareProjectTask({roomId:'room',projectId:'project',taskId:'original-project-task',logicalAgentId:'xiaok-worker',requestId:'positive-room'}),context=localStore.getRecord('project-execution',prepared.claimId).context;
  outcome=runtime.runProjectTask({handoff:{...handoff,runId:context.runId,task:{id:'original-project-task',title:'Positive Room'},workspaceContext:context},targetParticipantId:'xiaok-worker'}).then(value=>({value}),error=>({error}));
  await Promise.race([ready.promise,outcome.then(result=>{if(Object.hasOwn(result,'error'))throw result.error;throw Error('FIXTURE_EXECUTION_RETURNED_BEFORE_RUNNER:'+JSON.stringify(result));})]);proof=obs.readLastOriginalCandidate('room_project');assert.ok(proof);api.readOriginalRoomProjectRootBinding(runtime,service);const view=api.readOriginalRoomProjectRoot(runtime,proof);assert.equal(view.kind,'original_room_project_root_candidate_v1');assert.equal(view.candidateOnly,true);assert.equal(view.scope.profileId,scope.profileId);assert.equal(view.scope.workspaceId,scope.workspaceId);assert.equal(view.roomId,'room');assert.equal(view.projectId,'project');assert.equal(view.taskId,'original-project-task');assert.equal(view.claimId,context.claimId);
  api.assertOriginalRoomProjectRootCurrent(runtime,proof);await api.revalidateOriginalRoomProjectRoot(runtime,proof);
  assert.throws(()=>api.readOriginalRoomProjectRoot({...runtime},proof));assert.throws(()=>api.readOriginalRoomProjectRoot(runtime,foreign));assert.throws(()=>api.readOriginalRoomProjectRoot(runtime,{}));assert.throws(()=>api.readOriginalKSwarmHandoffRoot(unbound,proof));assert.equal(traps,0);
  held.resolve();assert.deepEqual(await outcome,{value:{ok:true}});assert.equal(obs.readLastOriginalCandidate('room_project'),proof);assert.throws(()=>api.readOriginalRoomProjectRoot(runtime,proof),/NOT_CURRENT/);
 }
 resourceRows=rows();bodyPassed=true;
 return nativeFetch;
}
(async()=>{
 let failed;
 try{await run();}catch(raw){failed={raw};retainedFirst={raw};}
 heldRelease?.();if(outcome)await outcome;
 const negativeStates=[];
 for(const [name,fn] of [['owner',()=>owner?.drain()],['runtime',()=>runtime?.shutdown()],['services',()=>services?.closeTaskSourceWritersForMigration()],['multi-agent',()=>services?.disposeMultiAgent()],['population',()=>population?.close()],['room-source',()=>source?.drain()],['kswarm',()=>api&&service?api.sealAndDrainKSwarmServiceInstance(service):undefined]])negativeStates.push(await negative(name,fn));
 ownerState=negativeStates.find(r=>r.name==='owner');
 globalThis.fetch=originalFetch;
 if(network){try{await network.close({retainRoot:negativeStates.some(s=>s.state!=='fulfilled')});networkClosed=network.getOwnedServerState();}catch(raw){failures.push({name:'network',raw});}}
 if(echoClosed)await echoClosed;if(localStore)try{localStore.close();}catch(raw){failures.push({name:'local-store',raw});}
 const unknown=negativeStates.some(s=>s.state!=='fulfilled')||failures.length>0;
 if(!unknown)fs.rmSync(accountHome,{recursive:true,force:true});
 const facts={ok:bodyPassed&&!failed,kind,actualMain:process.type==='browser',pid:process.pid,productionQualified:false,candidateOnly:true,noBinderValidCandidates:0,observerRetainsProof:!!proof,hostCalls,negative:negativeStates,resourceRows,physicalClosureConfirmed:!unknown,explicitExitWithHeld:unknown,error:failed?describe(failed.raw):null,cleanupErrors:failures.map(f=>({name:f.name,error:describe(f.raw)})),ownedChild:echoClosed?await echoClosed:null,networkChild:networkClosed,account:{realUid:account.uid,observedUid:actualAccount?.uid,homeIsPrivate:actualAccount?.homedir===accountHome,environmentUnchanged:process.env.HOME===homeEnvironment.HOME&&process.env.USERPROFILE===homeEnvironment.USERPROFILE},windows:BrowserWindow.getAllWindows().length,dockVisible:app.dock?.isVisible()??false};
 fs.writeFileSync(result,JSON.stringify(facts));app.exit(facts.ok?0:1);
})().catch(raw=>{retainedFirst??={raw};fs.writeFileSync(result,JSON.stringify({ok:false,pid:process.pid,error:describe(retainedFirst.raw)}));app.exit(1);});
