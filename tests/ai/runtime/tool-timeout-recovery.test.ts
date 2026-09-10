import { describe, it, expect, vi } from 'vitest';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { ModelAdapter } from '../../../src/types.js';

describe('tool timeout conversation recovery', () => {
  it('preserves successful results and pairs the failed batch before the next model request', async () => {
    const session = new AgentSessionState();
    const execute = vi.fn(async (_input, context) => {
      if (execute.mock.calls.length === 1) return 'completed side effect';
      return new Promise<string>((_resolve, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }));
    });
    const registry = new ToolRegistry({ autoMode: true, toolIdleTimeoutMs: 100 }, [{
      permission: 'safe', definition: { name: 'fixture', description: '', inputSchema: {} }, execute,
    }]);
    let calls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: async function* () {
        if (calls++ === 0) {
          for (const id of ['done', 'timeout', 'not-started']) yield { type: 'tool_use' as const, id, name: 'fixture', input: {} };
        } else {
          const results = session.getMessages().flatMap(m => m.content).filter(b => b.type === 'tool_result');
          expect(results.map(b => b.tool_use_id)).toEqual(['done', 'timeout', 'not-started']);
          expect(results[0].content).toBe('completed side effect');
          expect(results.slice(1).every(b => b.is_error)).toBe(true);
          yield { type: 'text' as const, delta: 'recovered' };
        }
        yield { type: 'done' as const };
      },
    };
    const runtime = new AgentRuntime({ adapter, registry, session, controller: new AgentRunController(), systemPrompt: 'system' });
    try {
      const failed = expect(runtime.run('start', () => {})).rejects.toThrow('TOOL_IDLE_TIMEOUT');
      await failed;
      await runtime.run('continue', () => {});
      expect(execute).toHaveBeenCalledTimes(2);
    } finally { registry.dispose(); }
  });

  it('repairs older incomplete batches before later user text and preserves existing replies', () => {
    const source = new AgentSessionState();
    source.appendAssistantBlocks(['a', 'b'].map(id => ({ type: 'tool_use', id, name: 'fixture', input: {} })));
    source.appendUserToolResults([{ type: 'tool_result', tool_use_id: 'a', content: 'real result' }]);
    source.appendUserText('next request that got 400');
    const restored = new AgentSessionState();
    restored.restoreSnapshot(source.exportSnapshot());
    restored.repairIncompleteToolCalls();
    const messages = restored.getMessages();
    expect(messages[1].content[0]).toMatchObject({ tool_use_id: 'a', content: 'real result' });
    expect(messages[1].content[1]).toMatchObject({ tool_use_id: 'b', is_error: true });
    expect(messages[2].content[0]).toMatchObject({ text: 'next request that got 400' });
    restored.repairIncompleteToolCalls();
    expect(restored.getMessages()).toEqual(messages);
  });

  it('preserves replies mixed with user text without duplicating their call IDs', () => {
    const session = new AgentSessionState();
    session.appendAssistantBlocks(['a', 'b'].map(id => ({ type: 'tool_use', id, name: 'fixture', input: {} })));
    session.appendUserBlocks([{ type: 'tool_result', tool_use_id: 'a', content: 'real' }, { type: 'text', text: 'continue' }]);
    session.repairIncompleteToolCalls();
    const messages = session.getMessages();
    expect(messages[1].content).toHaveLength(2);
    expect(messages[1].content[0]).toMatchObject({ tool_use_id: 'a', content: 'real' });
    expect(messages[1].content[1]).toMatchObject({ tool_use_id: 'b', is_error: true });
    expect(messages[2].content).toEqual([{ type: 'text', text: 'continue' }]);
  });
});
