import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
const siblingRoot=resolve(repositoryRoot,'..');
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import WebSocket from 'ws';
const {createBrokerService}=await import(resolve(siblingRoot,'intent-broker','src/broker/service.js'));
const {createServer:createBrokerHTTPServer}=await import(resolve(siblingRoot,'intent-broker','src/http/server.js'));
const {createSqlitePersistence}=await import(resolve(siblingRoot,'kswarm','src/core/sqlite-persistence.js'));
const {decomposeState}=await import(resolve(siblingRoot,'kswarm','src/core/state-scope.js'));
const {validateNodePermissions}=await import(resolve(siblingRoot,'kswarm','src/core/workflow-node-permissions.js'));
const {createHub}=await import(resolve(siblingRoot,'kswarm','src/core/hub.js'));
const {normalizeAndHashWorkflowScript}=await import(resolve(siblingRoot,'kswarm','src/core/workflow-script-source.js'));
const {initProjectWorkspace}=await import(resolve(siblingRoot,'kswarm','src/server/project-workspace.js'));

// Characterize actual persisted issuer -> actual HTTP GET, without model/network
// command demonstrations or an invented successful GET response body.
/** @param {{toolCategories?:string[],deniedCommandIds?:string[],deniedCommands?:string[]}|null} permissions
 * @param {{issuer?:string,partialRunWriteDeny?:boolean,project?:{id?:string,name?:string,goal?:string},workflowName?:string,phaseTitle?:string,prompt?:string,label?:string,tasks?:import('./owned-workflow-network-fixture.mjs').OwnedWorkflowTaskInput[]}} options */
export async function createOwnedWorkflowNetworkFixture(permissions=null,options={}){
const nativeFetch=globalThis.fetch;
const root=realpathSync(mkdtempSync(join(tmpdir(),'workflow-real-get-')));
const data=join(root,'data');mkdirSync(data);mkdirSync(join(root,'config'));
let child,childClosed,deadline,broker,brokerHTTP,recipient,recipientFailure,poTarget,original,serverStartedAt,serverStartedMonotonic,protectionTriggered=false;
const receivedHandoffs=[];
let handoffArrived;
const net=createServer();await new Promise((resolve,reject)=>{net.once('error',reject);net.listen(0,'127.0.0.1',resolve);});
const port=net.address().port;await new Promise(resolve=>net.close(resolve));
const hub=createHub({silent:true,eventLogDir:join(data,'events'),projectStorageRoot:join(data,'projects'),
 dataDir:{backend:'sqlite',filePath:join(data,'state.sqlite'),legacyJsonPath:join(data,'state.json'),silent:true}});
async function stopOwnedServer(){
 clearTimeout(deadline);const owned=child;
 if(owned&&owned.exitCode===null){
  let timer;try{owned.kill('SIGTERM');timer=setTimeout(()=>{if(owned.exitCode===null)owned.kill('SIGKILL');},1000);await childClosed;}
  finally{clearTimeout(timer);}
 }else if(childClosed)await childClosed;
}
async function stopOwnedRecipient(){
 const owned=recipient;if(!owned)return;recipient=undefined;
 if(owned.readyState===WebSocket.CLOSED)return;
 const closed=new Promise(resolve=>owned.once('close',resolve));let timer;
 try{owned.close();timer=setTimeout(()=>owned.terminate(),1000);await closed;}finally{clearTimeout(timer);}
}
async function joinBrokerDisconnects(){
 if(!broker)return;
 const notifier=broker.getWebSocketNotifier(),until=Date.now()+1000;
 for(;;){
  // The real backend close callback removes its socket and synchronously writes
  // presence. Observe only after an event-loop turn and before notifier.close(),
  // which would clear the map before those callbacks had completed.
  await new Promise(resolve=>setImmediate(resolve));
  const connected=notifier.listConnections();if(!connected.length)return;
  if(Date.now()>=until)throw Error('owned_broker_disconnect_unknown:'+JSON.stringify(connected));
 }
}
async function closePoOwners(primary){
 const failed=arguments.length!==0,errors=[];
 let joined=false;
 for(const close of [stopOwnedServer,stopOwnedRecipient])try{await close();}catch(error){errors.push(error);}
 try{await joinBrokerDisconnects();joined=true;}catch(error){errors.push(error);}
 // Unknown backend drains retain the live broker database and owned root.
 // Never turn a cleared notifier map into proof that its callbacks completed.
 if(joined&&!errors.length)for(const close of [()=>broker?.close(),()=>brokerHTTP?.close(),()=>hub.closePersistence()])try{await close();}catch(error){errors.push(error);}
 if(recipientFailure&&(!failed||recipientFailure!==primary)&&!errors.includes(recipientFailure))errors.push(recipientFailure);
 if(!errors.length)try{rmSync(root,{recursive:true,force:true});}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],'owned_workflow_protocol_cleanup_failed',{...(failed?{cause:primary}:{})});
 if(failed)throw primary;
}
try{
 const project=hub.createProject({id:options.project?.id??'project',name:options.project?.name??'Temporary project',goal:options.project?.goal??'Read temporary state',poAgent:'xiaok-po',members:['xiaok-worker'],autoAssignPo:false});
 hub.createProject({id:'other',name:'Other temporary project',goal:'Other',poAgent:'xiaok-po',members:[],autoAssignPo:false});
 const workspace=initProjectWorkspace(new Map(),join(data,'projects'),project.id);
 let issued;
 if(options.issuer==='builtin-smoke'){
  issued=hub.startAgentReviewSmokeWorkflow(project.id,{requestedBy:'human'});assert.equal(issued.ok,true);assert.equal(issued.workflowRun.source,'builtin-smoke');assert.equal(issued.workflowRun.workflowId,'agent-review-smoke');
 }else if(options.issuer==='po_generated'||options.issuer==='po_generated_project'){
  // These are ordinary persisted Hub producers, not hand-built run/spec rows.
  // Keep the original mixed permissions intact for the real checkpoint.
  assert.equal(permissions,null);assert.notEqual(options.partialRunWriteDeny,true);
  assert.ok(Array.isArray(options.tasks));
  if(options.issuer==='po_generated')assert.equal(options.tasks.length,1);
  const added=hub.handleHumanAddTasks(project.id,options.tasks);assert.equal(added.ok,true);
  assert.equal(added.taskIds.length,options.tasks.length);
  const approved=hub.handleApprove(project.id);assert.equal(approved.ok,true);
  poTarget={workflowId:options.issuer==='po_generated'?'po-generated-task-workflow':'po-generated-project-workflow',taskId:options.issuer==='po_generated'?added.taskIds[0]:null};
 }else{
 const workflowName=options.workflowName??'actual_get_workflow',phaseTitle=options.phaseTitle??'Read';
 const scriptSource=options.workflowName===undefined&&options.phaseTitle===undefined?"export const meta = { name: 'actual_get_workflow' };\nphase('Read');":`export const meta = { name: ${JSON.stringify(workflowName)} };\nphase(${JSON.stringify(phaseTitle)});`;
 const scriptHash=normalizeAndHashWorkflowScript(scriptSource).scriptHash;
 const preview={ok:true,workflowId:workflowName,source:'script_generated',strategy:'workflow',status:'pending_confirmation',projectId:project.id,scope:{projectId:project.id},requestedBy:'human',createdAt:1780000000000,title:'Temporary read',description:'Temporary state',meta:{name:workflowName,description:'Temporary state',phases:[{title:phaseTitle}]},phases:[{id:'read',title:phaseTitle,detail:null}],scriptHash,analysis:{agentCallCount:1,phaseCallCount:1,parallelCallCount:0,pipelineCallCount:0,requestUserInputCallCount:0,runtimePhaseTitles:[phaseTitle]}};
 const proposal=hub.createScriptWorkflowProposal(project.id,preview,{requestedBy:'human',scriptSource});assert.equal(proposal.ok,true);
 const started=hub.startScriptWorkflowRunFromProposal(proposal.workflowProposal.id,{approvedBy:'human'});assert.equal(started.ok,true);
 issued=hub.dispatchWorkflowScriptAgentNode(started.workflowRun.id,{phaseTitle,prompt:options.prompt??'Read temporary state',...(options.label?{label:options.label}:{}),assignedAgent:'xiaok-worker',permissions});assert.equal(issued.ok,true);
 }
 if(issued)original=hub.getWorkflowRun(issued.workflowRun.id);
 if(options.partialRunWriteDeny===true){
  const before=structuredClone(original);assert.equal(original.permissions,null);
  original.permissions={allowWrite:false};const expected=structuredClone(before);expected.permissions={allowWrite:false};
  assert.deepEqual(original,expected,'only existing aggregate restriction changes');hub.persistState();
 }
 hub.closePersistence();
 broker=createBrokerService({dbPath:join(root,'broker.sqlite')});brokerHTTP=createBrokerHTTPServer({broker,roomService:broker.room});if(poTarget)broker.attachWebSocket(brokerHTTP.raw());await brokerHTTP.listen(0,'127.0.0.1');
 const brokerBase=`http://127.0.0.1:${brokerHTTP.address().port}`;
 const base=`http://127.0.0.1:${port}`;
 if(poTarget){
  // Hosted xiaok-worker dispatches are delivered to the actual Desktop recipient.
  // This socket only receives the real broker event; it runs no model or command.
  const registered=await nativeFetch(brokerBase+'/participants/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({participantId:'xiaok-desktop',kind:'desktop',alias:'owned-workflow-desktop',roles:['worker'],capabilities:[],inboxMode:'realtime'})});
  assert.equal(registered.ok,true);assert.equal((await registered.json()).participantId,'xiaok-desktop');
  recipient=new WebSocket(brokerBase.replace('http:','ws:')+'/ws?participantId=xiaok-desktop');
  recipient.on('error',error=>{recipientFailure=error;});
  recipient.on('message',bytes=>{try{const message=JSON.parse(bytes.toString());if(message.type==='new_intent'&&message.event?.kind==='workflow_node_handoff'){receivedHandoffs.push(message.event);handoffArrived?.();}}catch(error){recipientFailure=error;}});
  await once(recipient,'open');
 }
 async function startOwnedServer(){
 child=spawn(process.execPath,['--import',fileURLToPath(new URL('./owned-workflow-child-account-preload.mjs',import.meta.url)),'src/server/index.js'],{cwd:resolve(siblingRoot,'kswarm'),env:{...process.env,XIAOK_WORKFLOW_FIXTURE_HOME:root,KSWARM_DATA_ROOT:data,KSWARM_PORT:String(port),BROKER_URL:brokerBase,KSWARM_DESKTOP_MUTATION_TOKEN:'temporary-test-token',XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_DISABLE_GLOBAL_PLUGINS:'1'},stdio:['ignore','pipe','pipe']});
 childClosed=new Promise(resolve=>child.once('close',resolve));
 // Own child is unconditionally stopped before existing 8s recovery/worker timer.
 let logs='';child.stdout.on('data',bytes=>{logs+=bytes.toString();});child.stderr.on('data',bytes=>{logs+=bytes.toString();});
 const deadlineChild=child;serverStartedAt=Date.now();serverStartedMonotonic=performance.now();protectionTriggered=false;deadline=setTimeout(()=>{if(deadlineChild.exitCode===null){protectionTriggered=true;deadlineChild.kill('SIGKILL');}},5000);
 let ready=false;
 for(let attempt=0;attempt<30;attempt++){
  if(child.exitCode!==null)throw Error(`owned server exited ${child.exitCode}: ${logs}`);
  try{const health=await nativeFetch(base+'/health',{signal:AbortSignal.timeout(100)});if(health.ok&&(!poTarget||(await health.json()).brokerConnected===true)){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.equal(ready,true,'actual owned server must be ready');
 }
 await startOwnedServer();
 if(poTarget){
  const prefix=base+'/projects/'+encodeURIComponent(project.id)+'/workflows/'+encodeURIComponent(poTarget.workflowId);
  const post=async(path,body)=>{const response=await nativeFetch(path,{method:'POST',headers:{'content-type':'application/json','x-kswarm-mutation-token':'temporary-test-token'},body:JSON.stringify(body),signal:AbortSignal.timeout(Math.max(1,5000-(Date.now()-serverStartedAt)))});const result=await response.json();assert.equal(response.ok,true,JSON.stringify(result));assert.equal(result.ok,true);return result;};
  // Run creation belongs to the already-started server's single actual Hub.
  // Startup recovery must not consume a pre-created task run as interrupted work.
  const proposal=await post(prefix+'/proposal',{taskId:poTarget.taskId,requestedBy:'human'});
  assert.equal(proposal.workflowProposal.projectId,project.id);assert.equal(proposal.workflowProposal.workflowId,poTarget.workflowId);
  issued=await post(prefix+'/runs',{proposalId:proposal.workflowProposal.id,taskId:poTarget.taskId,approvedBy:'human'});
  assert.equal(issued.workflowRun.source,options.issuer);assert.equal(issued.workflowRun.workflowId,poTarget.workflowId);assert.equal(issued.workflowRun.projectId,project.id);assert.equal(issued.workflowRun.status,'running');
  assert.equal(issued.dispatches.length,1);const dispatch=issued.dispatches[0];
  assert.equal(dispatch.nodeId,options.issuer==='po_generated'?'worker-produce-deliverable':'worker-produce-project-deliverable');
  assert.equal(dispatch.projectId,project.id);assert.equal(dispatch.workflowRunId,issued.workflowRun.id);assert.equal(dispatch.workflowId,poTarget.workflowId);
  if(!receivedHandoffs.length)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{handoffArrived=undefined;reject(Error('owned_workflow_handoff_not_received'));},Math.max(1,5000-(Date.now()-serverStartedAt)));handoffArrived=()=>{clearTimeout(timer);handoffArrived=undefined;resolve();};});
  if(recipientFailure)throw recipientFailure;
  assert.equal(receivedHandoffs.length,1);const received=receivedHandoffs[0].payload;
  for(const key of ['projectId','workflowRunId','workflowId','nodeId','nodeKind','attempt','handoffId','targetParticipantId'])assert.deepEqual(received[key],dispatch[key]);
  assert.equal(received.project.id,project.id);assert.equal(realpathSync(received.project.workFolder),realpathSync(workspace.path));
  const response=await nativeFetch(base+'/projects/'+encodeURIComponent(project.id)+'/workflows/'+encodeURIComponent(dispatch.workflowRunId));assert.equal(response.ok,true);original=(await response.json()).workflowRun;
  assert.deepEqual(original,issued.workflowRun);
 }
 const requestLog=[];
 const forwardedFetch=async (input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  let target;
  if((url.hostname==='127.0.0.1'||url.hostname==='localhost')&&url.port==='4400')target=base;
  else if((url.hostname==='127.0.0.1'||url.hostname==='localhost')&&url.port==='4318')target=brokerBase;
  else throw Error('fixture_unowned_fetch_target_denied');
  requestLog.push({originalOrigin:url.origin,path:url.pathname,method:init?.method??'GET',ownedTarget:target});
  return nativeFetch(target+url.pathname+url.search,init);
 };
 const durableMutations=[];
 async function tightenToReadonly(){
  const validated=validateNodePermissions({toolCategories:['read_project_state']});assert.equal(validated.ok,true);
  await stopOwnedServer();
  const persistence=createSqlitePersistence({filePath:join(data,'state.sqlite'),legacyJsonPath:join(data,'state.json'),silent:true});
  try{
   const state=persistence.load();assert.ok(state);
   const run=state.workflowRuns.find(run=>run.id===issued.workflowRun.id);assert.ok(run);
   const node=run.nodes.find(node=>node.id===issued.dispatches[0].nodeId);assert.ok(node);
   const before=structuredClone(run);assert.equal(node.runtime.handoffId,issued.dispatches[0].handoffId);
   node.input.permissions=validated.permissions;
   const expected=structuredClone(before);expected.nodes.find(item=>item.id===node.id).input.permissions=validated.permissions;
   assert.deepEqual(run,expected,'only the real issued durable permissions field changes');
   persistence.saveSync({scope:{type:'full'},entities:decomposeState(state)});
   durableMutations.push({runId:run.id,nodeId:node.id,revision:persistence.revision,beforePermissions:before.nodes.find(item=>item.id===node.id).input.permissions,afterPermissions:validated.permissions});
  }finally{persistence.close();}
  await startOwnedServer();
  const response=await nativeFetch(base+'/projects/'+project.id+'/workflows/'+issued.workflowRun.id);
  assert.equal(response.ok,true);const fresh=await response.json();
  assert.deepEqual(fresh.workflowRun.nodes.find(node=>node.id===issued.dispatches[0].nodeId).input.permissions,validated.permissions);
 }
 let disposed=false;
 const close=async()=>{if(disposed)return;disposed=true;if(poTarget)return closePoOwners();try{hub.closePersistence();}catch{}
  await stopOwnedServer();await brokerHTTP?.close();broker?.close();rmSync(root,{recursive:true,force:true});};
 return {root,base,brokerBase,workspace,project,original,issued,getReceivedHandoffs:()=>structuredClone(receivedHandoffs),getOwnedServerState:()=>({protectionTriggered,elapsedMs:performance.now()-serverStartedMonotonic,exitCode:child?.exitCode,signalCode:child?.signalCode}),forwardedFetch,nativeFetch,requestLog,close,tightenToReadonly,durableMutations};
}catch(error){
 if(options.issuer==='po_generated'||options.issuer==='po_generated_project')return closePoOwners(error);
 clearTimeout(deadline);try{hub.closePersistence();}catch{}
 if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(()=>{child.kill('SIGKILL');resolve();},1000))]);}
 try{await brokerHTTP?.close();}catch{}try{broker?.close();}catch{}
 rmSync(root,{recursive:true,force:true});throw error;
}
}
