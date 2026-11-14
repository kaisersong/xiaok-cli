import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, realpathSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { brokerResourcePlan } from '../../native/broker-authority-source/prepare-desktop.mjs';
const repo = resolve(import.meta.dirname, '../..');
test('the actual resource planner builds portable custody and gates Native to Mac only', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const plan = brokerResourcePlan(platform);
    assert.equal(plan.portableSourceRuntime, true); assert.equal(plan.native, platform === 'darwin');
  }
  const config = JSON.parse(readFileSync(join(repo, 'desktop/electron-builder.json'), 'utf8'));
  const common = config.extraResources.filter(row => row.to === 'services/intent-broker/runtime');
  assert.deepEqual(common.flatMap(row => row.filter).sort(), ['source-runtime-manifest.json', 'xiaok-source-runtime.cjs']);
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(manifest.files.some(name => name.includes('services/intent-broker')), false);
});
for (const platform of ['win32', 'linux']) test('ordinary Broker keeps its actual loader without Native on ' + platform, t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'broker-platform-resource-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/store'), { recursive: true }); mkdirSync(join(root, 'runtime'));
  copyFileSync(join(repo, '../intent-broker/src/store/protected-sqlite-resource.js'), join(root, 'src/store/protected-sqlite-resource.js'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'runtime/original-authority-sqlite.cjs'), "throw Error('Native wrapper must not be required on this platform');");
  const script = `Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});const {pathToFileURL}=await import('node:url');const {readBrokerProtectedSQLiteResource}=await import(pathToFileURL(process.argv[1]));if(readBrokerProtectedSQLiteResource()!==null)throw Error('ordinary branch must remain null');console.log(JSON.stringify({platform:${JSON.stringify(platform)},ordinary:true,nativeLoaded:false,qualification:false}));`;
  const actual = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(root, 'src/store/protected-sqlite-resource.js')], { encoding: 'utf8', timeout: 5000 });
  console.log(JSON.stringify({ platformLoaderChild: { pid: actual.pid, status: actual.status, stdout: actual.stdout, stderr: actual.stderr } }));
  assert.equal(actual.error, undefined); assert.equal(actual.status, 0, actual.stderr);
});
test('Windows packages place the installation-absence helper beside the Broker sidecar', () => {
  const config = JSON.parse(readFileSync(join(repo, 'desktop/electron-builder.json'), 'utf8'));
  const rows = (config.win.extraResources ?? []).filter(row => row.to === 'services/intent-broker/runtime/native');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, 'dist/main/src/runtime/verification/native');
  assert.deepEqual([...rows[0].filter].sort(), ['win32-*/windows-installation-absence.exe', 'win32-*/windows-installation-absence.json']);
  // The sidecar must keep resolving native/ relative to its own directory.
  const reader = readFileSync(join(repo, 'src/runtime/verification/windows-installation-absence.ts'), 'utf8');
  assert.match(reader, /join\(root, 'native', 'win32-' \+ process\.arch, 'windows-installation-absence\.exe'\)/);
});
test('the packaged service contract fails when the Broker Windows absence helper is missing or mismatched', async t => {
  const { createRequire } = await import('node:module');
  const { createHash } = await import('node:crypto');
  const { brokerWindowsAbsenceHelper } = createRequire(import.meta.url)(join(repo, 'desktop/scripts/verify-packaged-service-contracts.cjs'));
  const resources = realpathSync(mkdtempSync(join(tmpdir(), 'broker-absence-resource-')));
  t.after(() => rmSync(resources, { recursive: true, force: true }));
  const dir = join(resources, 'services/intent-broker/runtime/native/win32-x64');
  mkdirSync(join(resources, 'services/intent-broker/runtime'), { recursive: true });
  assert.throws(() => brokerWindowsAbsenceHelper(resources, 'x64'), /packaged service contract: intent-broker windows-installation-absence: missing or escaping packaged file/);
  mkdirSync(dir, { recursive: true });
  const exe = Buffer.from('MZ-test-helper');
  writeFileSync(join(dir, 'windows-installation-absence.exe'), exe);
  writeFileSync(join(dir, 'windows-installation-absence.json'), JSON.stringify({ target: 'win32-x64', sha256: '0'.repeat(64) }));
  assert.throws(() => brokerWindowsAbsenceHelper(resources, 'x64'), /does not match its manifest/);
  writeFileSync(join(dir, 'windows-installation-absence.json'), JSON.stringify({ target: 'win32-x64', sha256: createHash('sha256').update(exe).digest('hex') }));
  assert.deepEqual(brokerWindowsAbsenceHelper(resources, 'x64'), { component: 'intent-broker-windows-absence', version: 'win32-x64' });
  assert.throws(() => brokerWindowsAbsenceHelper(resources, 'arm64'), /missing or escaping packaged file/);
});
// 1.6.3 pack blocker: the afterPack service gate spawned the Broker with the
// packaging host's Node (CI 22.x), whose DatabaseSync[Symbol.dispose] is a JS
// function the source custody holds as unknown, so the gate failed closed with
// broker_sqlite_sdk_unconfirmed while production runs the pinned Node 24 runtime.
// The gate must probe the exact pinned runtime production resolves, and refuse
// a release target whose runtime is absent, tampered or not reported by health.
{
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const contracts = req('../../desktop/scripts/verify-packaged-service-contracts.cjs');
  const brokerRuntime = req('../../desktop/electron/broker-runtime-package.cjs');
  const probeEnv = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', PORT: '1', INTENT_BROKER_DB: 'x.sqlite' };
  const tempResources = t => { const root = realpathSync(mkdtempSync(join(tmpdir(), 'broker-pack-gate-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
  for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'x64']]) test(`pack gate refuses a ${platform}-${arch} package without its pinned Broker runtime`, t => {
    assert.throws(() => contracts.serviceLaunch('intent-broker', tempResources(t), probeEnv, platform, arch), /packaged service contract: intent-broker runtime: packaged Broker Node runtime/);
  });
  test('pack gate refuses a tampered pinned Broker runtime instead of falling back to host Node', t => {
    const resources = tempResources(t), dir = join(resources, 'services/intent-broker/runtime/win32-x64');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(brokerRuntime.expectedManifest('win32-x64')));
    writeFileSync(join(dir, 'node.exe'), 'not the pinned node'); writeFileSync(join(dir, 'LICENSE'), 'x');
    assert.throws(() => contracts.serviceLaunch('intent-broker', resources, probeEnv, 'win32', 'x64'), /packaged Broker Node runtime is invalid for win32-x64/);
  });
  for (const target of ['darwin-arm64', 'win32-x64']) test(`pack gate refuses a ${target} Broker runtime whose manifest does not match the lock`, t => {
    const [platform, arch] = target.split('-');
    const resources = tempResources(t), dir = join(resources, 'services/intent-broker/runtime', target);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...brokerRuntime.expectedManifest(target), node: '22.23.4' }));
    writeFileSync(join(dir, platform === 'win32' ? 'node.exe' : 'node'), 'x'); writeFileSync(join(dir, 'LICENSE'), 'x');
    assert.throws(() => contracts.serviceLaunch('intent-broker', resources, probeEnv, platform, arch), new RegExp(`packaged Broker Node runtime (is invalid|was not selected) for ${target}`));
  });
  test('only unsupported Broker targets and KSwarm keep the host Node launcher', t => {
    const resources = tempResources(t);
    for (const [name, platform, arch] of [['intent-broker', 'linux', 'x64'], ['intent-broker', 'win32', 'ia32'], ['kswarm', 'darwin', 'arm64'], ['kswarm', 'win32', 'x64']]) {
      const launch = contracts.serviceLaunch(name, resources, probeEnv, platform, arch);
      assert.equal(launch.command, process.execPath); assert.equal(launch.runtime, null); assert.equal(launch.env, probeEnv);
    }
  });
  test('the Broker probe launches the resolved pinned runtime with its sanitized environment', t => {
    const root = tempResources(t);
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'electron'));
    copyFileSync(join(repo, 'desktop/scripts/verify-packaged-service-contracts.cjs'), join(root, 'scripts/verify.cjs'));
    const command = join(root, 'pinned', 'node');
    writeFileSync(join(root, 'electron/broker-runtime-package.cjs'), `const seen=[];module.exports={seen,targetEntry:t=>t==='darwin-arm64'?{}:null,
      resolvePackagedBrokerRuntime:o=>{seen.push(o);const env={...o.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;return Object.freeze({command:${JSON.stringify(command)},env:Object.freeze(env),expected:{}});}};`);
    const isolated = req(join(root, 'scripts/verify.cjs'));
    const launch = isolated.serviceLaunch('intent-broker', '/pkg/Resources', probeEnv, 'darwin', 'arm64');
    assert.equal(launch.command, command);
    assert.deepEqual(launch.env, { PORT: '1', INTENT_BROKER_DB: 'x.sqlite' });
    const [options] = req(join(root, 'electron/broker-runtime-package.cjs')).seen;
    assert.deepEqual({ isPackaged: options.isPackaged, resourcesPath: options.resourcesPath, platform: options.platform, arch: options.arch }, { isPackaged: true, resourcesPath: '/pkg/Resources', platform: 'darwin', arch: 'arm64' });
  });
  test('Broker health must report the pinned runtime the pack gate launched', t => {
    const command = join(tempResources(t), 'node');
    const runtime = { command, expected: { node: '24.19.0', sqlite: '3.53.3', executableSha256: 'a'.repeat(64) } };
    const healthy = { service: { runtime: { node: '24.19.0', sqlite: '3.53.3', executableSha256: 'a'.repeat(64), execPath: command } } };
    assert.doesNotThrow(() => contracts.assertBrokerRuntimeHealth('intent-broker@0.3.9', healthy, runtime));
    for (const runtimeReport of [undefined, { ...healthy.service.runtime, node: '22.23.4' }, { ...healthy.service.runtime, execPath: process.execPath }, { ...healthy.service.runtime, executableSha256: 'b'.repeat(64) }])
      assert.throws(() => contracts.assertBrokerRuntimeHealth('intent-broker@0.3.9', { service: { runtime: runtimeReport } }, runtime), /health does not report the pinned packaged Broker Node runtime/);
    assert.doesNotThrow(() => contracts.assertBrokerRuntimeHealth('kswarm@0.9.3', { ok: true }, null));
  });
}
