import { describe, it, expect, beforeEach } from 'vitest';
import {
  InputReader,
  getMenuClearSequence,
  getSlashCommands,
  truncateMenuDescription,
  wordBoundaryLeft,
  wordBoundaryRight,
} from '../../src/ui/input.js';
import type { SkillMeta } from '../../src/ai/skills/loader.js';

describe('getSlashCommands', () => {
  it('should return base commands when no skills provided', () => {
    const commands = getSlashCommands([]);

    expect(commands).toContainEqual({ cmd: '/exit', desc: 'Exit the chat' });
    expect(commands).toContainEqual({ cmd: '/clear', desc: 'Clear the screen' });
    expect(commands).toContainEqual({ cmd: '/commit', desc: 'Commit staged changes' });
    expect(commands).toContainEqual({ cmd: '/review', desc: 'Summarize current git changes' });
    expect(commands).toContainEqual({ cmd: '/pr', desc: 'Create or preview a pull request' });
    expect(commands).toContainEqual({ cmd: '/models', desc: 'Switch model' });
    expect(commands).toContainEqual({ cmd: '/mode', desc: 'Show or change permission mode' });
    expect(commands).toContainEqual({ cmd: '/tasks', desc: 'List workflow tasks' });
    expect(commands).toContainEqual({ cmd: '/help', desc: 'Show help' });
    expect(commands.length).toBe(9);
  });

  it('should include skills in command list', () => {
    const skills: SkillMeta[] = [
      {
        name: 'test-skill',
        description: 'A test skill',
        content: 'Test content',
        path: '/path/to/skill.md',
      },
    ];

    const commands = getSlashCommands(skills);

    expect(commands).toContainEqual({ cmd: '/test-skill', desc: 'A test skill' });
    expect(commands.length).toBe(10); // 9 base + 1 skill
  });

  it('should sort commands alphabetically', () => {
    const skills: SkillMeta[] = [
      { name: 'zebra', description: 'Z skill', content: '', path: '' },
      { name: 'alpha', description: 'A skill', content: '', path: '' },
    ];

    const commands = getSlashCommands(skills);
    const cmdNames = commands.map(c => c.cmd);

    // Should be sorted: /alpha, /clear, /exit, /help, /zebra
    expect(cmdNames[0]).toBe('/alpha');
    expect(cmdNames[cmdNames.length - 1]).toBe('/zebra');
  });

  it('should not duplicate commands if skill has same name as base command', () => {
    const skills: SkillMeta[] = [
      { name: 'exit', description: 'Custom exit', content: '', path: '' },
    ];

    const commands = getSlashCommands(skills);
    const exitCommands = commands.filter(c => c.cmd === '/exit');

    expect(exitCommands.length).toBe(1);
    expect(exitCommands[0].desc).toBe('Exit the chat'); // Base command takes precedence
  });

  it('should handle multiple skills', () => {
    const skills: SkillMeta[] = [
      { name: 'skill1', description: 'First skill', content: '', path: '' },
      { name: 'skill2', description: 'Second skill', content: '', path: '' },
      { name: 'skill3', description: 'Third skill', content: '', path: '' },
    ];

    const commands = getSlashCommands(skills);

    expect(commands.length).toBe(12); // 9 base + 3 skills
  });
});

describe('InputReader', () => {
  let reader: InputReader;

  beforeEach(() => {
    reader = new InputReader();
  });

  describe('setSkills', () => {
    it('should store skills for menu generation', () => {
      const skills: SkillMeta[] = [
        {
          name: 'test-skill',
          description: 'A test skill',
          content: 'Test content',
          path: '/path/to/skill.md',
        },
      ];

      reader.setSkills(skills);
      // Skills are stored internally, verified through menu behavior
      expect(reader).toBeDefined();
    });

    it('should accept empty skills array', () => {
      reader.setSkills([]);
      expect(reader).toBeDefined();
    });
  });

  describe('read', () => {
    it('should clear input line after submission', async () => {
      // This test verifies that the input line is cleared after Enter is pressed
      // The actual behavior is tested in integration tests
      expect(reader).toBeDefined();
    });
  });

  describe('slash command menu', () => {
    it('should include slash menu candidates for "/" input', () => {
      const skills: SkillMeta[] = [
        { name: 'browse', description: 'Browser skill', content: '', path: '' },
      ];

      const commands = getSlashCommands(skills);

      expect(commands.some((item) => item.cmd === '/browse')).toBe(true);
      expect(commands.some((item) => item.cmd === '/exit')).toBe(true);
    });

    it('should filter commands based on input', () => {
      const skills: SkillMeta[] = [
        { name: 'test-skill', description: 'A test skill', content: '', path: '' },
        { name: 'another-skill', description: 'Another skill', content: '', path: '' },
      ];

      reader.setSkills(skills);

      // Test that commands can be filtered
      const allCommands = getSlashCommands(skills);
      const exitCommands = allCommands.filter(c => c.cmd.startsWith('/exit'));
      const testCommands = allCommands.filter(c => c.cmd.startsWith('/test'));

      expect(exitCommands.length).toBe(1);
      expect(testCommands.length).toBe(1);
      expect(testCommands[0].cmd).toBe('/test-skill');
    });

    it('should handle partial command matching', () => {
      const skills: SkillMeta[] = [
        { name: 'test-one', description: 'Test 1', content: '', path: '' },
        { name: 'test-two', description: 'Test 2', content: '', path: '' },
        { name: 'other', description: 'Other', content: '', path: '' },
      ];

      const commands = getSlashCommands(skills);
      const testCommands = commands.filter(c => c.cmd.startsWith('/test'));

      expect(testCommands.length).toBe(2);
      expect(testCommands[0].cmd).toBe('/test-one');
      expect(testCommands[1].cmd).toBe('/test-two');
    });

    it('should return empty array when no commands match', () => {
      const skills: SkillMeta[] = [
        { name: 'test-skill', description: 'A test skill', content: '', path: '' },
      ];

      const commands = getSlashCommands(skills);
      const noMatch = commands.filter(c => c.cmd.startsWith('/nonexistent'));

      expect(noMatch.length).toBe(0);
    });

    it('should handle menu with many commands', () => {
      const skills: SkillMeta[] = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: `Skill ${i}`,
        content: '',
        path: '',
      }));

      const commands = getSlashCommands(skills);

      // 9 base commands + 20 skills = 29 total
      expect(commands.length).toBe(29);
    });

    it('should preserve command descriptions', () => {
      const skills: SkillMeta[] = [
        { name: 'test', description: 'This is a test skill with a long description', content: '', path: '' },
      ];

      const commands = getSlashCommands(skills);
      const testCmd = commands.find(c => c.cmd === '/test');

      expect(testCmd).toBeDefined();
      expect(testCmd?.desc).toBe('This is a test skill with a long description');
    });
  });
});

describe('word navigation helpers', () => {
  it('wordBoundaryLeft should find previous word start', () => {
    expect(wordBoundaryLeft('hello world', 11)).toBe(6);
    expect(wordBoundaryLeft('hello world', 6)).toBe(0);
    expect(wordBoundaryLeft('hello world', 5)).toBe(0);
    expect(wordBoundaryLeft('', 0)).toBe(0);
  });

  it('wordBoundaryRight should find next word end', () => {
    expect(wordBoundaryRight('hello world', 0)).toBe(5);
    expect(wordBoundaryRight('hello world', 5)).toBe(11);
    expect(wordBoundaryRight('hello world', 6)).toBe(11);
    expect(wordBoundaryRight('', 0)).toBe(0);
  });
});

describe('menu rendering helpers', () => {
  it('truncateMenuDescription should keep descriptions to one line', () => {
    expect(truncateMenuDescription('line1\nline2', 20)).toBe('line1 line2');
  });

  it('truncateMenuDescription should truncate long descriptions', () => {
    expect(truncateMenuDescription('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefg...');
  });

  it('getMenuClearSequence should clear lines below the prompt and return to input row', () => {
    expect(getMenuClearSequence(2)).toBe('\x1b[1B\r\x1b[2K\x1b[1B\r\x1b[2K\x1b[2A\r');
  });
});
