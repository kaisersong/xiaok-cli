import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const mode of ['new', 'legacy', 'same-tenant']) test('original Main population preserves genuine source identity in the original ledger: ' + mode, {
    skip: process.platform !== 'darwin',
    timeout: 45000,
}, async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-github-population-'));
    const electron = await getNativeTestElectronExecutable(repo);
    const env = {...process.env, XIAOK_CONFIG_DIR: join(root, 'config')};
    delete env.NODE_OPTIONS;
    delete env.ELECTRON_RUN_AS_NODE;
    const args = [join(repo, 'tests/native/fixtures/github-source-population.cjs'), repo, root, mode];
    const child = spawn(electron, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
    const run = {pid: child.pid, argv: [electron, ...args], stdout: '', stderr: '', signals: []};
    writeFileSync(join(root, 'birth.json'), JSON.stringify(run));
    child.stdout.on('data', raw => run.stdout += raw);
    child.stderr.on('data', raw => run.stderr += raw);
    let escalation;
    const timer = setTimeout(() => {
        run.signals.push('SIGTERM');
        child.kill('SIGTERM');
        escalation = setTimeout(() => {
            run.signals.push('SIGKILL');
            child.kill('SIGKILL');
        }, 2000);
    }, 25000);
    await new Promise((yes, no) => {
        child.once('error', no);
        child.once('close', (code, signal) => {
            Object.assign(run, {code, signal, reaped: true});
            yes();
        });
    });
    clearTimeout(timer);
    clearTimeout(escalation);
    writeFileSync(join(root, 'run.json'), JSON.stringify(run));
    console.log(JSON.stringify({root, ...run}));
    const facts = JSON.parse(readFileSync(join(root, 'facts.json'), 'utf8'));
    assert.equal(run.code, 0, JSON.stringify(facts));
    assert.deepEqual(run.signals, []);
    assert.equal(facts.ok, true);
    assert.deepEqual(facts.tenants, mode === 'same-tenant' ? ['tenant-a', 'tenant-a'] : ['tenant-a', 'tenant-b']);
    assert.equal(facts.requests, mode === 'legacy' ? 5 : mode === 'same-tenant' ? 6 : 4);
    assert.equal(facts.spentRequests, facts.requests);
    assert.equal(facts.distinctLedgerOwners, 1);
    assert.equal(facts.runtimeSurvivedPopulationClose, true);
    if (mode === 'legacy') assert.equal(facts.legacyHistoryPreserved, true);
    if (mode === 'same-tenant') assert.equal(facts.distinctBindingsRead, 2);
});
