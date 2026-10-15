// Exercises the real repository-dev declaration repair CLI in owned temporary projects.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TARGET = 'node_modules/@types/better-sqlite3/index.d.ts';
const SCRIPT = 'scripts/repair-better-sqlite3-types.cjs';
const SPEC = 'patches/better-sqlite3-table-factory-types-7.6.13.json';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function copy(source, destination) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function setup(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-types-controls-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'project'); fs.mkdirSync(root);
  const assets = [TARGET, 'node_modules/@types/better-sqlite3/package.json', 'node_modules/better-sqlite3/package.json', 'node_modules/better-sqlite3/lib/methods/table.js', 'node_modules/better-sqlite3/src/util/custom-table.cpp'];
  for (const file of assets) copy(file === TARGET ? path.join(ROOT, 'tests', 'fixtures', 'better-sqlite3-types-7.6.13', 'index.d.ts.txt') : path.join(ROOT, file), path.join(root, file));
  for (const file of ['package.json', 'package-lock.json', SCRIPT, SPEC]) copy(path.join(ROOT, file), path.join(root, file));
  const spec = JSON.parse(fs.readFileSync(path.join(root, SPEC), 'utf8'));
  assert.equal(digest(fs.readFileSync(path.join(root, SCRIPT))), digest(fs.readFileSync(path.join(ROOT, SCRIPT))));
  return { root, temporary, spec, target: path.join(root, TARGET), script: path.join(root, SCRIPT) };
}
function cli(f, mode, preload) {
  const argv = preload ? ['--require', preload, f.script, mode] : [f.script, mode];
  const result = spawnSync(process.execPath, argv, { cwd: f.root, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error); return result;
}
function mutateJson(file, mutation) { const value = JSON.parse(fs.readFileSync(file, 'utf8')); mutation(value); writeJson(file, value); }
function noTemp(f) { assert.deepEqual(fs.readdirSync(path.dirname(f.target)).filter(name => name.startsWith('.sqlite-types-')), []); }
function rejectWithoutWrite(f, expected) {
  const before = fs.readFileSync(f.target); const result = cli(f, '--apply');
  assert.notEqual(result.status, 0); assert.match(result.stderr, expected); assert.deepEqual(fs.readFileSync(f.target), before); noTemp(f);
}
test('check on original declaration fails read-only; new script before is NOT_AVAILABLE, not feature RED', t => {
  const f = setup(t), before = fs.readFileSync(f.target); const result = cli(f, '--check');
  assert.equal(result.status, 1); assert.match(result.stderr, /types-repair-required/); assert.deepEqual(fs.readFileSync(f.target), before); noTemp(f);
});
test('actual CLI applies exact original asset to frozen post SHA without loading SQLite', t => {
  const f = setup(t), runtime = path.join(f.root, 'node_modules/better-sqlite3/lib/methods/table.js'), runtimeBefore = fs.readFileSync(runtime);
  const result = cli(f, '--apply'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /repaired/);
  assert.equal(digest(fs.readFileSync(f.target)), f.spec.postSHA256); assert.deepEqual(fs.readFileSync(runtime), runtimeBefore); noTemp(f);
});
test('post SHA apply/check are idempotent with no inode/mtime/content write', t => {
  const f = setup(t); assert.equal(cli(f, '--apply').status, 0); const before = fs.statSync(f.target), data = fs.readFileSync(f.target);
  for (const mode of ['--apply', '--check']) { const result = cli(f, mode); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /exact/); }
  const after = fs.statSync(f.target); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs); assert.deepEqual(fs.readFileSync(f.target), data); noTemp(f);
});
test('unknown declaration hash fails before replacement', t => { const f = setup(t); fs.appendFileSync(f.target, '\nforeign drift\n'); rejectWithoutWrite(f, /types-preimage/); });
test('wrong installed types version fails closed', t => { const f = setup(t); mutateJson(path.join(f.root, 'node_modules/@types/better-sqlite3/package.json'), p => { p.version = '0.0.0'; }); rejectWithoutWrite(f, /installed-lock-version-integrity/); });
test('wrong installed runtime version fails closed', t => { const f = setup(t); mutateJson(path.join(f.root, 'node_modules/better-sqlite3/package.json'), p => { p.version = '0.0.0'; }); rejectWithoutWrite(f, /installed-lock-version-integrity/); });
for (const asset of ['lib/methods/table.js', 'src/util/custom-table.cpp']) test(`actual source hash drift fails closed: ${asset}`, t => {
  const f = setup(t); fs.appendFileSync(path.join(f.root, 'node_modules/better-sqlite3', asset), '\nforeign source drift\n'); rejectWithoutWrite(f, /runtime-source-preimage/);
});
test('root range instead of exact runtime pin fails closed', t => { const f = setup(t); mutateJson(path.join(f.root, 'package.json'), p => { p.dependencies['better-sqlite3'] = '^13.0.3'; }); rejectWithoutWrite(f, /manifest-lock-versions-pin/); });
test('lock integrity drift fails closed', t => { const f = setup(t); mutateJson(path.join(f.root, 'package-lock.json'), p => { p.packages['node_modules/@types/better-sqlite3'].integrity += 'drift'; }); rejectWithoutWrite(f, /installed-lock-version-integrity/); });
test('post SHA does not bypass changed version guards', t => { const f = setup(t); assert.equal(cli(f, '--apply').status, 0); mutateJson(path.join(f.root, 'node_modules/better-sqlite3/package.json'), p => { p.version = '0.0.0'; }); rejectWithoutWrite(f, /installed-lock-version-integrity/); });
test('parent symlink outside repository causes no external declaration write', t => {
  const f = setup(t), external = path.join(f.temporary, 'external-types'), parent = path.join(f.root, 'node_modules/@types');
  fs.renameSync(parent, external); fs.symlinkSync(external, parent, process.platform === 'win32' ? 'junction' : 'dir');
  const outside = path.join(external, 'better-sqlite3/index.d.ts'), before = fs.readFileSync(outside);
  const result = cli(f, '--apply'); assert.equal(result.status, 1); assert.match(result.stderr, /symlink-component|outside-repository/);
  assert.deepEqual(fs.readFileSync(outside), before); assert.deepEqual(fs.readdirSync(path.dirname(outside)).filter(name => name.startsWith('.sqlite-types-')), []);
});
test('concurrent real file mutation after temporary write is not overwritten', t => {
  const f = setup(t), preload = path.join(f.root, 'concurrent-fault.cjs'), marker = '\nconcurrent fixture mutation\n', before = fs.readFileSync(f.target, 'utf8');
  fs.writeFileSync(preload, `'use strict';\nconst fs=require('node:fs'),path=require('node:path');const open=fs.openSync,write=fs.writeFileSync;let temporary,done=false;fs.openSync=function(file,...args){const fd=open.call(fs,file,...args);if(typeof file==='string'&&path.basename(file).startsWith('.sqlite-types-'))temporary=fd;return fd;};fs.writeFileSync=function(file,data,...args){const value=write.call(fs,file,data,...args);if(file===temporary&&!done){done=true;write.call(fs,${JSON.stringify(f.target)},${JSON.stringify(before + marker)});}return value;};\n`);
  const result = cli(f, '--apply', preload); assert.equal(result.status, 1); assert.match(result.stderr, /types-concurrent-change/);
  assert.equal(fs.readFileSync(f.target, 'utf8'), before + marker); noTemp(f);
});
test('resetting only the real original declaration simulates reinstall then repairs reproducibly', t => {
  const f = setup(t); assert.equal(cli(f, '--apply').status, 0); copy(path.join(ROOT, 'tests', 'fixtures', 'better-sqlite3-types-7.6.13', 'index.d.ts.txt'), f.target);
  const result = cli(f, '--apply'); assert.equal(result.status, 0, result.stderr); assert.equal(digest(fs.readFileSync(f.target)), f.spec.postSHA256); noTemp(f);
});
