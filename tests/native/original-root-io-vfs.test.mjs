import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('original RootIO VFS rejects foreign io/family before opening a pool', {
  skip: process.platform !== 'darwin',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'original-root-vfs-'));
  console.log(JSON.stringify({kind: 'original-root-vfs-test-root', root}));
  mkdirSync(join(root, 'config'), {mode: 0o700});
  const native = join(repo, 'native/root-resource-authority');
  const binary = join(root, 'foreign-input');
  const command = [
    '-std=c11', '-Wall', '-Wextra', '-Werror',
    '-I', native,
    '-I', join(repo, 'native/main-installation'),
    join(repo, 'tests/native/fixtures/original-root-io-vfs.c'),
    join(native, 'original-root-io-vfs.c'),
    join(native, 'installed-main-client.c'),
    join(repo, 'native/main-installation/wire.c'),
    '-lsqlite3', '-framework', 'Security', '-framework', 'CoreFoundation',
    '-lbsm', '-o', binary,
  ];
  const compiled = spawnSync('/usr/bin/cc', command, {cwd: repo, encoding: 'utf8'});
  writeFileSync(join(root, 'compile.json'), JSON.stringify({
    command, pid: compiled.pid, status: compiled.status, signal: compiled.signal,
    stdout: compiled.stdout, stderr: compiled.stderr, error: compiled.error?.message,
  }, null, 2));
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.status, 0, compiled.stderr);
  const result = spawnSync(binary, [], {cwd: root, encoding: 'utf8', timeout: 15000});
  writeFileSync(join(root, 'run.json'), JSON.stringify({
    pid: result.pid, status: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr, error: result.error?.message,
  }, null, 2));
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const facts = JSON.parse(result.stdout);
  assert.equal(facts.kind, 'original-root-io-vfs-foreign-input');
  assert.equal(facts.foreignRejected, true);
  assert.equal(facts.defaultVfsUnchanged, true);
  assert.equal(facts.productionQualified, false);
});

test('original helper and private client preserve SQLite BUSY and recover the same pool hot journal after real process loss', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rvi-')));
  mkdirSync(join(root, 'config'), {mode: 0o700});
  console.log(JSON.stringify({kind: 'original-root-vfs-live-root', root}));
  const native = join(repo, 'native/root-resource-authority');
  const wire = join(repo, 'native/main-installation');
  const child = join(root, 'child');
  const launcher = join(root, 'launcher');
  const helper = join(root, 'helper');
  const configuration = join(root, 'configuration.h');
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const sources = [
    join(native, 'original-root-io-vfs.c'), join(native, 'original-root-io-vfs.h'),
    join(native, 'root-store-io.h'), join(native, 'installed-main-client.c'),
    join(native, 'installed-main-client.h'), join(native, 'root-store-io-codec.h'),
    join(native, 'root-store-io-dispatch.h'),
    ...['protocol.h', 'wire.h', 'wire.c', 'main-installation-helper.c', 'main-installation-entry.c'].map(name => join(wire, name)),
    join(wire, 'root-store-state.h'), join(wire, 'root-store-io.h'),
    join(repo, 'tests/native/fixtures/original-root-io-vfs-live.c'),
  ];
  const sourceHashes = Object.fromEntries(sources.map(path => [path, hash(path)]));
  const header = childHash => [
    ['MI_FIXED_ROOT', root], ['MI_MAIN_EXEC', child], ['MI_MAIN_BUNDLE', child],
    ['MI_LAUNCHER_EXEC', launcher], ['MI_EXPECTED_MAIN_SHA256', childHash],
  ].map(([name, value]) => `#define ${name} ${JSON.stringify(value)}\n`).join('');
  writeFileSync(configuration, header('0'.repeat(64)));
  const sdk = spawnSync('/usr/bin/xcrun', ['--show-sdk-path'], {encoding: 'utf8'});
  assert.equal(sdk.status, 0, sdk.stderr);
  const common = [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
    '-isysroot', sdk.stdout.trim(), '-I', native, '-I', wire,
    '-DMI_FIXTURE_BUILD=1', '-DNR_ROOT_IO_COMPONENT=1',
    '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(configuration),
  ];
  const builds = [];
  const build = (input, output, sqlite = false) => {
    const args = [...common, ...input, ...(sqlite ? ['-lsqlite3'] : []),
      '-framework', 'Security', '-framework', 'CoreFoundation', '-framework', 'OpenDirectory', '-lbsm', '-o', output];
    const result = spawnSync('/usr/bin/cc', args, {cwd: repo, encoding: 'utf8'});
    builds.push({args, pid: result.pid, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr});
    writeFileSync(join(root, 'builds.json'), JSON.stringify(builds, null, 2));
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    chmodSync(output, 0o500);
  };
  build([
    join(repo, 'tests/native/fixtures/original-root-io-vfs-live.c'),
    join(native, 'original-root-io-vfs.c'), join(native, 'installed-main-client.c'), join(wire, 'wire.c'),
  ], child, true);
  writeFileSync(configuration, header(hash(child)));
  build([join(wire, 'main-installation-entry.c'), join(wire, 'wire.c')], launcher);
  build([join(wire, 'main-installation-helper.c'), join(wire, 'wire.c')], helper);
  assert.deepEqual(Object.fromEntries(sources.map(path => [path, hash(path)])), sourceHashes, 'source changed during compilation');
  writeFileSync(join(root, 'source-hashes.json'), JSON.stringify(sourceHashes, null, 2));
  const run = async (mode, expectedCode) => {
    const childProcess = spawn(helper, [], {
      cwd: root, env: {PATH: '/usr/bin:/bin', XIAOK_CONFIG_DIR: join(root, 'config')},
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const observed = {mode, pid: childProcess.pid, stdout: '', stderr: '', code: null, signal: null, reaped: false};
    childProcess.stdout.on('data', chunk => { observed.stdout += chunk; });
    childProcess.stderr.on('data', chunk => { observed.stderr += chunk; });
    const closed = new Promise((yes, no) => {
      childProcess.once('error', no);
      childProcess.once('close', (code, signal) => { Object.assign(observed, {code, signal, reaped: true}); yes(); });
    });
    const deadline = setTimeout(() => childProcess.kill('SIGTERM'), 20000);
    childProcess.stdin.end(mode + '\n');
    try {
      await closed;
    } finally {
      clearTimeout(deadline);
      if (!observed.reaped) { childProcess.kill('SIGTERM'); await closed; }
      writeFileSync(join(root, mode + '.run.json'), JSON.stringify(observed, null, 2));
      console.log(JSON.stringify({kind: 'original-root-vfs-live-result', ...observed}));
    }
    assert.equal(observed.signal, null, observed.stderr);
    assert.equal(observed.code, expectedCode, observed.stderr);
    const rows = observed.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    assert.equal(rows.filter(row => row.event === 'spawn').length, 1);
    assert.equal(rows.filter(row => row.event === 'reaped').length, 1);
    return rows;
  };
  const rows = await run('basic', 0);
  const facts = rows.find(row => row.kind === 'original-root-io-vfs-live-component');
  assert.ok(facts, 'original component facts must exist');
  assert.equal(facts.failure, 0);
  assert.equal(facts.busyHeld, true);
  assert.equal(facts.globalCloseBlocked, true);
  assert.equal(facts.secondConnectionDenied, true);
  assert.equal(facts.foreignJournalZeroIo, true);
  assert.equal(facts.rootFilesClosed, true);
  assert.equal(facts.unknown, false);
  assert.ok(facts.rootSequence > 0);
  assert.equal(facts.productionQualified, false);
  assert.equal(facts.freshClaim, true);
  assert.equal(facts.onceZeroIo, true);
  const crashed = await run('crash', 79);
  const lost = crashed.find(row => row.kind === 'original-root-io-vfs-component-crash');
  assert.ok(lost, 'actual crash point must have been reached');
  assert.equal(lost.freshClaim, false);
  assert.equal(lost.coldClaimZeroIo, true);
  assert.equal(lost.poolId, facts.poolId);
  const exit = crashed.find(row => row.event === 'reaped');
  assert.equal(exit.status, 91 << 8);
  const journal = join(root, 'authority', 'root-resource.sqlite-journal');
  assert.ok(statSync(journal).size > 0, 'actual hot journal must remain after process loss');
  assert.notEqual(readFileSync(journal).subarray(0, 8).toString('hex'), '0000000000000000');
  const recovered = (await run('recover', 0)).find(row => row.kind === 'original-root-io-vfs-live-component');
  assert.ok(recovered);
  assert.equal(recovered.failure, 0);
  assert.equal(recovered.poolId, facts.poolId);
  assert.equal(recovered.freshClaim, false);
  assert.equal(recovered.hotJournalRecovered, true);
  assert.equal(recovered.onceZeroIo, true);
  assert.equal(recovered.coldClaimZeroIo, true);
  assert.equal(recovered.rootFilesClosed, true);
  assert.equal(recovered.unknown, false);
  assert.equal(recovered.productionQualified, false);
});
