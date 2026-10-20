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
 * @param {{issuer?:string,partialRunWriteDeny?:boolean,project?:{id?:string,name?:string,goal?:string},workflowName?:string,phaseTitle?:string,prompt?:string,label?:string,tasks?:import('./owned-workflow-network-fixture.mjs').OwnedWorkflowTaskInput[],issuedAt?:number}} options */
export async function createOwnedWorkflowNetworkFixture(permissions=null,options={}){
const nativeFetch=globalThis.fetch;
const root=realpathSync(mkdtempSync(join(tmpdir(),'workflow-real-get-')));
const data=join(root,'data');mkdirSync(data);mkdirSync(join(root,'config'));
let child,deadline,broker,brokerHTTP;
const net=createServer();await new Promise((resolve,reject)=>{net.once('error',reject);net.listen(0,'127.0.0.1',resolve);});
const port=net.address().port;await new Promise(resolve=>net.close(resolve));
const hub=createHub({silent:true,eventLogDir:join(data,'events'),projectStorageRoot:join(data,'projects'),
 dataDir:{backend:'sqlite',filePath:join(data,'state.sqlite'),legacyJsonPath:join(data,'state.json'),silent:true}});
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
  const workflowId=options.issuer==='po_generated'?'po-generated-task-workflow':'po-generated-project-workflow';
  const taskId=options.issuer==='po_generated'?added.taskIds[0]:null;
  const now=options.issuedAt??1;assert.ok(Number.isSafeInteger(now)&&now>=1);
  const proposal=hub.createWorkflowProposal(project.id,workflowId,{requestedBy:'human',taskId,now:now-1});assert.equal(proposal.ok,true);
  issued=hub.startWorkflowRunFromProposal(proposal.workflowProposal.id,{projectId:project.id,workflowId,taskId,approvedBy:'human',now});assert.equal(issued.ok,true);
  assert.equal(issued.workflowRun.source,options.issuer);assert.equal(issued.workflowRun.workflowId,workflowId);
  assert.equal(issued.dispatches.length,1);
  assert.equal(issued.dispatches[0].nodeId,options.issuer==='po_generated'?'worker-produce-deliverable':'worker-produce-project-deliverable');
 }else{
 const workflowName=options.workflowName??'actual_get_workflow',phaseTitle=options.phaseTitle??'Read';
 const scriptSource=options.workflowName===undefined&&options.phaseTitle===undefined?"export const meta = { name: 'actual_get_workflow' };\nphase('Read');":`export const meta = { name: ${JSON.stringify(workflowName)} };\nphase(${JSON.stringify(phaseTitle)});`;
 const scriptHash=normalizeAndHashWorkflowScript(scriptSource).scriptHash;
 const preview={ok:true,workflowId:workflowName,source:'script_generated',strategy:'workflow',status:'pending_confirmation',projectId:project.id,scope:{projectId:project.id},requestedBy:'human',createdAt:1780000000000,title:'Temporary read',description:'Temporary state',meta:{name:workflowName,description:'Temporary state',phases:[{title:phaseTitle}]},phases:[{id:'read',title:phaseTitle,detail:null}],scriptHash,analysis:{agentCallCount:1,phaseCallCount:1,parallelCallCount:0,pipelineCallCount:0,requestUserInputCallCount:0,runtimePhaseTitles:[phaseTitle]}};
 const proposal=hub.createScriptWorkflowProposal(project.id,preview,{requestedBy:'human',scriptSource});assert.equal(proposal.ok,true);
 const started=hub.startScriptWorkflowRunFromProposal(proposal.workflowProposal.id,{approvedBy:'human'});assert.equal(started.ok,true);
 issued=hub.dispatchWorkflowScriptAgentNode(started.workflowRun.id,{phaseTitle,prompt:options.prompt??'Read temporary state',...(options.label?{label:options.label}:{}),assignedAgent:'xiaok-worker',permissions});assert.equal(issued.ok,true);
 }
 const original=hub.getWorkflowRun(issued.workflowRun.id);
 if(options.partialRunWriteDeny===true){
  const before=structuredClone(original);assert.equal(original.permissions,null);
  original.permissions={allowWrite:false};const expected=structuredClone(before);expected.permissions={allowWrite:false};
  assert.deepEqual(original,expected,'only existing aggregate restriction changes');hub.persistState();
 }
 hub.closePersistence();
 broker=createBrokerService({dbPath:join(root,'broker.sqlite')});brokerHTTP=createBrokerHTTPServer({broker,roomService:broker.room});await brokerHTTP.listen(0,'127.0.0.1');
 const brokerBase=`http://127.0.0.1:${brokerHTTP.address().port}`;
 const base=`http://127.0.0.1:${port}`;
 async function startOwnedServer(){
 child=spawn(process.execPath,['--import',fileURLToPath(new URL('./owned-workflow-child-account-preload.mjs',import.meta.url)),'src/server/index.js'],{cwd:resolve(siblingRoot,'kswarm'),env:{...process.env,XIAOK_WORKFLOW_FIXTURE_HOME:root,KSWARM_DATA_ROOT:data,KSWARM_PORT:String(port),BROKER_URL:brokerBase,KSWARM_DESKTOP_MUTATION_TOKEN:'temporary-test-token',XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_DISABLE_GLOBAL_PLUGINS:'1'},stdio:['ignore','pipe','pipe']});
 // Own child is unconditionally stopped before existing 8s recovery/worker timer.
 let logs='';child.stdout.on('data',bytes=>{logs+=bytes.toString();});child.stderr.on('data',bytes=>{logs+=bytes.toString();});
 const deadlineChild=child;deadline=setTimeout(()=>{if(deadlineChild.exitCode===null)deadlineChild.kill('SIGKILL');},5000);
 let ready=false;
 for(let attempt=0;attempt<30;attempt++){
  if(child.exitCode!==null)throw Error(`owned server exited ${child.exitCode}: ${logs}`);
  try{if((await nativeFetch(base+'/health',{signal:AbortSignal.timeout(100)})).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.equal(ready,true,'actual owned server must be ready');
 }
 await startOwnedServer();
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
 async function stopOwnedServer(){
  clearTimeout(deadline);const owned=child;
  if(owned&&owned.exitCode===null){
   const exit=once(owned,'exit');let timer;
   try{owned.kill('SIGTERM');timer=setTimeout(()=>{if(owned.exitCode===null)owned.kill('SIGKILL');},1000);await exit;}
   finally{clearTimeout(timer);}
  }
 }
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
 const close=async()=>{if(disposed)return;disposed=true;try{hub.closePersistence();}catch{}
  await stopOwnedServer();await brokerHTTP?.close();broker?.close();rmSync(root,{recursive:true,force:true});};
 return {root,base,brokerBase,workspace,project,original,issued,forwardedFetch,nativeFetch,requestLog,close,tightenToReadonly,durableMutations};
}catch(error){
 clearTimeout(deadline);try{hub.closePersistence();}catch{}
 if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(()=>{child.kill('SIGKILL');resolve();},1000))]);}
 try{await brokerHTTP?.close();}catch{}try{broker?.close();}catch{}
 rmSync(root,{recursive:true,force:true});throw error;
}
}
