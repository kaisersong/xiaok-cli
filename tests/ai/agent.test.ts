// tests/ai/agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { ModelAdapter, StreamChunk } from '../../src/types.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('Agent', () => {
  it('returns text response without tool calls', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const adapter: ModelAdapter = {
      stream: () => mockStream([
        { type: 'text', delta: 'Hello ' },
        { type: 'text', delta: 'world' },
        { type: 'done' },
      ]),
    };
    const registry = new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true });
    const agent = new Agent(adapter, registry, 'system');

    const outputs: string[] = [];
    await agent.runTurn('hi', (chunk) => { if (chunk.type === 'text') outputs.push(chunk.delta); });
    expect(outputs.join('')).toBe('Hello world');
  });

  it('executes a tool call and loops back', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    let callCount = 0;
    const adapter: ModelAdapter = {
      stream: () => {
        callCount++;
        if (callCount === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'glob', input: { pattern: '*.nonexistent' } },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'Done' }, { type: 'done' }]);
      },
    };
    const registry = new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true });
    const agent = new Agent(adapter, registry, 'system');

    const outputs: string[] = [];
    await agent.runTurn('list files', (chunk) => { if (chunk.type === 'text') outputs.push(chunk.delta); });
    expect(callCount).toBe(2);
    expect(outputs.join('')).toBe('Done');
  });

  it('dry-run emits tool description without executing', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    let callCount = 0;
    const adapter: ModelAdapter = {
      stream: () => {
        callCount++;
        if (callCount === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'rm -rf /' } },
            { type: 'done' },
          ]);
        }
        // 第二轮：模型收到 dry-run 结果后返回纯文本（无工具调用），循环结束
        return mockStream([{ type: 'done' }]);
      },
    };
    const registry = new ToolRegistry({ autoMode: false, dryRun: true, onPrompt: async () => true });
    vi.spyOn(registry, 'executeTool').mockResolvedValue('[dry-run] bash({"command":"rm -rf /"})');
    const agent = new Agent(adapter, registry, 'system');
    await agent.runTurn('bad', () => {});
    expect(registry.executeTool).toHaveBeenCalledWith('bash', { command: 'rm -rf /' });
  });
});
