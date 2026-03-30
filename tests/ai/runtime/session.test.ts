import { describe, expect, it } from 'vitest';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';

describe('AgentSessionState', () => {
  it('starts empty with zero usage', () => {
    const state = new AgentSessionState();

    expect(state.getMessages()).toEqual([]);
    expect(state.getUsage()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('appends user and assistant messages in order', () => {
    const state = new AgentSessionState();

    state.appendUserText('hello');
    state.appendAssistantBlocks([{ type: 'text', text: 'world' }]);

    expect(state.getMessages()).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ]);
  });

  it('forceCompact keeps a compact marker and recent messages', () => {
    const state = new AgentSessionState();

    state.appendUserText('first');
    state.appendAssistantBlocks([{ type: 'text', text: 'second' }]);
    state.appendUserToolResults([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }]);
    state.forceCompact('[compacted]');

    expect(state.getMessages()[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: '[compacted]' }],
    });
    expect(state.getMessages()).toHaveLength(3);
  });
});
