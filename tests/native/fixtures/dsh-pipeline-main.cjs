'use strict';
// Actual Electron/Source/A/ledger/M/B integration with controlled HTTPS data.
// Fixture compilation does not qualify the installed product or live model quality.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),http=require('node:http'),{spawn}=require('node:child_process'),{syncBuiltinESMExports}=require('node:module'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const [bundle,root,repo,pricingFile,resultFile]=process.argv.slice(2);
app.setPath('userData',path.join(root,'electron-profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const cleanup=[],children=[],sockets=new Set(),paths=[];let failure,failed=false,healthy=false,newComment=null,clockLag=0,modelCalls=0;const modelKinds=[];
let scope;const tenant='tenant';
let fencePauseObserved;
const issue={id:42,node_id:'I_42',number:1,user:{id:12,node_id:'U_12'},title:'Existing selected issue',body:'Existing context',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',labels:[{id:7}],state:'open',locked:false,repository_url:'https://api.github.com/repos/octo/demo'};
async function run(){
 await app.whenReady();
 const cert=fs.readFileSync(path.join(repo,'tests/fixtures/sol-pi-tls/cert.pem')),key=fs.readFileSync(path.join(repo,'tests/fixtures/sol-pi-tls/key.pem'));
 const server=https.createServer({cert,key},(request,response)=>{
  const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{
   paths.push(request.url);response.setHeader('Date',new Date(Date.now()-clockLag).toUTCString());response.setHeader('ETag','"pipeline-v1"');
   if(request.url.startsWith('/quick_start/pricing/')){response.setHeader('content-type','text/html');response.end(fs.readFileSync(pricingFile));return;}
   if(request.url==='/chat/completions'){
    modelCalls++;const body=JSON.parse(Buffer.concat(chunks).toString()),prompt=JSON.parse(body.messages.at(-1).content);
    const draft=prompt.kind==='original_dsh_draft_evidence_v1';modelKinds.push(draft?'draft':'assessment');
    if(draft&&process.env.XIAOK_DSH_PIPELINE_CASE==='draft_http_negative'){response.statusCode=400;response.setHeader('content-type','application/json');response.end(JSON.stringify({error:{type:'invalid_request_error',message:'controlled known negative'}}));return;}
    const content=draft?'Controlled local draft grounded in the selected issue and comment.':JSON.stringify({schemaVersion:1,suggestedIntent:'draft_request',evidenceRefs:prompt.evidence.map(value=>value.ref),uncertainty:null});
    response.setHeader('content-type','application/json');response.end(JSON.stringify({id:draft?'actual-controlled-draft':'actual-controlled-assessment',object:'chat.completion',model:'deepseek-flash',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100}}));return;
   }
   response.setHeader('content-type','application/json');
   const pathname=new URL(request.url,'https://api.github.com').pathname;
   const value=pathname==='/user'?{id:12,node_id:'U_12',login:'person'}:pathname==='/repos/octo/demo'?{id:123,node_id:'R_123',name:'demo',owner:{id:13,login:'octo'}}:pathname==='/repos/octo/demo/labels'?[{id:7,node_id:'L_7',name:'work'}]:pathname==='/repos/octo/demo/issues'?[issue]:pathname==='/repos/octo/demo/issues/1'?issue:pathname==='/repos/octo/demo/issues/1/comments'?(newComment?[newComment]:[]):pathname==='/repos/octo/demo/events'?(newComment?[{id:'9001',type:'IssueCommentEvent',actor:{id:12},repo:{id:123,name:'octo/demo'},created_at:newComment.created_at,payload:{action:'created',issue,comment:newComment}}]:[]):[];
   response.end(JSON.stringify(value));
  });
 });server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});await new Promise(yes=>server.listen(0,'127.0.0.1',yes));
 cleanup.push(async()=>{for(const socket of sockets)socket.destroy();await new Promise(yes=>server.close(yes));assert.equal(sockets.size,0);});
 const origin=`https://127.0.0.1:${server.address().port}`,nativeRequest=https.request;
 https.request=function(url,options,callback){if(!['https://api.github.com','https://api.deepseek.com','https://api-docs.deepseek.com'].includes(url.origin))throw Error('fixture_external_https_denied');return nativeRequest.call(https,new URL(url.pathname+url.search,origin),{...options,ca:cert},callback);};syncBuiltinESMExports();
 const entry=path.resolve(repo,'../kswarm/test/fixtures/owned-dsh-business/entry.js');process.env.KSWARM_SERVER_PATH=entry;process.env.XIAOK_CONFIG_DIR=path.join(root,'config');fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(process.env.XIAOK_CONFIG_DIR,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'deepseek-flash',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'isolated-fixture-only'}},models:{'deepseek-flash':{provider:'deepseek',model:'deepseek-flash',label:'Controlled fixture'}},defaultMode:'interactive'}),{mode:0o600});
 // Fixed literal routes are forwarded to this fixture's actual ephemeral
 // Broker. They never use or stop an independently running Desktop listener.
 const nativeFetch=globalThis.fetch;let brokerOrigin;
 const brokerWire=[],brokerRequestIds=new WeakMap();let brokerRequestSequence=0;
 const diagnostic=require('node:diagnostics_channel'),dataValue=(value,key)=>{const d=value&&Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;},diagnosticSubscriptions=[];
 for(const name of ['undici:request:create','undici:request:headers','undici:request:error']){
  const channel=diagnostic.channel(name),observe=event=>{const request=dataValue(event,'request');if(!request||dataValue(request,'origin')!==brokerOrigin)return;let id=brokerRequestIds.get(request);if(!id){id=++brokerRequestSequence;brokerRequestIds.set(request,id);}const response=dataValue(event,'response'),error=dataValue(event,'error');brokerWire.push({id,kind:name,path:dataValue(request,'path'),elapsedNs:process.hrtime.bigint().toString(),status:response&&dataValue(response,'statusCode'),errorCode:error&&dataValue(error,'code')});fs.writeFileSync(path.join(root,'broker-wire.json'),JSON.stringify(brokerWire));};channel.subscribe(observe);diagnosticSubscriptions.push([channel,observe]);
 }
 cleanup.push(()=>{for(const [channel,observe] of diagnosticSubscriptions)channel.unsubscribe(observe);});
 if(process.env.XIAOK_DSH_PIPELINE_CASE==='fence_pending_work'){
  const originalFreeze=Object.freeze,originalThen=Promise.prototype.then;let portCaptured=false;
  Object.freeze=function(value){
   if(!portCaptured&&value&&typeof value==='object'&&Object.hasOwn(value,'importOwnerReceipt')&&Object.hasOwn(value,'prepareAdmission')&&Object.hasOwn(value,'prepareDraft')){
    const method=Object.getOwnPropertyDescriptor(value,'importOwnerReceipt');assert.equal(typeof method.value,'function');const original=method.value;
    const wrapped=function(...args){const raw=Reflect.apply(original,this,args),result=Reflect.apply(originalThen,raw,[reply=>{
     const receipt=reply?.receipt?.receipt;
     if(!fencePauseObserved&&reply?.ok===true&&typeof reply.ownerWorkId==='string'&&receipt?.kind==='dsh_command'&&receipt.command?.action==='create_draft_work'&&receipt.result!=='blocked'&&receipt.ownerWorkId===reply.ownerWorkId){fencePauseObserved={commandId:reply.receipt.acceptedCommandId,ownerWorkId:reply.ownerWorkId,receiptId:receipt.id};throw Error('fixture_pause_after_original_create_ack');}
     return reply;
    }]);Object.defineProperty(result,Symbol('original_import_sdk_raw'),{value:raw});return result;};
    Object.defineProperty(wrapped,Symbol('original_import_sdk_function'),{value:original});Object.defineProperty(value,'importOwnerReceipt',{...method,value:wrapped});portCaptured=true;
   }
   return Reflect.apply(originalFreeze,Object,[value]);
  };
 }
 globalThis.fetch=function(input,init){
  const url=new URL(String(input));assert.ok(url.hostname==='127.0.0.1'||url.hostname==='localhost');assert.ok(['4318','4400'].includes(url.port));
  if(url.port==='4400'&&url.pathname==='/health')return Promise.resolve(new Response(JSON.stringify({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:api.computeKSwarmServiceSourceHash(entry)}}),{status:healthy?200:503}));
  if(url.port==='4400'&&url.pathname==='/agents')return Promise.resolve(new Response(JSON.stringify({ok:true,agents:[]})));
  assert.equal(url.port,'4318');assert.ok(brokerOrigin);return nativeFetch(new URL(url.pathname+url.search,brokerOrigin),init);
 };
 // The production control transport captures Node HTTP at module birth.
 // Preserve each original ClientRequest/socket; rewrite only its fixed route.
 const nativeHttpRequest=http.request;let idleBoundaryInjected=false;
 http.request=function(input,options,callback){
  const url=input instanceof URL?input:new URL(String(input));
  assert.equal(url.origin,'http://127.0.0.1:4318');assert.match(url.pathname,/^\/rooms\/admission-control\/(baseline|apply|read)$/);assert.equal(url.search,'');assert.ok(brokerOrigin);
  assert.equal(options.agent,false);assert.equal(options.headers.connection,'close');
  if(process.env.XIAOK_DSH_BROKER_IDLE_BOUNDARY==='1'&&!idleBoundaryInjected&&url.pathname.endsWith('/apply')){idleBoundaryInjected=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3000);}
  const id=++brokerRequestSequence;brokerWire.push({id,kind:'original-node-http',path:url.pathname,agent:false,connection:'close',idleBoundaryInjected,elapsedNs:process.hrtime.bigint().toString()});fs.writeFileSync(path.join(root,'broker-wire.json'),JSON.stringify(brokerWire));
  return Reflect.apply(nativeHttpRequest,http,[new URL(url.pathname,brokerOrigin),options,callback]);
 };syncBuiltinESMExports();
 const api=await import(pathToFileURL(bundle).href),dataRoot=path.join(root,'budget'),workspaceRoot=path.join(root,'workspace');fs.mkdirSync(workspaceRoot,{recursive:true});const actualScope=api.resolveDesktopServiceScope({dataRoot,workspaceRoot});scope={profileId:actualScope.profileId,workspaceId:actualScope.workspaceId};
 const html=path.join(root,'index.html'),preload=path.join(root,'preload.cjs');fs.writeFileSync(html,'<!doctype html><body>Actual controlled Source pipeline</body>');fs.writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('pipeline',action=>ipcRenderer.invoke('fixture:pipeline',action));");
 const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});cleanup.push(async()=>window.destroy());await window.loadFile(html);
 const user=api.createMainDshControlSource({window,scope,isTrustedUrl:url=>url===pathToFileURL(html).href}),sources=api.createOriginalMainDshServiceSources({scope,userSource:user}),actor=Object.freeze({requestSource:'user',principalId:'desktop-main-window'});
 cleanup.push(async()=>{user.seal();await user.drain();});
 let sourcesTransferred=false;cleanup.push(async()=>{if(!sourcesTransferred)await api.closeOriginalMainDshStartupSources(sources);});
 await api.prepareOriginalMainDshServiceSources(sources,{dataRoot,workspaceRoot,harnessUserActor:actor});const lease=api.readOriginalMainDshPreparedSources(sources),{realm,runtime:budget,budgetSource,businessSource:business}=lease;
 const service=api.createKSwarmService({desktopProjectScope:scope,ownedDshAdmission:business.admission,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_unrelated_owner_must_not_be_killed');},spawnProcess:(_command,args,options)=>{
  if(!args.includes(entry))throw Error('fixture_other_process_denied');
  const child=spawn(process.execPath,[entry],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:'1',DSH_BUSINESS_ROOT:path.join(root,'business'),DSH_BUSINESS_SCOPE:JSON.stringify(scope)}}),row={pid:child.pid,closed:false};children.push(row);
  child.on('message',message=>{if(message.protocol==='fixture_ready')healthy=true;});child.stdout?.on('data',()=>{});child.stderr?.on('data',value=>process.stderr.write(value));child.once('close',(code,signal)=>{healthy=false;Object.assign(row,{closed:true,code,signal});});return child;
 }});cleanup.push(()=>api.sealAndDrainKSwarmServiceInstance(service));
 const {createRoomStore}=await import(pathToFileURL(path.resolve(repo,'../intent-broker/src/room/store.js')).href),{createRoomService}=await import(pathToFileURL(path.resolve(repo,'../intent-broker/src/room/service.js')).href),{createServer}=await import(pathToFileURL(path.resolve(repo,'../intent-broker/src/http/server.js')).href);
 const brokerStore=createRoomStore({dbPath:path.join(root,'broker.sqlite')});brokerStore.migrate();const token=service.getIntentBrokerRoomToken(),brokerServer=createServer({broker:{},roomService:createRoomService({store:brokerStore}),roomDesktopToken:token,healthProvider:()=>({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:api.computeKSwarmServiceSourceHash(entry)}})});await brokerServer.listen(0,'127.0.0.1');brokerOrigin='http://127.0.0.1:'+brokerServer.address().port;cleanup.push(async()=>{await brokerServer.close();brokerStore.close();});
 const coldRestore=process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_settle'||process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_reject';let serviceDisposalAllowed=false;
 const services=api.createDesktopServices({dataRoot,workspaceRoot,kswarmService:service,harnessOptimizationUserActor:actor,dshServiceSources:sources,materialUserSource:user,modelProbeUserSource:user,knowledgeDbPath:path.join(root,'knowledge.sqlite')}),binding=api.readOriginalMainDshServicesBinding(services,sources);sourcesTransferred=true;cleanup.push(async()=>{if(!serviceDisposalAllowed)return;const result=await services.disposeMultiAgent();assert.equal(result.drained,true);});await binding.constructionReady;
 const store=binding.store,a=api.readOriginalDshAdmissionPort(store,realm),client=api.createCollaborationRoomBrokerClient({token});let controller,reconcileOwners;
 if(coldRestore){
  await service.start();const recovery=await api.createOriginalMainDshControlRecovery({services,sources,brokerClient:client});let recoveryFailure;
  reconcileOwners=async()=>{try{return await recovery.reconcile();}catch(raw){recoveryFailure=raw;throw raw;}};
  cleanup.push(async()=>{if(process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_reject'){assert.ok(recoveryFailure);await assert.rejects(recovery.close(),raw=>raw===recoveryFailure);}else await recovery.close();api.assertOriginalMainDshControlRecoveryPhysicalKnown(recovery,services,sources);serviceDisposalAllowed=true;});
 }else{
  const material=await api.createMainMaterialSource({userSource:user,services});cleanup.push(()=>api.sealAndDrainMainMaterialSource(material));
  const workspace=new api.RoomWorkspaceLocalStore(path.join(root,'workspace.sqlite'));cleanup.push(()=>workspace.close());const forbidden=async()=>{throw Error('fixture_room_execution_forbidden');};
  const room=api.createRoomWorkspaceRuntime({kswarmService:service,store:workspace,broker:{get:forbidden,request:forbidden},wake:{claimWake:client.claimWake,completeWake:client.completeWake},execute:services.runCollaborationRoomAgentTask,executeProject:services.runWorkspaceProjectTask,ensureProtocol:forbidden});cleanup.push(()=>room.shutdown());
  const dispatcher=api.createCollaborationRoomWakeDispatcher({brokerClient:client,execute:services.runCollaborationRoomAgentTask,executeTurn:room.run,canExecute:async()=>true}),direct=api.createKSwarmRuntimeBridge({kswarmService:service,runDesktopTask:services.runKSwarmHandoffTask,runWorkspaceTask:input=>room.runProjectTask(input),allowedRoots:[workspaceRoot],submitResult:forbidden});
  const proof=await api.composeOriginalMainDshRuntime({services,sources,roomRuntime:room,roomDispatcher:dispatcher,directBridge:direct,materialSource:material,brokerClient:client}),view=api.readOriginalMainDshRuntimeBinding(services,sources,proof);controller=view.controller;reconcileOwners=()=>view.coordinator.reconcileOwners();cleanup.push(async()=>{await api.closeOriginalMainDshRuntimeComposition(services,sources);serviceDisposalAllowed=true;});
  await api.startOriginalMainDshServicesRecovery(services,sources,proof);await binding.ready;await service.start();await api.startOriginalMainDshServicesRemoteRecovery(services,sources,proof);
 }
 const invoke=(event,body)=>{const frame=user.open(event,'policy_control',body,'user');try{return a.applyControl(frame.proof,{requestSource:'user',bodyHash:frame.bodyHash,bootstrapAuthority:realm});}finally{frame.release();}};
 let selected;
 const mandateInput=expectedHeadRevision=>({schemaVersion:1,mandateId:'native-pipeline-mandate',sourceBindingId:selected.sourceBindingId,expectedHeadRevision,workProfile:'model_text_only_v1',scopePolicyConsent:true,allowedActorProviderIds:['12'],allowedActions:['source.read','model.process_source','local.draft.create'],validUntil:'2027-01-01T00:00:00Z',maxInputBytes:100000,limits:{maxActiveWorks:1,maxDraftRunsPerWork:1,maxTokens:2000000,maxCostUsd:'1',executionDeadline:'2027-01-01T00:00:00Z'},dataEgressPolicyRef:'user-selected-policy',followup:{enabled:false,observationEndsAt:'2027-01-01T00:00:00Z'}});
 ipcMain.handle('fixture:pipeline',async(event,action)=>{
  try{
  if(action==='setup'){
   for(const scopeKind of ['global','tenant','workspace'])await controller.setMode(event,{schemaVersion:1,scopeKind,...(scopeKind==='global'?{}:{tenantId:tenant}),sourceBindingId:null,mode:'observe',expectedRevision:0});
   await controller.configureBudget(event,{schemaVersion:1,tenantId:tenant,mandateId:'native-pipeline-mandate',mandateRevision:1,tokenLimit:2000000,costLimitUsd:'1',validUntil:'2027-01-01T00:00:00Z'});
   await controller.configureSetup(event,{schemaVersion:1,tenantId:tenant,setupId:'native-pipeline',candidateRepository:{owner:'octo',repo:'demo'},selection:{kind:'label_ids',match:'all',labelIds:['7']},issueRefs:[],minimumIntervalMs:1000,expectedRevision:0});
   const connected=await controller.connect(event,{schemaVersion:1,kind:'setup',setupId:'native-pipeline',configurationRevision:1,operationId:'connect-pipeline',secret:'fixture-only'});selected=connected.sources[0];
   await controller.publishMandate(event,mandateInput(0));
   await controller.setMode(event,{schemaVersion:1,scopeKind:'mandate',sourceBindingId:selected.sourceBindingId,mandateId:'native-pipeline-mandate',mode:'observe',expectedRevision:0});
   await controller.publishEgressPolicy(event,{schemaVersion:1,sourceBindingId:selected.sourceBindingId,mandateId:'native-pipeline-mandate',policyRef:'user-selected-policy',provider:'deepseek',modelIds:['deepseek-flash'],destinationRef:'deepseek-official-chat-completions',purposes:['admission','draft'],enabled:true,validUntil:'2027-01-01T00:00:00Z',expectedRevision:0});
   await reconcileOwners();return await controller.getState();
  }
  if(action==='budget-revision'){
   const readAccount=()=>{const db=new(require('node:sqlite').DatabaseSync)(path.join(root,'budget','harness-optimization.sqlite'),{readOnly:true});try{return db.prepare('SELECT * FROM dsh_budget_accounts').get();}finally{db.close();}};
   const before=readAccount(),prior=api.readOriginalDshDesktopState(realm,store,realm,scope).authorizations.publishedMandates.find(row=>row.projection.document.mandateId==='native-pipeline-mandate');
   assert.equal(before.mandate_revision,1);assert.equal(before.authorization_epoch,1);
   await controller.configureBudget(event,{schemaVersion:1,tenantId:tenant,mandateId:'native-pipeline-mandate',mandateRevision:2,tokenLimit:3000000,costLimitUsd:'2',validUntil:'2027-01-01T00:00:00Z'});
   const revised=readAccount();assert.equal(revised.account_id,before.account_id);assert.equal(revised.owner_id,before.owner_id);assert.equal(revised.authorization_epoch,2);assert.equal(revised.mandate_revision,2);assert.equal(revised.spent_tokens,before.spent_tokens);assert.equal(revised.spent_cost,before.spent_cost);
   const next=mandateInput(prior.headRevision);next.limits.maxTokens=3000000;next.limits.maxCostUsd='2';next.scopePolicyConsent=false;
   await controller.publishMandate(event,next);
   const published=api.readOriginalDshDesktopState(realm,store,realm,scope).authorizations.publishedMandates.find(row=>row.projection.document.mandateId==='native-pipeline-mandate');
   assert.equal(published.projection.document.revision,2);assert.equal(published.projection.document.authorizationEpoch,2);assert.equal(published.projection.document.budgetRef,before.account_id);
   // Idempotent reconfiguration stays in the same account; same-revision
   // numerical mutation and stale epoch cannot revise the original ledger.
   await controller.configureBudget(event,{schemaVersion:1,tenantId:tenant,mandateId:'native-pipeline-mandate',mandateRevision:2,tokenLimit:3000000,costLimitUsd:'2',validUntil:'2027-01-01T00:00:00Z'});
   await assert.rejects(controller.configureBudget(event,{schemaVersion:1,tenantId:tenant,mandateId:'native-pipeline-mandate',mandateRevision:2,tokenLimit:4000000,costLimitUsd:'2',validUntil:'2027-01-01T00:00:00Z'}),/DSH_DESKTOP_OPERATION_FAILED/);
   assert.equal(readAccount().token_limit,3000000);assert.equal(modelCalls,2);
   return {sameAccount:true,mandateRevision:2,authorizationEpoch:2,spentTokens:revised.spent_tokens,spentCost:revised.spent_cost,originalSpentPreserved:true,sameRevisionMutationDenied:true};
  }
  if(action==='activate'){
   // This genuine user IPC drives original A controls under the compiled
   // fixture profile; it does not bypass or enable the installed UI P4 gate.
   const state=api.readOriginalDshDesktopState(realm,store,realm,scope);for(const row of state.modes)invoke(event,{control:{kind:'mode',identity:row.identity,mode:'auto_draft',epoch:row.epoch+1},expectedRevision:row.revision});
   await reconcileOwners();clockLag=298000;await controller.reconcile(event,{schemaVersion:1,sourceBindingId:selected.sourceBindingId,configurationRevision:selected.configurationRevision});return await controller.getState();
  }
  if(action==='new-input'){
   clockLag=0;const stamp=new Date().toISOString();newComment={id:84,node_id:'C_84',user:{id:12,node_id:'U_12'},body:'@person 请为这个 issue 写一份本地实现方案草稿。',created_at:stamp,updated_at:stamp,issue_url:'https://api.github.com/repos/octo/demo/issues/1'};
   await controller.reconcile(event,{schemaVersion:1,sourceBindingId:selected.sourceBindingId,configurationRevision:selected.configurationRevision});return await controller.getState();
  }
  if(action==='fence-pending'||action==='fence-pending-work'){
   let commandId;
   const readWork=async()=>{
    const delivery=await business.reconcileCommand(commandId,new AbortController().signal);
    try{await delivery.observation.waitKnown();delivery.observation.assertKnown();return delivery.observation.output.basis.control;}
    finally{delivery.release();}
   };
   if(action==='fence-pending-work'){
    const db=new(require('node:sqlite').DatabaseSync)(path.join(dataRoot,'multi-agent','groups.sqlite'),{readOnly:true});
    try{commandId=db.prepare('SELECT command_id FROM dsh_a_command_outbox ORDER BY rowid LIMIT 1').get().command_id;}finally{db.close();}
    assert.equal((await readWork()).generationClosed,false);
   }
   const original=api.readOriginalDshDesktopState(realm,store,realm,scope).modes.find(row=>row.identity.kind==='global');
   assert.ok(original);
   invoke(event,{control:{kind:'mode',identity:original.identity,mode:'off',epoch:original.epoch+1},expectedRevision:original.revision});
   const narrowed=api.readOriginalDshDesktopState(realm,store,realm,scope).modes.find(row=>row.identity.kind==='global');
   assert.equal(narrowed.value.mode,'off');
   assert.throws(()=>invoke(event,{control:{kind:'mode',identity:original.identity,mode:'auto_draft',epoch:narrowed.epoch+1},expectedRevision:narrowed.revision}),/DSH_A_FENCE_PENDING/);
   const retained=api.readOriginalDshDesktopState(realm,store,realm,scope).modes.find(row=>row.identity.kind==='global');
   assert.equal(retained.operationId,narrowed.operationId);assert.equal(retained.epoch,narrowed.epoch);assert.equal(retained.value.mode,'off');
   await reconcileOwners();
   if(commandId){const stopped=await readWork();assert.equal(stopped.stopped,true);assert.equal(stopped.generationClosed,true);}
   invoke(event,{control:{kind:'mode',identity:original.identity,mode:'auto_draft',epoch:retained.epoch+1},expectedRevision:retained.revision});
   await reconcileOwners();
   if(commandId){const retainedWork=await readWork();assert.equal(retainedWork.stopped,true);assert.equal(retainedWork.generationClosed,true);}
   const policyAxes=[];
   for(const axis of ['mandate','egress','privacy','readonly']){
    const before=api.readOriginalDshDesktopState(realm,store,realm,scope).scopePolicies.find(row=>row.identity.kind==='global'&&row.axis===axis);
    assert.ok(before);
    invoke(event,{control:{kind:'scope_policy',identity:before.identity,axis,allowed:false,epoch:before.epoch+1},expectedRevision:before.revision});
    const denied=api.readOriginalDshDesktopState(realm,store,realm,scope).scopePolicies.find(row=>row.controlId===before.controlId);
    assert.throws(()=>invoke(event,{control:{kind:'scope_policy',identity:before.identity,axis,allowed:true,epoch:denied.epoch+1},expectedRevision:denied.revision}),/DSH_A_FENCE_PENDING/);
    assert.equal(api.readOriginalDshDesktopState(realm,store,realm,scope).scopePolicies.find(row=>row.controlId===before.controlId).operationId,denied.operationId);
    await reconcileOwners();
    invoke(event,{control:{kind:'scope_policy',identity:before.identity,axis,allowed:true,epoch:denied.epoch+1},expectedRevision:denied.revision});
    await reconcileOwners();policyAxes.push(axis);
   }
   const egressInput={schemaVersion:1,sourceBindingId:selected.sourceBindingId,mandateId:'native-pipeline-mandate',policyRef:'user-selected-policy',provider:'deepseek',modelIds:['deepseek-flash'],destinationRef:'deepseek-official-chat-completions',purposes:['admission','draft'],validUntil:'2027-01-01T00:00:00Z'};
   await controller.publishEgressPolicy(event,{...egressInput,enabled:false,expectedRevision:1});
   // The public controller deliberately sanitizes Store errors. Keep its
   // refusal and separately verify the original Store's exact known cause.
   await assert.rejects(controller.publishEgressPolicy(event,{...egressInput,enabled:true,expectedRevision:2}),/DSH_DESKTOP_OPERATION_FAILED/);
   const retryBody={sourceBindingId:selected.sourceBindingId,mandateId:'native-pipeline-mandate',policy:{policyRef:egressInput.policyRef,epoch:3,provider:egressInput.provider,modelIds:egressInput.modelIds,destinationRef:egressInput.destinationRef,bodyClasses:['source_title_body_v1'],purposes:egressInput.purposes,enabled:true,validUntil:egressInput.validUntil},expectedRevision:2};
   const retryFrame=user.open(event,'policy_control',retryBody,'user');
   try{assert.throws(()=>a.publishEgressPolicy(retryFrame.proof,{requestSource:'user',bodyHash:retryFrame.bodyHash,bootstrapAuthority:realm}),/DSH_A_FENCE_PENDING/);}finally{retryFrame.release();}
   await reconcileOwners();
   await controller.publishEgressPolicy(event,{...egressInput,enabled:true,expectedRevision:2});
   await reconcileOwners();
   return {unconfirmedFenceBlocksAuto:true,originalOffDelivered:true,explicitAutoAfterFence:true,policyAxes,egressEnableWaitsForFence:true,...(commandId?{realWorkStoppedAndNotRevived:true}:{})};
  }
  if(action==='control-cold-register'){
   const prior=api.readOriginalDshDesktopState(realm,store,realm,scope).modes.find(row=>row.identity.kind==='global');
   invoke(event,{control:{kind:'mode',identity:prior.identity,mode:'off',epoch:prior.epoch+1},expectedRevision:prior.revision});
   const originalBroker=await api.createMainDshBrokerControlSource({services,sources,client});await originalBroker.reconcileControls(new AbortController().signal);
   const state=api.readOriginalDshDesktopState(realm,store,realm,scope),head=state.modes.find(row=>row.identity.kind==='global');
   const workDomains=state.authorizations.ownerDomains.filter(row=>row.kind==='work');assert.equal(workDomains.length,1);const item=state.pendingOwnerCommands.find(row=>row.commandId===head.operationId&&row.operation==='apply_dsh_control'&&row.ownerDomain===workDomains[0].domainId);
   assert.ok(item);const claim=a.claimCommand(realm.openClaimCommand({commandId:item.commandId,expectedDeliveryRevision:item.deliveryRevision}),{requestSource:'scheduler'});
   if(process.env.XIAOK_DSH_PIPELINE_CASE!=='control_cold_prepare_unsent'){
    const delivery=await business.sendClaim(claim,new AbortController().signal);
    try{await delivery.observation.waitKnown();delivery.observation.assertKnown();assert.equal(delivery.observation.output.control.value.mode,'off');}finally{delivery.release();}
   }
   const pending=api.readOriginalDshDesktopState(realm,store,realm,scope).pendingOwnerCommands.find(row=>row.commandId===item.commandId&&row.ownerDomain===item.ownerDomain);
   assert.equal(pending.state,'leased');assert.equal(pending.reconcileOnly,true);
   return {operationId:item.commandId,ownerDomain:item.ownerDomain,leasedWithoutAReceipt:true,neverTransmitted:process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_prepare_unsent'};
  }
  throw Error('fixture_action_denied');
  }catch(error){console.error('controlled-pipeline-stage',action,error);throw error;}
 });
 if(process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_settle'||process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_reject'){
  const before=api.readOriginalDshDesktopState(realm,store,realm,scope),workDomains=before.authorizations.ownerDomains.filter(row=>row.kind==='work');assert.equal(workDomains.length,1);const item=before.pendingOwnerCommands.find(row=>row.operation==='apply_dsh_control'&&row.state==='leased'&&row.ownerDomain===workDomains[0].domainId);
  assert.ok(item);assert.equal(item.reconcileOnly,true);assert.equal(api.readOriginalMainDshClock(realm,store,realm).projection.state,'unverified');
  const reject=process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_reject';
  if(reject)await assert.rejects(reconcileOwners(),/DSH_A_CONTROL_RECEIPT_CONFLICT/);
  else await reconcileOwners();
  const history=a.readOperation(realm.openReadHistory({schemaVersion:1,query:{kind:'control',operationId:item.commandId,ownerDomain:item.ownerDomain}}),{requestSource:'scheduler'});
  if(reject){assert.equal(history.delivery.state,'leased');assert.equal(history.receipt,null);}
  else{assert.equal(history.delivery.state,'receipt_observed');assert.equal(history.receipt.ownerControl.value.mode,'off');assert.equal(history.receipt.operationId,item.commandId);}
  assert.equal(modelCalls,0);
  return{actualMain:true,actualAAndBudgetAndB:true,notInstalledP4Qualification:true,coldControl:{newNativeLifetime:true,clockUnverified:true,leasedReadOnlyReconciled:!reject,unconfirmedControlNotAcknowledged:reject,operationId:item.commandId},modelCalls,paths};
 }
 await window.webContents.executeJavaScript("window.pipeline('setup')");
 if(process.env.XIAOK_DSH_PIPELINE_CASE==='fence_pending'){
  const fence=await window.webContents.executeJavaScript("window.pipeline('fence-pending')");
  assert.equal(modelCalls,0);return{actualMain:true,actualAAndBudgetAndB:true,notInstalledP4Qualification:true,fence,modelCalls,paths};
 }
 await window.webContents.executeJavaScript("window.pipeline('activate')");
 await new Promise(yes=>setTimeout(yes,3500));
 if(process.env.XIAOK_DSH_PIPELINE_CASE==='fence_pending_work'){
  await assert.rejects(window.webContents.executeJavaScript("window.pipeline('new-input')"),/DSH_DESKTOP_OPERATION_FAILED/);assert.ok(fencePauseObserved,'must pause only after original persisted create ACK');assert.equal(modelCalls,1);assert.deepEqual(modelKinds,['assessment']);
  const ledger=new(require('node:sqlite').DatabaseSync)(path.join(dataRoot,'harness-optimization.sqlite'),{readOnly:true});let beforeFence;try{beforeFence=ledger.prepare('SELECT spent_tokens,held_tokens,spent_cost,held_cost FROM dsh_budget_accounts').get();}finally{ledger.close();}assert.equal(beforeFence.spent_tokens,130);assert.ok(beforeFence.held_tokens>0);assert.ok(beforeFence.held_cost>0);
  const fence=await window.webContents.executeJavaScript("window.pipeline('fence-pending-work')");assert.equal(modelCalls,1);
  return{actualMain:true,actualAAndBudgetAndB:true,notInstalledP4Qualification:true,fence,modelCalls,paths,pausedAfterOriginalCreateAck:fencePauseObserved,beforeFence};
 }
 if(process.env.XIAOK_DSH_PIPELINE_CASE==='draft_http_negative'){
  await assert.rejects(window.webContents.executeJavaScript("window.pipeline('new-input')"),/DSH_DESKTOP_OPERATION_FAILED/);
  const take=(file,table)=>{const db=new(require('node:sqlite').DatabaseSync)(path.join(root,file),{readOnly:true});try{return db.prepare('SELECT * FROM '+table).all();}finally{db.close();}};
  const state=api.readOriginalDshDesktopState(realm,store,realm,scope),brokerDomains=state.authorizations.ownerDomains.filter(row=>row.writerProfile==='broker_dsh_control_v1');assert.equal(brokerDomains.length,1);assert.equal(brokerStore.db.prepare('SELECT count(*) AS n FROM rooms').get().n,0);
  assert.ok(state.authorizations.publishedMandates.find(row=>row.projection.document.mandateId==='native-pipeline-mandate').projection.document.ownerDomains.some(row=>row.kind==='active_pointer'&&row.domainId===brokerDomains[0].domainId));
  const roots=take('domain/root-resource-v1.sqlite','root_resources'),models=take('domain/root-resource-v1.sqlite','root_physical_resources'),attempts=take('budget/harness-optimization.sqlite','dsh_budget_attempts'),account=take('budget/harness-optimization.sqlite','dsh_budget_accounts')[0];
  assert.equal(modelCalls,2);assert.equal(roots.length,1);assert.equal(roots[0].state,'released');assert.equal(models.length,2);for(const row of models)assert.equal(row.state,'released');
  assert.equal(attempts.filter(row=>row.state==='unknown').length,1);assert.ok(account.held_tokens>0);assert.ok(account.held_cost>0);
  const entities=take('business/state.sqlite','state_entities');assert.equal(entities.filter(row=>JSON.parse(row.state_json)?.kind==='dsh_draft_artifact').length,0);
  return {actualMain:true,actualAAndBudgetAndB:true,notInstalledP4Qualification:true,independentBrokerRegistered:true,modelCalls,modelKinds,paths,negativeDraft:{businessRejected:true,noDraftArtifact:true,budgetUnknownRetained:true,releasedRoots:1,releasedModelPermits:2}};
 }
 await window.webContents.executeJavaScript("window.pipeline('new-input')");
 const db=new(require('node:sqlite').DatabaseSync)(path.join(dataRoot,'multi-agent','groups.sqlite'),{readOnly:true});let counts;try{const count=table=>Number(db.prepare('SELECT count(*) n FROM '+table).get().n);counts={inputs:count('dsh_a_inbox'),attempts:count('dsh_a_assessment_attempts'),decisions:count('dsh_a_decisions'),outbox:count('dsh_a_command_outbox'),receipts:count('dsh_a_owner_receipts')};}finally{db.close();}
 assert.equal(modelCalls,2);assert.deepEqual(modelKinds,['assessment','draft']);assert.equal(counts.attempts,1);assert.equal(counts.decisions,1);assert.equal(counts.outbox,2);assert.equal(counts.receipts,2);
 const registeredState=api.readOriginalDshDesktopState(realm,store,realm,scope),brokerDomains=registeredState.authorizations.ownerDomains.filter(row=>row.writerProfile==='broker_dsh_control_v1');assert.equal(brokerDomains.length,1);assert.equal(brokerStore.db.prepare('SELECT count(*) AS n FROM rooms').get().n,0);
 const frozenMandate=registeredState.authorizations.publishedMandates.find(row=>row.projection.document.mandateId==='native-pipeline-mandate');assert.ok(frozenMandate.projection.document.ownerDomains.some(row=>row.kind==='active_pointer'&&row.domainId===brokerDomains[0].domainId));
 if(process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_prepare'||process.env.XIAOK_DSH_PIPELINE_CASE==='control_cold_prepare_unsent'){
  const coldControl=await window.webContents.executeJavaScript("window.pipeline('control-cold-register')");
  return{actualMain:true,actualAAndBudgetAndB:true,independentBrokerRegistered:true,notInstalledP4Qualification:true,coldControl,counts,modelCalls,paths};
 }
 const settlement={};
 for(const [file,tables] of [['budget/harness-optimization.sqlite',['dsh_budget_accounts','dsh_budget_work_heads','dsh_budget_work_closures']],['domain/root-resource-v1.sqlite',['root_resources','root_physical_resources']]]){
  const db=new(require('node:sqlite').DatabaseSync)(path.join(root,file),{readOnly:true});try{for(const table of tables)settlement[table]=db.prepare('SELECT * FROM '+table).all();}finally{db.close();}
 }
 assert.equal(settlement.dsh_budget_accounts.length,1);assert.equal(settlement.dsh_budget_accounts[0].held_tokens,0);assert.equal(settlement.dsh_budget_accounts[0].held_cost,0);
 assert.equal(settlement.dsh_budget_work_heads.length,1);assert.equal(settlement.dsh_budget_work_heads[0].state,'closed');assert.equal(settlement.dsh_budget_work_closures.length,1);
 assert.equal(settlement.root_resources.length,1);assert.equal(settlement.root_resources[0].state,'released');assert.equal(settlement.root_physical_resources.length,2);for(const row of settlement.root_physical_resources)assert.equal(row.state,'released');
 const completion={workClosed:true,accountHeldTokens:0,accountHeldCost:0,releasedRoots:1,releasedModelPermits:2};
 const budgetRevision=process.env.XIAOK_DSH_PIPELINE_CASE==='budget_revision'?await window.webContents.executeJavaScript("window.pipeline('budget-revision')"):null;
 const workFence=process.env.XIAOK_DSH_PIPELINE_CASE==='fence_pending_work'
  ?await window.webContents.executeJavaScript("window.pipeline('fence-pending-work')"):null;
 return {controlledProvider:true,actualMain:true,actualAAndBudgetAndB:true,independentBrokerRegistered:true,notInstalledP4Qualification:true,counts,modelCalls,modelKinds,paths,completion,...(budgetRevision?{budgetRevision}:{}),...(workFence?{fence:workFence}:{})};
}
run().then(async facts=>{for(let i=cleanup.length-1;i>=0;i--)try{await cleanup[i]();}catch(error){if(!failed){failed=true;failure=error;}}if(failed)throw failure;fs.writeFileSync(resultFile,JSON.stringify({ok:true,pid:process.pid,...facts,children,remainingSockets:sockets.size}));},async error=>{failed=true;failure=error;for(let i=cleanup.length-1;i>=0;i--)try{await cleanup[i]();}catch{}}).catch(error=>{if(!failed){failed=true;failure=error;}}).finally(()=>{if(failed){process.stderr.write((failure?.stack||String(failure))+'\n');fs.writeFileSync(resultFile,JSON.stringify({ok:false,pid:process.pid,error:failure?.stack||String(failure),children,paths,modelCalls,modelKinds}));}app.exit(failed?1:0);});
