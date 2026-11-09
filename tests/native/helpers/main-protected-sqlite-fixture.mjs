import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, lstatSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {assertElectronNativeTargetSymbols} from './electron-native-target-abi.mjs';

// Compile/copy into an already-owned fixture directory. Never launches Main,
// a helper or Worker, and never changes the shared Electron installation.
export function buildMainProtectedSqliteFixture(repo, headers, output, configuration, {crashTrace = false, electronExecutable} = {}) {
  assert.equal(typeof electronExecutable, 'string', 'exact copied target Electron executable required');
  const root = dirname(output), native = join(repo, 'native/root-resource-authority');
  const facade = join(repo, 'native/protected-sqlite-facade');
  const wire = join(repo, 'native/main-installation');
  const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const includes = [native, facade, wire, headers];
  const sourceFiles = new Set();
  const capture = file => {
    if (sourceFiles.has(file)) return;
    sourceFiles.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm)) {
      const dependency = [join(dirname(file), match[1]), ...includes.map(dir => join(dir, match[1]))].find(existsSync);
      if (dependency) capture(dependency);
    }
  };
  const c = [join(facade, 'protected-sqlite-facade.c'), join(native, 'original-root-io-vfs.c'),
    join(native, 'installed-main-client.c'), join(wire, 'wire.c')];
  if (crashTrace) c.push(join(repo, 'tests/native/fixtures/budget-worker-crash-trace.c'));
  const cpp = [join(native, 'budget-worker-native-bridge.cc'), join(facade, 'admission-namespace-bridge.cc')];
  for (const file of [...c, ...cpp, configuration]) capture(file);
  const sources = Object.fromEntries([...sourceFiles].map(file => [file, digest(file)]));
  const sdk = spawnSync('/usr/bin/xcrun', ['--show-sdk-path'], {encoding: 'utf8'});
  assert.equal(sdk.status, 0, sdk.stderr);
  const common = ['-Werror', '-Wno-deprecated-declarations', '-isysroot', sdk.stdout.trim(),
    ...includes.flatMap(dir => ['-I', dir]), '-DNAPI_VERSION=8', '-DMI_FIXTURE_BUILD=1',
    '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(configuration),
    ...(crashTrace ? ['-DNR_BUDGET_DIAGNOSTIC_BACKTRACE=1'] : [])];
  const builds = [];
  const build = (command, args) => {
    const result = spawnSync(command, args, {cwd: repo, encoding: 'utf8'});
    builds.push({command, args, pid: result.pid, code: result.status, signal: result.signal, stderr: result.stderr});
    writeFileSync(join(root, 'protected-sqlite-builds.json'), JSON.stringify(builds, null, 2));
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  };
  const objects = [];
  for (const file of c) {
    const object = output + '.' + objects.length + '.o';
    build('/usr/bin/cc', [...common, '-std=c11', '-c', file, '-o', object]); objects.push(object);
  }
  for (const file of cpp) {
    const object = output + '.' + objects.length + '.o';
    build('/usr/bin/c++', [...common, '-std=c++20', '-DV8_COMPRESS_POINTERS', '-DV8_ENABLE_SANDBOX',
      '-DNR_ADMISSION_NAMESPACE_BRIDGE=1', '-c', file, '-o', object]); objects.push(object);
  }
  build('/usr/bin/c++', ['-bundle', '-undefined', 'dynamic_lookup', ...objects,
    '-lsqlite3', '-framework', 'Security', '-framework', 'CoreFoundation', '-framework', 'OpenDirectory', '-lbsm', '-o', output]);
  // Dynamic lookup permits missing C++ symbols to survive linking. Check the
  // exact target image before any Main birth; Node exports are not a substitute.
  const {framework} = assertElectronNativeTargetSymbols(output, electronExecutable,
    join(root, 'protected-sqlite-target-abi.json'));
  for (const [file, hash] of Object.entries(sources)) assert.equal(digest(file), hash, 'source drift ' + file);
  const adapter = join(root, 'harness-protected-sqlite.cjs');
  copyFileSync(join(facade, 'index.cjs'), adapter);
  const artifacts = {[output]: digest(output), [adapter]: digest(adapter), [framework]: digest(framework)};
  const electron = join(repo, 'desktop/electron');
  for (const name of readdirSync(electron)) {
    if (name !== 'harness-optimization-store-worker.mjs' && !/^harness-dsh-.*\.mjs$/.test(name)) continue;
    const source = join(electron, name), target = join(root, name);
    assert.ok(lstatSync(source).isFile()); sources[source] = digest(source);
    copyFileSync(source, target); artifacts[target] = digest(target);
  }
  const lockSource = join(repo, 'native/harness-optimization-owner-lock/owner_lock.c');
  const lockOutput = join(root, 'harness_owner_lock.node');
  sources[lockSource] = digest(lockSource);
  build('/usr/bin/cc', [...common, '-std=c11', '-bundle', '-undefined', 'dynamic_lookup', lockSource, '-o', lockOutput]);
  artifacts[lockOutput] = digest(lockOutput);
  return {sources, builds, artifacts};
}
