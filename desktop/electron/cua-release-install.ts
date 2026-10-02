import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { runDependencyProcess } from './dependency-task.js';
import { detectNativeWindowsArchitecture } from './windows-cua-host.js';

/** Official release metadata + extracted file hashes, frozen from tag/commit below.
 * Hashes are product trust anchors, never accepted from the live download response.
 */
export const WINDOWS_CUA_RELEASE = Object.freeze({
  version: '0.31.0',
  tag: 'cua-driver-rs-v0.31.0',
  sourceCommit: '5272e492d61b96caf08e3bf434d91126c1f3dccc',
  archiveRoot: 'cua-driver-rs-0.31.0-windows-x86_64',
  sourceUrl: 'https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.31.0/cua-driver-rs-0.31.0-windows-x86_64.zip',
  sha256: '0c091deff7aa153e69f94c8a19039aaa62f34c9d0c86a23474fe3ea5c3d3b7d1',
  bytes: 30767151,
  signerCertificateSha256: '65EF88B2412945E4DC8F2CDF32C9184DA1D84E538306859C2F437A0EB7EFD96F',
  files: Object.freeze(["cua_driver_abi.h", "cua_driver_node_runtime.node", "cua_driver_sdk.dll", "cua-cursor-theme.exe", "cua-driver-uia.exe", "cua-driver.exe", "LICENSE"]),
  fileHashes: Object.freeze({
  "cua_driver_abi.h": "c17169f41da321baa5e7e953323c3ad660b00790176ba381e93189fba3506587",
  "cua_driver_node_runtime.node": "c2c4836e87126596dfdcc4dcb496dc7184d9b5f2d5ab8f03e086e96624185b27",
  "cua_driver_sdk.dll": "08939b5ff00c4f7825956caec732759604874c4a0bd90fb58a30cd62bbcd0659",
  "cua-cursor-theme.exe": "9b777eb0a7edca13c8bef09a856657e7f28efc4631703747249e985ce50722ba",
  "cua-driver-uia.exe": "87c9ab54f943a3dede6306174ab2bcf373226c167d9f9d92fa13fe85ef2e160a",
  "cua-driver.exe": "88c1e2a65e53e3a01d683c87ea45a25c8aaff7b15b369bec33624d30f51ce50d",
  "LICENSE": "d0a32419a44fa38d5023d1431dfcbedd1457eb5e7b2e6c7c87ca064facb41b41"
}),
});

interface ZipMember { name: string; offset: number; compressedBytes: number; bytes: number; method: number }
const archiveError = () => new Error('cua_archive_invalid');

/** Central directory is checked before any filesystem write. ZIP64/encryption/links are rejected. */
export function parsePinnedReleaseZip(buffer: Buffer): ZipMember[] {
  if (buffer.length < 22 || buffer.length > 64 * 1024 * 1024) throw archiveError();
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw archiveError();
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (count > 100 || count !== buffer.readUInt16LE(end + 8) || directoryOffset + directorySize !== end) throw archiveError();
  const entries: ZipMember[] = [];
  const names = new Set<string>();
  let cursor = directoryOffset;
  let totalBytes = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw archiveError();
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedBytes = buffer.readUInt32LE(cursor + 20);
    const bytes = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const attributes = buffer.readUInt32LE(cursor + 38);
    const local = buffer.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd + extraLength + commentLength > end) throw archiveError();
    const name = buffer.subarray(cursor + 46, nameEnd).toString('utf8');
    const mode = (attributes >>> 16) & 0xf000;
    if (flags & 1 || ![0, 8].includes(method) || name.includes('\\') || name.includes(':') || name.includes('\0')
      || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')
      || (mode !== 0 && mode !== 0x8000) || names.has(name.toLowerCase())) throw archiveError();
    if (local + 30 > directoryOffset || buffer.readUInt32LE(local) !== 0x04034b50) throw archiveError();
    const localNameLength = buffer.readUInt16LE(local + 26);
    const localExtraLength = buffer.readUInt16LE(local + 28);
    const offset = local + 30 + localNameLength + localExtraLength;
    if (buffer.readUInt16LE(local + 8) !== method || buffer.readUInt16LE(local + 6) !== flags
      || buffer.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name
      || offset + compressedBytes > directoryOffset || bytes > 64 * 1024 * 1024) throw archiveError();
    totalBytes += bytes;
    if (totalBytes > 128 * 1024 * 1024) throw archiveError();
    names.add(name.toLowerCase());
    entries.push({ name, offset, compressedBytes, bytes, method });
    cursor = nameEnd + extraLength + commentLength;
  }
  if (cursor !== end) throw archiveError();
  return entries;
}

export async function downloadDependencyAsset(url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const timeout = AbortSignal.timeout(120_000);
  const boundedSignal = AbortSignal.any([signal, timeout]);
  const response = await fetch(url, { signal: boundedSignal });
  if (!response.ok || !response.body) throw new Error(`dependency_download_failed_${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel(); throw new Error('dependency_download_limit');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      boundedSignal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('dependency_download_limit');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  signal.throwIfAborted();
  return Buffer.concat(chunks);
}

export function privateCuaReleaseDirectory(dataRoot: string): string {
  return join(dataRoot, 'runtime', 'cua-driver', WINDOWS_CUA_RELEASE.version);
}

export async function resolveActivePrivateCuaRelease(dataRoot: string): Promise<string | null> {
  try {
    const pointer = join(dataRoot, 'runtime', 'cua-driver', 'active-version.json');
    const stat = await lstat(pointer);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    const active = JSON.parse(await readFile(pointer, 'utf8'));
    if (active.schemaVersion !== 1 || active.version !== WINDOWS_CUA_RELEASE.version || active.archiveSha256 !== WINDOWS_CUA_RELEASE.sha256) return null;
    const directory = privateCuaReleaseDirectory(dataRoot);
    return await verifyPrivateCuaRelease(directory) ? join(directory, 'cua-driver.exe') : null;
  } catch { return null; }
}

export async function verifyPrivateCuaRelease(directory: string, signal?: AbortSignal): Promise<boolean> {
  try {
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) return false;
    for (const name of WINDOWS_CUA_RELEASE.files) {
      signal?.throwIfAborted();
      const file = join(directory, name);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) return false;
      const bytes = await readFile(file);
      if (createHash('sha256').update(bytes).digest('hex') !== WINDOWS_CUA_RELEASE.fileHashes[name as keyof typeof WINDOWS_CUA_RELEASE.fileHashes]) return false;
    }
    signal?.throwIfAborted();
    return true;
  } catch { signal?.throwIfAborted(); return false; }
}

/** Authenticode is the upstream publisher's existing Windows signature method.
 * Fixed hashes are checked first; signature verification runs only on the fixed files.
 */
export async function verifyCuaAuthenticode(directory: string, signal: AbortSignal): Promise<void> {
  if (process.platform !== 'win32') throw new Error('unsupported_platform');
  const script = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; $sha=[System.Security.Cryptography.SHA256]::Create(); foreach($p in $args){ $s=Get-AuthenticodeSignature -LiteralPath $p; if($s.Status -ne 'Valid' -or !$s.SignerCertificate){throw 'cua_signature_invalid'}; $h=([BitConverter]::ToString($sha.ComputeHash($s.SignerCertificate.RawData))).Replace('-',''); if($h -ne '${WINDOWS_CUA_RELEASE.signerCertificateSha256}'){throw 'cua_signature_publisher_mismatch'} }; Write-Output 'cua_signature_valid'`;
  const signedFiles = WINDOWS_CUA_RELEASE.files.filter(name => /\.(exe|dll|node)$/.test(name)).map(name => join(directory, name));
  // A fixed script file avoids PowerShell -Command's argument parsing rules.
  const scriptPath = join(directory, 'verify-signatures.ps1');
  await writeFile(scriptPath, script, { flag: 'wx' });
  try {
    const result = await runDependencyProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...signedFiles], { signal, timeoutMs: 60_000 });
    if (!result.success || !result.output?.includes('cua_signature_valid')) throw new Error('cua_signature_verification_failed');
  } finally { await rm(scriptPath, { force: true }); }
}

/** Windows scanners can hold a just-verified file briefly. Keep the atomic move and bound retries. */
export async function renameCuaInstallArtifact(from: string, to: string, signal: AbortSignal, move: typeof rename = rename): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { await move(from, to); return; }
    catch (error) {
      signal.throwIfAborted();
      const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
      if (attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
      await delay((attempt + 1) * 100, undefined, { signal });
    }
  }
}

/** Installs beside existing versions. Only the small pointer is replaced; no global state. */
export async function installPrivateCuaRelease(dataRoot: string, signal: AbortSignal, offlineArchive?: Buffer): Promise<string> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('unsupported_platform');
  if (await detectNativeWindowsArchitecture(signal) !== 'x64') throw new Error('unsupported_architecture');
  signal.throwIfAborted();
  const root = join(dataRoot, 'runtime', 'cua-driver');
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) throw new Error('cua_install_root_invalid');
  const staging = await mkdtemp(join(root, '.staging-'));
  const directory = privateCuaReleaseDirectory(dataRoot);
  let pointerTemp: string | undefined;
  try {
    const archive = offlineArchive ?? await downloadDependencyAsset(WINDOWS_CUA_RELEASE.sourceUrl, WINDOWS_CUA_RELEASE.bytes, signal);
    if (archive.length !== WINDOWS_CUA_RELEASE.bytes || createHash('sha256').update(archive).digest('hex') !== WINDOWS_CUA_RELEASE.sha256) throw new Error('cua_archive_hash_mismatch');
    const members = parsePinnedReleaseZip(archive);
    if (members.length !== WINDOWS_CUA_RELEASE.files.length) throw archiveError();
    for (const member of members) {
      signal.throwIfAborted();
      const name = member.name.slice(WINDOWS_CUA_RELEASE.archiveRoot.length + 1);
      if (member.name !== `${WINDOWS_CUA_RELEASE.archiveRoot}/${name}` || !WINDOWS_CUA_RELEASE.files.includes(name)) throw archiveError();
      const compressed = archive.subarray(member.offset, member.offset + member.compressedBytes);
      const bytes = member.method === 0 ? compressed : await promisify(inflateRaw)(compressed, { maxOutputLength: 64 * 1024 * 1024 });
      signal.throwIfAborted();
      if (bytes.length !== member.bytes || createHash('sha256').update(bytes).digest('hex') !== WINDOWS_CUA_RELEASE.fileHashes[name as keyof typeof WINDOWS_CUA_RELEASE.fileHashes]) throw new Error('cua_file_hash_mismatch');
      await writeFile(join(staging, name), bytes, { flag: 'wx' });
    }
    await verifyCuaAuthenticode(staging, signal);
    signal.throwIfAborted();
    const existing = await lstat(directory).catch(() => null);
    if (existing) {
      if (!await verifyPrivateCuaRelease(directory, signal)) throw new Error('cua_existing_release_invalid');
    } else { await renameCuaInstallArtifact(staging, directory, signal); }
    signal.throwIfAborted();
    pointerTemp = join(root, `.active-${staging.slice(staging.lastIndexOf('-') + 1)}.json`);
    await writeFile(pointerTemp, JSON.stringify({ schemaVersion: 1, version: WINDOWS_CUA_RELEASE.version, archiveSha256: WINDOWS_CUA_RELEASE.sha256 }), { flag: 'wx' });
    signal.throwIfAborted();
    await renameCuaInstallArtifact(pointerTemp, join(root, 'active-version.json'), signal);
    return join(directory, 'cua-driver.exe');
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    if (pointerTemp) await rm(pointerTemp, { force: true }).catch(() => {});
  }
}
