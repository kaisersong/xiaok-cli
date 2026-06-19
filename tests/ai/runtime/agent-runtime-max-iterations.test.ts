import { describe, expect, it } from 'vitest';
import type { ModelAdapter, StreamChunk, ToolDefinition } from '../../../src/types.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function createRegistryMock(overrides?: {
  getToolDefinitions?: () => ToolDefinition[];
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
}) {
  return {
    getToolDefinitions: overrides?.getToolDefinitions ?? (() => []),
    executeTool: overrides?.executeTool ?? (async () => 'ok'),
  };
}

/**
 * Models that never produce a "stop" response (always return tool_use) used to
 * cause an unbounded loop when AgentRuntime received no maxIterations override.
 * The CLI now sets maxIterations explicitly; this suite locks in that the guard
 * actually halts the loop, emits the documented event, and exits gracefully.
 */
describe('AgentRuntime maxIterations guard', () => {
  it('halts the tool loop with max_iterations_reached when the model never stops', async () => {
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls += 1;
        return mockStream([
          { type: 'tool_use', id: `tu_${streamCalls}`, name: 'glob', input: { pattern: '*.ts' } },
          { type: 'done' },
        ]);
      },
    };

    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
      maxIterations: 3,
    });

    const events: Array<{ type: string }> = [];
    await runtime.run('go', (event) => events.push({ type: event.type }));

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain('max_iterations_reached');
    expect(eventTypes.at(-1)).toBe('run_completed');
    // 3 iterations * (1 model stream + 1 tool execute), then guard fires before iteration 4
    expect(streamCalls).toBe(3);
  });

  it('finishes normally when the model stops before the iteration cap', async () => {
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls += 1;
        if (streamCalls === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'glob', input: { pattern: '*.ts' } },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'all done' }, { type: 'done' }]);
      },
    };

    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
      maxIterations: 100,
    });

    const events: string[] = [];
    await runtime.run('go', (event) => events.push(event.type));

    expect(events).not.toContain('max_iterations_reached');
    expect(events.at(-1)).toBe('run_completed');
    expect(streamCalls).toBe(2);
  });
});
