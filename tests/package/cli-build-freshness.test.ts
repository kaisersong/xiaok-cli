import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('CLI build freshness', () => {
  it('cleans stale compiled output before TypeScript emits runtime dist', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    for (const scriptName of ['build', 'build:release']) {
      expect(pkg.scripts[scriptName]).toContain('node scripts/clean-cli-build.mjs && tsc');
    }
  });

  it('removes only regenerable CLI build artifacts from the current cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'xiaok-clean-cli-build-'));
    try {
      mkdirSync(join(cwd, 'dist', 'platform', 'mcp'), { recursive: true });
      writeFileSync(join(cwd, 'dist', 'platform', 'mcp', 'config.js'), 'stale output', 'utf8');
      writeFileSync(join(cwd, '.tsbuildinfo'), 'stale incremental cache', 'utf8');

      const result = spawnSync(process.execPath, [join(process.cwd(), 'scripts', 'clean-cli-build.mjs')], {
        cwd,
        encoding: 'utf8',
      });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(existsSync(join(cwd, 'dist'))).toBe(false);
      expect(existsSync(join(cwd, '.tsbuildinfo'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
