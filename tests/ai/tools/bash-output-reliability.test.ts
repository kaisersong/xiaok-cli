import { describe, it, expect, vi } from 'vitest';
import { createBashTool, createInteractiveBashTool } from '../../../src/ai/tools/bash.js';
import { ToolRegistry, isSuccessfulModelToolResult } from '../../../src/ai/tools/index.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';

const nodeCommand = (code: string) => `"${process.execPath}" -e "${code}"`;
describe('bash result budgets', () => {
  it.each([null, 0, -1, 1, 1023, 1.5, NaN, Infinity, 1048577])('rejects max_chars=%s before execution', async max_chars => {
    expect(await createBashTool().execute({command:'exit 7',max_chars})).toMatch(/^Error:.*max_chars/);
  });
  it.each([null,0,-1,1.5,NaN,Infinity,2147483648])('rejects timeout_ms=%s', async timeout_ms => {
    expect(await createBashTool().execute({command:'exit 7',timeout_ms})).toMatch(/^Error:.*timeout_ms/);
  });
  it('validates interactive sudo before invoking host', async () => {
    const run=vi.fn(); const tool=createInteractiveBashTool(run);
    expect(await tool.execute({command:'sudo echo hello',max_chars:1})).toMatch(/^Error:.*max_chars/);
    expect(await tool.execute({command:'sudo echo hello',timeout_ms:null})).toMatch(/^Error:.*timeout_ms/);
    expect(run).not.toHaveBeenCalled();
  });
  it('preserves exit, head and tail within a legal minimum budget', async () => {
    const result=await createBashTool().execute({command:nodeCommand(`process.stdout.write('HEAD'+'.'.repeat(200000)+'TAIL');process.exitCode=7`),max_chars:1024});
    expect(result).toMatch(/^Error \(exit 7\)/);expect(result).toContain('HEAD');expect(result).toContain('TAIL');
    expect(result).toMatch(/omittedBytes=/);expect(result.length).toBeLessThanOrEqual(1024);
    expect(isSuccessfulModelToolResult(result)).toBe(false);
  });
  it('keeps stdout/stderr identities and observation original independent of summary', async () => {
    let original=''; const finalize=vi.fn();
    const result=await createBashTool().execute({command:nodeCommand(`process.stdout.write('O'.repeat(9000));process.stderr.write('E'.repeat(9000))`),max_chars:1024},
      {observationCollector:{begin:()=>({append:s=>{original+=s;},finalize})}});
    expect(original.length).toBe(18000);expect(result).toContain('[stdout');expect(result).toContain('[stderr');
    expect(result.length).toBeLessThanOrEqual(1024);expect(finalize).toHaveBeenCalledWith({executionState:'terminal',outcome:'success'});
  });
  it('collector failure does not change process result', async()=>{
    const result=await createBashTool().execute({command:'exit 7',max_chars:1024},{observationCollector:{begin:()=>{throw Error('disk unavailable');}}});
    expect(result).toMatch(/^Error \(exit 7\)/);
  });
  it('registry rejects tiny budgets and preserves actual nonzero exit', async()=>{
    const registry=new ToolRegistry({permissionManager:new PermissionManager({mode:'yolo'})});
    expect(await registry.executeTool('bash',{command:'exit 7',max_chars:1})).toMatch(/^Error:/);
    const result=await registry.executeTool('bash',{command:'exit 7',max_chars:1024});
    expect(result).toContain('exit 7');expect(isSuccessfulModelToolResult(result)).toBe(false);
  });
});

import {AgentRuntime} from '../../../src/ai/runtime/agent-runtime.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {AgentRunController} from '../../../src/ai/runtime/controller.js';
import type {ModelAdapter,StreamChunk} from '../../../src/types.js';
it.each([1,1024])('real registry through runtime never marks exit 7 successful (budget %s)',async max_chars=>{
 let requests=0;const adapter:ModelAdapter={getModelName:()=> 'fixture',stream:()=> (async function*():AsyncGenerator<StreamChunk>{
  if(++requests===1)yield {type:'tool_use',id:'bash-7',name:'bash',input:{command:'exit 7',max_chars}};
  else yield {type:'text',delta:'done'};yield {type:'done'};
 })()};
 const registry=new ToolRegistry({permissionManager:new PermissionManager({mode:'yolo'})});
 const session=new AgentSessionState();const runtime=new AgentRuntime({adapter,registry,session,controller:new AgentRunController(),systemPrompt:'test'});
 const events:any[]=[];await runtime.run('test',event=>{events.push(event);});
 const results=session.exportSnapshot().messages.flatMap(m=>m.content).filter(b=>b.type==='tool_result');
 expect(results).toHaveLength(1);expect(results[0]).toMatchObject({is_error:true});
 expect(events.find(e=>e.type==='tool_finished')).toMatchObject({ok:false});
});
it('trusted current command fact survives display text and ignores foreign invocation facts',()=>{
 const fact={invocationId:'own',toolName:'bash',factKind:'command_result' as const,exitCode:7};
 expect(isSuccessfulModelToolResult('success',fact)).toBe(false);
 expect(isSuccessfulModelToolResult('Error from command output',{...fact,exitCode:0})).toBe(true);
 expect(isSuccessfulModelToolResult('success',{...fact,exitCode:null})).toBe(false);
});
it.each([['own',0,false],['foreign',7,true]] as const)('runtime trusts only matched invocation %s',async(invocationId,exitCode,isError)=>{
 let requests=0;const adapter:ModelAdapter={getModelName:()=> 'fixture',stream:()=> (async function*():AsyncGenerator<StreamChunk>{
  if(++requests===1)yield {type:'tool_use',id:'own',name:'bash',input:{}};
  else yield {type:'text',delta:'done'};yield {type:'done'};
 })()};
 const session=new AgentSessionState();const registry={getToolDefinitions:()=>[],executeTool:async(_name:any,_input:any,context:any)=>{
  context.runtimeFactSink.emit({invocationId,toolName:'bash',factKind:'command_result',exitCode});return 'Error from stdout';
 }};
 const runtime=new AgentRuntime({adapter,registry:registry as any,session,controller:new AgentRunController(),systemPrompt:'test'});
 await runtime.run('test',()=>{});const result=session.exportSnapshot().messages.flatMap(m=>m.content).find(b=>b.type==='tool_result');
 expect(result).toMatchObject({is_error:isError});
});
it('registry skill observation never marks failed bash as success without a runtime context',async()=>{
 const observed:any[]=[];const registry=new ToolRegistry({permissionManager:new PermissionManager({mode:'yolo'}),onToolObserved:event=>{observed.push(event);}});
 await registry.executeTool('bash',{command:'exit 7',max_chars:1024});
 expect(observed.find(event=>event.phase==='after')).toMatchObject({ok:false});
});
import {retainCommandResult} from '../../../src/ai/tools/command-result.js';
it('failure command facts cannot be overwritten by later success',()=>{
 const failure={invocationId:'own',toolName:'bash',factKind:'command_result' as const,exitCode:null};
 expect(retainCommandResult(failure,{...failure,exitCode:0})).toEqual(failure);
 expect(retainCommandResult({...failure,exitCode:0},{...failure,exitCode:7}).exitCode).toBe(7);
});
