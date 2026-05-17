import { describe, expect, it } from 'vitest';
import { registerMemoryCommands } from '../../src/commands/memory.js';
import { Command } from 'commander';

describe('memory command registration', () => {
  it('should register memory command with subcommands', () => {
    const program = new Command();
    registerMemoryCommands(program);

    const memCmd = program.commands.find(c => c.name() === 'memory');
    expect(memCmd).toBeDefined();

    const subcommands = memCmd!.commands.map(c => c.name());
    expect(subcommands).toContain('stats');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('search');
    expect(subcommands).toContain('compact');
    expect(subcommands).toContain('clear');
  });

  it('stats command should have correct description', () => {
    const program = new Command();
    registerMemoryCommands(program);

    const memCmd = program.commands.find(c => c.name() === 'memory');
    const statsCmd = memCmd!.commands.find(c => c.name() === 'stats');
    expect(statsCmd!.description()).toContain('统计');
  });

  it('search command should require a query argument', () => {
    const program = new Command();
    registerMemoryCommands(program);

    const memCmd = program.commands.find(c => c.name() === 'memory');
    const searchCmd = memCmd!.commands.find(c => c.name() === 'search');
    // Commander stores arguments as registeredArguments
    const args = (searchCmd as any)._args || (searchCmd as any).registeredArguments;
    expect(args.length).toBeGreaterThan(0);
    expect(args[0].name()).toBe('query');
  });
});
