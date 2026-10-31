// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {join,resolve,relative,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';
import {setTimeout as realDelay} from 'node:timers/promises';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
// Cold module compilation must not consume the owned server's real 5s protection lease.
const ksModule=await import('../../electron/kswarm-service.ts');
const {createDesktopServices}=await import('../../electron/desktop-services.ts'),{OpenAIAdapter}=await import('../../../src/ai/adapters/openai.ts'),{DesktopExecutionCoordinator}=await import('../../electron/desktop-execution-coordinator.ts');
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
async function waitFor(test:()=>boolean){const started=performance.now();while(!test()){if(performance.now()-started>2000)throw Error('fixture_condition_timeout');await realDelay(10);}}
for(const mode of ['active-eleven','expired-approved','queued-fifteen','delayed-setup','late-prepared','retry-budget','worker-then-reviewer'] as const)it(`actual approved workflow budget: ${mode}`,async()=>{
 const fixture=await createOwnedWorkflowNetworkFixture(null,{issuer:mode==='expired-approved'?'po_generated_project':'po_generated',tasks:[{title:'Fictional report',assignedAgent:'xiaok-worker',requiredOutputs:['markdown']}]});
 const previous={config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS,recovery:process.env.XIAOK_MODEL_RECOVERY_WINDOW_MS};let ks:any,desktop:any,lease:any;const release=deferred();let calls=0,closed=0,settled=false,providerSignal:AbortSignal|undefined;let outcome:Promise<any>|undefined;let mock:any,prepareMock:any,retryTimerMock:any;let retryWaits=0,providerFailed=false;
 try{
 const config=join(fixture.root,'config');writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));
 process.env.XIAOK_CONFIG_DIR=config;process.env.KSWARM_SERVER_PATH=resolve(repositoryRoot,'..','kswarm','src/server/index.js');process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';globalThis.fetch=fixture.forwardedFetch;
 ks=ksModule.createKSwarmService({spawnProcess:(()=>{throw Error('foreign_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('foreign_kill_denied');}});
 if(mode==='delayed-setup'){let shifted=false;
  globalThis.fetch=async(input,init)=>{const response=await fixture.forwardedFetch(input,init);if(new URL(String(input)).pathname==='/agents'&&!shifted){shifted=true;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(fixture.issued.workflowRun.startedAt+14*60000);}return response;};
 }
 if(mode==='late-prepared'){const {ToolRegistry}=await import('../../../src/ai/tools/index.ts');const original=ToolRegistry.prototype.prepareToolInvocationDetailed;prepareMock=vi.spyOn(ToolRegistry.prototype,'prepareToolInvocationDetailed').mockImplementation(async function(this:any,name,input,context){const value=await original.call(this,name,input,context);if(name==='write'&&value.kind==='prepared'){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(fixture.issued.workflowRun.startedAt+16*60000);}return value;});}
 const approvedMinutes=fixture.issued.workflowRun.budgets.maxMinutes;expect(approvedMinutes).toBe(mode==='expired-approved'?30:15);
 expect(fixture.issued.workflowRun.approval.budget.maxMinutes).toBe(approvedMinutes);expect(fixture.issued.workflowRun.budgetGate.hardLimits.maxMinutes).toBe(approvedMinutes);
 if(mode==='retry-budget'){process.env.XIAOK_MODEL_RECOVERY_WINDOW_MS='0';const original=setTimeout;retryTimerMock=vi.spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,ms:any,...args:any[])=>{if(ms===750&&providerFailed){retryWaits++;vi.setSystemTime(fixture.issued.workflowRun.startedAt+15*60000+50);}return original(fn,ms,...args);})as any);}
 const coordinator=new DesktopExecutionCoordinator({backgroundCapacity:1}),file=join(fixture.workspace.artifacts,'approved-budget-report.md');
 mock=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(_messages,_tools,_system,options){
  calls++;providerSignal=options?.signal;try{
   if(mode==='retry-budget'){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(fixture.issued.workflowRun.startedAt+15*60000-100);providerFailed=true;throw Object.assign(Error('ECONNRESET fictional provider'),{code:'ECONNRESET'});}
   if(calls===1){if(mode==='delayed-setup')vi.setSystemTime(fixture.issued.workflowRun.startedAt+16*60000);yield {type:'tool_input_progress' as const};await Promise.race([(mode==='delayed-setup'||mode==='late-prepared')?Promise.resolve():release.promise,new Promise<void>((_,reject)=>{const abort=()=>reject(options?.signal?.reason);if(options?.signal?.aborted)abort();else options?.signal?.addEventListener('abort',abort,{once:true});})]);options?.signal?.throwIfAborted();
    yield {type:'tool_use' as const,id:'one-write',name:'write',input:{file_path:file,content:'# Fictional report\nVerified evidence and bounded conclusions.\n'}};
   }else yield {type:'text' as const,delta:JSON.stringify({output:{summary:'Fictional report generated with verified evidence and bounded conclusions; the artifact is readable and complete.',artifacts:[{path:file,kind:'markdown'}],evidenceRefs:['artifact:'+file]}})};
   yield {type:'done' as const};
  }finally{closed++;}
 });
 desktop=createDesktopServices({dataRoot:join(fixture.root,'desktop-data'),kswarmService:ks,executionCoordinator:coordinator});
 if(mode==='queued-fifteen')lease=await coordinator.acquireLease({lane:'background',policy:'ordinary'});
 const run=desktop.runKSwarmWorkflowNode({handoff:{...fixture.issued.dispatches[0],input:{...fixture.issued.dispatches[0].input,budget:{maxMinutes:10000}},project:{id:fixture.project.id,name:fixture.project.name,workFolder:fixture.workspace.path}},targetParticipantId:'xiaok-worker'});
 outcome=run.then((value:any)=>{settled=true;return {ok:true,value};},(error:any)=>{settled=true;return {ok:false,error};});
 if(mode==='retry-budget'){await waitFor(()=>settled);const rejected=await outcome;expect(rejected.ok).toBe(false);expect(String(rejected.error)).toMatch(/WORKFLOW_RUN_DEADLINE_EXCEEDED|desktop_tool_loop_deadline_exceeded/);expect(calls).toBe(1);expect(retryWaits).toBe(1);expect(existsSync(file)).toBe(false);return;}
 if(mode==='delayed-setup'||mode==='late-prepared'){await waitFor(()=>settled);expect((await outcome).ok).toBe(false);expect(existsSync(file)).toBe(false);return;}
 await waitFor(()=>mode==='queued-fifteen'?coordinator.snapshot().waiting===1:calls===1);
 // Fake Date only. Real HTTP, fixture ownership timers and provider cleanup stay real.
 vi.useFakeTimers({toFake:['Date']});if(mode==='expired-approved'){vi.setSystemTime(fixture.issued.workflowRun.startedAt+(approvedMinutes-1)*60000);await realDelay(650);expect(settled).toBe(false);}vi.setSystemTime(fixture.issued.workflowRun.startedAt+((mode==='active-eleven'||mode==='worker-then-reviewer')?11:approvedMinutes)*60000+50);
 await realDelay(650);
 if(mode==='active-eleven'||mode==='worker-then-reviewer'){
  expect(settled).toBe(false);release.resolve();await waitFor(()=>settled);const result=await outcome;
  expect(result.ok,JSON.stringify({error:result.error?.stack??String(result.error),server:fixture.getOwnedServerState()})).toBe(true);expect(fixture.getOwnedServerState().protectionTriggered).toBe(false);expect(readFileSync(file,'utf8')).toContain('Verified evidence');expect(calls).toBe(2);expect(closed).toBe(2);
  if(mode==='worker-then-reviewer'){
   const {submitKSwarmWorkflowNodeResultToBroker}=await import('../../electron/kswarm-runtime-bridge.ts');
   const sent=await submitKSwarmWorkflowNodeResultToBroker({brokerUrl:fixture.brokerBase,fetchImpl:fixture.nativeFetch,participantId:'xiaok-desktop',logicalParticipantId:fixture.issued.dispatches[0].targetParticipantId,handoff:fixture.issued.dispatches[0],output:result.value.output});expect(sent.ok).toBe(true);await sent.json();
   const match=()=>fixture.getReceivedHandoffs().find((e:any)=>e.payload?.workflowRunId===fixture.issued.workflowRun.id&&e.payload.nodeKind==='review');await waitFor(()=>!!match());
   const delivered=match()!.payload;if(delivered.handoffPath){const within=relative(fixture.root,resolve(delivered.handoffPath));expect(isAbsolute(within)).toBe(false);expect(within.split(/[/\\]/)[0]).not.toBe('..');}const review=delivered.handoffPath?JSON.parse(readFileSync(delivered.handoffPath,'utf8')):delivered;
   for(const key of ['projectId','workflowRunId','workflowId','nodeId','attempt','handoffId'])expect(review[key]).toEqual(delivered[key]);
   const authoritative=await(await fixture.nativeFetch(fixture.base+'/projects/'+fixture.project.id+'/workflows/'+fixture.issued.workflowRun.id)).json();expect(authoritative.workflowRun.startedAt).toBe(fixture.issued.workflowRun.startedAt);expect(authoritative.workflowRun.nodes.find((n:any)=>n.id===review.nodeId).status).toBe('running');
   mock.mockImplementation(async function*(_m:any,_t:any,_s:any,opts:any){calls++;providerSignal=opts.signal;try{yield {type:'tool_input_progress' as const};await new Promise<void>((_,reject)=>{const abort=()=>reject(opts.signal.reason);if(opts.signal.aborted)abort();else opts.signal.addEventListener('abort',abort,{once:true});});}finally{closed++;}});
   settled=false;outcome=desktop.runKSwarmWorkflowNode({handoff:review,targetParticipantId:delivered.targetParticipantId}).then((value:any)=>{settled=true;return {ok:true,value};},(error:any)=>{settled=true;return {ok:false,error};});await waitFor(()=>calls===3);
   vi.setSystemTime(fixture.issued.workflowRun.startedAt+14*60000);await realDelay(650);expect(settled).toBe(false);
   vi.setSystemTime(fixture.issued.workflowRun.startedAt+15*60000+50);await waitFor(()=>settled);expect((await outcome).ok).toBe(false);expect(providerSignal?.aborted).toBe(true);expect(closed).toBe(3);
  }
 }else{
  expect(settled).toBe(true);const result=await outcome;expect(result.ok).toBe(false);expect(String(result.error)).toMatch(/WORKFLOW_RUN_DEADLINE_EXCEEDED|desktop_tool_loop_deadline_exceeded/);expect(existsSync(file)).toBe(false);
  if(mode==='queued-fifteen'){expect(calls).toBe(0);expect(coordinator.snapshot().waiting).toBe(0);lease.release();lease=undefined;await realDelay(30);expect(calls).toBe(0);}
  else{expect(providerSignal?.aborted).toBe(true);expect(closed).toBe(1);}
 }
 }finally{
 vi.useRealTimers();release.resolve();lease?.release();if(desktop){await desktop.closeTaskSourceWritersForMigration();await desktop.disposeMultiAgent();}if(outcome)await outcome;mock?.mockRestore();prepareMock?.mockRestore();retryTimerMock?.mockRestore();
 if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}globalThis.fetch=fixture.nativeFetch;
 for(const [key,value]of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins],['XIAOK_MODEL_RECOVERY_WINDOW_MS',previous.recovery]]as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fixture.close();
 }
},8000);
