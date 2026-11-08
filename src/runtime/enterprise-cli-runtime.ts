import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { getConfigDir } from '../utils/config.js';
import { writeFileAtomicallySync } from '../utils/atomic-file.js';
import { ENTERPRISE_CLI_COMMANDS, ENTERPRISE_CLI_PROVIDERS, getEnterpriseCliArtifact, type EnterpriseCliArtifact, type EnterpriseCliProvider } from './enterprise-cli-catalog.js';

const MAX_DOWNLOAD = 96 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const downloadHosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'registry.npmjs.org', 'registry.npmmirror.com', 'cdn.npmmirror.com']);
function fail(): never { throw Error('enterprise_cli_install_failed'); }
function safeName(name: string): string {
  if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) fail();
  return name.replace(/^\.\//, '');
}
/** Decode only fixed entries into memory; archive paths are never filesystem targets. */
export function extractCliArchive(archive: Buffer, artifact: EnterpriseCliArtifact): { binary: Buffer; license?: Buffer; notice?: Buffer } {
  const wanted = new Map<string, string>([[artifact.entry, 'binary'], [artifact.licenseEntry, 'license']]);
  if (artifact.noticeEntry) wanted.set(artifact.noticeEntry, 'notice');
  const result: Record<string, Buffer> = {};
  const accept = (name: string, data: Buffer, type = '0') => {
    const key = wanted.get(safeName(name));
    if (!key) return;
    if (result[key] || !['0', '\0'].includes(type) || data.length > MAX_EXPANDED) fail();
    result[key] = data;
  };
  if (artifact.format === 'tar.gz') {
    const tar = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED });
    for (let offset = 0; offset + 512 <= tar.length;) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every(byte => byte === 0)) break;
      const name = header.subarray(0, 100).toString().split('\0')[0];
      const prefix = header.subarray(345, 500).toString().split('\0')[0];
      const rawSize = header.subarray(124, 136).toString().replace(/\0.*$/, '').trim();
      if (!/^[0-7]+$/.test(rawSize)) fail();
      const size = parseInt(rawSize, 8);
      if (size > MAX_EXPANDED || offset + 512 + size > tar.length) fail();
      accept(prefix ? `${prefix}/${name}` : name, tar.subarray(offset + 512, offset + 512 + size), String.fromCharCode(header[156]));
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } else {
    // Read the central directory first to reject links, duplicates and oversized entries.
    let end = archive.length - 22;
    while (end >= Math.max(0, archive.length - 65557) && archive.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0 || archive.readUInt32LE(end) !== 0x06054b50) fail();
    const count = archive.readUInt16LE(end + 10); let offset = archive.readUInt32LE(end + 16); let expanded = 0;
    if (count > 1000) fail();
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) fail();
      const nameLength = archive.readUInt16LE(offset + 28);
      const name = safeName(archive.subarray(offset + 46, offset + 46 + nameLength).toString());
      const size = archive.readUInt32LE(offset + 24);
      if (wanted.has(name)) {
        expanded += size;
        if (seen.has(name) || expanded > MAX_EXPANDED || ((archive.readUInt32LE(offset + 38) >>> 16) & 0xf000) === 0xa000) fail();
        seen.add(name);
      }
      offset += 46 + nameLength + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
    }
    const entries = unzipSync(archive, { filter: entry => wanted.has(safeName(entry.name)) });
    for (const [name, data] of Object.entries(entries)) accept(name, Buffer.from(data));
  }
  if (!result.binary?.length) fail();
  return result as { binary: Buffer; license?: Buffer; notice?: Buffer };
}
export interface InstalledEnterpriseCli { binaryPath: string; binDir: string; version: string }
interface Options {
  rootDir?: string; platform?: NodeJS.Platform; arch?: string; fetch?: typeof fetch;
  artifactFor?: typeof getEnterpriseCliArtifact;
}
function regular(file: string): boolean { try { const s = lstatSync(file); return s.isFile() && !s.isSymbolicLink(); } catch { return false; } }
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export class ManagedEnterpriseCliRuntime {
  private readonly root: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly pending = new Map<EnterpriseCliProvider, Promise<InstalledEnterpriseCli>>();
  constructor(private readonly options: Options = {}) {
    this.root = resolve(options.rootDir ?? join(getConfigDir(), 'tools', 'enterprise-cli'));
    this.platform = options.platform ?? process.platform; this.arch = options.arch ?? process.arch;
  }
  private artifact(provider: EnterpriseCliProvider) { return (this.options.artifactFor ?? getEnterpriseCliArtifact)(provider, this.platform, this.arch); }
  supported(provider: EnterpriseCliProvider): boolean { return Boolean(this.artifact(provider)); }
  private location(provider: EnterpriseCliProvider, version: string) {
    const dirs = [this.root, join(this.root, provider), join(this.root, provider, `${this.platform}-${this.arch}`), join(this.root, provider, `${this.platform}-${this.arch}`, version)];
    for (const directory of dirs) if (existsSync(directory)) { const s = lstatSync(directory); if (!s.isDirectory() || s.isSymbolicLink()) fail(); }
    const directory = dirs.at(-1)!;
    return { directory, binaryPath: join(directory, ENTERPRISE_CLI_COMMANDS[provider] + (this.platform === 'win32' ? '.exe' : '')), recordPath: join(directory, 'installed.json'), binDir: join(this.root, 'bin'), version };
  }
  find(provider: EnterpriseCliProvider): InstalledEnterpriseCli | null {
    try {
      const artifact = this.artifact(provider); if (!artifact) return null;
      const location = this.location(provider, artifact.version);
      if (!regular(location.recordPath) || !regular(location.binaryPath) || lstatSync(location.recordPath).size > 4096 || lstatSync(location.binaryPath).size > MAX_EXPANDED) return null;
      const record = JSON.parse(readFileSync(location.recordPath, 'utf8'));
      if (record.version !== artifact.version || !/^[a-f0-9]{64}$/.test(record.sha256) || digest(readFileSync(location.binaryPath)) !== record.sha256) return null;
      return { binaryPath: location.binaryPath, binDir: location.binDir, version: artifact.version };
    } catch { return null; }
  }
  async install(provider: EnterpriseCliProvider, signal: AbortSignal, progress?: (value: number) => void): Promise<InstalledEnterpriseCli> {
    signal.throwIfAborted();
    const installed = this.find(provider); if (installed) return Promise.resolve(installed);
    const pending = this.pending.get(provider); if (pending) return pending;
    const work = this.downloadAndInstall(provider, signal, progress).finally(() => this.pending.delete(provider));
    this.pending.set(provider, work); return work;
  }
  private async download(url: string, signal: AbortSignal, progress?: (value: number) => void): Promise<Buffer> {
    const fetcher = this.options.fetch ?? fetch;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !downloadHosts.has(parsed.hostname)) fail();
      const response = await fetcher(url, { signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) { const next = response.headers.get('location'); await response.body?.cancel(); if (!next) fail(); url = new URL(next, url).href; continue; }
      if (!response.ok || !response.body) fail();
      const total = Number(response.headers.get('content-length'));
      if (total > MAX_DOWNLOAD) { await response.body.cancel(); fail(); }
      const reader = response.body.getReader(); const chunks: Buffer[] = []; let length = 0;
      try {
        for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > MAX_DOWNLOAD) fail(); chunks.push(Buffer.from(part.value)); if (total > 0) progress?.(Math.min(99, Math.floor(length / total * 100))); }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return Buffer.concat(chunks);
    }
    fail();
  }
  private async downloadAndInstall(provider: EnterpriseCliProvider, parentSignal: AbortSignal, progress?: (value: number) => void): Promise<InstalledEnterpriseCli> {
    const artifact = this.artifact(provider); if (!artifact) throw Error('enterprise_cli_unsupported');
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(180000)]);
    let archive: Buffer | undefined;
    for (const url of artifact.urls) {
      try { archive = await this.download(url, signal, progress); break; } catch { signal.throwIfAborted(); }
    }
    if (!archive) fail();
    const split = artifact.checksum.indexOf(':'); const algorithm = artifact.checksum.slice(0, split);
    if (!['sha256', 'sha512'].includes(algorithm)) fail();
    const actual = createHash(algorithm).update(archive).digest(algorithm === 'sha512' ? 'base64' : 'hex');
    if (actual !== artifact.checksum.slice(split + 1)) fail();
    const extracted = extractCliArchive(archive, artifact); const binary = extracted.binary;
    const magic = binary.subarray(0, 4).toString('hex');
    if (this.platform === 'win32' ? binary.subarray(0, 2).toString() !== 'MZ' : this.platform === 'linux' ? magic !== '7f454c46' : !['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca'].includes(magic)) fail();
    signal.throwIfAborted();
    const location = this.location(provider, artifact.version); mkdirSync(location.directory, { recursive: true, mode: 0o700 });
    this.location(provider, artifact.version);
    const staged = join(location.directory, `.install-${randomUUID()}`);
    try {
      writeFileSync(staged, binary, { flag: 'wx', mode: 0o755 });
      try { linkSync(staged, location.binaryPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !regular(location.binaryPath) || digest(readFileSync(location.binaryPath)) !== digest(binary)) throw error; }
      if (extracted.license) writeFileAtomicallySync(join(location.directory, 'LICENSE'), extracted.license.toString());
      if (extracted.notice) writeFileAtomicallySync(join(location.directory, 'NOTICE'), extracted.notice.toString());
      writeFileAtomicallySync(location.recordPath, JSON.stringify({ version: artifact.version, sha256: digest(binary) }));
    } finally { rmSync(staged, { force: true }); }
    this.configurePath(); progress?.(100);
    return { binaryPath: location.binaryPath, binDir: location.binDir, version: artifact.version };
  }
  configurePath(env: NodeJS.ProcessEnv = process.env): void {
    let binDir: string | undefined;
    for (const provider of ENTERPRISE_CLI_PROVIDERS) {
      const installed = this.find(provider); if (!installed) continue;
      const windows = this.platform === 'win32';
      if (/[\r\n\0]/.test(installed.binaryPath) || (windows && installed.binaryPath.includes('"'))) continue;
      binDir = installed.binDir; mkdirSync(binDir, { recursive: true, mode: 0o700 });
      if (lstatSync(binDir).isSymbolicLink()) fail();
      const launcher = join(binDir, ENTERPRISE_CLI_COMMANDS[provider] + (windows ? '.cmd' : ''));
      const content = windows ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${installed.binaryPath.replace(/%/g, '%%')}" %*\r\n` : `#!/bin/sh\nexec '${installed.binaryPath.replace(/'/g, `'"'"'`)}' "$@"\n`;
      writeFileAtomicallySync(launcher, content); if (!windows) chmodSync(launcher, 0o755);
    }
    if (!binDir) return;
    const windows = this.platform === 'win32'; const separator = windows ? ';' : ':';
    const key = windows ? Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH' : 'PATH';
    const normalize = (s: string) => windows ? s.replace(/\\/g, '/').toLowerCase() : s;
    const entries = env[key] === undefined ? [] : env[key]!.split(separator);
    env[key] = [binDir, ...entries.filter(entry => normalize(entry) !== normalize(binDir!))].join(separator);
    if (windows) for (const other of Object.keys(env)) if (other !== key && other.toLowerCase() === 'path') delete env[other];
  }
}
export function configureInstalledEnterpriseClis(): void { try { new ManagedEnterpriseCliRuntime().configurePath(); } catch { /* Optional installations never block app startup. */ } }
