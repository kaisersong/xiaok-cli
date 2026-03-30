// tests/types.test.ts
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { Message, MessageBlock, UsageStats } from '../src/types.js';
import { isValidProvider, DEFAULT_CONFIG } from '../src/types.js';

describe('types', () => {
  it('isValidProvider accepts valid providers', () => {
    expect(isValidProvider('claude')).toBe(true);
    expect(isValidProvider('openai')).toBe(true);
    expect(isValidProvider('custom')).toBe(true);
  });

  it('isValidProvider rejects unknown providers', () => {
    expect(isValidProvider('unknown')).toBe(false);
    expect(isValidProvider('')).toBe(false);
    expect(isValidProvider(null)).toBe(false);
  });

  it('DEFAULT_CONFIG has schemaVersion 1', () => {
    expect(DEFAULT_CONFIG.schemaVersion).toBe(1);
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
