import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn, spawnSync} from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function actual(mode) {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-workflow-process-gang-'));
  const domain = join(root, 'domain');
  mkdirSync(domain);
  if (mode === 'legacy') {
    copyFileSync(join(repo, 'tests/native/fixtures/workflow-process-gang-v3.sqlite'),
      join(domain, 'root-resource-v1.sqlite'));
  }
  const factsHeader = join(root, 'finite-facts.h');
  writeFileSync(factsHeader, `static const char *nr_fixture_metadata[]={NULL};
static const char *nr_fixture_execution_keys[]={NULL};
static const int nr_fixture_priorities[]={0};
#define NR_FIXTURE_FACT_COUNT 0\n`);
  const addon = join(root, 'main.node');
  const build = spawnSync(process.execPath, [
    join(repo, 'native/root-resource-authority/build-main-session.mjs'),
    process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS, addon, domain, 'embedded', factsHeader,
  ], {encoding: 'utf8'});
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const electron = await getNativeTestElectronExecutable(repo);
  const result = join(root, 'facts.json');
  const args = [join(repo, 'tests/native/fixtures/workflow-process-gang.cjs'),
    addon, domain, result, join(root, 'userData'), mode];
  const env = {...process.env};
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  const row = {pid: child.pid, argv: [electron, ...args], signals: [], stdout: '', stderr: ''};
  row.birth = spawnSync('ps', ['-p', String(child.pid), '-o', 'lstart='], {encoding: 'utf8'}).stdout.trim();
  writeFileSync(join(root, 'birth.json'), JSON.stringify(row, null, 2));
  child.stdout.on('data', value => { row.stdout += value; });
  child.stderr.on('data', value => { row.stderr += value; });
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      row.signals.push('SIGTERM');
      child.kill('SIGTERM');
    }
  }, 20000);
  try {
    await new Promise((yes, no) => {
      child.once('error', no);
      child.once('close', (code, signal) => {
        Object.assign(row, {code, signal, reaped: true});
        yes();
      });
    });
  } finally {
    clearTimeout(timer);
    writeFileSync(join(root, 'run.json'), JSON.stringify(row, null, 2));
  }
  console.log(JSON.stringify({root, ...row}));
  assert.equal(row.code, 0, row.stderr);
  assert.deepEqual(row.signals, []);
  const facts = JSON.parse(readFileSync(result, 'utf8'));
  assert.equal(facts.pid, child.pid);
  assert.equal(facts.ok, true, JSON.stringify(facts));
}

test('actual Native workflow VM has a fixed pair-admission API',
  {skip: process.platform !== 'darwin', timeout: 60000}, () => actual('api'));
test('same original P2 admits one VM with a child slot and lets its actual child advance',
  {skip: process.platform !== 'darwin', timeout: 60000}, () => actual('gang'));
test('v4 refuses the actual previous Native v3 database without rewriting history',
  {skip: process.platform !== 'darwin', timeout: 60000}, () => actual('legacy'));
test('Native physical fault probes have fixed fixture-only entry points',
  {skip: process.platform !== 'darwin', timeout: 60000}, () => actual('fault-api'));
test('same invocation cannot replay an ordinary P row as a two-slot VM group',
  {skip: process.platform !== 'darwin', timeout: 60000}, () => actual('role-conflict'));
test('identical VM metadata under two consumed Native roots preserves exact parent identity',
  {skip: process.platform !== 'darwin', timeout: 60000}, () => actual('parent-binding'));
for (const column of ['allocation_role', 'parent_record_id', 'native_root_id']) {
  test('real Native full-cell guard rejects changed SQL binding ' + column,
    {skip: process.platform !== 'darwin', timeout: 60000}, () => actual('guard-' + column));
}
for (const operation of ['claim', 'settle']) {
  test('original physical ' + operation + ' wrapper failure preserves actual committed SQL and closes grants',
    {skip: process.platform !== 'darwin', timeout: 60000}, () => actual('commit-' + operation));
}
