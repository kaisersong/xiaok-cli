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
