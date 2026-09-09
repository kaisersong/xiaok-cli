import {describe,it,expect,vi} from 'vitest';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import type {ToolExecutionContext} from '../../../src/types.js';
describe('real tool registry health',()=>{
 it('keeps active and explicitly waiting tools alive, then resumes idle detection',async()=>{
  vi.useFakeTimers();let finish!:(v:string)=>void;
  try {
   let active!:ToolExecutionContext;
   const registry=new ToolRegistry({autoMode:true,toolIdleTimeoutMs:100},[{permission:'safe',definition:{name:'progress',description:'fixture',inputSchema:{}},execute:async(_i,c)=>{active=c!;return new Promise(r=>{finish=r;});}}]);
   const context:ToolExecutionContext={taskId:'test',session:new AgentSessionState().exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[]};
   const running=registry.executeTool('progress',{},context);
   await vi.advanceTimersByTimeAsync(0);
   for(let i=0;i<20;i++){await vi.advanceTimersByTimeAsync(90);active.executionProgress!.progress();}
   active.executionProgress!.wait('approval');await vi.advanceTimersByTimeAsync(1000);expect(active.signal?.aborted).toBe(false);
   active.executionProgress!.resume('approval');finish('ok');expect(await running).toBe('ok');
   active.executionProgress!.progress();await vi.advanceTimersByTimeAsync(1000);expect(active.signal?.aborted).toBe(false);registry.dispose();
  }finally{finish?.('cleanup');vi.useRealTimers();}
 });
 it('cancels stalled execution but waits for physical settlement',async()=>{
  vi.useFakeTimers();try {
   let finish!:(v:string)=>void;let signal:AbortSignal|undefined;const states:string[]=[];
   const registry=new ToolRegistry({autoMode:true,toolIdleTimeoutMs:100},[{permission:'safe',definition:{name:'held',description:'fixture',inputSchema:{}},execute:async(_i,c)=>{signal=c?.signal;return new Promise(r=>{finish=r;});}}]);
   const context:ToolExecutionContext={taskId:'test',session:new AgentSessionState().exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],onExecutionHealth:s=>states.push(s)};
   let settled=false;const running=registry.executeTool('held',{},context).finally(()=>{settled=true;});
   const assertion=expect(running).rejects.toThrow('TOOL_IDLE_TIMEOUT');
   await vi.advanceTimersByTimeAsync(101);
   expect(signal?.aborted).toBe(true);expect(settled).toBe(false);expect(states).toContain('cleanup_pending');
   finish('late');await assertion;registry.dispose();
  }finally{vi.useRealTimers();}
 });
});
