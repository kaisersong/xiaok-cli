/* Real Electron main + real DesktopServices/TaskHost. Preparation-only probe.
 * A deliberate start-commit rejection prevents invoking ANY runner. This does
 * not measure real C execution, model quality, approval UX, or user efficiency.
 */
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const [phase,sessionRoot,countText,profileMode]=process.argv.slice(2);
const audit=profileMode==='audit';
if(!['prepare','recover'].includes(phase)||!sessionRoot)throw Error('usage: Electron prepared-electron.cjs prepare|recover SESSION [1..20]');
const root=fs.realpathSync(sessionRoot),session=JSON.parse(fs.readFileSync(path.join(root,'session.json'),'utf8'));
const file=path.join(root,`prepared-${phase}.json`);
if(fs.existsSync(file))throw Error('phase_already_recorded_use_new_session');
const dirs=['electron-user-data','electron-session','plugins','config'];
for(const dir of dirs)fs.mkdirSync(path.join(root,dir),{recursive:true,mode:0o700});
app.setPath('userData',path.join(root,'electron-user-data'));
app.setPath('sessionData',path.join(root,'electron-session'));
app.disableHardwareAcceleration();
process.env.XIAOK_CONFIG_DIR=path.join(root,'config');
process.env.XIAOK_CONVERSATION_ACTIVITY='0'; // no owner daemon or OS notifications
const requests=[];
// Effect denial, never a model/tool success stub. No network is permitted here.
globalThis.fetch=async()=>{requests.push({at:Date.now(),kind:'fetch_denied'});throw Error('prepared_probe_network_forbidden');};
const configPath=path.join(root,'config','config.json');
if(phase==='prepare')fs.writeFileSync(configPath,JSON.stringify({schemaVersion:2,providers:{},models:{},memory:{autoDistill:false}}),{mode:0o600,flag:'wx'});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
let services,kswarm;
const result={schemaVersion:1,phase,pid:process.pid,startedAt:new Date().toISOString(),auditProfile:audit,dataClass:'real_foreground_preparation_with_synthetic_commit_rejection',realCModelExecutions:0,modelCalls:0,uiOperations:null,userElapsedMs:null,rows:[],networkAttempts:requests,errors:[]};
fs.writeFileSync(path.join(root,`prepared-${phase}-pid.json`),JSON.stringify({pid:process.pid,phase,startedAt:result.startedAt}),{mode:0o600,flag:'wx'});
(async()=>{
 try{
  const {register}=await import('tsx/esm/api');register();
  await app.whenReady();
  const {createDesktopServices}=await import('../../desktop/electron/desktop-services.ts');
  const {createKSwarmService}=await import('../../desktop/electron/kswarm-service.ts');
  kswarm=createKSwarmService(); // real service object; never start/request it
  const auditProfile=audit?(await import('../../desktop/electron/desktop-readonly-audit.ts')).createDesktopReadonlyAuditProfile(root):undefined;
  services=createDesktopServices({...(auditProfile?{readonlyAuditProfile:auditProfile}:{}),dataRoot:session.dataRoot,workspaceRoot:fs.realpathSync(session.workspace),kswarmService:kswarm,
   knowledgeDbPath:path.join(root,'data','knowledge.db'),pluginRootDir:path.join(root,'plugins'),computerUsePreferencePath:path.join(root,'data','computer-use.json')});
  const port=services.assistantTaskAdmission;
  const domain=await port.domain();
  if(domain.lane!=='local'||domain.cwd!==fs.realpathSync(session.workspace))throw Error('actual_domain_mismatch');
  if(phase==='prepare'){
   const count=Number(countText??20);if(!Number.isSafeInteger(count)||count<1||count>20)throw Error('count_out_of_range');
   const plan=JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8')).rows.filter(row=>row.cohort==='handoff').slice(0,count);
   for(const row of plan){
    const started=performance.now(),binding={operationId:crypto.randomUUID(),requestDigest:hash(row.instruction),threadId:crypto.randomUUID()};
    const allocation=port.allocate(binding);let commits=0,errorCode=null,seenGuard;
    const guardObserved=new Promise(resolve=>{seenGuard=resolve;});
    try{await port.ensure({...binding,taskId:allocation.taskId,instruction:row.instruction,domain,allocation},()=>{commits++;errorCode='prepared_probe_deliberate_commit_rejection';seenGuard();throw Error(errorCode);});}
    catch(error){errorCode=error.message==='prepared_probe_deliberate_commit_rejection'?error.message:error.name;}
    // startTask acknowledges admission before executeTask's asynchronous commit.
    // Wait for the REAL guard invocation, never a fixed-delay guessed receipt.
    let guardTimer;await Promise.race([guardObserved,new Promise((_,reject)=>{guardTimer=setTimeout(()=>reject(Error('actual_guard_not_observed')),5000);})]).finally(()=>clearTimeout(guardTimer));
    const snapshot=await port.lookup(allocation.taskId);
    result.lastObserved={taskId:allocation.taskId,commits,errorCode,checkpoint:snapshot??null};
    if(!snapshot||commits!==1||errorCode!=='prepared_probe_deliberate_commit_rejection'||JSON.stringify(snapshot.assistantBinding)!==JSON.stringify(binding))throw Error('prepared_checkpoint_or_guard_unconfirmed');
    if(snapshot.events.some(event=>['task_execution_started','tool_started','tool_finished','assistant_delta'].includes(event.type)))throw Error('unexpected_execution_event');
    result.rows.push({rowId:row.id,caseId:row.caseId,scenario:'prepared_commit_rejected',plannedScenario:row.scenario,taskId:allocation.taskId,binding,domain,status:snapshot.status,checkpointDigest:hash(JSON.stringify(snapshot)),checkpoint:snapshot,commits,errorCode,elapsedMs:performance.now()-started,modelUsage:'not_invoked',humanOperations:null});
   }
  }else{
   const previous=JSON.parse(fs.readFileSync(path.join(root,'prepared-prepare.json'),'utf8'));
   if(!previous.rows.length||previous.errors.length)throw Error('prepare_phase_incomplete');
   for(const before of previous.rows){
    const started=performance.now(),snapshot=await port.lookup(before.taskId);
    const sameBinding=!!snapshot&&JSON.stringify(snapshot.assistantBinding)===JSON.stringify(before.binding);
    const executionEvents=snapshot?.events.filter(event=>['task_execution_started','tool_started','tool_finished','assistant_delta'].includes(event.type))??[];
    result.rows.push({rowId:before.rowId,taskId:before.taskId,beforePid:previous.pid,afterPid:process.pid,distinctProcess:previous.pid!==process.pid,statusBefore:before.status,statusAfter:snapshot?.status??'unknown',sameBinding,executionEvents:executionEvents.length,checkpoint:snapshot??null,elapsedMs:performance.now()-started,replayRequested:false,modelUsage:'not_invoked',humanOperations:null});
    if(!sameBinding||executionEvents.length||previous.pid===process.pid)throw Error('recovery_identity_or_no_replay_unconfirmed');
   }
  }
 }catch(error){result.errors.push({name:error.name,code:/^[a-z_]+$/.test(error.message)?error.message:'bootstrap_or_native_dependency_unavailable'});}
 finally{
  if(services){
   result.closeDiagnostics=[];
   for(const close of [()=>services.closeTaskSourceWritersForMigration(),()=>services.disposeMultiAgent(),()=>services.closeMaterialRegistryAndArtifactFileManagerInstances()]){
    try{await close();}catch(error){
     const flatten=e=>e instanceof AggregateError?e.errors.flatMap(flatten):[e];
     if(flatten(error).every(e=>e.message==='prepared_probe_deliberate_commit_rejection'))result.closeDiagnostics.push({code:'owner_retained_expected_injected_guard_rejection',count:flatten(error).length});
     else result.errors.push({name:error.name,code:'owner_close_unconfirmed'});
    }
   }
  }
  // The real KSwarm service was never started. Do not issue stop() to a shared daemon.
  if(kswarm)result.kswarmStatus=kswarm.getStatus();
  result.finishedAt=new Date().toISOString();result.executionClass='backend_preparation_only_not_C_or_pilot';
  if(requests.length)result.errors.push({code:'unexpected_network_attempt_blocked'});
  fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({phase,rows:result.rows.length,errors:result.errors,modelCalls:0,evidence:file}));
  app.exit(result.errors.length?2:0);
 }
})();
