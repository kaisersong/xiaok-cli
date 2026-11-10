import {join} from 'node:path';
// @vitest-environment node
import {it,expect,vi} from 'vitest';
vi.mock('electron',()=>{const api={app:{isReady:()=>false,getPath:()=>process.cwd(),getLocale:()=> 'en'},BrowserWindow:{getAllWindows:()=>[],fromId:()=>undefined,fromWebContents:()=>undefined},webContents:{fromId:()=>undefined}};return{...api,default:api};});
import {openOwnedWorkflowNormalCase} from '../support/owned-workflow-normal-case.js';
import {createWorkflowScriptPreview,hashWorkflowScript,normalizeWorkflowScript} from '../../electron/workflow-script-contract.js';
import {createKSwarmScriptWorkflowRun} from '../../electron/workflow-script-kswarm-controller.js';
import {createKSwarmRunDynamicWorkflowScriptTool,createKSwarmGetDynamicWorkflowStatusTool,restoreWorkflowScriptBackgroundJob,sealKSwarmWorkflowScriptJobs,sealAndDrainKSwarmWorkflowScriptJobs} from '../../electron/kswarm-dynamic-workflow-script-tool.js';
import {createDesktopServices,recoverInterruptedScriptWorkflows,resumeOneScriptWorkflow} from '../../electron/desktop-services.js';
const source="export const meta={name:'original_job_slot',description:'Original control slot',phases:[{title:'Read'}]}\nreturn await agent('Read state')";
async function setup(){const owned=await openOwnedWorkflowNormalCase({project:{id:'p',name:'Original script job',goal:'Read state'},workflowName:'job_owner_fixture',phaseTitle:'Read',prompt:'Read state',label:'Read'});const manager=owned.kswarmService;await manager.readProjectExecutionStart('p');const normalized=normalizeWorkflowScript(source),preview=createWorkflowScriptPreview(normalized,{projectId:'p',requestedBy:'human'});expect(preview.ok).toBe(true);const created=await createKSwarmScriptWorkflowRun({kswarmService:manager,projectId:'p',preview,scriptSource:normalized,scriptHash:hashWorkflowScript(normalized)});return{owned,manager,input:{kswarmService:manager,projectId:'p',workflowRunId:String(created.workflowRun.id),scriptSource:normalized,scriptHash:hashWorkflowScript(normalized)}};}
it('joins two original restores before the first real reader settles and starts no second timer',async()=>{
 const {owned,manager,input}=await setup(),read=manager.readProjectExecutionStart.bind(manager);let calls=0;
 const spy=vi.spyOn(manager,'readProjectExecutionStart').mockImplementation(project=>{calls++;return read(project);});
 try{const [first,second]=await Promise.all([restoreWorkflowScriptBackgroundJob(input),restoreWorkflowScriptBackgroundJob(input)]);sealKSwarmWorkflowScriptJobs(manager);expect(first).toMatchObject({restored:true});expect(second).toEqual({restored:false,reason:'already_running'});expect(calls).toBe(1);await sealAndDrainKSwarmWorkflowScriptJobs(manager);expect(owned.fixture.requestLog.filter((r:any)=>r.method==='POST'&&r.path.endsWith('/script/nodes'))).toEqual([]);}finally{spy.mockRestore();await sealAndDrainKSwarmWorkflowScriptJobs(manager);await owned.close();}
});
it('seals synchronously but holds the same original pending reader until actual completion before reporting drain',async()=>{
 const {owned,manager,input}=await setup(),previous=globalThis.fetch;let entered!:()=>void,release!:()=>void,reads=0,closed=false;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
 globalThis.fetch=async(value,init)=>{const response=await previous(value,init),url=new URL(typeof value==='string'?value:value instanceof URL?value.href:value.url);if(url.pathname.endsWith('/execution-start-admission')){reads++;entered();await held;}return response;};
 const first=restoreWorkflowScriptBackgroundJob(input),second=restoreWorkflowScriptBackgroundJob(input);const settled=Promise.allSettled([first,second]);let closing:Promise<void>|undefined;
 try{await ready;closing=sealAndDrainKSwarmWorkflowScriptJobs(manager).then(()=>{closed=true;});await new Promise<void>(r=>setImmediate(r));expect(closed).toBe(false);expect(reads).toBe(1);release();const results=await settled;await closing;expect(results.every(result=>result.status==='rejected')).toBe(true);expect(results[0].status==='rejected'&&results[1].status==='rejected'&&Object.is(results[0].reason,results[1].reason)).toBe(true);expect(owned.fixture.requestLog.filter((r:any)=>r.method==='POST'&&r.path.endsWith('/script/nodes'))).toEqual([]);}finally{release();await settled;await closing;globalThis.fetch=previous;await sealAndDrainKSwarmWorkflowScriptJobs(manager);await owned.close();}
});
it('rejects a different script identity while the original run still owns its pending admission',async()=>{
 const {owned,manager,input}=await setup(),previous=globalThis.fetch;let entered!:()=>void,release!:()=>void,reads=0;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
 globalThis.fetch=async(value,init)=>{const response=await previous(value,init),url=new URL(typeof value==='string'?value:value instanceof URL?value.href:value.url);if(url.pathname.endsWith('/execution-start-admission')){reads++;entered();await held;}return response;};
 const first=restoreWorkflowScriptBackgroundJob(input).then(value=>({value}),error=>({error}));let closing:Promise<void>|undefined;
 try{await ready;const altered=source.replace('Read state','Different state');await expect(restoreWorkflowScriptBackgroundJob({...input,scriptSource:altered,scriptHash:hashWorkflowScript(normalizeWorkflowScript(altered))})).rejects.toMatchObject({code:'workflow_script_job_identity_conflict'});expect(reads).toBe(1);closing=sealAndDrainKSwarmWorkflowScriptJobs(manager);release();await first;await closing;}finally{release();await first;await closing;globalThis.fetch=previous;await sealAndDrainKSwarmWorkflowScriptJobs(manager);await owned.close();}
});

it.each(['tool','restore'] as const)('keeps an empty-owner seal effective before the first %s reader or producer',async kind=>{
 const {owned,manager,input}=await setup(),actual=manager.readProjectExecutionStart.bind(manager);let reads=0;
 const spy=vi.spyOn(manager,'readProjectExecutionStart').mockImplementation(project=>{reads++;return actual(project);});sealKSwarmWorkflowScriptJobs(manager);
 try{if(kind==='tool'){const result=JSON.parse(await createKSwarmRunDynamicWorkflowScriptTool(manager).execute!({projectId:'p',script:source}));expect(result.ok).toBe(false);}else await expect(restoreWorkflowScriptBackgroundJob(input)).rejects.toMatchObject({message:'workflow_script_owner_closed'});expect(reads).toBe(0);}finally{spy.mockRestore();sealKSwarmWorkflowScriptJobs(manager);await sealAndDrainKSwarmWorkflowScriptJobs(manager);await owned.close();}
});
it('holds the original tool pre-run reader and stops its proposal POST when sealed before any run slot exists',async()=>{
 const {owned,manager}=await setup(),previous=globalThis.fetch;let entered!:()=>void,release!:()=>void,closed=false;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);const start=owned.fixture.requestLog.length;
 globalThis.fetch=async(value,init)=>{const response=await previous(value,init),url=new URL(typeof value==='string'?value:value instanceof URL?value.href:value.url);if(url.pathname.endsWith('/execution-start-admission')){entered();await held;}return response;};
 const work=createKSwarmRunDynamicWorkflowScriptTool(manager).execute!({projectId:'p',script:source});let closing:Promise<void>|undefined;
 try{await ready;closing=sealAndDrainKSwarmWorkflowScriptJobs(manager).then(()=>{closed=true;});await new Promise<void>(r=>setImmediate(r));expect(closed).toBe(false);release();const result=JSON.parse(await work);await closing;expect(result.ok).toBe(false);expect(owned.fixture.requestLog.slice(start).filter((r:any)=>r.method==='POST')).toEqual([]);}finally{release();await work;await closing;globalThis.fetch=previous;sealKSwarmWorkflowScriptJobs(manager);await sealAndDrainKSwarmWorkflowScriptJobs(manager);await owned.close();}
});
it('retains a started original RPC failure in the seal-to-quiesce gap',async()=>{
 const {owned,manager}=await setup(),actual=manager.request.bind(manager),sentinel=Error('actual_started_rpc_failed_after_seal');let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
 const spy=vi.spyOn(manager,'request').mockImplementation(async(path,init,beforeEffects)=>{const response=await actual(path,init,beforeEffects);if(path.endsWith('/script/nodes')){await response.arrayBuffer();entered();await held;throw sentinel;}return response;});
 let workflowRunId='',failure:unknown;
 try{const result=JSON.parse(await createKSwarmRunDynamicWorkflowScriptTool(manager).execute!({projectId:'p',script:source}));expect(result.ok).toBe(true);workflowRunId=result.workflowRunId;await ready;sealKSwarmWorkflowScriptJobs(manager);release();const status=createKSwarmGetDynamicWorkflowStatusTool(manager);await vi.waitFor(async()=>{expect(JSON.parse(await status.execute!({projectId:'p',workflowRunId})).backgroundJob?.status).toBe('failed');});try{await sealAndDrainKSwarmWorkflowScriptJobs(manager);}catch(error){failure=error;}expect(failure).toBeDefined();const causes=(error:unknown):unknown[]=>error instanceof AggregateError?[error,...error.errors.flatMap(causes)]:error instanceof Error&&error.cause?[error,...causes(error.cause)]:[error];expect(causes(failure).some(error=>Object.is(error,sentinel))).toBe(true);}finally{release();spy.mockRestore();await sealAndDrainKSwarmWorkflowScriptJobs(manager).catch(()=>{});await owned.close();}
});

it.each([{id:'foreign-run',projectId:'p'},{id:'requested',projectId:'foreign-project'},{id:'requested'},{projectId:'p'},{id:'foreign-run',projectId:'p',status:'completed'},{id:'requested',projectId:'q',status:'failed'}])('denies a foreign Main resume snapshot before its original reader: %j',async foreign=>{
 const {owned,manager}=await setup(),actual=manager.request.bind(manager),read=manager.readProjectExecutionStart.bind(manager);let reads=0;
 const snapshot={source:'script_generated',status:'running',scriptSource:source,...foreign};let timers=0;const nativeTimer=globalThis.setTimeout;const timerSpy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((callback:()=>void,delay?:number,...args:unknown[])=>{if(delay===0)timers++;return nativeTimer(callback,delay,...args);}) as typeof setTimeout);const baseline=owned.fixture.requestLog.length;
 const requestSpy=vi.spyOn(manager,'request').mockImplementation(async(path,init,guard)=>path==='/projects/p/workflows/requested'?new Response(JSON.stringify({workflowRun:snapshot})):actual(path,init,guard));
 const readSpy=vi.spyOn(manager,'readProjectExecutionStart').mockImplementation(project=>{reads++;return read(project);});
 try{expect(await resumeOneScriptWorkflow(manager,'p','requested')).toEqual({restored:false,reason:'workflow_scope_mismatch'});expect(reads).toBe(0);expect(timers).toBe(0);expect(owned.fixture.requestLog.slice(baseline).filter((r:any)=>r.method==='POST')).toEqual([]);}finally{timerSpy.mockRestore();requestSpy.mockRestore();readSpy.mockRestore();await sealAndDrainKSwarmWorkflowScriptJobs(manager);await owned.close();}
});
it('skips a foreign Main recovery list entry before any original reader admission',async()=>{
 const {owned,manager}=await setup(),actual=manager.request.bind(manager),read=manager.readProjectExecutionStart.bind(manager);let reads=0;
 const requestSpy=vi.spyOn(manager,'request').mockImplementation(async(path,init,guard)=>path==='/projects'?new Response(JSON.stringify({projects:[{id:'p'}]})):path==='/projects/p/workflows'?new Response(JSON.stringify({workflowRuns:[{id:'foreign',projectId:'q',source:'script_generated',status:'running',scriptSource:source}]})):actual(path,init,guard));
 const readSpy=vi.spyOn(manager,'readProjectExecutionStart').mockImplementation(project=>{reads++;return read(project);});
 try{await recoverInterruptedScriptWorkflows(manager);sealKSwarmWorkflowScriptJobs(manager);expect(reads).toBe(0);}finally{requestSpy.mockRestore();readSpy.mockRestore();await sealAndDrainKSwarmWorkflowScriptJobs(manager);await owned.close();}
});

it('the original Main shutdown joins its actual pending dynamic reader before closing task stores',async()=>{
 const {owned,manager,input}=await setup(),previous=globalThis.fetch;let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
 const services=createDesktopServices({dataRoot:join(owned.fixture.workspace.path,'main-shutdown-data'),kswarmService:manager,now:()=>Date.now()});
 globalThis.fetch=async(value,init)=>{const response=await previous(value,init),url=new URL(typeof value==='string'?value:value instanceof URL?value.href:value.url);if(url.pathname.endsWith('/execution-start-admission')){entered();await held;}return response;};
 const restoring=restoreWorkflowScriptBackgroundJob(input).then(value=>({value}),error=>({error}));
 try{await ready;services.taskShutdown.ingress.stopAccepting();expect(await services.taskShutdown.ingress.drain(10)).toBe(false);await expect(services.taskShutdown.durable.close()).rejects.toThrow('desktop_task_shutdown_not_drained');release();const result=await restoring;expect(Object.hasOwn(result,'error')).toBe(true);expect(await services.taskShutdown.ingress.drain(3000)).toBe(true);await services.taskShutdown.durable.close();expect(owned.fixture.requestLog.filter((r:any)=>r.method==='POST'&&r.path.endsWith('/script/nodes'))).toEqual([]);}finally{release();await restoring;globalThis.fetch=previous;await owned.close(services);}
});
