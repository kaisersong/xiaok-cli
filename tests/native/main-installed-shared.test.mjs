import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {prepareMainInstalledFixture} from './helpers/main-installed-fixture.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
test('original early Main shares one installation birth across two real DSOs and closes after Source revoke',
  {skip: process.platform !== 'darwin', timeout: 45000}, async () => {
    const prepared = await prepareMainInstalledFixture(repo, process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS);
    const {helper, root, executable, executableHash} = prepared;
    for (const [file, sha256] of Object.entries(prepared.sources)) {
      assert.equal(createHash('sha256').update(readFileSync(join(repo, file))).digest('hex'), sha256);
    }
    const child = spawn(helper, [], {cwd: root, env: {PATH: '/usr/bin:/bin', LC_ALL: 'C'}, stdio: ['pipe', 'pipe', 'pipe']});
    const row = {pid: child.pid, argv: [helper], stdout: '', stderr: '', signals: [], reaped: false};
    writeFileSync(join(root, 'birth.json'), JSON.stringify(row) + '\n');
    let stopSent = false;
    child.stdout.on('data', value => {
      row.stdout += value;
      if (!stopSent && row.stdout.includes('"kind":"original-main-installed-ready"')) {
        stopSent = true;
        child.stdin.end('STOP\n');
      }
    });
    child.stderr.on('data', value => { row.stderr += value; });
    const timer = setTimeout(() => { row.signals.push('SIGTERM'); child.kill('SIGTERM'); }, 20000);
    try {
      await new Promise((yes, no) => {
        child.once('error', no);
        child.once('close', (code, signal) => { Object.assign(row, {code, signal, reaped: true}); yes(); });
      });
    } finally {
      clearTimeout(timer);
      writeFileSync(join(root, 'run.json'), JSON.stringify(row, null, 2) + '\n');
    }
    console.log(JSON.stringify({root, ...row}));
    assert.equal(row.code, 0, row.stdout + row.stderr);
    assert.equal(row.signal, null);
    assert.deepEqual(row.signals, []);
    const rows = row.stdout.split('\n').filter(value => value.startsWith('{')).map(value => JSON.parse(value));
    assert.equal(rows.filter(value => value.event === 'spawn').length, 1);
    const reaped = rows.filter(value => value.event === 'reaped');
    assert.equal(reaped.length, 1);
    assert.equal(reaped[0].status, 0);
    const facts = JSON.parse(readFileSync(join(root, 'facts.json'), 'utf8'));
    assert.equal(facts.failed, false);
    assert.equal(facts.actualMain, true);
    assert.equal(facts.foreignTraps, 0);
    assert.equal(facts.sameClientCounters, true);
    assert.equal(facts.closed.rootFilesClosed, true);
    assert.equal(facts.productionQualified, false);
    assert.equal(facts.ready.type, 'browser');
    assert.equal(facts.ready.dockVisible, false);
    assert.equal((row.stderr.match(/MI_FIXTURE_HELLO_ACCEPTED/g) || []).length, 2);
    assert.equal(createHash('sha256').update(readFileSync(executable)).digest('hex'), executableHash);
    for (const [file, sha256] of Object.entries(prepared.sources)) {
      assert.equal(createHash('sha256').update(readFileSync(join(repo, file))).digest('hex'), sha256);
    }
  });
