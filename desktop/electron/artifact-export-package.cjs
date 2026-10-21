'use strict';
// Build freshness metadata is not an authorization proof. Runtime binaries may
// have been changed by the normal platform signing phase after afterPack.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const TARGETS = new Set(['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64']);
const SOURCES = ['go.mod','main.go','identity_unix.go','identity_windows.go'];
const MAX_BINARY = 16 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function requireValue(value, message) { if (!value) throw new Error(`artifact export package: ${message}`); }
function targetName(platform, arch) {
  const target = `${platform}-${arch}`;
  requireValue(TARGETS.has(target), 'unsupported target');
  return target;
}
function keys(value, expected) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0'), 'invalid schema');
}
function digest(value) { requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'invalid hash'); }
function size(value, max) { requireValue(Number.isSafeInteger(value) && value > 0 && value <= max, 'invalid size'); }
function assertDirectories(directory) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = fs.lstatSync(current);
    requireValue(info.isDirectory() && !info.isSymbolicLink(), 'non-directory or symbolic ancestor');
  }
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs; }
function capture(file, max) {
  assertDirectories(path.dirname(file));
  const before = fs.lstatSync(file, { bigint: true });
  requireValue(before.isFile() && !before.isSymbolicLink() && before.size <= BigInt(max), 'invalid regular file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    requireValue(sameFile(before, fs.fstatSync(fd, { bigint: true })), 'file changed while opening');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      requireValue(count > 0, 'file shortened'); offset += count;
    }
    requireValue(fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) === 0, 'file grew');
    requireValue(sameFile(before, fs.fstatSync(fd, { bigint: true })) && sameFile(before, fs.lstatSync(file, { bigint: true })), 'file changed while reading');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function manifestSchema(bytes, target) {
  const m = JSON.parse(bytes.toString('utf8'));
  keys(m, ['version','target','filename','size','sha256','license','sourceHashes','toolchainArchive','compilerVersion','compilerSha256','arguments','executedOnTarget']);
  const filename = target.startsWith('win32-') ? 'artifact-export-helper.exe' : 'artifact-export-helper';
  requireValue(m.version === 3 && m.target === target && m.filename === filename && m.executedOnTarget === false, 'manifest target/version mismatch');
  size(m.size, MAX_BINARY); digest(m.sha256); digest(m.compilerSha256);
  keys(m.license, ['size','sha256']); size(m.license.size, 65536); digest(m.license.sha256);
  keys(m.sourceHashes, SOURCES); SOURCES.forEach(name => digest(m.sourceHashes[name]));
  keys(m.toolchainArchive, ['filename','size','sha256','lockSha256']);
  size(m.toolchainArchive.size, 256 * 1024 * 1024); digest(m.toolchainArchive.sha256); digest(m.toolchainArchive.lockSha256);
  requireValue(typeof m.toolchainArchive.filename === 'string' && /^go1\.27\.1\.(darwin|linux|windows)-(arm64|amd64)\.(tar\.gz|zip)$/.test(m.toolchainArchive.filename), 'invalid SDK archive');
  requireValue(typeof m.compilerVersion === 'string' && /^go version go1\.27\.1 (darwin|linux|windows)\/(arm64|amd64)$/.test(m.compilerVersion), 'invalid compiler');
  requireValue(JSON.stringify(m.arguments) === JSON.stringify(['build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',filename,'.']), 'invalid build arguments');
  return m;
}
function executableFormat(bytes, target) {
  const arm = target.endsWith('-arm64');
  requireValue(bytes.length >= 64, 'truncated executable');
  if (target.startsWith('darwin-')) {
    requireValue(bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(12) === 2 && bytes.readUInt32LE(4) === (arm ? 0x0100000c : 0x01000007), 'wrong Mach-O CPU');
  } else if (target.startsWith('linux-')) {
    requireValue(bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])) && bytes[4] === 2 && bytes[5] === 1 && [2,3].includes(bytes.readUInt16LE(16)) && bytes.readUInt16LE(18) === (arm ? 183 : 62), 'wrong ELF CPU');
  } else {
    const pe = bytes.readUInt32LE(0x3c);
    requireValue(bytes.readUInt16LE(0) === 0x5a4d && pe >= 64 && pe <= bytes.length - 26 && bytes.readUInt32LE(pe) === 0x4550 && (bytes.readUInt16LE(pe + 22) & 0x2002) === 2 && bytes.readUInt16LE(pe + 4) === (arm ? 0xaa64 : 0x8664) && bytes.readUInt16LE(pe + 24) === 0x20b, 'wrong PE CPU');
  }
}
function directoryNames(directory, maximum) {
  const handle = fs.opendirSync(directory), names = [];
  try {
    let entry;
    while ((entry = handle.readSync()) !== null) {
      requireValue(names.length < maximum, 'unexpected package files');
      names.push(entry.name);
    }
    return names.sort();
  } finally { handle.closeSync(); }
}
function capturePackage(directory, target) {
  assertDirectories(directory);
  const manifestBytes = capture(path.join(directory, 'manifest.json'), 65536);
  const manifest = manifestSchema(manifestBytes, target);
  const binary = capture(path.join(directory, manifest.filename), MAX_BINARY);
  const license = capture(path.join(directory, 'GO-LICENSE'), 65536);
  requireValue(directoryNames(directory, 3).join('\0') === ['GO-LICENSE',manifest.filename,'manifest.json'].sort().join('\0'), 'unexpected package files');
  requireValue(license.length === manifest.license.size && sha(license) === manifest.license.sha256, 'license mismatch');
  executableFormat(binary, target);
  return {manifest, manifestBytes, binary, license};
}
function captureBuild(repoRoot, target) {
  try { return captureBuildInputs(repoRoot, target); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`artifact export package: missing ${target} build input; from repository root ${path.resolve(repoRoot)}, prepare with node scripts/verification/build-artifact-export-helper.mjs --target ${target} --toolchain-archive <official Go 1.27.1 host SDK archive>`, {cause:error});
    throw error;
  }
}
function captureBuildInputs(repoRoot, target) {
  requireValue(TARGETS.has(target), 'unsupported target');
  const build = path.join(repoRoot, '.artifacts', 'artifact-export-helper', target);
  const pointer = JSON.parse(capture(path.join(build, 'current.json'), 4096).toString('utf8'));
  keys(pointer, ['version','generation','manifestSha256']); digest(pointer.manifestSha256);
  requireValue(pointer.version === 1 && typeof pointer.generation === 'string' && /^generation-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(pointer.generation), 'invalid generation');
  const directory = path.join(build, pointer.generation), captured = capturePackage(directory, target), m = captured.manifest;
  requireValue(sha(captured.manifestBytes) === pointer.manifestSha256, 'manifest mismatch');
  requireValue(captured.binary.length === m.size && sha(captured.binary) === m.sha256, 'binary mismatch');
  for (const name of SOURCES) requireValue(sha(capture(path.join(repoRoot,'desktop','native','artifact-export-helper',name), 1024 * 1024)) === m.sourceHashes[name], 'stale helper source');
  const lockBytes = capture(path.join(repoRoot,'scripts','verification','artifact-export-toolchain.lock.json'), 65536);
  requireValue(sha(lockBytes) === m.toolchainArchive.lockSha256, 'stale SDK lock');
  const lock = JSON.parse(lockBytes.toString('utf8'));
  requireValue(lock.version === 'go1.27.1' && lock.hosts && Object.entries(lock.hosts).some(([host, entry]) => {
    const compiler = host.replace('win32','windows').replace('x64','amd64').replace('-', '/');
    return entry.filename === m.toolchainArchive.filename && entry.sha256 === m.toolchainArchive.sha256 && entry.size === m.toolchainArchive.size && m.compilerVersion === `go version go1.27.1 ${compiler}`;
  }), 'SDK not in current official lock');
  return {...captured, directory};
}
function installArtifactExportPackage(repoRoot, target, resourcesRoot) {
  const captured = captureBuild(repoRoot, target);
  fs.mkdirSync(resourcesRoot, {recursive: true}); assertDirectories(resourcesRoot);
  const parent = path.join(resourcesRoot, 'artifact-export-helper');
  fs.mkdirSync(parent, {recursive: true}); assertDirectories(parent);
  directoryNames(parent, 0); // Owned output must contain only this target, never old generations.
  fs.chmodSync(parent, 0o755); // System installations must be readable by ordinary users.
  const destination = path.join(parent, target);
  try { fs.lstatSync(destination); throw new Error('artifact export package: destination occupied'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = fs.mkdtempSync(path.join(parent, '.staging-'));
  let published = false;
  try {
    for (const [name, bytes, mode] of [[captured.manifest.filename,captured.binary,0o755],['manifest.json',captured.manifestBytes,0o644],['GO-LICENSE',captured.license,0o644]]) {
      const file = path.join(staging, name);
      fs.writeFileSync(file, bytes, {flag:'wx',mode}); fs.chmodSync(file, mode);
      requireValue(capture(file, MAX_BINARY).equals(bytes), 'staged bytes changed');
    }
    const executable = path.join(destination, captured.manifest.filename);
    // All bytes are verified before making this public program traversable.
    fs.chmodSync(staging, 0o755);
    fs.renameSync(staging, destination); published = true;
    return {executable};
  } finally { if (!published) fs.rmSync(staging, {recursive:true, force:true}); }
}
function resolveInstalledArtifactExportHelper(resourcesRoot, platform, arch) {
  requireValue(path.isAbsolute(resourcesRoot), 'resources path must be absolute');
  const target = targetName(platform, arch), directory = path.join(resourcesRoot, 'artifact-export-helper', target);
  // Signing can change binary size/hash; CPU/format and bounded regular-file checks remain.
  const captured = capturePackage(directory, target);
  return path.join(directory, captured.manifest.filename);
}
function resolveDevelopmentArtifactExportHelper(repoRoot, platform, arch) {
  requireValue(path.isAbsolute(repoRoot), 'repository path must be absolute');
  const captured = captureBuild(repoRoot, targetName(platform, arch));
  return path.join(captured.directory, captured.manifest.filename);
}
module.exports = {installArtifactExportPackage, resolveInstalledArtifactExportHelper, resolveDevelopmentArtifactExportHelper};
