import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat terminal layout', () => {
  it('should not use bottom-fixed input cursor positioning sequences', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).not.toContain('\\x1b[1;${rows - 3}r');
    expect(source).not.toContain('\\x1b[${rows - 2};1H\\x1b[K');
    expect(source).not.toContain('\\x1b[${rows - 1};1H\\x1b[K');
    expect(source).not.toContain('\\x1b[${termRows - 3};1H');
  });
});
