import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat workflow wiring', () => {
  it('wires ask_user and native intent delegation into the CLI tool registry', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("from '../ai/tools/ask-user.js'");
    expect(source).toContain("from '../ai/tools/intent-delegation.js'");
    expect(source).toContain("from '../ai/intent-delegation/planner.js'");
    expect(source).toContain("from '../runtime/intent-delegation/store.js'");
    expect(source).toContain("from '../runtime/intent-delegation/runtime-sync.js'");
    expect(source).toContain("from '../runtime/intent-delegation/ownership.js'");
    expect(source).toContain('createAskUserTool');
    expect(source).toContain('createIntentDelegationTools');
    expect(source).toContain('createIntentPlan');
    expect(source).toContain('SessionIntentDelegationStore');
    expect(source).toContain('wireIntentDelegationToRuntimeSync');
    expect(source).toMatch(/markSessionOwned|resumeSessionOwnership/);
    expect(source).toContain("trimmed.startsWith('/mode')");
    expect(source).not.toContain("from '../ai/tools/tasks.js'");
    expect(source).not.toContain("from '../runtime/tasking/board.js'");
    expect(source).not.toContain('createTaskTools');
    expect(source).not.toContain("trimmed === '/tasks'");
    expect(source).not.toContain("trimmed === '/task'");
    expect(source).not.toContain("trimmed.startsWith('/task ')");
  });

  it('redirects git workflow slash commands to the top-level CLI before slash skill dispatch', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("trimmed === '/review'");
    expect(source).toContain("trimmed === '/pr'");
    expect(source).toContain("trimmed === '/commit' || trimmed.startsWith('/commit ')");
    expect(source).toContain('chat 中已不再支持 /commit');
    expect(source).toContain('chat 中已不再支持 /review');
    expect(source).toContain('chat 中已不再支持 /pr');
    expect(source).not.toContain("from './commit.js'");
    expect(source).not.toContain("from './review.js'");
    expect(source).not.toContain("from './pr.js'");
    expect(source).not.toContain('runCommitCommand');
    expect(source).not.toContain('runReviewCommand');
    expect(source).not.toContain('runPrCommand');

    const reviewIndex = source.indexOf("trimmed === '/review'");
    const slashIndex = source.indexOf('const slash = parseSlashCommand(trimmed);');
    expect(reviewIndex).toBeGreaterThan(-1);
    expect(slashIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeLessThan(slashIndex);
  });
});
