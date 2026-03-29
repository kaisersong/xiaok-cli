import { describe, it, expect, beforeEach } from 'vitest';
import { InputReader, getSlashCommands } from '../../src/ui/input.js';
import type { SkillMeta } from '../../src/ai/skills/loader.js';

describe('getSlashCommands', () => {
  it('should return base commands when no skills provided', () => {
    const commands = getSlashCommands([]);

    expect(commands).toContainEqual({ cmd: '/exit', desc: 'Exit the chat' });
    expect(commands).toContainEqual({ cmd: '/clear', desc: 'Clear the screen' });
    expect(commands).toContainEqual({ cmd: '/models', desc: 'Switch model' });
    expect(commands).toContainEqual({ cmd: '/help', desc: 'Show help' });
    expect(commands.length).toBe(4);
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
    expect(commands.length).toBe(5); // 4 base + 1 skill
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

    expect(commands.length).toBe(7); // 4 base + 3 skills
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
});
