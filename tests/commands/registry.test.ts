import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('chat command metadata contracts', () => {
  it('moves chat help metadata out of chat.ts and into a shared registry module', () => {
    const chatSource = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(chatSource).toContain("from './registry.js'");
    expect(chatSource).not.toContain('const helpLines = [');
    expect(chatSource).not.toContain("'  /clear   - 清屏'");
  });
});
