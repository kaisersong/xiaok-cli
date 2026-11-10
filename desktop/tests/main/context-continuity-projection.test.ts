// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { projectPublicTaskMessages } from '../../shared/context-continuity-projection.js';
import type { DesktopTaskEvent } from '../../shared/task-types.js';

const project = (events: unknown[]) => projectPublicTaskMessages({ taskId: 'task-one', prompt: 'original input', events: events as DesktopTaskEvent[] });
describe('one public task projection for main and renderer (R01/H09/H14)', () => {
  it('preserves tool-separated narration and removes an identical result summary only', () => {
    const messages = project([{ type: 'assistant_delta', delta: 'before' }, { type: 'canvas_tool_call', toolName: 'read', input: { secret: 'internal' } },
      { type: 'assistant_delta', delta: 'after' }, { type: 'result', result: { summary: 'beforeafter', artifacts: [] } }]);
    expect(messages.map(m => m.text)).toEqual(['original input', 'before\n\nafter']);
    expect(JSON.stringify(messages)).not.toContain('internal');
  });
  it('preserves separately authored final summaries as their own public record', () => {
    const messages = project([{ type: 'assistant_delta', delta: 'analysis visible to the user' }, { type: 'result', result: { summary: 'final decision', artifacts: [] } }]);
    expect(messages.map(m => m.text)).toEqual(['original input', 'analysis visible to the user', 'final decision']);
  });
  it('keeps original assistant partial text without copying internal error details', () => {
    const messages = project([{ type: 'assistant_delta', delta: 'visible' }, { type: 'error', message: 'private connection details' }]);
    expect(messages.map(m => m.text)).toEqual(['original input', 'visible']);
  });
  it('uses the committed append-only event coordinate, independent of chunk text and repeat runs', () => {
    const events = [{ type: 'assistant_delta', delta: 'same' }, { type: 'result', result: { summary: 'same', artifacts: [] } }];
    expect(project(events)).toEqual(project(events));
    const extended = project([...events, { type: 'assistant_delta', delta: 'next' }, { type: 'result', result: { summary: 'next', artifacts: [] } }]);
    expect(extended[1].sourceMessageId).toBe(project(events)[1].sourceMessageId);
    expect(new Set(extended.map(m => m.sourceMessageId)).size).toBe(extended.length);
  });
  it('has no bounded display trim and excludes tool payloads and unknown provider blocks', () => {
    const events = Array.from({ length: 500 }, () => ({ type: 'assistant_delta', delta: 'long content '.repeat(20) }));
    const messages = project([...events, { type: 'reasoning', text: 'private' }, { type: 'canvas_tool_result', response: 'private tool data' }, { type: 'result', result: { summary: '', artifacts: [] } }]);
    expect(messages[1].text.length).toBe(130000);
    expect(JSON.stringify(messages)).not.toContain('private');
  });
});
