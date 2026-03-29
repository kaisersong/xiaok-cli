// tests/ai/skills/slash.test.ts
import { describe, it, expect } from 'vitest';
import { parseSlashCommand } from '../../../src/ai/skills/loader.js';

describe('parseSlashCommand', () => {
  it('detects /skill-name at start of input', () => {
    expect(parseSlashCommand('/greet 帮我打招呼')).toEqual({ skillName: 'greet', rest: '帮我打招呼' });
  });

  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('普通输入')).toBeNull();
  });

  it('handles /skill-name with no trailing text', () => {
    expect(parseSlashCommand('/deploy')).toEqual({ skillName: 'deploy', rest: '' });
  });

  it('normalizes extra whitespace after the slash command', () => {
    expect(parseSlashCommand('/review    api   layer  ')).toEqual({ skillName: 'review', rest: 'api layer' });
  });
});
