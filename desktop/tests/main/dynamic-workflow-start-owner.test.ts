// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {createKSwarmRunDynamicWorkflowScriptTool,restoreWorkflowScriptBackgroundJob} from '../../electron/kswarm-dynamic-workflow-script-tool.js';
import {openOwnedWorkflowNormalCase} from '../support/owned-workflow-normal-case.js';
import {runWorkflowScript} from '../../electron/workflow-script-runtime.js';
import {mkdtempSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const prefix="export const meta={name:'dsh_original_start_fixture',description:'Original ordinary control',phases:[{title:'Read'}]}\n";
const script=prefix+"phase('Read')\nreturn await agent('Read temporary state')";
it('keeps preview static while refusing a real run without the original start reader before proposal POST',async()=>{
 const posts:string[]=[],service={request:async(path:string)=>{posts.push(path);return Response.json({ok:true,workflowProposal:{id:'proposal'},workflowRun:{id:'run',status:'running'}});}};
 const tool=createKSwarmRunDynamicWorkflowScriptTool(service as any);
 expect(JSON.parse(await tool.execute!({projectId:'p',script,previewOnly:true}))).toMatchObject({ok:true});expect(posts).toEqual([]);
 const result=JSON.parse(await tool.execute!({projectId:'p',script,waitForCompletion:true}));expect(posts).toEqual([]);expect(result).toMatchObject({ok:false,error:'workflow_script_run_failed',message:'project_execution_start_reader_unavailable'});
});
it('refuses restore without the original reader before registering any background execution timer',async()=>{
 const timers:Array<ReturnType<typeof setTimeout>>=[],actualSetTimeout=globalThis.setTimeout;
 const timerSpy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((...args:any[])=>{const handle=Reflect.apply(actualSetTimeout,globalThis,args);if(args[1]===0)timers.push(handle);return handle;}) as never);
 let failure:unknown,result:unknown;
 try{try{result=await restoreWorkflowScriptBackgroundJob({kswarmService:{request:async()=>Response.json({ok:true})} as any,projectId:'p',workflowRunId:'dsh-no-reader-restore',scriptSource:prefix+"return 'done'"});}catch(error){failure=error;}
 expect(timers).toEqual([]);expect(result).toBeUndefined();expect(failure).toMatchObject({message:'project_execution_start_reader_unavailable'});
 }finally{for(const timer of timers)clearTimeout(timer);timerSpy.mockRestore();}
});
it('checks the private runtime start before a real controller physical effect',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workflow-start-')),marker=join(root,'actual-node'),sentinel=Error('original_dynamic_start_revoked');let failure:unknown;
 try{try{await runWorkflowScript(script,{beforeEffects:()=>{throw sentinel;},controller:{createAgentNode:async()=>{writeFileSync(marker,'physical node');return{summary:'done'};}}} as any);}catch(error){failure=error;}
 expect(existsSync(marker)).toBe(false);expect(failure).toBe(sentinel);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('retains the first control failure even when the VM script catches it and returns success',async()=>{
 let allowed=true,calls=0,failure:unknown;const sentinel=Error('original_dynamic_control_revoked');
 const source=prefix+"await agent('First admitted operation')\ntry{await agent('Must not start')}catch{}\nreturn 'caught'";
 try{await runWorkflowScript(source,{beforeEffects:()=>{if(!allowed)throw sentinel;},controller:{createAgentNode:async()=>{calls++;allowed=false;return{summary:'actual first node result'};}}} as any);}catch(error){failure=error;}
 expect(calls).toBe(1);expect(failure).toBe(sentinel);
});
it('holds the original floating primitive until its actual file effect settles after the VM body returns',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workflow-raw-tail-')),marker=join(root,'actual-node');let entered!:()=>void,release!:()=>void,physicalDone!:()=>void;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r),closed=new Promise<void>(r=>physicalDone=r);let settled=false;
 const work=runWorkflowScript(prefix+"agent('Original floating operation')\nreturn 'body returned'",{controller:{createAgentNode:async()=>{entered();try{await held;writeFileSync(marker,'actual completed node');return{summary:'done'};}finally{physicalDone();}}}}).then(result=>{settled=true;return result;});
 try{await ready;await new Promise<void>(r=>setImmediate(r));expect(settled).toBe(false);expect(existsSync(marker)).toBe(false);release();await work;await closed;expect(existsSync(marker)).toBe(true);}finally{release();await work;await closed;rmSync(root,{recursive:true,force:true});}
});
it('preserves the real late floating controller failure in its original tail outcome',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workflow-late-failure-')),marker=join(root,'actual-node'),sentinel=Error('actual_floating_controller_io_failed');let entered!:()=>void,release!:()=>void,physicalDone!:()=>void;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r),closed=new Promise<void>(r=>physicalDone=r);
 const work=runWorkflowScript(prefix+"agent('Original floating operation')\nreturn 'body returned'",{controller:{createAgentNode:async()=>{entered();try{await held;writeFileSync(marker,'actual effect before original IO rejection');throw sentinel;}finally{physicalDone();}}}});
 try{await ready;release();const result=await work;await closed;expect(existsSync(marker)).toBe(true);expect(Object.hasOwn(result,'tailFailures')).toBe(true);expect(Array.isArray((result as any).tailFailures)).toBe(true);expect((result as any).tailFailures.some((error:unknown)=>Object.is(error,sentinel))).toBe(true);}finally{release();await work;await closed;rmSync(root,{recursive:true,force:true});}
});

it('keeps the real proposal receipt but denies the next original run POST after its reader incarnation changes',async()=>{
 const owned=await openOwnedWorkflowNormalCase({project:{id:'p',name:'Dynamic original',goal:'Read state'},workflowName:'dynamic_admission_fixture',phaseTitle:'Read',prompt:'Read state',label:'Read'}),manager=owned.kswarmService;
 const request=manager.request.bind(manager);let committedProposal=false,proposalId='';
 const spy=vi.spyOn(manager,'request').mockImplementation(async(path,init,beforeEffects)=>{const response=await request(path,init,beforeEffects);if(path.endsWith('/script-generated/proposal')&&response.ok){committedProposal=true;proposalId=String((await response.clone().json()).workflowProposal.id);await manager.stop();}return response;});
 try{const result=JSON.parse(await createKSwarmRunDynamicWorkflowScriptTool(manager).execute!({projectId:'p',script,waitForCompletion:true}));expect(committedProposal).toBe(true);expect(Array.isArray(result.acknowledgedEffects)).toBe(true);expect(result.acknowledgedEffects.some((fact:any)=>fact.kind==='proposal'&&fact.projectId==='p'&&fact.proposalId===proposalId)).toBe(true);expect(owned.fixture.requestLog.filter((r:any)=>r.method==='POST'&&r.path.endsWith('/script-generated/runs'))).toEqual([]);expect(result.ok).toBe(false);}finally{spy.mockRestore();await owned.close();}
});
it('does not complete the real B run when the script catches an unclassified original controller request failure',async()=>{
 const owned=await openOwnedWorkflowNormalCase({project:{id:'p',name:'Dynamic tail owner',goal:'Read state'},workflowName:'dynamic_tail_fixture',phaseTitle:'Read',prompt:'Read state',label:'Read'}),manager=owned.kswarmService,request=manager.request.bind(manager);let nodeRequests=0;
 const spy=vi.spyOn(manager,'request').mockImplementation((path,init,beforeEffects)=>{if(path.endsWith('/script/nodes')){nodeRequests++;throw Error('injected_original_node_request_unknown');}return request(path,init,beforeEffects);});
 try{const source=prefix+"try{await agent('Original node request')}catch{}\nreturn 'caught does not prove execution outcome'";const result=JSON.parse(await createKSwarmRunDynamicWorkflowScriptTool(manager).execute!({projectId:'p',script:source,waitForCompletion:true}));expect(nodeRequests).toBe(1);expect(owned.fixture.requestLog.filter((r:any)=>r.method==='POST'&&r.path.endsWith('/script/complete'))).toEqual([]);expect(result.ok).toBe(false);}finally{spy.mockRestore();await owned.close();}
});

it('returns the original acknowledged run ID when its owner is sealed before timer admission',async()=>{
 const owned=await openOwnedWorkflowNormalCase({project:{id:'p',name:'Original acknowledged run',goal:'Read'},workflowName:'ack_run_fixture',phaseTitle:'Read',prompt:'Read',label:'Read'}),manager=owned.kswarmService,request=manager.request.bind(manager);let runId='';
 const owner=await import('../../electron/kswarm-dynamic-workflow-script-tool.js');
 const spy=vi.spyOn(manager,'request').mockImplementation(async(path,init,beforeEffects)=>{const response=await request(path,init,beforeEffects);if(path.endsWith('/script-generated/runs')&&response.ok){runId=String((await response.clone().json()).workflowRun.id);owner.sealKSwarmWorkflowScriptJobs(manager);}return response;});
 try{const result=JSON.parse(await createKSwarmRunDynamicWorkflowScriptTool(manager).execute!({projectId:'p',script}));expect(runId.length).toBeGreaterThan(0);expect(result.ok).toBe(false);expect(Array.isArray(result.acknowledgedEffects)).toBe(true);expect(result.acknowledgedEffects.some((fact:any)=>fact.kind==='run'&&fact.projectId==='p'&&fact.workflowRunId===runId)).toBe(true);expect(owned.fixture.requestLog.filter((r:any)=>r.method==='POST'&&r.path.endsWith('/script/nodes'))).toEqual([]);}finally{spy.mockRestore();await owner.sealAndDrainKSwarmWorkflowScriptJobs(manager);await owned.close();}
});
it('rejects a foreign completed resume snapshot before publishing any current-project success or execution',async()=>{
 const owned=await openOwnedWorkflowNormalCase({project:{id:'p',name:'Resume scope',goal:'Read'},workflowName:'resume_scope_fixture',phaseTitle:'Read',prompt:'Read',label:'Read'}),manager=owned.kswarmService,request=manager.request.bind(manager);
 const spy=vi.spyOn(manager,'request').mockImplementation((path,init,beforeEffects)=>path==='/projects/p/workflows/requested'?Promise.resolve(Response.json({workflowRun:{id:'foreign',projectId:'q',status:'completed',scriptSource:'private foreign source'}})):request(path,init,beforeEffects));
 try{const result=JSON.parse(await createKSwarmRunDynamicWorkflowScriptTool(manager).execute!({projectId:'p',resumeWorkflowRunId:'requested',waitForCompletion:true}));expect(result).toMatchObject({ok:false,error:'workflow_script_run_scope_mismatch'});expect(JSON.stringify(result)).not.toContain('private foreign source');}finally{spy.mockRestore();await owned.close();}
});
