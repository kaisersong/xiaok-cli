import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPackage } from '@electron/asar';

describe('packaged main freshness verifier', () => {
  let rootDir: string;
  let packageRoot: string;
  let distRoot: string;
  let asarPath: string;
  const relativeMainFile = join('dist', 'main', 'desktop', 'electron', 'kb-tools.js');

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-packaged-main-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    packageRoot = join(rootDir, 'package-root');
    distRoot = join(rootDir, 'current-dist');
    asarPath = join(rootDir, 'app.asar');
    mkdirSync(join(packageRoot, 'dist', 'main', 'desktop', 'electron'), { recursive: true });
    mkdirSync(join(distRoot, 'main', 'desktop', 'electron'), { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true, maxRetries: 3 });
  });

  async function packageMain(contents: string): Promise<void> {
    writeFileSync(join(packageRoot, relativeMainFile), contents);
    await createPackage(packageRoot, asarPath);
  }

  function verify() {
    return spawnSync(process.execPath, [
      join(process.cwd(), 'scripts', 'verify-packaged-main-freshness.cjs'),
      '--asar', asarPath,
      '--dist-root', distRoot,
    ], { encoding: 'utf8' });
  }

  it('accepts an app.asar whose kb-tools bytecode matches the current main build', async () => {
    const contents = 'export const build = "current";\n';
    await packageMain(contents);
    writeFileSync(join(distRoot, 'main', 'desktop', 'electron', 'kb-tools.js'), contents);

    const result = verify();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('packaged main is fresh');
  });

  it('rejects a stale app.asar even when both files are valid JavaScript', async () => {
    await packageMain('export const build = "stale";\n');
    writeFileSync(
      join(distRoot, 'main', 'desktop', 'electron', 'kb-tools.js'),
      'export const build = "current";\n',
    );

    const result = verify();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('stale packaged main');
  });
});
