// @vitest-environment node
import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { verifyPackagedYzjCli } = require('../../scripts/verify-packaged-yzj-cli.cjs');
const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });
function fixture(platform = 'win32', arch = 'x64') {
  const packageRoot = mkdtempSync(join(tmpdir(), 'packaged yzj ')); roots.push(packageRoot);
  mkdirSync(join(packageRoot, 'bin')); writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version: '0.1.8' }));
  mkdirSync(join(packageRoot, 'scripts')); writeFileSync(join(packageRoot, 'scripts', 'install.js'), '// fixture');
  const binaryPath = join(packageRoot, 'bin', platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli');
  const binary = Buffer.alloc(128);
  if (platform === 'win32') { binary.write('MZ'); binary.writeUInt32LE(64, 60); binary.write('PE\0\0', 64); binary.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68); }
  else { binary.writeUInt32LE(0xfeedfacf, 0); binary.writeUInt32LE(arch === 'x64' ? 0x01000007 : 0x0100000c, 4); }
  writeFileSync(binaryPath, binary); chmodSync(binaryPath, 0o755);
  return { packageRoot, platform, arch, binaryPath };
}
describe('packaged Yunzhijia CLI', () => {
  it('rejects a package whose download/install hook did not produce a binary', () => {
    const f = fixture(); rmSync(f.binaryPath);
    expect(() => verifyPackagedYzjCli(f)).toThrow(/missing|缺失/);
  });
  it('rejects a host-platform binary in a Windows installer', () => {
    const f = fixture(); writeFileSync(f.binaryPath, Buffer.from('cffaedfe0c000001', 'hex'));
    expect(() => verifyPackagedYzjCli(f)).toThrow(/target|目标/);
  });
  it('rejects an arm64 binary in an x64 installer', () => {
    const f = fixture('win32', 'arm64');
    expect(() => verifyPackagedYzjCli({ ...f, arch: 'x64' })).toThrow(/target|目标/);
  });
  it('executes only a matching native target, checks the pinned version, and fails on a broken executable', () => {
    const f = fixture(process.platform, process.arch); const run = vi.fn(() => ({ status: 0, stdout: 'yzj-cli 0.1.8\n' }));
    expect(verifyPackagedYzjCli({ ...f, run }).runtimeVerified).toBe(true);
    expect(run).toHaveBeenCalledWith(f.binaryPath, ['--version'], expect.objectContaining({ shell: false, timeout: 10000 }));
    run.mockReturnValue({ status: 0, stdout: 'yzj-cli 0.1.7' });
    expect(() => verifyPackagedYzjCli({ ...f, run })).toThrow(/version|版本/);
    run.mockReturnValue({ status: 1, stdout: '' });
    expect(() => verifyPackagedYzjCli({ ...f, run })).toThrow(/version|版本/);
  });
  it('ships the pinned official dependency, unpacked executable, skill, and afterPack gate', () => {
    const desktop = resolve(process.cwd());
    const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
    const root = JSON.parse(readFileSync(join(desktop, '..', 'package.json'), 'utf8'));
    const builder = JSON.parse(readFileSync(join(desktop, 'electron-builder.json'), 'utf8'));
    expect(pkg.dependencies['@yunzhijia/cli']).toBe('0.1.8'); expect(root.dependencies['@yunzhijia/cli']).toBe('0.1.8');
    expect(builder.asarUnpack).toContain('**/node_modules/@yunzhijia/cli/**');
    expect(builder.extraResources).toContainEqual({ from: '../data/skills/yzj-cli', to: 'skills/yzj-cli' });
    expect(builder.extraResources).toContainEqual({ from: '../data/yzj-cli', to: 'yzj-cli' });
    expect(readFileSync(join(desktop, 'scripts', 'after-pack.cjs'), 'utf8')).toContain('await verifyPackagedYzjCli(context)');
  });
});
