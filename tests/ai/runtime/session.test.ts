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
    const compaction = state.forceCompact('[compacted]');

    expect(compaction?.summary).toContain('[context compacted summary]');
    expect(compaction?.replacedMessages).toBe(1);
    expect(state.getCompactions()).toHaveLength(1);
    expect(state.getMessages()[0]?.role).toBe('assistant');
    expect((state.getMessages()[0]?.content[0] as { text: string }).text).toContain('[context compacted summary]');
    expect(state.getMessages()).toHaveLength(3);
  });

  it('exports prompt snapshot and approval metadata with the session snapshot', () => {
    const state = new AgentSessionState();

    state.attachPromptSnapshot('prompt_1', ['mem_1']);
    state.recordApproval('apr_1');
    state.recordBackgroundJob('bg_1');

    expect(state.exportSnapshot()).toMatchObject({
      promptSnapshotId: 'prompt_1',
      memoryRefs: ['mem_1'],
      approvalRefs: ['apr_1'],
      backgroundJobRefs: ['bg_1'],
    });
  });
});
