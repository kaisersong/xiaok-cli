import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/types.js';
import { computeEphemeralProviderTranscriptDigest } from '../../../src/ai/runtime/provider-transcript-digest.js';

function officialMessages(): Message[] {
  return [
    {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'private',
          reasoningProvenance: {
            captureVersion: 1,
            source: 'reasoning_content',
            fieldPresence: 'present',
          },
        },
        { type: 'text', text: 'world' },
      ],
    },
  ];
}

describe('computeEphemeralProviderTranscriptDigest', () => {
  it('binds the task-local transcript to surface, invocation, and exact profile', () => {
    const input = {
      surfaceKind: 'desktop-task' as const,
      invocationId: 'invocation-1',
      providerConversationProfileId: 'kimi-k3-coding-openai' as const,
      messages: officialMessages(),
    };
    const digest = computeEphemeralProviderTranscriptDigest(input);

    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computeEphemeralProviderTranscriptDigest({
      ...input,
      invocationId: 'invocation-2',
    })).not.toBe(digest);
    expect(computeEphemeralProviderTranscriptDigest({
      ...input,
      surfaceKind: 'cli-chat-task',
    })).not.toBe(digest);
    expect(computeEphemeralProviderTranscriptDigest({
      ...input,
      providerConversationProfileId: 'kimi-k3-256k-coding-openai',
    })).not.toBe(digest);
  });

  it('rejects non-official reasoning before producing a digest', () => {
    const messages = officialMessages();
    const thinking = messages[1]!.content[0]!;
    if (thinking.type === 'thinking' && thinking.reasoningProvenance) {
      thinking.reasoningProvenance.source = 'reasoning';
    }

    expect(() => computeEphemeralProviderTranscriptDigest({
      surfaceKind: 'desktop-task',
      invocationId: 'invocation-1',
      providerConversationProfileId: 'kimi-k3-coding-openai',
      messages,
    })).toThrow('KIMI_REASONING_SOURCE_INVARIANT');
  });
});
