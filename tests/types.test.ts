// tests/types.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { Message, StreamChunk, ModelAdapter, ToolResultContent, ToolCall } from '../src/types.js';
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

  it('Message can carry toolCalls on assistant role', () => {
    const msg: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tu_1', name: 'bash', input: { command: 'ls' } }],
    };
    expect(msg.toolCalls?.[0].name).toBe('bash');
  });
});
