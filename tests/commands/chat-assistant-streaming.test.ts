import { describe, expect, it } from 'vitest';
import {
  writeAssistantTextChunkInOrder,
  type AssistantTextChunkOrderDeps,
} from '../../src/commands/chat/assistant-streaming.js';

type Call = {
  op: string;
  delta?: string;
};

const createDeps = (): { calls: Call[]; deps: AssistantTextChunkOrderDeps } => {
  const calls: Call[] = [];
  const deps: AssistantTextChunkOrderDeps = {
    noteVisibleAssistantText: (delta) => {
      calls.push({ op: 'noteVisibleAssistantText', delta });
    },
    appendAssistantText: (delta) => {
      calls.push({ op: 'appendAssistantText', delta });
    },
    noteResponseStarted: () => {
      calls.push({ op: 'noteResponseStarted' });
    },
    appendStreamingSegment: (delta) => {
      calls.push({ op: 'appendStreamingSegment', delta });
    },
    ensureStreamingPhase: () => {
      calls.push({ op: 'ensureStreamingPhase' });
    },
    writeMarkdown: (delta) => {
      calls.push({ op: 'writeMarkdown', delta });
    },
  };

  return { calls, deps };
};

describe('writeAssistantTextChunkInOrder', () => {
  it('starts content streaming for whitespace chunks without marking a visible response', () => {
    const { calls, deps } = createDeps();

    writeAssistantTextChunkInOrder('  \n', deps);

    expect(calls).toEqual([
      { op: 'noteVisibleAssistantText', delta: '  \n' },
      { op: 'appendAssistantText', delta: '  \n' },
      { op: 'appendStreamingSegment', delta: '  \n' },
      { op: 'ensureStreamingPhase' },
      { op: 'writeMarkdown', delta: '  \n' },
    ]);
    expect(calls).not.toContainEqual({ op: 'noteResponseStarted' });
  });

  it('records visible text before writing markdown', () => {
    const { calls, deps } = createDeps();

    writeAssistantTextChunkInOrder('hello', deps);

    expect(calls).toEqual([
      { op: 'noteVisibleAssistantText', delta: 'hello' },
      { op: 'appendAssistantText', delta: 'hello' },
      { op: 'noteResponseStarted' },
      { op: 'appendStreamingSegment', delta: 'hello' },
      { op: 'ensureStreamingPhase' },
      { op: 'writeMarkdown', delta: 'hello' },
    ]);
  });

  it('records empty chunks without starting a streaming phase', () => {
    const { calls, deps } = createDeps();

    writeAssistantTextChunkInOrder('', deps);

    expect(calls).toEqual([
      { op: 'noteVisibleAssistantText', delta: '' },
      { op: 'appendAssistantText', delta: '' },
      { op: 'appendStreamingSegment', delta: '' },
      { op: 'writeMarkdown', delta: '' },
    ]);
    expect(calls).not.toContainEqual({ op: 'noteResponseStarted' });
    expect(calls).not.toContainEqual({ op: 'ensureStreamingPhase' });
  });
});
