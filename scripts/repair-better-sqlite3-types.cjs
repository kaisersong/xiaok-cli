#!/usr/bin/env node
'use strict';
// Repository-dev types repair only: no installed JS/native module is loaded.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Resolve the repository from this checked-in script, never process.cwd() or a global dependency.
const root = fs.realpathSync(path.resolve(__dirname, '..'));
const TARGET = 'node_modules/@types/better-sqlite3/index.d.ts';
const SPEC = 'patches/better-sqlite3-table-factory-types-7.6.13.json';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function fail(code) { throw new Error(code); }
function inside(absolute) {
  const relative = path.relative(root, absolute);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) fail('outside-repository');
}
function locate(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)
      || relative.split(/[\\/]/u).some(part => part === '..' || part === '')) fail('unsafe-relative-path');
  const absolute = path.resolve(root, relative);
  inside(absolute);
  const ancestors = [];
  let cursor = root;
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('repository-root');
  ancestors.push({ absolute: root, ino: rootStat.ino, dev: rootStat.dev });
  const parts = path.relative(root, absolute).split(path.sep);
  let stat;
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) fail('symlink-component');
    if (i < parts.length - 1) {
      if (!stat.isDirectory()) fail('not-directory-component');
      ancestors.push({ absolute: cursor, ino: stat.ino, dev: stat.dev });
    }
  }
  const canonical = fs.realpathSync(absolute);
  inside(canonical);
  if (!stat.isFile()) fail('not-regular-file');
  return { absolute: canonical, stat, ancestors };
}
function stable(info) {
  for (const item of info.ancestors) {
    const current = fs.lstatSync(item.absolute);
    if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== item.ino
        || current.dev !== item.dev) fail('parent-concurrent-change');
    inside(fs.realpathSync(item.absolute));
  }
}
function read(relative, maximum = 2 * 1024 * 1024) {
  const info = locate(relative); // Every read rejects symlink ancestors, not just the leaf.
  if (info.stat.size > maximum) fail('oversized-file');
  let fd;
  try {
    fd = fs.openSync(info.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== info.stat.ino || opened.dev !== info.stat.dev
        || opened.size > maximum) fail('read-file-concurrent-change');
    const data = fs.readFileSync(fd);
    stable(info);
    const current = locate(relative);
    if (current.stat.ino !== opened.ino || current.stat.dev !== opened.dev) fail('read-path-concurrent-change');
    return { ...info, data };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function json(relative) { return JSON.parse(read(relative).data.toString('utf8')); }
function guards(spec) {
  if (spec.schemaVersion !== 1 || spec.target !== TARGET || spec.typesVersion !== '7.6.13'
      || spec.runtimeVersion !== '13.0.3' || !Array.isArray(spec.edits) || spec.edits.length !== 3) fail('spec-version');
  const manifest = json('package.json');
  const lock = json('package-lock.json');
  if (manifest.devDependencies?.['@types/better-sqlite3'] !== spec.typesVersion
      || manifest.dependencies?.['better-sqlite3'] !== spec.runtimeVersion
      || lock.lockfileVersion !== 3 || lock.packages?.['']?.devDependencies?.['@types/better-sqlite3'] !== spec.typesVersion
      || lock.packages?.['']?.dependencies?.['better-sqlite3'] !== spec.runtimeVersion) fail('manifest-lock-versions-pin');
  for (const [name, version] of [['@types/better-sqlite3', spec.typesVersion], ['better-sqlite3', spec.runtimeVersion]]) {
    const key = `node_modules/${name}`;
    if (json(`${key}/package.json`).version !== version || lock.packages?.[key]?.version !== version
        || lock.packages[key].integrity !== spec.lockIntegrities[key]) fail('installed-lock-version-integrity');
  }
  const expectedGuards = ['node_modules/better-sqlite3/lib/methods/table.js', 'node_modules/better-sqlite3/src/util/custom-table.cpp'];
  if (!Array.isArray(spec.runtimeSourceGuards) || spec.runtimeSourceGuards.length !== expectedGuards.length) fail('runtime-source-guard-list');
  for (let i = 0; i < expectedGuards.length; i++) {
    const item = spec.runtimeSourceGuards[i];
    if (item.file !== expectedGuards[i] || hash(read(item.file).data) !== item.SHA256) fail('runtime-source-preimage');
  }
}
function run(mode) {
  if (!['--check', '--apply'].includes(mode) || process.argv.length !== 3) fail('usage: --check-or---apply');
  const spec = json(SPEC);
  guards(spec); // No writes before every version/source/lock guard passes.
  const original = read(TARGET, 128 * 1024);
  const originalHash = hash(original.data);
  if (originalHash === spec.postSHA256) { process.stdout.write('sqlite-types: exact\n'); return; }
  if (originalHash !== spec.preSHA256) fail('types-preimage');
  if (mode === '--check') fail('types-repair-required');
  let text = original.data.toString('utf8');
  for (const edit of spec.edits) {
    if (typeof edit.before !== 'string' || !edit.before.length || typeof edit.after !== 'string'
        || text.split(edit.before).length !== 2) fail('literal-edit-not-unique');
    text = text.replace(edit.before, edit.after);
  }
  const replacement = Buffer.from(text, 'utf8');
  if (hash(replacement) !== spec.postSHA256) fail('types-postimage');
  // Only a bounded known declaration can be replaced; never library JS or addon.
  stable(original);
  const parent = fs.realpathSync(path.dirname(original.absolute));
  inside(parent);
  const target = path.join(parent, path.basename(original.absolute));
  inside(target);
  let temporary;
  let fd;
  function cleanup() {
    if (fd !== undefined) fs.closeSync(fd);
    if (temporary !== undefined) {
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  try {
    temporary = path.join(parent, `.sqlite-types-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fd = fs.openSync(temporary, 'wx', original.stat.mode & 0o777);
    fs.writeFileSync(fd, replacement);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    guards(spec);
    stable(original);
    const current = read(TARGET, 128 * 1024);
    if (hash(current.data) !== originalHash || current.stat.ino !== original.stat.ino
        || current.stat.dev !== original.stat.dev) fail('types-concurrent-change');
    fs.renameSync(temporary, target); temporary = undefined;
    if (hash(read(TARGET, 128 * 1024).data) !== spec.postSHA256) fail('types-final-verification');
    process.stdout.write('sqlite-types: repaired\n');
  } catch (error) {
    cleanup();
    throw error;
  }
  cleanup();
}
try { run(process.argv[2]); }
catch (error) { process.stderr.write(`sqlite-types: ${error.code || error.message}\n`); process.exitCode = 1; }
