import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { configureBundledYzjCli, ensureBundledYzjCli } from '../../src/runtime/bundled-yzj-cli.js';
import { bashTool } from '../../src/ai/tools/bash.js';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
function fixture(platform: NodeJS.Platform = process.platform) {
  const root = mkdtempSync(join(tmpdir(), 'xiaok yzj ')); roots.push(root);
  const packageRoot = join(root, 'package'); const configDir = join(root, 'profile');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  const name = platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli';
  const source = join(packageRoot, 'bin', name);
  writeFileSync(source, 'bundled-v1');
  return { root, packageRoot, configDir, source, platform, arch: 'x64' };
}
describe('bundled Yunzhijia CLI', () => {
  it('publishes one complete executable under concurrent real-process initialization', async () => {
    const f = fixture(); writeFileSync(f.source, Buffer.alloc(1024 * 1024, 37));
    let moduleUrl = new URL('../../src/runtime/bundled-yzj-cli.js', import.meta.url).href;
    const loaderArgs = existsSync(fileURLToPath(moduleUrl)) ? [] : ['--import', createRequire(import.meta.url).resolve('tsx')];
    if (loaderArgs.length) moduleUrl = moduleUrl.replace(/\.js$/, '.ts');
    const script = `import {ensureBundledYzjCli} from ${JSON.stringify(moduleUrl)}; ensureBundledYzjCli(JSON.parse(process.argv[1]));`;
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, [...loaderArgs, '--input-type=module', '--eval', script, JSON.stringify(f)])));
    for (const result of results) expect(result.status).toBe('fulfilled');
    const seeded = ensureBundledYzjCli(f);
    expect(readFileSync(seeded.binaryPath)).toEqual(readFileSync(f.source)); expect(readdirSync(seeded.binDir)).toHaveLength(1);
  });
  it.each(['darwin', 'win32'] as const)('seeds a writable %s copy and preserves independent updates', platform => {
    const f = fixture(platform); const first = ensureBundledYzjCli(f);
    expect(readFileSync(first.binaryPath, 'utf8')).toBe('bundled-v1');
    writeFileSync(first.binaryPath, 'self-updated-v2'); writeFileSync(f.source, 'app-upgraded-v1.5');
    expect(ensureBundledYzjCli(f)).toEqual(first);
    expect(readFileSync(first.binaryPath, 'utf8')).toBe('self-updated-v2');
    expect(readFileSync(f.source, 'utf8')).toBe('app-upgraded-v1.5');
    expect(readdirSync(first.binDir)).toEqual([platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli']);
  });
  it('keeps an existing copy usable when the source package binary is missing', () => {
    const f = fixture(); const first = ensureBundledYzjCli(f); rmSync(f.source);
    expect(ensureBundledYzjCli(f)).toEqual(first);
  });
  it('reports missing binaries without changing PATH or preventing startup', () => {
    const f = fixture(); rmSync(f.source); const env = { PATH: '/existing' }; const warn = vi.fn();
    expect(configureBundledYzjCli({ ...f, env, warn })).toBeNull();
    expect(env.PATH).toBe('/existing'); expect(warn).toHaveBeenCalledWith(expect.stringContaining('npm rebuild @yunzhijia/cli'));
  });
  it('fails safely for an unwritable/invalid profile without leaving a partial executable', () => {
    const f = fixture(); writeFileSync(f.configDir, 'not a directory');
    expect(configureBundledYzjCli({ ...f, env: {}, warn: vi.fn() })).toBeNull();
  });
  it('restores a missing Windows executable from .old without downgrading to the bundled seed', () => {
    const f = fixture('win32'); const first = ensureBundledYzjCli(f); rmSync(first.binaryPath);
    writeFileSync(first.binaryPath + '.old', 'updated-recovery');
    ensureBundledYzjCli(f);
    expect(readFileSync(first.binaryPath, 'utf8')).toBe('updated-recovery');
    expect(readFileSync(first.binaryPath + '.old', 'utf8')).toBe('updated-recovery');
  });
  it.runIf(process.platform !== 'win32')('rejects a managed executable symlink rather than following it', () => {
    const f = fixture(); const first = ensureBundledYzjCli(f); rmSync(first.binaryPath); symlinkSync(f.source, first.binaryPath);
    expect(() => ensureBundledYzjCli(f)).toThrow(/symbolic|符号链接/);
    expect(readFileSync(f.source, 'utf8')).toBe('bundled-v1');
  });
  it('prepends only to the provided environment and deduplicates Windows Path ignoring case', () => {
    const f = fixture('win32'); const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows;C:\\tools', HOME: 'unchanged' };
    const first = configureBundledYzjCli({ ...f, env })!;
    expect(env.Path).toBe(`${first.binDir};C:\\Windows;C:\\tools`); expect(env.PATH).toBeUndefined();
    env.Path = env.Path!.toUpperCase(); configureBundledYzjCli({ ...f, env });
    expect(env.Path!.split(';')).toHaveLength(3); expect(env.HOME).toBe('unchanged');
  });
  it.runIf(process.platform !== 'win32')('makes the CLI available through the production bash tool with a minimal PATH', async () => {
    const f = fixture(); writeFileSync(f.source, '#!/bin/sh\nprintf "managed-yzj:%s" "$1"\n'); chmodSync(f.source, 0o755);
    vi.stubEnv('PATH', '/usr/bin:/bin'); configureBundledYzjCli({ ...f, env: process.env });
    expect(await bashTool.execute({ command: 'yzj-cli --version' })).toBe('managed-yzj:--version');
    expect(existsSync(f.source)).toBe(true);
  });
  it.runIf(process.platform === 'win32')('runs the generated Windows cmd launcher through the production bash tool', async () => {
    const f = fixture('win32'); copyFileSync(process.execPath, f.source);
    configureBundledYzjCli({ ...f, env: process.env });
    expect(await bashTool.execute({ command: 'yzj-cli --version' })).toContain(process.version);
  });
});
