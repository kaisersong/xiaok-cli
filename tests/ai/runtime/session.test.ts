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

  it('does not expose the live mutable message history', () => {
    const state = new AgentSessionState();
    state.appendUserText('original');

    const exposed = state.getMessages();
    exposed[0]!.content[0] = { type: 'text', text: 'mutated outside the session' };
    exposed.push({ role: 'assistant', content: [{ type: 'text', text: 'injected' }] });

    expect(state.getMessages()).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'original' }] },
    ]);
  });

  it('forceCompact keeps a deterministic compact marker and recent messages', () => {
    const state = new AgentSessionState();

    state.appendUserText(`first ${'a'.repeat(10_000)}`);
    state.appendAssistantBlocks([
      { type: 'text', text: `second ${'b'.repeat(10_000)}` },
      { type: 'tool_use', id: 'tu_1', name: 'read', input: { path: '/tmp/a' } },
    ]);
    state.appendUserToolResults([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }]);
    const compaction = state.forceCompact();

    expect(compaction?.summary).toContain('[context compacted summary]');
    expect(compaction?.replacedMessages).toBe(1);
    expect(state.getCompactions()).toHaveLength(1);
    expect(state.getMessages()[0]?.role).toBe('user');
    expect((state.getMessages()[0]?.content[0] as { text: string }).text).toContain('[context compacted summary]');
    expect(state.getMessages()).toHaveLength(3);
  });

  it('applies the exact LLM summary to the frozen plan and compaction record', () => {
    const state = new AgentSessionState();
    state.appendUserText(`first ${'a'.repeat(10_000)}`);
    state.appendAssistantBlocks([{ type: 'text', text: `second ${'b'.repeat(10_000)}` }]);
    state.appendUserText('recent request');
    state.appendAssistantBlocks([{ type: 'text', text: 'recent answer' }]);
    const plan = state.planCompaction();

    const outcome = state.applyCompaction(plan, 'LLM summary: preserve path /tmp/report.html');

    expect(outcome.status).toBe('compacted');
    expect(outcome.record?.summary).toBe('LLM summary: preserve path /tmp/report.html');
    expect(state.getCompactions().at(-1)?.summary).toBe('LLM summary: preserve path /tmp/report.html');
    expect((state.getMessages()[0]?.content[0] as { text: string }).text)
      .toBe('LLM summary: preserve path /tmp/report.html');
  });

  it('rejects a stale plan without changing messages, usage, or compactions', () => {
    const state = new AgentSessionState();
    state.appendUserText(`first ${'a'.repeat(10_000)}`);
    state.appendAssistantBlocks([{ type: 'text', text: `second ${'b'.repeat(10_000)}` }]);
    state.appendUserText('recent request');
    state.updateUsage({ inputTokens: 123, outputTokens: 7 });
    const plan = state.planCompaction();

    state.appendAssistantBlocks([{ type: 'text', text: 'arrived while summary was pending' }]);
    const before = state.exportSnapshot();
    const outcome = state.applyCompaction(plan, 'stale summary');

    expect(outcome).toEqual({ status: 'stale_plan', record: null });
    expect(state.exportSnapshot()).toEqual(before);
  });

  it('leaves the session unchanged when a plan cannot yield net reduction', () => {
    const state = new AgentSessionState();
    state.appendUserText('a');
    state.appendAssistantBlocks([{ type: 'text', text: 'b' }]);
    state.appendUserText('c');
    const before = state.exportSnapshot();
    const plan = state.planCompaction();

    const outcome = state.applyCompaction(plan, 'an expansion rather than a summary');

    expect(outcome).toEqual({ status: 'no_gain', record: null });
    expect(state.exportSnapshot()).toEqual(before);
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
