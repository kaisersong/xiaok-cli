import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import { createSkillCatalogWatcher } from '../../../src/ai/skills/watcher.js';
import { waitFor } from '../../support/wait-for.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path, { recursive: true });
  tempDirs.push(path);
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createSkillCatalogWatcher', () => {
  it('reloads directory-style skills when a new project skill appears', async () => {
    const configDir = createTempDir('xiaok-skill-watch-config');
    const projectDir = createTempDir('xiaok-skill-watch-project');
    mkdirSync(join(projectDir, '.xiaok', 'skills'), { recursive: true });

    const catalog = createSkillCatalog(configDir, projectDir, { builtinRoots: [] });
    await catalog.reload();

    const snapshots: string[][] = [];
    const watcher = createSkillCatalogWatcher({
      xiaokConfigDir: configDir,
      cwd: projectDir,
      options: { builtinRoots: [] },
      pollMs: 50,
      onChange: async () => {
        snapshots.push((await catalog.reload()).map((skill) => skill.name));
      },
    });

    try {
      const skillDir = join(projectDir, '.xiaok', 'skills', 'release-checklist');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), `---
name: release-checklist
description: release readiness
---
Check release readiness.
`, 'utf8');

      await waitFor(() => {
        expect(snapshots.some((snapshot) => snapshot.includes('release-checklist'))).toBe(true);
      }, { timeoutMs: 3_000 });
    } finally {
      watcher.close();
    }
  });

  it('reloads flat-file skills when an existing project skill is removed', async () => {
    const configDir = createTempDir('xiaok-skill-watch-config');
    const projectDir = createTempDir('xiaok-skill-watch-project');
    const skillsDir = join(projectDir, '.xiaok', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    const skillPath = join(skillsDir, 'summary.md');
    writeFileSync(skillPath, `---
name: summary
description: summarize a single update
---
Summarize one update.
`, 'utf8');

    const catalog = createSkillCatalog(configDir, projectDir, { builtinRoots: [] });
    await catalog.reload();
    expect(catalog.get('summary')).toBeTruthy();

    const snapshots: string[][] = [];
    const watcher = createSkillCatalogWatcher({
      xiaokConfigDir: configDir,
      cwd: projectDir,
      options: { builtinRoots: [] },
      pollMs: 50,
      onChange: async () => {
        snapshots.push((await catalog.reload()).map((skill) => skill.name));
      },
    });

    try {
      unlinkSync(skillPath);

      await waitFor(() => {
        expect(snapshots.some((snapshot) => !snapshot.includes('summary'))).toBe(true);
      }, { timeoutMs: 3_000 });
    } finally {
      watcher.close();
    }
  });
});
