// @vitest-environment node
import {expect,it} from 'vitest';
import * as worker from '../../electron/workflow-script-worker.js';
import type {WorkflowScriptRuntimeOptions,WorkflowScriptRunResult} from '../../electron/workflow-script-runtime.js';
const run=(script:string,options:WorkflowScriptRuntimeOptions,deadline=3000)=>(worker as unknown as {__runIsolatedWorkflowScript(script:string,options:WorkflowScriptRuntimeOptions,origin:undefined,deadline:number):Promise<WorkflowScriptRunResult>}).__runIsolatedWorkflowScript(script,options,undefined,deadline);
it('uses the actual Worker and joins its exit before exposing a physical fact',async()=>{
 const calls:string[]=[],controller={async createAgentNode(input:{prompt:string}){calls.push(input.prompt);return {summary:input.prompt};}};
 const result=await run("export const meta={name:'worker_original',description:'Bounded fixture'}\nreturn await agent('original worker')",{controller});expect(result.result).toEqual({summary:'original worker'});expect(calls).toEqual(['original worker']);const fate=worker.readOriginalWorkflowScriptRuntimeFate(controller,result);await fate.waitKnown();fate.assertKnown();expect(()=>worker.readOriginalWorkflowScriptRuntimeFate({...controller},result)).toThrow();expect(()=>worker.readOriginalWorkflowScriptRuntimeFate(controller,{...result})).toThrow();
});
it('terminates a post-await CPU loop while the Main heartbeat continues',async()=>{
 let ticks=0;const interval=setInterval(()=>{ticks++;},10),controller={async createAgentNode(){return {ok:true};}};try{await expect(run("export const meta={name:'worker_loop',description:'Bounded fixture'}\nawait agent('inert')\nwhile(true){}",{controller},250)).rejects.toThrow('WORKFLOW_WORKER_DEADLINE');expect(ticks).toBeGreaterThan(0);}finally{clearInterval(interval);}
});
it('does not turn Worker exit into known while an original controller SDK tail is held',async()=>{
 let begun!:()=>void,release!:()=>void;const ready=new Promise<void>(yes=>{begun=yes;}),held=new Promise<void>(yes=>{release=yes;}),controller={async createAgentNode(){begun();await held;return {ok:true};}};let done=false;const pending=run("export const meta={name:'worker_held',description:'Bounded fixture'}\nreturn await agent('held')",{controller},250);void pending.then(()=>{done=true;},()=>{done=true;});await ready;try{await new Promise<void>(yes=>setTimeout(yes,350));expect(done).toBe(false);}finally{release();}await expect(pending).rejects.toThrow('WORKFLOW_WORKER_DEADLINE');
});
it('records a pre-constructor contract rejection as a sealed physical negative without invoking a getter',async()=>{
 let reads=0;const controller={get createAgentNode(){reads++;return()=>({});}};let failure:unknown;
 try{await run("export const meta={name:'worker_preflight',description:'Bounded fixture'}\nreturn {}",{controller} as never);}catch(raw){failure=raw;}
 expect(failure).toBeInstanceOf(Error);expect(reads).toBe(0);const fate=worker.readOriginalWorkflowScriptRuntimeFate(controller,failure);await fate.waitKnown();fate.assertKnown();expect(()=>fate.assertOpen()).toThrow('WORKFLOW_WORKER_CLOSED');
});
it('preserves the original RPC business failure while joining symbol-bearing raw SDK tails before physical settlement',async()=>{
 let release!:()=>void,begun!:()=>void;const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{begun=yes;}),raw=Error('original RPC failure');Object.defineProperty(raw,Symbol('raw-tail'),{value:held});
 const controller={async createAgentNode(){begun();throw raw;}};let finished=false;const pending=run("export const meta={name:'worker_raw',description:'Bounded fixture'}\nreturn await agent('original error')",{controller});void pending.then(()=>{finished=true;},()=>{finished=true;});await ready;
 try{await new Promise<void>(yes=>setTimeout(yes,50));expect(finished).toBe(false);}finally{release();}
 let actual:unknown;try{await pending;}catch(value){actual=value;}expect(actual).toBe(raw);const fate=worker.readOriginalWorkflowScriptRuntimeFate(controller,raw);await fate.waitKnown();fate.assertKnown();
});
it('uses the real wall deadline at five seconds rather than renewing the deadline after an await',async()=>{
 let beats=0;const interval=setInterval(()=>{beats++;},50),controller={async createAgentNode(){return {ok:true};}},began=performance.now();
 try{await expect(run("export const meta={name:'worker_wall',description:'Bounded fixture'}\nawait agent('then loop')\nwhile(true){}",{controller},5000)).rejects.toThrow('WORKFLOW_WORKER_DEADLINE');expect(performance.now()-began).toBeGreaterThanOrEqual(4900);expect(beats).toBeGreaterThan(20);}finally{clearInterval(interval);}
},10000);
