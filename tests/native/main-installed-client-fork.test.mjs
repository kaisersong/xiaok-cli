import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
test(
  'original connected C client rejects a raw-fork child without mutating or closing the parent wire session',
  { skip: process.platform !== 'darwin', timeout: 30000 },
  () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'mi-fork-')));
    mkdirSync(join(root, 'config'), { mode: 0o700 });
    const child = join(root, 'client'),
      helper = join(root, 'helper'),
      launcher = join(root, 'launcher'),
      config = join(root, 'configuration.h');
    const source = join(repo, 'native/main-installation'),
      native = join(repo, 'native/root-resource-authority');
    const header = (hash) =>
      `#define MI_FIXED_ROOT ${JSON.stringify(root)}\n#define MI_MAIN_EXEC ${JSON.stringify(child)}\n#define MI_MAIN_BUNDLE ${JSON.stringify(child)}\n#define MI_LAUNCHER_EXEC ${JSON.stringify(launcher)}\n#define MI_EXPECTED_MAIN_SHA256 ${JSON.stringify(hash)}\n`;
    writeFileSync(config, header('0'.repeat(64)));
    const sdk = spawnSync('/usr/bin/xcrun', ['--show-sdk-path'], {
      encoding: 'utf8',
    });
    assert.equal(sdk.status, 0, sdk.stderr);
    const common = [
      '-std=c11',
      '-Werror',
      '-Wall',
      '-Wextra',
      '-Wno-deprecated-declarations',
      '-isysroot',
      sdk.stdout.trim(),
      '-I',
      source,
      '-I',
      native,
      '-DMI_FIXTURE_BUILD=1',
      '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(config),
    ];
    const builds = [];
    function build(files, output) {
      const result = spawnSync(
        '/usr/bin/cc',
        [
          ...common,
          ...files,
          join(source, 'wire.c'),
          '-framework',
          'Security',
          '-framework',
          'CoreFoundation',
          '-framework',
          'OpenDirectory',
          '-lbsm',
          '-o',
          output,
        ],
        { encoding: 'utf8' },
      );
      builds.push({
        pid: result.pid,
        code: result.status,
        signal: result.signal,
      });
      assert.equal(result.status, 0, result.stderr);
    }
    build(
      [
        join(repo, 'tests/native/fixtures/main-installed-client-fork.c'),
        join(native, 'installed-main-client.c'),
      ],
      child,
    );
    writeFileSync(
      config,
      header(createHash('sha256').update(readFileSync(child)).digest('hex')),
    );
    build([join(source, 'main-installation-entry.c')], launcher);
    build([join(source, 'main-installation-helper.c')], helper);
    const run = spawnSync(helper, [], {
      cwd: root,
      encoding: 'utf8',
      timeout: 18000,
      env: {
        PATH: '/usr/bin:/bin',
        LC_ALL: 'C',
        XIAOK_CONFIG_DIR: join(root, 'config'),
      },
    });
    console.log(
      JSON.stringify({
        root,
        builds,
        pid: run.pid,
        code: run.status,
        signal: run.signal,
        stdout: run.stdout,
        stderr: run.stderr,
      }),
    );
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const records = run.stdout
      .split('\n')
      .filter((x) => x.startsWith('{'))
      .map((x) => JSON.parse(x));
    const facts = records.find((x) => x.kind === 'original-client-fork');
    assert.ok(facts);
    assert.equal(facts.forkReaped, true);
    assert.equal(facts.forkStatus, 0);
    assert.equal(facts.childConnect, 0);
    assert.equal(facts.childCurrent, 0);
    assert.equal(facts.childPing, 0);
    assert.equal(facts.childClose, 0);
    assert.equal(facts.childAfterRelease, 1);
    assert.equal(facts.childFateRead, 1);
    assert.equal(facts.childUnknown, 1);
    assert.equal(facts.childRootFilesClosed, 0);
    assert.equal(facts.parentPing, 1);
    assert.equal(facts.parentClose, 1);
    assert.equal(facts.parentUnknown, 0);
    assert.equal(facts.parentRootFilesClosed, 1);
    assert.equal(facts.beforeRootSeq, 1);
    assert.equal(facts.afterRootSeq, 3);
    assert.equal(facts.beforeDispatchSeq, 1);
    assert.equal(facts.afterDispatchSeq, 3);
    assert.equal(records.filter((x) => x.event === 'spawn').length, 1);
    assert.equal(
      records.filter((x) => x.event === 'reaped' && x.status === 0).length,
      1,
    );
  },
);
