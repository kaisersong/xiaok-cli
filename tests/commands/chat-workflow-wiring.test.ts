import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat workflow wiring', () => {
  it('wires ask_user and task tools into the CLI tool registry', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("from '../ai/tools/ask-user.js'");
    expect(source).toContain("from '../ai/tools/tasks.js'");
    expect(source).toContain("from '../runtime/tasking/board.js'");
    expect(source).toContain('createAskUserTool');
    expect(source).toContain('createTaskTools');
    expect(source).toContain("trimmed.startsWith('/mode')");
    expect(source).toContain("trimmed === '/tasks'");
  });
});
