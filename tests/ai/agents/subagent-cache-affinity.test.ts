import { describe, expect, it } from 'vitest';
import { executeNamedSubAgent } from '../../../src/ai/agents/subagent-executor.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import type { ModelAdapter } from '../../../src/types.js';

describe('subagent cache affinity', () => {
  it('keeps a real subagent Agent runtime side call affinity-free', async () => {
    const captured: Array<StreamOptions | undefined> = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: async function* (_messages, _tools, _systemPrompt, options) {
        captured.push(options);
        yield { type: 'text', delta: 'subagent result' };
        yield { type: 'done' };
      },
    };

    await expect(executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'side request',
      sessionId: 'sess_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      adapter: () => adapter,
      createRegistry: () => ({
        getToolDefinitions: () => [],
        executeTool: async () => 'unused',
      }) as never,
      buildSystemPrompt: async () => 'isolated prompt',
    })).resolves.toBe('subagent result');

    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty('cacheKey');
  });
});
