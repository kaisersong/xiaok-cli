import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {assertMacOS12Deployment} from './helpers/macho-minimum.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(repo, 'desktop/package.json'));
test('Electron supplies Node 24 in real Main and macOS binaries declare macOS 12 compatibility', {
  skip: !['darwin', 'win32'].includes(process.platform), timeout: 60000,
}, async () => {
  const source = require('electron');
  const appRoot = dirname(dirname(dirname(source)));
  const root = mkdtempSync(join(tmpdir(), 'xiaok-runtime-version-'));
  if (process.platform === 'darwin') {
  const plist = spawnSync('/usr/libexec/PlistBuddy', [
    '-c', 'Print :LSMinimumSystemVersion', join(appRoot, 'Contents/Info.plist'),
  ], {encoding: 'utf8'});
  assert.equal(plist.status, 0, plist.stderr);
  assert.equal(plist.stdout.trim(), '12.0');
  const frameworks = join(appRoot, 'Contents/Frameworks');
  const helpers = readdirSync(frameworks).filter(name => name.endsWith('.app'))
    .map(name => join(frameworks, name, 'Contents/MacOS', name.slice(0, -4)));
  assert.ok(helpers.length >= 3, 'missing Helper applications');
  let binaryIndex = 0;
  for (const binary of [source, join(frameworks, 'Electron Framework.framework/Versions/A/Electron Framework'), ...helpers]) {
    // otool interprets parentheses in Helper names as archive-member syntax.
    const inspectionPath = join(root, 'binary-' + binaryIndex++);
    symlinkSync(binary, inspectionPath);
    const macho = spawnSync('otool', ['-l', inspectionPath], {encoding: 'utf8'});
    assert.equal(macho.status, 0, macho.stderr);
    assertMacOS12Deployment(macho.stdout);
  }
  }
  const electron = process.platform === 'darwin' ? await getNativeTestElectronExecutable(repo) : source;
  const resultPath = join(root, 'facts.json');
  const env = {...process.env};
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH']) delete env[key];
  const run = spawnSync(electron, [join(repo, 'tests/native/fixtures/electron-runtime-version.cjs'), resultPath, join(root, 'userData')], {
    env, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  const facts = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.equal(facts.type, 'browser');
  assert.equal(facts.electron, '43.8.10');
  assert.equal(Number(facts.node.split('.')[0]), 24);
  if (process.platform === 'darwin') assert.equal(facts.dockVisible, false);
  console.log(JSON.stringify({root, ...facts, mainPid: run.pid, mainExitCode: run.status, macOS12ExecutionVerified: false}));
});
