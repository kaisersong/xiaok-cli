// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, existsSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManagedEnterpriseCliRuntime, extractCliArchive } from '../../../src/runtime/enterprise-cli-runtime.js';
import { getEnterpriseCliArtifact } from '../../../src/runtime/enterprise-cli-catalog.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });
function root() { const path = mkdtempSync(join(tmpdir(), 'xiaok-enterprise-')); dirs.push(path); return path; }
function tar(entries: Array<{ name: string; data: Buffer; type?: string }>) {
 const parts: Buffer[] = [];
 for (const entry of entries) {
  const h = Buffer.alloc(512); h.write(entry.name); h.write(entry.data.length.toString(8).padStart(11, '0') + '\0', 124); h[156] = (entry.type ?? '0').charCodeAt(0);
  parts.push(h, entry.data, Buffer.alloc((512 - entry.data.length % 512) % 512));
 }
 return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
function fixture() {
 const binary = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]);
 const archive = tar([{ name: './dws', data: binary }, { name: './LICENSE', data: Buffer.from('Apache-2.0') }]);
 const artifact = { version: '1.0.67', urls: ['https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/download/v1.0.67/dws-darwin-arm64.tar.gz'], checksum: 'sha256:' + createHash('sha256').update(archive).digest('hex'), format: 'tar.gz' as const, entry: 'dws', licenseEntry: 'LICENSE' };
 const fetch = vi.fn(async () => new Response(archive)); const rootDir = root();
 const runtime = new ManagedEnterpriseCliRuntime({ rootDir, platform: 'darwin', arch: 'arm64', fetch: fetch as any, artifactFor: () => artifact });
 return { runtime, fetch, rootDir, archive, artifact, binary };
}
describe('on-demand enterprise CLI installation', () => {
 it('does not download or create install directories while inspecting or configuring PATH', () => {
  const f = fixture(); expect(f.runtime.find('dingtalk')).toBeNull(); const env = { PATH: '/usr/bin' }; f.runtime.configurePath(env); expect(env.PATH).toBe('/usr/bin'); expect(f.fetch).not.toHaveBeenCalled();
 });
 it('verifies and publishes one complete native executable and restores it without a download', async () => {
  const f = fixture(); const installed = await f.runtime.install('dingtalk', new AbortController().signal);
  expect(readFileSync(installed.binaryPath)).toEqual(f.binary); expect(f.runtime.find('dingtalk')?.version).toBe('1.0.67');
  await f.runtime.install('dingtalk', new AbortController().signal); expect(f.fetch).toHaveBeenCalledTimes(1);
  const env = { PATH: '/usr/bin' }; f.runtime.configurePath(env); expect(env.PATH).toBe(installed.binDir + ':/usr/bin'); expect(existsSync(join(installed.binDir, 'dws'))).toBe(true);
 });
 it('rejects a checksum mismatch without publishing a binary', async () => {
  const f = fixture(); f.fetch.mockResolvedValue(new Response('corrupt')); await expect(f.runtime.install('dingtalk', new AbortController().signal)).rejects.toThrow(); expect(f.runtime.find('dingtalk')).toBeNull();
 });
 it('refuses redirects to untrusted or plaintext destinations', async () => {
  const f = fixture(); for (const location of ['https://evil.example/cli','http://github.com/file']) {
   f.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location } })); await expect(f.runtime.install('dingtalk', new AbortController().signal)).rejects.toThrow();
  }
 });
 it('does not publish an aborted download and rejects unsupported platforms', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort(); await expect(f.runtime.install('dingtalk', controller.signal)).rejects.toThrow(); expect(f.runtime.find('dingtalk')).toBeNull();
  expect(getEnterpriseCliArtifact('wecom', 'win32', 'arm64')).toBeUndefined();
  expect(getEnterpriseCliArtifact('dingtalk', 'win32', 'x64')?.entry).toBe('dws.exe');
  expect(getEnterpriseCliArtifact('feishu', 'darwin', 'arm64')?.format).toBe('tar.gz');
 });
 it.each(['../dws', '/dws'])('rejects an escaping archive entry %s', name => {
  const f = fixture(); expect(() => extractCliArchive(tar([{ name, data: f.binary }]), f.artifact)).toThrow();
 });
 it('extracts Windows ZIP entries and rejects oversized entries without writing archive paths', () => {
  const f = fixture(); const artifact = { ...f.artifact, format: 'zip' as const, entry: 'dws.exe' };
  const archive = Buffer.from(zipSync({ 'dws.exe': Buffer.from('MZ-test'), LICENSE: Buffer.from('license') }));
  expect(extractCliArchive(archive, artifact).binary.toString()).toBe('MZ-test');
  const central = archive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); archive.writeUInt32LE(300 * 1024 * 1024, central + 24);
  expect(() => extractCliArchive(archive, artifact)).toThrow();
 });
 it('restores a Windows cmd launcher with escaped paths and one case-insensitive PATH key', async () => {
  const rootDir = join(root(), 'percent% tools'); const binary = Buffer.from('MZ-test'); const archive = Buffer.from(zipSync({ 'dws.exe': binary }));
  const artifact = { version:'1.0.67',urls:['https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/download/v1.0.67/dws-windows-amd64.zip'],checksum:'sha256:'+createHash('sha256').update(archive).digest('hex'),format:'zip' as const,entry:'dws.exe',licenseEntry:'LICENSE' };
  const runtime = new ManagedEnterpriseCliRuntime({rootDir,platform:'win32',arch:'x64',fetch:vi.fn(async()=>new Response(archive)) as any,artifactFor:()=>artifact});
  const installed = await runtime.install('dingtalk',new AbortController().signal);const env={Path:'C:\\Windows',PATH:'ignored'};runtime.configurePath(env);
  const launcher=readFileSync(join(installed.binDir,'dws.cmd'),'utf8');expect(launcher).toContain('DisableDelayedExpansion');expect(launcher).toContain('percent%% tools');expect(env.Path).toContain(installed.binDir+';');expect(Object.keys(env).filter(key=>key.toLowerCase()==='path')).toHaveLength(1);
 });
 it('deduplicates concurrent downloads and rejects oversized HTTP bodies before publication', async () => {
  const f = fixture(); await Promise.all([f.runtime.install('dingtalk', new AbortController().signal), f.runtime.install('dingtalk', new AbortController().signal)]); expect(f.fetch).toHaveBeenCalledOnce();
  const next = fixture(); next.fetch.mockResolvedValue(new Response('too big', {headers:{'content-length':String(100 * 1024 * 1024)}})); await expect(next.runtime.install('dingtalk',new AbortController().signal)).rejects.toThrow(); expect(next.runtime.find('dingtalk')).toBeNull();
 });
 it('rejects missing, duplicate, and link binary entries', () => {
  const f = fixture(); for (const entries of [[], [{ name: 'dws', data: f.binary }, { name: './dws', data: f.binary }], [{ name: 'dws', data: f.binary, type: '2' }]]) expect(() => extractCliArchive(tar(entries), f.artifact)).toThrow();
 });
});
