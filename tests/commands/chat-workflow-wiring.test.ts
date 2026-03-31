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

  it('intercepts built-in git workflow commands before slash skill dispatch', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("from './commit.js'");
    expect(source).toContain("from './review.js'");
    expect(source).toContain("from './pr.js'");
    expect(source).toContain("trimmed === '/review'");
    expect(source).toContain("trimmed === '/pr'");
    expect(source).toContain("trimmed.startsWith('/commit')");
    expect(source).toContain('runCommitCommand');
    expect(source).toContain('runReviewCommand');
    expect(source).toContain('runPrCommand');

    const reviewIndex = source.indexOf("trimmed === '/review'");
    const slashIndex = source.indexOf('const slash = parseSlashCommand(trimmed);');
    expect(reviewIndex).toBeGreaterThan(-1);
    expect(slashIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeLessThan(slashIndex);
  });
});
