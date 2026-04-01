import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('top-level command registration', () => {
  it('registers git workflow commands in the root CLI program', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'index.ts'), 'utf8');

    expect(source).toContain("from './commands/commit.js'");
    expect(source).toContain("from './commands/review.js'");
    expect(source).toContain("from './commands/pr.js'");
    expect(source).toContain('registerCommitCommands(program);');
    expect(source).toContain('registerReviewCommands(program);');
    expect(source).toContain('registerPrCommands(program);');
  });
});
