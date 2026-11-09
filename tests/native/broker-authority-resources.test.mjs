import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, realpathSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const repo = resolve(import.meta.dirname, '../..');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function sourceFacts(root) {
  const rows = [];
  function visit(path) {
    const facts = statSync(path, { bigint: true });
    if (facts.isDirectory()) { for (const name of readdirSync(path).sort()) visit(join(path, name)); }
    else rows.push([path, sha(path), String(facts.size), String(facts.mtimeNs)]);
  }
  visit(root); return rows;
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', timeout: 120000 });
  console.log(JSON.stringify({ brokerResourceChild: { pid: result.pid, command, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr } }));
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
test('original Broker resource builder produces the fixed NAPI8 closure and real packaging paths', { skip: process.platform !== 'darwin', timeout: 120000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'broker-resource-build-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = realpathSync(join(repo, '../intent-broker'));
  const sourceRoots = [join(sibling, 'src'), join(sibling, 'adapters'), join(sibling, 'package.json'), realpathSync(join(sibling, 'node_modules/ws'))];
  const sourceBefore = sourceRoots.map(sourceFacts);
  const headers = realpathSync(process.env.XIAOK_BROKER_TEST_NODE_HEADERS || resolve(dirname(realpathSync(process.execPath)), '../include/node'));
  run(process.execPath, [join(repo, 'native/broker-authority-source/prepare-desktop.mjs'), '--headers', headers]);
  const output = join(repo, 'native/broker-authority-source/build/Release'), repeated = join(root, 'repeat');
  run(process.execPath, [join(repo, 'native/broker-authority-source/build.mjs'), headers, repeated]);
  const expected = ['protected_sqlite.node', 'broker-child-launcher', 'index.cjs', 'original-authority-sqlite.cjs', 'xiaok-source-runtime.cjs', 'artifact-manifest.json', 'source-runtime-manifest.json'];
  for (const name of expected) { assert.ok(existsSync(join(output, name)), name); assert.equal(sha(join(output, name)), sha(join(repeated, name)), name + ' must reproduce'); }
  const program = `const a=require('node:assert/strict'),p=require('node:path');const base=process.argv[1],n=require(p.join(base,'protected_sqlite.node'));a.equal(n.readOriginalBrokerSource(),undefined);const resource=require(p.join(base,'original-authority-sqlite.cjs'));a.deepEqual(Reflect.ownKeys(resource).sort(),['bindNamespace','finish','namespace']);a.equal(resource.namespace,null);a.equal(Object.isFrozen(resource),true);a.throws(()=>n.consumeOriginalBrokerSource(),e=>e.code==='BROKER_ORIGINAL_AUTHORITY_REQUIRED');a.equal(n.finishOriginalBrokerSource(),undefined);console.log(JSON.stringify({node:process.versions.node,napi:process.versions.napi,namespaceAbsent:true,actualLoaded:true,qualification:false}));`;
  run(process.execPath, ['-e', program, output]);
  if (process.env.XIAOK_BROKER_MINIMUM_NODE) run(realpathSync(process.env.XIAOK_BROKER_MINIMUM_NODE), ['-e', program, output]);
  for (const name of ['protected_sqlite.node', 'broker-child-launcher']) {
    assert.deepEqual(run('/usr/bin/lipo', ['-archs', join(output, name)]).trim().split(/\s+/).sort(), ['arm64', 'x86_64']);
    const commands = run('/usr/bin/otool', ['-l', join(output, name)]);
    assert.equal((commands.match(/minos 11\.0\b/g) || []).length, 2);
    assert.equal((commands.match(/cmd LC_UUID/g) || []).length, 2);
  }
  assert.match(run('/usr/bin/nm', ['-m', join(output, 'protected_sqlite.node')]), /weak external.*_sqlite3_changes64/);
  const config = JSON.parse(readFileSync(join(repo, 'desktop/electron-builder.json'), 'utf8'));
  const entries = [...config.extraResources, ...config.mac.extraResources].filter(row => row.to?.startsWith('services/intent-broker') || row.to === 'native/broker-child-launcher');
  assert.ok(entries.some(row => row.to === 'native/broker-child-launcher'));
  const require = createRequire(join(repo, 'desktop/package.json'));
  const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher.js');
  const resources = join(root, 'resources');
  const matchers = getFileMatchers({ extraResources: entries }, 'extraResources', resources, { defaultSrc: join(repo, 'desktop'), macroExpander: value => value, customBuildOptions: {}, globalOutDir: join(root, 'output') });
  await copyFiles(matchers, null, false);
  assert.equal(sha(join(resources, 'services/intent-broker/src/runtime/original-authority-bootstrap.js')), sha(join(repo, '../intent-broker/src/runtime/original-authority-bootstrap.js')));
  for (const name of expected.filter(name => name !== 'broker-child-launcher')) assert.equal(sha(join(resources, 'services/intent-broker/runtime', name)), sha(join(output, name)));
  assert.equal(sha(join(resources, 'native/broker-child-launcher')), sha(join(output, 'broker-child-launcher')));
  assert.ok(existsSync(join(resources, 'services/intent-broker/node_modules/ws/package.json')));
  assert.deepEqual(sourceRoots.map(sourceFacts), sourceBefore);
  console.log(JSON.stringify({ kind: 'actual-broker-resource-closure', actualElectronBuilderCopy: true, actualNapiLoaded: true, inputUnchanged: true, signed: false, installed: false, qualification: false }));
});
