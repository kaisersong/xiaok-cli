// tests/types.test.ts
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { Message, MessageBlock, UsageStats } from '../src/types.js';
import { isValidLegacyProvider, DEFAULT_CONFIG } from '../src/types.js';

describe('types', () => {
  it('isValidLegacyProvider accepts valid legacy providers', () => {
    expect(isValidLegacyProvider('claude')).toBe(true);
    expect(isValidLegacyProvider('openai')).toBe(true);
    expect(isValidLegacyProvider('custom')).toBe(true);
  });

  it('isValidLegacyProvider rejects unknown providers', () => {
    expect(isValidLegacyProvider('unknown')).toBe(false);
    expect(isValidLegacyProvider('')).toBe(false);
    expect(isValidLegacyProvider(null)).toBe(false);
  });

  it('DEFAULT_CONFIG uses schemaVersion 2 provider catalogs', () => {
    expect(DEFAULT_CONFIG.schemaVersion).toBe(2);
    expect(DEFAULT_CONFIG.defaultProvider).toBe('anthropic');
    expect(DEFAULT_CONFIG.defaultModelId).toBe('anthropic-default');
  });

  it('Message uses block-based content', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
    };
    expect(msg.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('MessageBlock supports text, tool_use, tool_result, and thinking blocks', () => {
    expectTypeOf<MessageBlock>().toMatchTypeOf<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      | { type: 'thinking'; thinking: string }
    >();
  });

  it('UsageStats exposes token accounting fields', () => {
    expectTypeOf<UsageStats>().toMatchTypeOf<{
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    }>();
  });
});
