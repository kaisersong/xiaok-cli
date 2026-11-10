import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {getNativeTestElectronExecutable} from './electron-executable.mjs';

// Preparation copies and compiles only. It never launches Electron/helper.
export async function prepareMainInstalledFixture(repo, headers, {authorityFamilies = false} = {}) {
  assert.equal(process.platform, 'darwin');
  const sourceFiles = [
    'native/root-resource-authority/main-bootstrap.cc',
    'native/root-resource-authority/main-session-bridge.h',
    'native/root-resource-authority/root_resource_authority.c',
    'native/root-resource-authority/installed-main-client.c',
    'native/root-resource-authority/installed-main-client.h',
    'native/root-resource-authority/installed-main-handoff.h',
    'native/root-resource-authority/build-main-bootstrap.mjs',
    'native/root-resource-authority/build-main-session.mjs',
    'native/main-installation/protocol.h', 'native/main-installation/wire.h',
    'native/main-installation/wire.c', 'native/main-installation/main-installation-entry.c',
    'native/main-installation/main-installation-helper.c',
    'native/main-installation/installation-closure.h',
    'native/main-installation/installation-release.h',
    'native/main-installation/installation-certificate.h',
    'tests/native/fixtures/main-installed-shared.cjs',
  ];
  const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const sources = Object.fromEntries(sourceFiles.map(file => [file, digest(join(repo, file))]));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mi-main-')));
  const nativeRoot = join(root, 'pool');
  mkdirSync(nativeRoot, {mode: 0o700});
  mkdirSync(join(root, 'config'), {mode: 0o700});
  const executable = await getNativeTestElectronExecutable(repo);
  const standalone = join(root, 'main_bootstrap.node');
  const embedded = join(root, 'root_resource_authority_main.node');
  const helper = join(root, 'helper');
  const launcher = join(root, 'launcher');
  const entry = join(root, 'entry.cjs');
  const configuration = join(root, 'configuration.h');
  const executableHash = createHash('sha256').update(readFileSync(executable)).digest('hex');
  writeFileSync(entry, `require(${JSON.stringify(join(repo, 'tests/native/fixtures/main-installed-shared.cjs'))})(${JSON.stringify({root, standalone, embedded})});\n`);
  writeFileSync(configuration, [
    ['MI_FIXED_ROOT', root], ['MI_LAUNCHER_EXEC', launcher],
    ['MI_MAIN_EXEC', executable], ['MI_MAIN_BUNDLE', dirname(dirname(dirname(executable)))],
    ['MI_EXPECTED_MAIN_SHA256', executableHash], ['MI_FIXTURE_MAIN_ENTRY', entry],
  ].map(([name, value]) => `#define ${name} ${JSON.stringify(value)}\n`).join('') +
    (authorityFamilies ? '#define MI_FIXTURE_AUTHORITY_SCOPES 1\n' : ''));
  const builds = [];
  function build(command, args) {
    const result = spawnSync(command, args, {cwd: repo, encoding: 'utf8'});
    builds.push({pid: result.pid, command, args, code: result.status, signal: result.signal});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  build(process.execPath, [join(repo, 'native/root-resource-authority/build-main-bootstrap.mjs'), headers, standalone, configuration]);
  build(process.execPath, [join(repo, 'native/root-resource-authority/build-main-session.mjs'), headers, embedded, nativeRoot, 'embedded', '-', configuration]);
  const sdk = spawnSync('/usr/bin/xcrun', ['--show-sdk-path'], {encoding: 'utf8'});
  assert.equal(sdk.status, 0, sdk.stderr);
  const source = join(repo, 'native/main-installation');
  const common = ['-std=c11', '-Werror', '-Wall', '-Wextra', '-Wno-deprecated-declarations',
    '-isysroot', sdk.stdout.trim(), '-I', source, '-DMI_FIXTURE_BUILD=1',
    '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(configuration)];
  for (const [file, output] of [['main-installation-entry.c', launcher], ['main-installation-helper.c', helper]]) {
    build('/usr/bin/cc', [...common, join(source, file), join(source, 'wire.c'),
      '-framework', 'Security', '-framework', 'CoreFoundation', '-framework', 'OpenDirectory', '-lbsm', '-o', output]);
  }
  for (const [file, sha256] of Object.entries(sources)) assert.equal(digest(join(repo, file)), sha256, 'source changed during fixture compilation: ' + file);
  const artifacts = Object.fromEntries([standalone, embedded, helper, launcher, entry, configuration].map(file => [file, digest(file)]));
  const prepared = {root, nativeRoot, executable, executableHash, standalone, embedded, helper, launcher, entry, configuration, builds, sources, artifacts};
  writeFileSync(join(root, 'prepared.json'), JSON.stringify(prepared, null, 2) + '\n');
  return prepared;
}
