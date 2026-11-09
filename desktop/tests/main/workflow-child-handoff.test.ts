// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {openOwnedWorkflowNormalCase} from '../support/owned-workflow-normal-case.js';
import {createKSwarmRuntimeBridge,type KSwarmWorkflowNodeHandoff} from '../../electron/kswarm-runtime-bridge.js';
import {readOriginalKSwarmWorkflowControllerIO} from '../../electron/kswarm-service.js';
import {readCurrentOriginalRootExecutionContext} from '../../../src/runtime/verification/original-root-execution-context.js';
import {readOptionalOriginalWorkflowScriptChildRoot,readOriginalWorkflowScriptChildView} from '../../electron/workflow-script-kswarm-controller.js';
async function open(){
 const owned=await openOwnedWorkflowNormalCase({project:{id:'workflow-child',name:'Original child handoff',goal:'Metadata only'},workflowName:'child_fixture',phaseTitle:'Observe',prompt:'Original B input',label:'Observe'});
 const issued=owned.fixture.issued,run=issued.workflowRun,node=run.nodes.find((v:{id:string})=>v.id===issued.nodeId)!;
 const handoff:KSwarmWorkflowNodeHandoff={projectId:run.projectId,workflowRunId:run.id,workflowId:run.workflowId,nodeId:node.id,nodeKind:node.kind,nodeTitle:node.title,attempt:node.attempt,handoffId:node.runtime.handoffId,input:node.input};
 return{owned,handoff};
}
it('preserves an ordinary source without manufacturing a carried parent, verifies actual B input and single-flights duplicate handoffs',async()=>{
 const {owned,handoff}=await open();try{
  let current:object|null|undefined,release!:()=>void,begun!:()=>void;const ready=new Promise<void>(yes=>{begun=yes;}),hold=new Promise<void>(yes=>{release=yes;});
  const run=vi.fn(async()=>{current=readCurrentOriginalRootExecutionContext();begun();await hold;return{output:{summary:'original child'}};}),submit=vi.fn(async()=>new Response('{}'));
  const options={kswarmService:owned.kswarmService,runDesktopTask:vi.fn(),submitResult:vi.fn(),runWorkflowNode:run,submitWorkflowNodeResult:submit},bridge=createKSwarmRuntimeBridge(options);
  let late=0;Object.defineProperty(options,'runWorkflowNode',{get(){late++;throw Error('late callback');}});Object.defineProperty(options,'submitWorkflowNodeResult',{get(){late++;throw Error('late callback');}});
  const first=bridge.handleWorkflowNodeHandoff({handoff});await Promise.race([ready,first.then(()=>{throw Error('callback not reached');})]);const duplicate=bridge.handleWorkflowNodeHandoff({handoff});expect(duplicate).toBe(first);release();expect(await first).toEqual({ok:true});expect(current).toBe(null);expect(run).toHaveBeenCalledOnce();expect(submit).toHaveBeenCalledOnce();expect(late).toBe(0);
  expect(await bridge.handleWorkflowNodeHandoff({handoff})).toEqual({ok:true});expect(run).toHaveBeenCalledOnce();
  await expect(bridge.handleWorkflowNodeHandoff({handoff:{...handoff,input:{prompt:'forged'}}})).rejects.toThrow('WORKFLOW_HANDOFF_CONFLICT');
 }finally{await owned.close();}
});
it('rejects forged handoff body and provider node identity before the business callback while public request replacement stays unused',async()=>{
 const {owned,handoff}=await open();try{
  let publicCalls=0;owned.kswarmService.request=async()=>{publicCalls++;throw Error('late public request');};
  const run=vi.fn(),submit=vi.fn(),bridge=createKSwarmRuntimeBridge({kswarmService:owned.kswarmService,runDesktopTask:vi.fn(),submitResult:vi.fn(),runWorkflowNode:run,submitWorkflowNodeResult:submit});
  await expect(bridge.handleWorkflowNodeHandoff({handoff:{...handoff,input:{prompt:'forged'}}})).rejects.toThrow('WORKFLOW_HANDOFF_IDENTITY_MISMATCH');
  await expect(bridge.handleWorkflowNodeHandoff({handoff:{...handoff,nodeId:'caller-suggested-id'}})).rejects.toThrow('WORKFLOW_HANDOFF_NODE_MISSING');
  expect(run).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();expect(publicCalls).toBe(0);
  const io=readOriginalKSwarmWorkflowControllerIO(owned.kswarmService,handoff.projectId,handoff.workflowRunId);await io.waitPhysicalKnown();io.assertPhysicalKnown();
 }finally{await owned.close();}
});
it('has no candidate for a foreign source and checks child-view private membership without consulting getters',async()=>{
 let calls=0;const foreign=new Proxy({}, {get(){calls++;throw Error('getter');},getOwnPropertyDescriptor(){calls++;throw Error('descriptor');}});
 expect(await readOptionalOriginalWorkflowScriptChildRoot(foreign,'project','run','node')).toBe(null);expect(()=>readOriginalWorkflowScriptChildView(foreign,foreign)).toThrow('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');expect(calls).toBe(0);
});
