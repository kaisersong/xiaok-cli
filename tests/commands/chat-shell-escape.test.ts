import { describe, expect, it } from 'vitest';
import { parseShellEscapeInput } from '../../src/commands/chat-shell-escape.js';

describe('chat shell escape parser', () => {
  it('parses bang-prefixed local shell commands', () => {
    expect(parseShellEscapeInput('! sudo -v')).toEqual({ kind: 'command', command: 'sudo -v' });
    expect(parseShellEscapeInput('!sudo -v')).toEqual({ kind: 'command', command: 'sudo -v' });
    expect(parseShellEscapeInput('  ! npm install  ')).toEqual({ kind: 'command', command: 'npm install' });
  });

  it('returns usage for an empty shell escape', () => {
    expect(parseShellEscapeInput('!')).toEqual({ kind: 'usage' });
    expect(parseShellEscapeInput('!   ')).toEqual({ kind: 'usage' });
  });

  it('does not treat slash shortcuts or normal prompts as shell escapes', () => {
    expect(parseShellEscapeInput('!/release-checklist now')).toBeNull();
    expect(parseShellEscapeInput('hello')).toBeNull();
  });
});
