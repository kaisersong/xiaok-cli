import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChatHelpText, getChatSlashCommands } from '../../src/commands/registry.js';

describe('chat command metadata contracts', () => {
  it('exposes the new commands in completion and packs help without dropping entries', () => {
    const commands = getChatSlashCommands();
    expect(commands.some(command => command.cmd === '/version')).toBe(true);
    expect(commands.some(command => command.cmd === '/statusline')).toBe(true);
    const text = buildChatHelpText([]);
    for (const command of commands) expect(text).toContain(command.cmd);
    expect(text).toContain('/clear');
    expect(text).toContain('压缩上下文');
  });
  it('moves chat help metadata out of chat.ts and into a shared registry module', () => {
    const chatSource = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(chatSource).toContain("from './registry.js'");
    expect(chatSource).not.toContain('const helpLines = [');
    expect(chatSource).not.toContain("'  /clear   - 清屏'");
  });
});
