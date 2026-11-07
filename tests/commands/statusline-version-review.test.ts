import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerVersionCommand } from '../../src/commands/version.js';
import { BUILD_INFO } from '../../src/build-info.js';
import { formatVersionInfo, getInstalledVersion, getVersionInfo } from '../../src/utils/version-info.js';

describe('CLI version production entry and provenance regression', () => {
  afterEach(() => vi.restoreAllMocks());
  it('prints structured provenance through the registered command and uses package fallback', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command(); registerVersionCommand(program);
    await program.parseAsync(['node', 'xiaok', 'version', '--json']);
    const info = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(info).toEqual(getVersionInfo());
    expect(info.version).toBe(BUILD_INFO.version ?? JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version);
    expect(getInstalledVersion()).toBe(info.version);
    expect(info.runtime).toMatchObject({ node: process.version, platform: process.platform, arch: process.arch });
  });

  it('sanitizes control sequences in human-readable version metadata and paths', () => {
    const info = getVersionInfo();
    info.runtime.entry = '/tmp/\x1b[2Jentry\nforged';
    info.build.branch = 'branch\x1b]0;title\x07\rforged';
    const text = formatVersionInfo(info);
    expect(text).toContain('/tmp/entry forged');
    expect(text).not.toContain('\x1b'); expect(text).not.toContain('\r'); expect(text).not.toContain('\x07');
    expect(text.split('\n')).toHaveLength(13);
  });

  it('generates release metadata from the actual script in an isolated checkout and rejects invalid epochs without writing', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-version-review-'));
    try {
      mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'src'));
      copyFileSync(resolve('scripts/set-build-info.mjs'), join(root, 'scripts/set-build-info.mjs'));
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.8.7', type: 'module' }));
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['-c', 'user.name=Review', '-c', 'user.email=review@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], { cwd: root });
      const env = { ...process.env, SOURCE_DATE_EPOCH: '0' };
      const script = join(root, 'scripts/set-build-info.mjs');
      execFileSync(process.execPath, [script, 'release'], { cwd: root, env });
      const generated = readFileSync(join(root, 'src/build-info.ts'), 'utf8');
      const metadata = JSON.parse(generated.match(/BUILD_INFO: BuildMetadata = (\{[\s\S]*\});/)![1]!);
      expect(metadata).toMatchObject({ version: '9.8.7', dirty: false, builtAt: '1970-01-01T00:00:00.000Z', buildType: 'release' });
      expect(metadata.commit).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
      expect(generated).toContain('BUILD_TIME: string | null = null;');
      execFileSync(process.execPath, [script, 'release'], { cwd: root, env });
      expect(readFileSync(join(root, 'src/build-info.ts'), 'utf8')).toBe(generated);
      expect(() => execFileSync(process.execPath, [script, 'release'], { cwd: root, env: { ...env, SOURCE_DATE_EPOCH: 'invalid' }, stdio: 'pipe' })).toThrow();
      expect(readFileSync(join(root, 'src/build-info.ts'), 'utf8')).toBe(generated);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
