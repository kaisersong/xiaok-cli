// @vitest-environment node
import {expect,it} from 'vitest';
import {createKSwarmWorkflowScriptController} from '../../electron/workflow-script-kswarm-controller.js';
it('applies the original owner fence before each future poll and stops using the SDK after retirement',async()=>{
 let retired=false,reads=0;const stopped=Error('original owner retired');
 const service={getDesktopMutationToken:()=>'',async request(_path:string,init?:RequestInit){if(init?.method==='POST')return new Response(JSON.stringify({ok:true,nodeId:'actual-node'}));reads++;retired=true;return new Response(JSON.stringify({ok:true,workflowRun:{id:'run',projectId:'project',nodes:[{id:'actual-node',status:'running'}]}}));}};
 const controller=createKSwarmWorkflowScriptController({kswarmService:service as never,projectId:'project',workflowRunId:'run',pollIntervalMs:1,timeoutMs:20,beforeEffects(){if(retired)throw stopped;}});
 await expect(controller.createAgentNode({prompt:'inert',label:'inert',phaseTitle:'Observe',sequence:1,scriptHash:'a'.repeat(64),workflowId:'workflow'} as never)).rejects.toBe(stopped);expect(reads).toBe(1);
});
