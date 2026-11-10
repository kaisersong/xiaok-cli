'use strict';
const fs = require('node:fs');
const {join, resolve} = require('node:path');
const {types} = require('node:util');
const {release: hostRelease} = require('node:os');
const rawLock = require('../resources/broker-runtime-lock.json');
// Capture private immutable policy; exporting a profile must not let a caller
// mutate future verification through the shared JSON require cache.
const lock = Object.freeze({...rawLock,targets:Object.freeze(Object.fromEntries(Object.entries(rawLock.targets).map(([name,entry])=>[name,Object.freeze({...entry})])))});
const {readPackageFile, assertRuntimeFileReadsKnown} = require('./broker-runtime-file.cjs');
const blocked = new Set(['XIAOK_NODE_CMD', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']);
const manifestKeys = ['schema', 'target', 'node', 'sqlite', 'executable', 'archiveSha256', 'executableSha256', 'executableSize', 'licenseSha256', 'licenseSize'];
function targetEntry(target) {
  if (!Object.hasOwn(lock.targets, target)) return null;
  const entry = lock.targets[target];
  if (lock.schema !== 'xiaok-broker-runtime-lock/v1' || lock.node !== '24.19.0' || lock.sqlite !== '3.53.3') throw Error('broker_runtime_lock');
  const prefix = `node-v${lock.node}-${target === 'darwin-arm64' ? 'darwin-arm64' : 'win-x64'}`;
  const exe = target === 'darwin-arm64' ? 'node' : 'node.exe';
  if (!['darwin-arm64', 'win32-x64'].includes(target) || entry.archive !== `${prefix}.${target === 'darwin-arm64' ? 'tar.gz' : 'zip'}` || entry.executable !== exe || entry.member !== `${prefix}/${target === 'darwin-arm64' ? 'bin/' : ''}${exe}` || entry.license !== `${prefix}/LICENSE`) throw Error('broker_runtime_lock');
  if(target==='darwin-arm64'&&entry.minimumDarwinRelease!=='22.6.0')throw Error('broker_runtime_lock');
  for (const key of ['archiveSha256', 'executableSha256', 'licenseSha256']) if (!/^[a-f0-9]{64}$/.test(entry[key])) throw Error('broker_runtime_lock');
  for (const key of ['archiveSize', 'executableSize', 'licenseSize']) if (!Number.isSafeInteger(entry[key]) || entry[key] < 1) throw Error('broker_runtime_lock');
  return entry;
}
function samePath(a, b, platform = process.platform) {
  const x = resolve(a), y = resolve(b);
  return platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
function directory(path) {
  const stat = fs.lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('broker_runtime_alias');
}
function packageDirectory(resourcesPath, target) {
  let path = fs.realpathSync(resourcesPath);
  directory(path);
  for (const part of ['services', 'intent-broker', 'runtime', target]) { path = join(path, part); directory(path); }
  if (!samePath(fs.realpathSync(path), path)) throw Error('broker_runtime_alias');
  return path;
}
function expectedManifest(target) {
  const entry = targetEntry(target);
  if (!entry) throw Error('broker_runtime_target');
  return {schema: 'xiaok-broker-runtime/v1', target, node: lock.node, sqlite: lock.sqlite, executable: entry.executable, archiveSha256: entry.archiveSha256, executableSha256: entry.executableSha256, executableSize: entry.executableSize, licenseSha256: entry.licenseSha256, licenseSize: entry.licenseSize};
}
function verifyRuntimeDirectory(dir, target) {
  assertRuntimeFileReadsKnown(); directory(dir);
  const expected = expectedManifest(target), entry = targetEntry(target);
  const actual = JSON.parse(readPackageFile(join(dir, 'manifest.json'), 8192).bytes.toString('utf8'));
  if (!actual || typeof actual !== 'object' || Array.isArray(actual) || Object.keys(actual).length !== manifestKeys.length || manifestKeys.some(key => !Object.hasOwn(actual, key) || actual[key] !== expected[key])) throw Error('broker_runtime_manifest');
  readPackageFile(join(dir, entry.executable), entry.executableSize, {size: entry.executableSize, sha256: entry.executableSha256});
  readPackageFile(join(dir, 'LICENSE'), entry.licenseSize, {size: entry.licenseSize, sha256: entry.licenseSha256});
  return Object.freeze({command: join(dir, entry.executable), expected: Object.freeze({node: lock.node, sqlite: lock.sqlite, executableSha256: entry.executableSha256})});
}
function sanitizeRuntimeEnv(env) {
  if (!env || typeof env !== 'object' || types.isProxy(env)) throw Error('broker_runtime_env');
  const copy = Object.create(null);
  for (const key of Reflect.ownKeys(env)) {
    if (typeof key !== 'string') throw Error('broker_runtime_env');
    const value = Object.getOwnPropertyDescriptor(env, key);
    if (!value || !Object.hasOwn(value, 'value') || (typeof value.value !== 'string' && value.value !== undefined)) throw Error('broker_runtime_env');
    const name = key.toUpperCase();
    if (blocked.has(name) || name.startsWith('LD_') || name.startsWith('DYLD_')) continue;
    if (value.value !== undefined) copy[key] = value.value;
  }
  return copy;
}
function resolvePackagedBrokerRuntime(options) {
  if (!options.isPackaged) return null;
  const target = `${options.platform ?? process.platform}-${options.arch ?? process.arch}`;
  if (!targetEntry(target)) return null; // Existing unsupported profiles keep the ordinary legacy resolver.
  if(target==='darwin-arm64'&&process.platform==='darwin'){
    const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(hostRelease());
    // Official Mach-O requires macOS13.5 (Darwin22.6). An unknown/older
    // host retains the existing ordinary resolver, never a pinned compatibility claim.
    const parts=match?match.slice(1).map(Number):[];
    if(parts.length!==3||parts.some(value=>!Number.isSafeInteger(value))||parts[0]<22||(parts[0]===22&&parts[1]<6))return null;
  }
  const env = Object.freeze(sanitizeRuntimeEnv(options.env ?? process.env));
  const runtime = verifyRuntimeDirectory(packageDirectory(options.resourcesPath, target), target);
  return Object.freeze({...runtime, env});
}
function brokerRuntimeMatchesHealth(body, runtime) {
  const actual = body?.service?.runtime;
  return actual?.node === runtime.expected.node && actual.sqlite === runtime.expected.sqlite && actual.executableSha256 === runtime.expected.executableSha256 && typeof actual.execPath === 'string' && samePath(actual.execPath, runtime.command);
}
module.exports = Object.freeze({resolvePackagedBrokerRuntime, brokerRuntimeMatchesHealth, assertRuntimeFileReadsKnown, targetEntry, expectedManifest, verifyRuntimeDirectory, packageDirectory});
