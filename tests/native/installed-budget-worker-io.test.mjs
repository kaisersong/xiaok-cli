import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

for(const mode of ['basic','known-denied','unknown-open'])test('original client budget Worker lease '+mode+' preserves IO lifetime', {
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
    join(native, 'root-store-io-dispatch.h'), join(native, 'installed-budget-worker-io.h'),
    ...['protocol.h', 'wire.h', 'wire.c', 'main-installation-helper.c', 'main-installation-entry.c'].map(name => join(wire, name)),
    join(wire, 'root-store-state.h'), join(wire, 'root-store-io.h'),join(wire,'authority-family-io.h'),
    join(repo, 'tests/native/fixtures/installed-budget-worker-io.c'),
  ];
  const sourceHashes = Object.fromEntries(sources.map(path => [path, hash(path)]));
  const header = childHash => [
    ['MI_FIXED_ROOT', root], ['MI_MAIN_EXEC', child], ['MI_MAIN_BUNDLE', child],
    ['MI_LAUNCHER_EXEC', launcher], ['MI_EXPECTED_MAIN_SHA256', childHash],
  ].map(([name, value]) => `#define ${name} ${JSON.stringify(value)}\n`).join('')+'#define MI_FIXTURE_AUTHORITY_SCOPES 1\n';
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
    join(repo, 'tests/native/fixtures/installed-budget-worker-io.c'),
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
  const rows = await run(mode, mode==='unknown-open'?79:0);
  const facts = rows.find(row => row.kind === 'original-budget-worker-io-component');
  assert.ok(facts);
  assert.equal(facts.failure, 0);assert.equal(facts.threadFailure, 0);
  if(mode==='unknown-open'){assert.equal(facts.unknownOpenNoWorker,true);assert.equal(facts.joined,false);}
  else if(mode==='known-denied'){assert.equal(facts.knownDeniedNoWorker,true);assert.equal(facts.joined,false);}
  else{
  assert.equal(facts.crossThreadOriginalRejected, true);assert.equal(facts.concurrentMainFrames,true);
  assert.equal(facts.busyBeforeWorker, true);assert.equal(facts.workerSqlClosed, true);
  assert.equal(facts.joined, true);
  }
  assert.equal(facts.rootFilesClosed,mode!=='unknown-open');
  assert.equal(facts.unknown, mode==='unknown-open');assert.equal(facts.productionQualified, false);
});
