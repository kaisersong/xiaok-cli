// @vitest-environment node
// Controller-port unit fixtures, not Native/physical-closure qualification.
import {it,expect} from 'vitest';
import * as nativeController from '../../electron/workflow-script-kswarm-controller.js';
import {runWorkflowScript} from '../../electron/workflow-script-runtime.js';
const classify=(controller:unknown,error:unknown)=>(nativeController as any).isKSwarmWorkflowKnownTerminalFailure(controller,error);
function service(runId='wf',projectId='p'){
 return {getDesktopMutationToken:()=> 'fixture',request:async(path:string,init?:RequestInit)=>{
   const body=init?.body?JSON.parse(String(init.body)):{};
   if(path.endsWith('/parallel-groups'))return Response.json({parallelGroup:{id:'g'}});
   if(path.endsWith('/script/nodes'))return Response.json({nodeId:body.prompt.includes('good')?'good':'bad'});
   return Response.json({workflowRun:{id:runId,projectId,nodes:[{id:'bad',status:'failed'},{id:'good',status:'completed',output:{summary:'good'}}]}});
 }};
}
it('recognizes only its own actual controller terminal observation and rejects another controller or wrong run/project',async()=>{
 for(const scope of [{run:'wf',project:'p',known:true},{run:'foreign',project:'p',known:false},{run:'wf',project:'foreign',known:false}]){
   const backend=service(scope.run,scope.project),controller=nativeController.createKSwarmWorkflowScriptController({kswarmService:backend as any,projectId:'p',workflowRunId:'wf',pollIntervalMs:1,timeoutMs:10});let failure:unknown;
   try{await controller.createAgentNode({prompt:'bad',sequence:1} as any);}catch(error){failure=error;}
   expect(failure).toBeDefined();expect(classify(controller,failure)).toBe(scope.known);
   const foreign=nativeController.createKSwarmWorkflowScriptController({kswarmService:backend as any,projectId:'p',workflowRunId:'wf'});expect(classify(foreign,failure)).toBe(false);
 }
});
it.each(['collect_errors','quorum'])('records the exact known terminal consumed by the original %s policy including successful quorum',async policy=>{
 const controller=nativeController.createKSwarmWorkflowScriptController({kswarmService:service() as any,projectId:'p',workflowRunId:'wf',pollIntervalMs:1,timeoutMs:10});
 const script="export const meta={name:'tail_policy',description:'Classify original branch outcome',phases:[{title:'Read'}]}\nreturn await parallel([()=>agent('bad'),()=>agent('good')],{failurePolicy:'"+policy+"',quorum:1})";
 const result=await runWorkflowScript(script,{controller,isKnownBusinessFailure:(error:unknown)=>classify(controller,error)} as any);
 expect(Object.hasOwn(result,'tailFailures')).toBe(true);expect(Array.isArray((result as any).policyConsumedFailures)).toBe(true);
 const failures=(result as any).tailFailures as unknown[];expect(failures.length).toBeGreaterThan(0);expect(failures.every(error=>(result as any).policyConsumedFailures.some((item:unknown)=>Object.is(error,item)))).toBe(true);
});
it('preserves the actual response body rejection after a successful producer HTTP status',async()=>{
 const sentinel=Error('actual_controller_body_failed'),backend={request:async()=>new Response(new ReadableStream({start(controller){controller.error(sentinel);}}),{status:200})};
 const controller=nativeController.createKSwarmWorkflowScriptController({kswarmService:backend as any,projectId:'p',workflowRunId:'wf'});let failure:unknown;
 try{await controller.createAgentNode({prompt:'Read',sequence:1} as any);}catch(error){failure=error;}expect(failure).toBe(sentinel);
});
it.each(['new','retry'])('refuses a %s producer response without its own node receipt instead of adopting an old node',async kind=>{
 let retried=false;const requests:string[]=[],node={id:'script-agent-old-node',kind:'agent_task',status:'failed',input:{prompt:'Read',label:'Read',options:null,script:{phaseTitle:'Read'}}};
 const backend={request:async(path:string,init?:RequestInit)=>{requests.push((init?.method??'GET')+' '+path);if(path.endsWith('/script/nodes'))return Response.json({workflowRun:{id:'wf',projectId:'p',nodes:[{...node,status:'completed',output:{summary:'sibling'}}]}});if(path.endsWith('/retry')){retried=true;return Response.json({ok:true,workflowRun:{id:'wf',projectId:'p',nodes:[{...node,status:'completed'}]}});}if(path.endsWith('/nodes/requested'))return Response.json({node});return Response.json({workflowRun:{id:'wf',projectId:'p',nodes:[{...node,status:retried||kind==='new'?'completed':'failed',output:{summary:'must not adopt'}}]}});}};
 const controller=nativeController.createKSwarmWorkflowScriptController({kswarmService:backend as any,projectId:'p',workflowRunId:'wf',reuseCompletedPrimitives:kind==='retry',pollIntervalMs:1,timeoutMs:10});let failure:unknown;
 try{await controller.createAgentNode({prompt:'Read',label:'Read',phaseTitle:'Read',nodeId:'requested',sequence:1} as any);}catch(error){failure=error;}
 expect(failure).toMatchObject({code:'workflow_script_node_missing'});expect(classify(controller,failure)).toBe(false);expect(requests.filter(path=>path.startsWith('POST '))).toHaveLength(1);
});
it.each([{run:'foreign',project:'p'},{run:'wf',project:'foreign'}])('refuses a completed output from another run/project $run/$project',async scope=>{
 const backend=service(scope.run,scope.project),controller=nativeController.createKSwarmWorkflowScriptController({kswarmService:backend as any,projectId:'p',workflowRunId:'wf',pollIntervalMs:1,timeoutMs:10});let failure:unknown;
 try{await controller.createAgentNode({prompt:'good',sequence:1} as any);}catch(error){failure=error;}expect(failure).toMatchObject({code:'workflow_script_run_scope_mismatch'});
});
it('does not reuse a completed direct-node response without its original run and project identity',async()=>{
 const node={id:'requested',kind:'agent_task',status:'completed',output:'foreign result',input:{prompt:'Read',label:'Read',options:null,script:{phaseTitle:'Read'}}};
 const backend={request:async()=>Response.json({node,workflowRun:{id:'foreign',projectId:'q',nodes:[node]}})};
 const controller=nativeController.createKSwarmWorkflowScriptController({kswarmService:backend as any,projectId:'p',workflowRunId:'wf',reuseCompletedPrimitives:true});let failure:unknown;
 try{await controller.createAgentNode({prompt:'Read',label:'Read',phaseTitle:'Read',nodeId:'requested',sequence:1} as any);}catch(error){failure=error;}expect(failure).toMatchObject({code:'workflow_script_run_scope_mismatch'});
});
it('does not acknowledge another run or project as the current completed run',async()=>{
 const backend={request:async()=>Response.json({workflowRun:{id:'foreign',projectId:'q',status:'completed'}})};
 await expect(nativeController.completeKSwarmScriptWorkflowRun({kswarmService:backend as any,projectId:'p',workflowRunId:'wf',result:'done'})).rejects.toMatchObject({code:'workflow_script_run_scope_mismatch'});
});
