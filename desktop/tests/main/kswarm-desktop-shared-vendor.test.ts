import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'desktop', 'scripts', 'sync-shared-vendor.mjs');
const DIST_DIR = join(ROOT, 'dist', 'contract', 'desktop-shared');
const SOURCE_DIR = join(ROOT, 'desktop', 'shared');

function runScript(args: string[] = []) {
  return execFileAsync('node', [SCRIPT, ...args], { cwd: ROOT }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (err: any) => ({ code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }),
  );
}

describe('kswarm desktop-shared vendor sync', () => {
  const distBackup = join(ROOT, 'dist', 'contract', 'desktop-shared-backup-test');

  beforeEach(() => {
    if (existsSync(DIST_DIR)) {
      cpSync(DIST_DIR, distBackup, { recursive: true });
      rmSync(DIST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    rmSync(DIST_DIR, { recursive: true, force: true });
    if (existsSync(distBackup)) {
      mkdirSync(join(ROOT, 'dist', 'contract'), { recursive: true });
      cpSync(distBackup, DIST_DIR, { recursive: true });
      rmSync(distBackup, { recursive: true, force: true });
    }
  });

  it('syncs source to dist and writes .build-meta.json with file hashes', async () => {
    const result = await runScript(['--allow-dirty']);
    expect(result.code === 0 || result.code === 2).toBe(true);
    expect(existsSync(DIST_DIR)).toBe(true);

    const meta = JSON.parse(readFileSync(join(DIST_DIR, '.build-meta.json'), 'utf8'));
    expect(meta.files).toBeDefined();
    expect(Object.keys(meta.files).length).toBeGreaterThan(0);
    expect(meta.generatedAt).toBeDefined();

    const sourceContent = readFileSync(join(SOURCE_DIR, 'kswarm-seed-contract.ts'), 'utf8');
    const distContent = readFileSync(join(DIST_DIR, 'kswarm-seed-contract.ts'), 'utf8');
    expect(distContent).toBe(sourceContent);
  });

  it('is idempotent — running twice produces identical dist hashes', async () => {
    await runScript(['--allow-dirty']);
    const meta1 = JSON.parse(readFileSync(join(DIST_DIR, '.build-meta.json'), 'utf8'));

    await runScript(['--allow-dirty']);
    const meta2 = JSON.parse(readFileSync(join(DIST_DIR, '.build-meta.json'), 'utf8'));

    expect(meta2.files).toEqual(meta1.files);
  });

  it('--verify passes when dist matches source', async () => {
    await runScript(['--allow-dirty']);
    const result = await runScript(['--verify']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[ok]');
  });

  it('--verify fails when dist is missing', async () => {
    const result = await runScript(['--verify']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('does not exist');
  });

  it('--verify fails when dist content diverges from source', async () => {
    await runScript(['--allow-dirty']);
    writeFileSync(join(DIST_DIR, 'kswarm-seed-contract.ts'), '// tampered');
    const result = await runScript(['--verify']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[mismatch]');
  });

  it('--allow-dirty writes to disk but outputs hint and exits 2 when source is dirty', async () => {
    const result = await runScript(['--allow-dirty']);
    if (result.code === 2) {
      expect(result.stdout).toContain('[hint]');
      expect(result.stdout).toContain('NOT staged');
    }
    expect(existsSync(DIST_DIR)).toBe(true);
  });
});
