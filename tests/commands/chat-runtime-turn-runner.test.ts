import { describe, expect, it, vi } from 'vitest';
import {
  runInteractiveRuntimeTurn,
  type InteractiveRuntimeTurnRequest,
} from '../../src/commands/chat/runtime-turn-runner.js';

function createRequest(input = 'hello'): InteractiveRuntimeTurnRequest<string> {
  return {
    turnToken: `turn-${input}`,
    sessionId: 'session-1',
    cwd: '/tmp/project',
    source: 'chat',
    input,
  };
}

describe('chat runtime turn runner', () => {
  it('collects text chunks in order and forwards every text delta to the writer', async () => {
    const writeAssistantText = vi.fn();
    const updateUsage = vi.fn();
    const request = createRequest('text');

    const result = await runInteractiveRuntimeTurn(async (receivedRequest, onChunk) => {
      expect(receivedRequest).toBe(request);
      onChunk({ type: 'text', delta: '\n' });
      onChunk({ type: 'text', delta: 'hello' });
      onChunk({ type: 'done' });
    }, request, {
      writeAssistantText,
      updateUsage,
    });

    expect(result.assistantText).toBe('\nhello');
    expect(writeAssistantText).toHaveBeenNthCalledWith(1, '\n');
    expect(writeAssistantText).toHaveBeenNthCalledWith(2, 'hello');
    expect(updateUsage).not.toHaveBeenCalled();
  });

  it('forwards usage chunks without appending assistant text', async () => {
    const writeAssistantText = vi.fn();
    const updateUsage = vi.fn();
    const usage = { inputTokens: 7, outputTokens: 3 };

    const result = await runInteractiveRuntimeTurn(async (_request, onChunk) => {
      onChunk({ type: 'usage', usage });
      onChunk({ type: 'done' });
    }, createRequest('usage'), {
      writeAssistantText,
      updateUsage,
    });

    expect(result.assistantText).toBe('');
    expect(updateUsage).toHaveBeenCalledExactlyOnceWith(usage);
    expect(writeAssistantText).not.toHaveBeenCalled();
  });

  it('preserves AbortError thrown by strict continuation instead of normalizing it', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    await expect(runInteractiveRuntimeTurn(async () => {
      throw abortError;
    }, createRequest('abort'), {
      writeAssistantText: vi.fn(),
      updateUsage: vi.fn(),
    })).rejects.toBe(abortError);
  });

  it('keeps consecutive turn calls isolated through local state only', async () => {
    const first = await runInteractiveRuntimeTurn(async (_request, onChunk) => {
      onChunk({ type: 'text', delta: 'first' });
    }, createRequest('first'), {
      writeAssistantText: vi.fn(),
      updateUsage: vi.fn(),
    });
    const second = await runInteractiveRuntimeTurn(async (_request, onChunk) => {
      onChunk({ type: 'text', delta: 'second' });
    }, createRequest('second'), {
      writeAssistantText: vi.fn(),
      updateUsage: vi.fn(),
    });

    expect(first.assistantText).toBe('first');
    expect(second.assistantText).toBe('second');
  });
});
