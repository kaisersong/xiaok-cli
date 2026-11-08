import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mac = { skip: process.platform !== 'darwin', timeout: 90000 };
function invoke(name, file, args = [], extra = {}) {
    const output = mkdtempSync(join(tmpdir(), 'nmp-migration-case-'));
    mkdirSync(join(output, 'config'), { mode: 0o700 });
    const command = [process.execPath, join(repo, 'tests/native/helpers', file), ...args];
    const child = spawnSync(command[0], command.slice(1), { cwd: repo, encoding: 'utf8', timeout: 80000, env: { ...process.env, XIAOK_CONFIG_DIR: join(output, 'config'), XIAOK_MIGRATION_CASE_OUTPUT: output, XIAOK_MIGRATION_SYNTHETIC_MNP: '1', ...extra } });
    const run = { name, command, pid: child.pid, status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, error: child.error?.message, productionQualified: false, genuineMain: false, genuineEntryApproval: false };
    writeFileSync(join(output, 'driver-run.json'), JSON.stringify(run, null, 2));
    console.log(JSON.stringify({ kind: 'original-migration-driver', name, output, pid: child.pid, status: child.status }));
    assert.equal(child.error, undefined, child.stderr);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stdout + child.stderr);
    return { output, run };
}
function fresh(fault = 0) {
    const exe = statSync(process.execPath);
    assert.equal(exe.uid, userInfo().uid, 'original Native fixture requires an owned executable');
    assert.equal(exe.nlink, 1, 'original Native fixture requires nlink1; use one private COW test executable');
    const result = invoke('migration-' + fault, 'root-nmp-migration-case.mjs', [], { XIAOK_MIGRATION_FAULT: String(fault) });
    return JSON.parse(readFileSync(join(result.output, 'latest-root-io-run.json'), 'utf8'));
}
function recover(prior) { return invoke('cold-recovery', 'root-nmp-migration-recovery.mjs', [prior.root]); }
test('same original inode/pool and all seven nonempty N/M/P business tables survive Native migration and BOUND cold recovery', mac, () => {
    const prior = fresh();
    recover(prior);
    recover(prior);
});
for (const stage of [1, 2, 3, 4, 5, 6, 7, 8]) {
    test('actual original Native migration fault ' + stage + ' preserves old pool and all seven tables', mac, () => {
        const prior = fresh(stage);
        if (stage === 4 || stage === 7 || stage === 8)
            recover(prior);
    });
}
