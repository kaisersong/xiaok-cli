import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let executable;
function compile() {
  if (executable) return executable;
  const root = mkdtempSync(join(tmpdir(), 'xiaok-main-client-component-'));
  mkdirSync(join(root, 'config'), {mode: 0o700});
  const config = join(root, 'configuration.h');
  writeFileSync(config, `#define MI_FIXED_ROOT ${JSON.stringify(root)}\n`);
  const sdk = spawnSync('/usr/bin/xcrun', ['--show-sdk-path'], {encoding: 'utf8'});
  assert.equal(sdk.status, 0, sdk.stderr);
  const output = join(root, 'client-probe');
  const native = join(repo, 'native/root-resource-authority');
  const wire = join(repo, 'native/main-installation');
  const result = spawnSync('/usr/bin/cc', [
    '-std=c11', '-Werror', '-Wall', '-Wextra', '-Wno-deprecated-declarations',
    '-isysroot', sdk.stdout.trim(), '-I', native, '-I', wire,
    '-DMI_FIXTURE_BUILD=1', '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(config),
    join(repo, 'tests/native/fixtures/main-installed-client.c'),
    join(native, 'installed-main-client.c'), join(wire, 'wire.c'),
    '-framework', 'Security', '-lbsm', '-o', output,
  ], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  executable = {output, root};
  return executable;
}

for (const scenario of ['missing', 'malformed', 'trailing', 'no-helper']) {
  test(`original Native installation client retains ${scenario} birth failure without retry or FD leakage`,
    {skip: process.platform !== 'darwin'}, () => {
      const {output, root} = compile();
      const result = spawnSync(output, [scenario], {
        encoding: 'utf8', timeout: 10000,
        env: {PATH: '/usr/bin:/bin', XIAOK_CONFIG_DIR: join(root, 'config')},
      });
      console.log(JSON.stringify({scenario, pid: result.pid, code: result.status, signal: result.signal}));
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.signal, null);
      const facts = JSON.parse(result.stdout);
      assert.equal(facts.connected, 0);
      assert.equal(facts.replay, 0);
      assert.equal(facts.attempted, 1);
      assert.equal(facts.entered, scenario === 'missing' ? 0 : 1);
      assert.equal(facts.closed, 1);
      assert.equal(facts.unknown, scenario === 'missing' ? 0 : 1);
      assert.equal(facts.seedClosed, scenario === 'missing' ? 0 : 1);
      assert.equal(facts.cleanup, scenario === 'missing' ? 1 : 0);
      assert.equal(facts.errorPresent, 1);
      assert.equal(facts.seedDescriptorClosed, 1);
      assert.equal(facts.unknownRetained, 1);
      assert.equal(facts.rootFilesClosed, 0);
    });
}
