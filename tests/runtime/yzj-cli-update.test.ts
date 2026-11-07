import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const helper = resolve(process.cwd(), 'data/yzj-cli/runner.cjs');
const { updateCli, isManagedUpdate } = require(existsSync(helper) ? helper : resolve(process.cwd(), '../data/yzj-cli/runner.cjs'));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
function fixture(platform = process.platform) {
 const root = mkdtempSync(join(tmpdir(), 'yzj update ')); roots.push(root);
 const binaryPath = join(root, platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli'); writeFileSync(binaryPath, '0.1.8');
 const fetchMetadata = vi.fn(async () => ({ version: '0.1.9' }));
 const install = vi.fn(async ({ destination, version }: any) => { writeFileSync(destination, version); });
 const readVersion = (file: string) => readFileSync(file, 'utf8');
 return { root, binaryPath, platform, deps: { fetchMetadata, install, readVersion, log: vi.fn() } };
}
describe('managed Yunzhijia CLI update owner', () => {
 it('intercepts only valid update commands, leaving help, invalid flags, and product args to native parsing', () => {
  for (const args of [['update'], ['update', '--force'], ['--profile', 'work', 'update']]) expect(isManagedUpdate(args)).toBe(true);
  for (const args of [['update', '--help'], ['update', '--invalid'], ['im', 'message', 'send', '--content', 'update'], ['--profile']]) expect(isManagedUpdate(args)).toBe(false);
 });
 it.each(['darwin', 'win32'])('installs, validates and retains an independent update on %s', async platform => {
  const f = fixture(platform); await updateCli(f, f.deps);
  expect(readFileSync(f.binaryPath, 'utf8')).toBe('0.1.9'); expect(f.deps.install).toHaveBeenCalledOnce();
  expect(readdirSync(f.root)).toEqual([platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli']);
 });
 it('does not download or downgrade when the user copy is already newer', async () => {
  const f = fixture(); writeFileSync(f.binaryPath, '0.2.0'); await updateCli(f, f.deps);
  expect(f.deps.install).not.toHaveBeenCalled(); expect(readFileSync(f.binaryPath, 'utf8')).toBe('0.2.0');
 });
 it('force reinstalls the current version', async () => {
  const f = fixture(); f.deps.fetchMetadata.mockResolvedValue({ version: '0.1.8' });
  await updateCli({ ...f, force: true }, f.deps); expect(f.deps.install).toHaveBeenCalledOnce();
 });
 it('cleans a stale Windows recovery file after validating both active and new versions', async () => {
  const f = fixture('win32'); writeFileSync(f.binaryPath + '.old', '0.1.7');
  await updateCli(f, f.deps); expect(readFileSync(f.binaryPath, 'utf8')).toBe('0.1.9');
  expect(existsSync(f.binaryPath + '.old')).toBe(false);
 });
 it('retains the previous binary and removes owned staging/lock after a failed or invalid download', async () => {
  const f = fixture(); f.deps.install.mockRejectedValue(new Error('download failed'));
  await expect(updateCli(f, f.deps)).rejects.toThrow('download failed'); expect(readFileSync(f.binaryPath, 'utf8')).toBe('0.1.8');
  f.deps.install.mockImplementation(async ({ destination }: any) => { writeFileSync(destination, '0.0.1'); });
  await expect(updateCli(f, f.deps)).rejects.toThrow(/version|版本/); expect(readFileSync(f.binaryPath, 'utf8')).toBe('0.1.8');
  expect(readdirSync(f.root)).toHaveLength(1);
 });
 it('rejects malformed registry metadata before invoking the installer', async () => {
  const f = fixture(); f.deps.fetchMetadata.mockResolvedValue({ version: '../invalid' });
  await expect(updateCli(f, f.deps)).rejects.toThrow(/version|版本/); expect(f.deps.install).not.toHaveBeenCalled();
 });
 it('rejects concurrent updates and preserves an existing lock', async () => {
  const f = fixture(); const lock = join(f.root, '.update-lock'); mkdirSync(lock);
  await expect(updateCli(f, f.deps)).rejects.toThrow(/更新|update/);
  expect(existsSync(lock)).toBe(true); expect(f.deps.install).not.toHaveBeenCalled();
 });
});
