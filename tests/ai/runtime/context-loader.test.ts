import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLoadedContext, loadAutoContext } from '../../../src/ai/runtime/context-loader.js';

const tempDirs: string[] = [];

function createTempTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xiaok-context-loader-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('context loader', () => {
  it('loads AGENTS.md and CLAUDE.md while traversing toward the repo root', async () => {
    const root = createTempTree();
    const nested = join(root, 'packages', 'cli');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), 'root agent rules');
    writeFileSync(join(root, 'CLAUDE.md'), 'root claude rules');
    writeFileSync(join(root, 'packages', 'AGENTS.md'), 'package agent rules');

    const loaded = await loadAutoContext({
      cwd: nested,
      maxChars: 10_000,
      git: {
        getBranch: async () => 'feature/runtime',
        isDirty: async () => true,
        getRecentCommits: async () => ['feat: add runtime layer'],
      },
    });

    expect(loaded.docs.map((doc) => doc.name)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'AGENTS.md',
    ]);
    expect(loaded.docs.map((doc) => doc.path)).toEqual([
      join(root, 'AGENTS.md'),
      join(root, 'CLAUDE.md'),
      join(root, 'packages', 'AGENTS.md'),
    ]);
    expect(loaded.git).toEqual({
      branch: 'feature/runtime',
      isDirty: true,
      recentCommits: ['feat: add runtime layer'],
    });
  });

  it('truncates prompt-doc loading to the configured size budget', async () => {
    const root = createTempTree();
    const nested = join(root, 'child');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), 'A'.repeat(120));
    writeFileSync(join(nested, 'CLAUDE.md'), 'B'.repeat(120));

    const loaded = await loadAutoContext({
      cwd: nested,
      maxChars: 100,
      git: {
        getBranch: async () => '',
        isDirty: async () => false,
        getRecentCommits: async () => [],
      },
    });

    expect(loaded.docs.length).toBeGreaterThan(0);
    expect(loaded.docs.some((doc) => doc.truncated)).toBe(true);
    expect(loaded.docs.reduce((sum, doc) => sum + doc.content.length, 0)).toBeLessThanOrEqual(120);
  });

  it('formats docs and git summary into a model-friendly section', () => {
    const section = formatLoadedContext({
      docs: [
        {
          name: 'AGENTS.md',
          path: '/repo/AGENTS.md',
          content: 'Follow repo rules',
          truncated: false,
        },
      ],
      git: {
        branch: 'main',
        isDirty: false,
        recentCommits: ['feat: first', 'fix: second'],
      },
    });

    expect(section).toContain('仓库提示文档');
    expect(section).toContain('/repo/AGENTS.md');
    expect(section).toContain('Git 上下文');
    expect(section).toContain('branch=main');
    expect(section).toContain('feat: first');
  });
});
