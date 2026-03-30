import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import {
  formatPrintOutput,
  type PrintResult,
} from '../../src/commands/chat-print-mode.js';
import { registerChatCommands } from '../../src/commands/chat.js';

describe('chat print mode', () => {
  it('registers print and json flags', () => {
    const program = new Command();

    registerChatCommands(program);

    const chatCommand = program.commands.find((command) => command.name() === 'chat');
    const optionNames = chatCommand?.options.flatMap((option) => [option.short, option.long].filter(Boolean)) ?? [];

    expect(optionNames).toContain('-p');
    expect(optionNames).toContain('--json');
  });

  it('formats plain print output as assistant text only', () => {
    const result: PrintResult = {
      sessionId: 'sess_123',
      text: 'hello world',
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    expect(formatPrintOutput(result, false)).toBe('hello world');
  });

  it('formats json print output with stable fields', () => {
    const result: PrintResult = {
      sessionId: 'sess_123',
      text: 'hello world',
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    expect(JSON.parse(formatPrintOutput(result, true))).toEqual(result);
  });
});
