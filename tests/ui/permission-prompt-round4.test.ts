import { expect, it } from 'vitest';
import { escapeProjectRuleDisplay } from '../../src/ui/permission-prompt.js';

it.each(['\u202e', '\u200b', '\u{e0001}'])('escapes Unicode format characters in rule display: %s', char => {
  const result = escapeProjectRuleDisplay(`bash(${char}*)`);
  expect(result).not.toContain(char);
  expect(result).toBe(`bash(\\u{${char.codePointAt(0)!.toString(16).padStart(4, '0')}}*)`);
});
