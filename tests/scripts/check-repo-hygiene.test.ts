import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
const {
  evaluateRepoHealth,
  parseStatusPorcelain,
} = await import(pathToFileURL(resolve(process.cwd(), 'scripts/check-repo-hygiene.mjs')).href);

describe('parseStatusPorcelain', () => {
  it('parses porcelain lines into entries', () => {
    const entries = parseStatusPorcelain(` M README.md\n?? .xiaok/state/capability-health.json\nD  test.txt\n`);

    expect(entries).toEqual([
      { code: ' M', path: 'README.md' },
      { code: '??', path: '.xiaok/state/capability-health.json' },
      { code: 'D ', path: 'test.txt' },
    ]);
  });
});

describe('evaluateRepoHealth', () => {
  it('fails when master is dirty and behind origin/master', () => {
    const report = evaluateRepoHealth({
      repoRoot: '/repo',
      branch: 'master',
      ahead: 0,
      behind: 2,
      entries: parseStatusPorcelain(' M README.md\n'),
      globalXiaokTarget: '/repo',
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toContain('master is behind origin/master by 2 commit(s)');
    expect(report.issues).toContain('master has tracked working tree changes');
  });

  it('treats ignored runtime noise as a warning, not a blocking work item', () => {
    const report = evaluateRepoHealth({
      repoRoot: '/repo',
      branch: 'feature/runtime',
      ahead: 1,
      behind: 0,
      entries: parseStatusPorcelain('?? .xiaok/state/capability-health.json\n?? .DS_Store\n'),
      globalXiaokTarget: '/repo/.worktrees/feature-runtime',
    });

    expect(report.ok).toBe(true);
    expect(report.warnings).toContain('runtime noise detected: .xiaok/state/capability-health.json, .DS_Store');
  });

  it('warns when the global xiaok link points away from the clean master repo', () => {
    const report = evaluateRepoHealth({
      repoRoot: '/repo',
      branch: 'master',
      ahead: 0,
      behind: 0,
      entries: [],
      globalXiaokTarget: '/repo/.worktrees/runtime-first-phase1',
    });

    expect(report.ok).toBe(true);
    expect(report.warnings).toContain(
      'global xiaok points to /repo/.worktrees/runtime-first-phase1 instead of /repo',
    );
  });
});
