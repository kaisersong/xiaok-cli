import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerChatCommands } from '../../src/commands/chat.js';

describe('chat session options', () => {
  it('registers resume and fork-session flags', () => {
    const program = new Command();

    registerChatCommands(program);

    const chatCommand = program.commands.find((command) => command.name() === 'chat');
    const optionNames = chatCommand?.options.map((option) => option.long) ?? [];

    expect(optionNames).toContain('--resume');
    expect(optionNames).toContain('--fork-session');
  });
});
