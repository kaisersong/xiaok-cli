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
