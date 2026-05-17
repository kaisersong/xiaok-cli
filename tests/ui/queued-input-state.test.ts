import { describe, expect, it } from 'vitest';
import { createQueuedInputState } from '../../src/ui/queued-input.js';

describe('queued input state', () => {
  it('queues a non-empty draft and clears the draft', () => {
    const state = createQueuedInputState();

    state.insertText('更新了没');
    const result = state.submitDraft();

    expect(result).toEqual({ type: 'submit', value: '更新了没' });
    expect(state.getSnapshot()).toMatchObject({
      draft: '',
      cursor: 0,
      queued: { text: '更新了没' },
      editingQueued: false,
    });
  });

  it('ignores empty draft submissions', () => {
    const state = createQueuedInputState();

    expect(state.submitDraft()).toEqual({ type: 'none' });
    expect(state.getSnapshot().queued).toBeNull();
  });

  it('edits the queued input with up arrow semantics', () => {
    const state = createQueuedInputState();
    state.insertText('更新了没');
    state.submitDraft();

    const result = state.editQueued();

    expect(result).toEqual({ type: 'edit', value: '更新了没' });
    expect(state.getSnapshot()).toMatchObject({
      draft: '更新了没',
      cursor: '更新了没'.length,
      queued: null,
      editingQueued: true,
    });
  });

  it('replaces the single queued slot instead of appending', () => {
    const state = createQueuedInputState();
    state.insertText('第一条');
    state.submitDraft();

    state.insertText('第二条');
    const result = state.submitDraft();

    expect(result).toEqual({ type: 'replace', oldValue: '第一条', newValue: '第二条' });
    expect(state.getSnapshot().queued?.text).toBe('第二条');
  });

  it('moves queued input back into draft on escape before clearing it', () => {
    const state = createQueuedInputState();
    state.insertText('保留这条');
    state.submitDraft();

    expect(state.handleEscape()).toEqual({ type: 'edit', value: '保留这条' });
    expect(state.getSnapshot().draft).toBe('保留这条');
    expect(state.getSnapshot().queued).toBeNull();

    expect(state.handleEscape()).toEqual({ type: 'clear-draft', value: '保留这条' });
    expect(state.getSnapshot().draft).toBe('');
  });

  it('consumes queued input exactly once', () => {
    const state = createQueuedInputState();
    state.insertText('只执行一次');
    state.submitDraft();

    expect(state.consumeQueued()).toBe('只执行一次');
    expect(state.consumeQueued()).toBeNull();
  });

  it('preserves multiline queued input', () => {
    const state = createQueuedInputState();
    state.insertText('第一行\n第二行');
    state.submitDraft();

    expect(state.consumeQueued()).toBe('第一行\n第二行');
  });
});
