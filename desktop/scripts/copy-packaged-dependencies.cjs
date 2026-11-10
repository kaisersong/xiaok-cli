#!/usr/bin/env node
// Repair electron-builder's incomplete production collector from the installed
// dependency tree. Never install, mutate node_modules, or weaken afterPack gates.
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const { packagedRuntimePaths } = require('./verify-packaged-runtime-dependencies.cjs');

function packageName(name) {
  if (!/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name) || name === '..' || name === '.') throw new Error(`invalid dependency name: ${name}`);
  return name;
}
function resolveInstalled(from, name) {
  for (let dir = fs.realpathSync(from); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', packageName(name));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (path.dirname(dir) === dir) return null;
  }
}
function compatible(pkg, platform, arch) {
  return [['os', platform], ['cpu', arch]].every(([key, value]) => {
    const values = pkg[key];
    return !Array.isArray(values) || (!values.includes(`!${value}`) && (!values.some(v => !v.startsWith('!')) || values.includes(value)));
  });
}
async function copyPackagedDependencies({ asarPath, projectDir, platform = process.platform, arch = process.arch }) {
  const requestedAsarPath = path.resolve(asarPath);
  asarPath = fs.realpathSync(requestedAsarPath);
  const installedRoot = fs.realpathSync(path.join(projectDir, 'node_modules'));
  const entries = new Map();
  for (const name of asar.listPackage(asarPath)) {
    const key = name.replaceAll('\\', '/').replace(/^\//, '');
    entries.set(key, asar.statFile(asarPath, path.normalize(key), false));
  }
  const additions = new Map(), copied = [], visited = new Set();
  function manifestAt(target) {
    const key = path.posix.join(target, 'package.json');
    if (additions.has(key)) return JSON.parse(fs.readFileSync(additions.get(key).source, 'utf8'));
    if (entries.has(key)) return JSON.parse(asar.extractFile(asarPath, path.normalize(key)).toString('utf8'));
    return null;
  }
  function addTree(source, target) {
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
      if (item.name === 'node_modules') continue; // traversed by dependency edges, never dev trees
      const file = path.join(source, item.name), key = path.posix.join(target, item.name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`dependency copy refuses package-internal symlink: ${file}`);
      if (stat.isDirectory()) addTree(file, key);
      else if (stat.isFile()) additions.set(key, { source: file, stat });
      else throw new Error(`unsupported dependency file: ${file}`);
    }
  }
  function visit(source, target, pkg) {
    const identity = `${source}\0${target}`;
    if (visited.has(identity)) return;
    visited.add(identity);
    const existing = manifestAt(target);
    if (existing && existing.version !== pkg.version) throw new Error(`packaged dependency version mismatch: ${target} (${existing.version} vs installed ${pkg.version})`);
    if (!existing) { addTree(source, target); copied.push(`${target}@${pkg.version}`); }
    edges(source, target, pkg);
  }
  function edges(source, target, pkg) {
    const optional = pkg.optionalDependencies ?? {};
    const peers = pkg.peerDependencies ?? {};
    const deps = { ...peers, ...pkg.dependencies, ...optional };
    for (const name of Object.keys(deps).sort()) {
      const isOptional = Object.hasOwn(optional, name) || (!Object.hasOwn(pkg.dependencies ?? {}, name) && pkg.peerDependenciesMeta?.[name]?.optional === true);
      const resolved = resolveInstalled(source, name);
      if (!resolved) {
        if (isOptional) continue;
        throw new Error(`missing required installed dependency ${name} from ${source}`);
      }
      const child = JSON.parse(fs.readFileSync(path.join(resolved, 'package.json'), 'utf8'));
      if (!compatible(child, platform, arch)) {
        if (isOptional) continue;
        throw new Error(`required dependency incompatible with ${platform}/${arch}: ${name}`);
      }
      // Retain npm's installed nesting (including multiple versions). Hoisted
      // dependencies outside this node_modules root are placed at the app root.
      const relative = path.relative(installedRoot, resolved);
      let dest = relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
        ? path.posix.join('node_modules', relative.split(path.sep).join('/'))
        : path.posix.join('node_modules', name);
      const existing = manifestAt(dest);
      if (existing && existing.version !== child.version && target) dest = path.posix.join(target, 'node_modules', name);
      visit(resolved, dest, child);
    }
  }
  const manifest = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  edges(projectDir, '', manifest);
  if (!copied.length) return { copied };
  const streams = [];
  for (const [key, info] of entries) {
    if (info.files) streams.push({ path: key, type: 'directory', unpacked: !!info.unpacked });
    else if (info.link) streams.push({ path: key, type: 'link', unpacked: !!info.unpacked, symlink: path.posix.relative(path.posix.dirname(key), info.link), stat: { mode: 0o777, size: 0 } });
    else streams.push({ path: key, type: 'file', unpacked: !!info.unpacked,
      stat: { size: info.size, mode: info.executable ? 0o755 : 0o644 }, streamGenerator: () => Readable.from(asar.extractFile(asarPath, path.normalize(key))) });
  }
  const directories = new Set([...entries].filter(([, info]) => info.files).map(([key]) => key));
  for (const [key, item] of additions) {
    if (entries.has(key)) throw new Error(`dependency copy would overwrite existing file: ${key}`);
    const parents = []; for (let dir = path.posix.dirname(key); dir !== '.' && !directories.has(dir); dir = path.posix.dirname(dir)) parents.unshift(dir);
    for (const dir of parents) { streams.push({ path: dir, type: 'directory', unpacked: false }); directories.add(dir); }
    // Added packages are unpacked in full: native binaries and package-relative
    // workers/data keep ordinary filesystem semantics on all supported targets.
    streams.push({ path: key, type: 'file', unpacked: true, stat: item.stat, streamGenerator: () => fs.createReadStream(item.source) });
  }
  const temp = fs.mkdtempSync(path.join(path.dirname(asarPath), '.dependency-copy-'));
  const next = path.join(temp, 'app.asar');
  try {
    const output = await asar.createPackageFromStreams(next, streams);
    await finished(output);
    // Copy unpacked files before replacing the archive; existing unpacked bytes
    // are preserved and no development tree is written to.
    if (fs.existsSync(next + '.unpacked')) fs.cpSync(next + '.unpacked', asarPath + '.unpacked', { recursive: true });
    asar.uncache(asarPath); asar.uncache(requestedAsarPath); fs.renameSync(next, asarPath);
  } finally { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); }
  return { copied };
}
module.exports = async context => {
  const { Arch } = require('electron-builder');
  const result = await copyPackagedDependencies({ ...packagedRuntimePaths(context), projectDir: context.packager.projectDir,
    platform: context.electronPlatformName, arch: Arch[context.arch] });
  console.log(`packaged production dependency closure: copied ${result.copied.length} packages`);
};
module.exports.copyPackagedDependencies = copyPackagedDependencies;
