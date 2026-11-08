import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const repo = resolve(import.meta.dirname, '../..');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, ...options });
  console.log(JSON.stringify({ sqliteApiChild: { command, args, pid: result.pid, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr } }));
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}
function root(t, cleanup = { safe: true }) { const value = realpathSync(mkdtempSync(join(tmpdir(), 'sqlite-api-guard-'))); t.after(() => { if (cleanup.safe) rmSync(value, { recursive: true, force: true }); else console.log(JSON.stringify({ retainedFailedApiFixture: value })); }); return value; }
function common() {
  const headers = realpathSync(process.env.XIAOK_BROKER_TEST_NODE_HEADERS || resolve(dirname(realpathSync(process.execPath)), '../include/node'));
  return ['-std=c11', '-mmacosx-version-min=11.0', '-Werror', '-Werror=unguarded-availability-new', '-Wno-deprecated-declarations', '-I', headers, '-I', join(repo, 'native/root-resource-authority'), '-I', join(repo, 'native/main-installation'), '-I', join(repo, 'native/protected-sqlite-facade'), '-DNAPI_VERSION=8'];
}
for (const family of ['broker', 'kswarm']) test('actual ' + family + ' child refuses unsupported SQLite API before Native client creation', { skip: process.platform !== 'darwin' }, t => {
  const dir = root(t), output = join(dir, 'protected_sqlite.node');
  run('/usr/bin/cc', [...common(), ...(family === 'broker' ? ['-DFIXTURE_BROKER_API=1'] : []), '-bundle', '-undefined', 'dynamic_lookup', join(repo, 'tests/native/fixtures/sqlite-api-unavailable-child.c'), join(repo, 'native/protected-sqlite-facade/protected-sqlite-facade.c'), join(repo, 'native/root-resource-authority/original-root-io-vfs.c'), join(repo, 'native/root-resource-authority/installed-main-client.c'), join(repo, 'native/main-installation/wire.c'), '-lsqlite3', '-framework', 'Security', '-lbsm', '-o', output]);
  const capital = family === 'broker' ? 'Broker' : 'KSwarm', code = family.toUpperCase();
  const script = `const a=require('node:assert/strict'),n=require(process.argv[1]);a.equal(n.readOriginal${capital}Source(),undefined);a.throws(()=>n.consumeOriginal${capital}Source(),e=>e.code==='${code}_ORIGINAL_API_UNAVAILABLE');a.equal(n.readOriginal${capital}Source(),undefined);a.throws(()=>n.finishOriginal${capital}Source());console.log(JSON.stringify({unsupportedTyped:true,nativeClientCreated:false,platformFactSimulated:true,qualification:false}));`;
  const actual = run(process.execPath, ['-e', script, output]);
  assert.equal(actual.stderr.includes('FIXTURE_NATIVE_CREATE_ENTERED'), false);
});
test('actual Broker and KS parent producers reject unsupported API before family allocation or IO', { skip: process.platform !== 'darwin', timeout: 30000 }, async t => {
  const cleanup = { safe: false };
  const dir = root(t, cleanup), config = join(dir, 'configuration.h'), main = join(dir, 'main-child'), launcher = join(dir, 'main-launcher'), helper = join(dir, 'helper');
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const configure = sha => writeFileSync(config, '#define MI_FIXTURE_AUTHORITY_SCOPES 1\n' + [['MI_FIXED_ROOT', dir], ['MI_MAIN_EXEC', main], ['MI_MAIN_BUNDLE', main], ['MI_LAUNCHER_EXEC', launcher], ['MI_EXPECTED_MAIN_SHA256', sha]].map(([k, v]) => '#define ' + k + ' ' + JSON.stringify(v) + '\n').join(''));
  const flags = [...common(), '-DMI_FIXTURE_BUILD=1', '-DNR_ROOT_IO_COMPONENT=1', '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(config)];
  const build = (source, output) => run('/usr/bin/cc', [...flags, ...source, join(repo, 'native/main-installation/wire.c'), '-lsqlite3', '-framework', 'Security', '-framework', 'CoreFoundation', '-framework', 'OpenDirectory', '-lbsm', '-o', output]);
  configure('0'.repeat(64));
  build([join(repo, 'tests/native/fixtures/sqlite-api-unavailable-parent.c'), join(repo, 'tests/native/fixtures/sqlite-api-unavailable-producer.c')], main);
  configure(hash(main));
  build([join(repo, 'native/main-installation/main-installation-entry.c')], launcher);
  build([join(repo, 'native/main-installation/main-installation-helper.c')], helper);
  mkdirSync(join(dir, 'config'), { mode: 0o700 });
  const child = spawn(helper, [], { cwd: dir, env: { PATH: '/usr/bin:/bin', XIAOK_CONFIG_DIR: join(dir, 'config') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const closed = new Promise((yes, no) => { child.once('error', no); child.once('close', (code, signal) => yes({ code, signal })); });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 15000);
  let result; try { result = await closed; } finally { clearTimeout(timeout); }
  console.log(JSON.stringify({ originalApiGuardHelper: { pid: child.pid, ...result, stdout, stderr, reaped: true } }));
  assert.equal(result.signal, null); assert.equal(result.code, 0, stderr + stdout);
  const fact = stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).find(row => row.kind === 'actual-unsupported-source-producers');
  assert.ok(fact); assert.equal(fact.failure, 0); assert.equal(fact.rootSequenceUnchanged, true); assert.equal(fact.rootFilesClosed, true); cleanup.safe = true;
});
