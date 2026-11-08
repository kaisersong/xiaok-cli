import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), root = process.argv[2], prior = JSON.parse(readFileSync(join(root, 'run.json'), 'utf8')), old = JSON.parse(readFileSync(join(root, 'old-capture.json'), 'utf8')), work = join(root, 'recovery-' + Date.now());
mkdirSync(work, { mode: 0o700 });
const configuration = join(work, 'configuration.h'), launcher = join(work, 'launcher'), helper = join(work, 'helper'), entry = join(work, 'entry.cjs');
let cfg = readFileSync(join(root, 'configuration.h'), 'utf8').replace(/^#define NR_FIXTURE_MIGRATION_FAILURE.*\n/gm, '');
cfg = cfg.replace(/^#define MI_LAUNCHER_EXEC .*$/m, '#define MI_LAUNCHER_EXEC ' + JSON.stringify(launcher)).replace(/^#define MI_FIXTURE_MAIN_ENTRY .*$/m, '#define MI_FIXTURE_MAIN_ENTRY ' + JSON.stringify(entry));
writeFileSync(configuration, cfg);
process.env.XIAOK_MIGRATION_TEST_CONFIGURATION = configuration;
const { prepareRootNmpLedgerFixture } = await import('./root-nmp-ledger-fixture.mjs');
const f = prepareRootNmpLedgerFixture({ rootIoConfiguration: configuration });
writeFileSync(entry, 'process.env.XIAOK_CONFIG_DIR=' + JSON.stringify(join(root, 'config')) + ';const fs=require("node:fs"),api=require(' + JSON.stringify(f.binary) + ');try{const result=api.componentBootstrapInstalledRootStore();fs.writeFileSync(' + JSON.stringify(join(work, 'facts.json')) + ',JSON.stringify(result));console.log(JSON.stringify({kind:"actual-original-cold-migration-recovery",node:process.version,result,productionQualified:false,genuineMain:false}));}catch(error){console.error(error);process.exitCode=1;}\n');
const records = [];
function build(exe, args) { const p = spawnSync(exe, args, { cwd: repo, encoding: 'utf8' }); records.push({ pid: p.pid, argv: [exe, ...args], status: p.status, stdout: p.stdout, stderr: p.stderr }); writeFileSync(join(work, 'builds.json'), JSON.stringify(records, null, 2)); assert.equal(p.error, undefined); assert.equal(p.status, 0, p.stderr); }
const common = ['-std=c11', '-Werror', '-Wno-deprecated-declarations', '-Wno-unused-function', '-DMI_FIXTURE_BUILD=1', '-DMI_ENROLLMENT_COMPONENT_BUILD=1', '-DMI_ORIGINAL_ADOPTION_ENTRY=1', '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(configuration), '-I', join(repo, 'native/main-installation'), '-I', join(repo, 'native/root-resource-authority'), '-I', join(repo, 'tests/native/fixtures')];
build('/usr/bin/cc', [...common, join(repo, 'native/main-installation/main-installation-entry.c'), join(repo, 'native/main-installation/wire.c'), '-framework', 'Security', '-lbsm', '-o', launcher]);
build('/usr/bin/cc', [...common, join(repo, 'tests/native/fixtures/root-nmp-adoption-files.c'), join(repo, 'native/main-installation/wire.c'), '-framework', 'Security', '-framework', 'CoreFoundation', '-framework', 'OpenDirectory', '-lbsm', '-o', helper]);
const args = prior.argv.slice(1, -1).concat('ipc-restore'), p = spawnSync(helper, args, { cwd: work, encoding: 'utf8', timeout: 20000 });
const run = { root, work, pid: p.pid, argv: [helper, ...args], status: p.status, signal: p.signal, stdout: p.stdout, stderr: p.stderr, productionQualified: false, genuineEntryApproval: false };
writeFileSync(join(work, 'run.json'), JSON.stringify(run, null, 2));
console.log(JSON.stringify(run));
assert.equal(p.error, undefined);
assert.equal(p.status, 0, p.stdout + p.stderr);
const target = join(prior.metadata, 'authority', 'root-resource.sqlite'), identity = statSync(target, { bigint: true });
assert.equal(String(identity.dev), prior.oldDevice);
assert.equal(String(identity.ino), prior.oldInode);
const db = new DatabaseSync(target, { readOnly: true });
try {
    assert.equal(db.prepare('SELECT * FROM root_resource_floor').get().schema_version, 4);
    assert.equal(db.prepare('SELECT pool_id FROM root_pool_identity').get().pool_id, old.poolId);
    for (const t of old.tables.filter(t => !['root_resource_floor', 'root_pool_identity'].includes(t.name))) {
        const stmt = db.prepare('SELECT * FROM ' + t.name + (t.name === 'root_physical_policy' ? ' ORDER BY kind' : t.name === 'root_resource_policy' ? ' ORDER BY singleton' : t.name.includes('receipts') ? ' ORDER BY record_id COLLATE BINARY,kind COLLATE BINARY' : ' ORDER BY record_id COLLATE BINARY'));
        stmt.setReadBigInts(true);
        const actual = stmt.all().map(r => t.columns.map(c => { const v = r[c]; return v === null ? ['null'] : typeof v === 'bigint' ? ['integer', String(v)] : typeof v === 'string' ? ['text', Buffer.from(v).toString('hex')] : ['blob', Buffer.from(v).toString('hex')]; }));
        assert.deepEqual(actual, t.rows, t.name);
    }
}
finally {
    db.close();
}
console.log(JSON.stringify({ kind: 'actual-cold-recovery-all-seven-tables', root, work, poolId: old.poolId, inode: String(identity.ino), productionQualified: false }));
