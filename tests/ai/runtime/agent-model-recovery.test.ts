import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Message, ModelAdapter } from '../../../src/types.js';
afterEach(() => vi.unstubAllEnvs());
describe('actual AgentRuntime model recovery', () => {
  it('preserves completed tool results, drops uncommitted tools/reasoning and resumes partial text', async () => {
    vi.stubEnv('XIAOK_MODEL_RECOVERY_WINDOW_MS','10000');
    let calls=0, executions=0;
    const requests: Message[][]=[];
    const adapter:ModelAdapter={getModelName:()=> 'fixture', async *stream(messages) {
      requests.push(structuredClone(messages));
      if (++calls===1) {yield {type:'tool_use',id:'executed',name:'write_fixture',input:{}};return;}
      if (calls===2) {
        yield {type:'text',delta:'visible partial'};
        yield {type:'thinking',delta:'PRIVATE_REASONING'};
        yield {type:'tool_use',id:'UNCOMMITTED_TOOL',name:'write_fixture',input:{}};
        throw new TypeError('terminated');
      }
      yield {type:'text',delta:'finished'};
    }};
    const registry=new ToolRegistry({autoMode:true},[{permission:'safe',definition:{name:'write_fixture',description:'fixture',inputSchema:{type:'object',properties:{}}},execute:async()=>{executions++;return 'COMPLETED_EFFECT';}}]);
    const session=new AgentSessionState();const events:unknown[]=[];
    const runtime=new AgentRuntime({adapter,registry,session,controller:new AgentRunController(),systemPrompt:'system'});
    await runtime.run('perform work',event=>events.push(event));
    expect(calls).toBe(3);expect(executions).toBe(1);
    const resumed=JSON.stringify(requests[2]);
    expect(resumed).toContain('COMPLETED_EFFECT');expect(resumed).toContain('visible partial');
    expect(resumed).not.toContain('PRIVATE_REASONING');expect(resumed).not.toContain('UNCOMMITTED_TOOL');
    expect(events).toContainEqual(expect.objectContaining({type:'model_recovery'}));
    expect(events).toContainEqual(expect.objectContaining({type:'run_completed'}));
  });
});
