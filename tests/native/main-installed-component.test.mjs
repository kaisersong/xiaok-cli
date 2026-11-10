import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
let built;
function compile() {
  if (built) return built;
  const root = mkdtempSync(join(tmpdir(), 'xiaok-installed-component-'));
  mkdirSync(join(root, 'config'), { mode: 0o700 });
  process.env.XIAOK_CONFIG_DIR = join(root, 'config');
  const headers = resolve(dirname(process.execPath), '../include/node');
  assert.ok(
    existsSync(join(headers, 'node.h')),
    'actual current Node headers required',
  );
  const sdk = spawnSync('/usr/bin/xcrun', ['--show-sdk-path'], {
    encoding: 'utf8',
  });
  assert.equal(sdk.status, 0, sdk.stderr);
  const native = join(repo, 'native/root-resource-authority');
  const common = [
    '-Werror',
    '-Wno-deprecated-declarations',
    '-isysroot',
    sdk.stdout.trim(),
    '-I',
    headers,
    '-I',
    native,
    '-DMI_FIXTURE_BUILD=1',
    '-DNR_MAIN_INSTALLATION_COMPONENT=1',
    '-DNAPI_VERSION=8',
  ];
  if (process.config.variables.v8_enable_pointer_compression)
    common.push('-DV8_COMPRESS_POINTERS');
  if (process.config.variables.v8_enable_sandbox)
    common.push('-DV8_ENABLE_SANDBOX');
  const events = [];
  const build = (command, args) => {
    const row = spawnSync(command, args, { encoding: 'utf8' });
    events.push({ pid: row.pid, code: row.status, signal: row.signal });
    assert.equal(row.status, 0, row.stderr);
  };
  const client = join(root, 'client.o'),
    wire = join(root, 'wire.o'),
    glue = join(root, 'glue.o');
  build('/usr/bin/cc', [
    ...common,
    '-std=c11',
    '-c',
    join(native, 'installed-main-client.c'),
    '-o',
    client,
  ]);
  build('/usr/bin/cc', [
    ...common,
    '-std=c11',
    '-c',
    join(repo, 'native/main-installation/wire.c'),
    '-o',
    wire,
  ]);
  build('/usr/bin/cc', [
    ...common,
    '-std=c11',
    '-c',
    join(repo, 'tests/native/fixtures/main-installed-component.c'),
    '-o',
    glue,
  ]);
  const source = join(root, 'source.node'),
    target = join(root, 'target.node');
  for (const [output, embedded] of [
    [source, false],
    [target, true],
  ]) {
    build('/usr/bin/c++', [
      ...common,
      '-std=c++20',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      ...(embedded ? ['-DNR_MAIN_BOOTSTRAP_EMBEDDED=1'] : []),
      join(native, 'main-bootstrap.cc'),
      client,
      wire,
      ...(embedded ? [glue] : []),
      '-framework',
      'Security',
      '-lbsm',
      '-o',
      output,
    ]);
  }
  console.log(
    JSON.stringify({
      root,
      mode: 'Node component; MainPrecheck always false; no GUI/seed/handshake',
      events,
    }),
  );
  return (built = { source: require(source), target: require(target) });
}
test(
  'two real Node DSOs carry the original private capsule and destination transport reaches the closed Main role gate',
  { skip: process.platform !== 'darwin' || process.versions.modules !== '137' },
  () => {
    const { source, target } = compile();
    const issuer = source.componentCreateOriginalCapsule();
    const audit = target.componentReadOriginalCapsule(issuer);
    assert.equal(audit.productionQualified, false);
    assert.equal(audit.attempted, false);
    assert.throws(() => target.componentAdopt(issuer), {
      code: 'HANDOFF_DESTINATION_MAIN_ROLE',
    });
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error('get');
        },
        getOwnPropertyDescriptor() {
          traps++;
          throw Error('descriptor');
        },
      },
    );
    assert.throws(() => target.__originalMainInstallationAdopt(proxy), {
      code: 'HANDOFF_CALL_SLOT_REQUIRED',
    });
    assert.throws(() => target.componentAdopt(proxy), {
      code: 'HANDOFF_ARGUMENTS',
    });
    assert.throws(() => target.componentReadOriginalCapsule(proxy));
    assert.throws(() => target.componentReadOriginalCapsule({ ...issuer }));
    assert.equal(traps, 0);
    assert.throws(() => target.componentAdopt(1), {
      code: 'HANDOFF_ARGUMENTS',
    });
    assert.throws(() => target.componentAdopt({ ...issuer }), {
      code: 'HANDOFF_DESTINATION_MAIN_ROLE',
    });
    const checks = target.componentSlotChecks(issuer);
    assert.equal(checks.reentryRejected, true);
    assert.equal(checks.foreignLeaveRejected, true);
    assert.equal(checks.first.code, 'HANDOFF_DESTINATION_MAIN_ROLE');
    assert.equal(checks.afterTaken.code, 'HANDOFF_CALL_SLOT_REQUIRED');
    assert.equal(checks.afterLeave.code, 'HANDOFF_CALL_SLOT_REQUIRED');
    assert.equal(checks.next.code, 'HANDOFF_DESTINATION_MAIN_ROLE');
    assert.throws(() => source.assertOriginalMainIssuerCurrent(issuer));
  },
);
