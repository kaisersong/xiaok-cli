import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), D = process.env.XIAOK_MIGRATION_CASE_OUTPUT;
assert.ok(D && isAbsolute(D));
const root = realpathSync(mkdtempSync('/private/tmp/nmp-migration-')), metadata = join(root, 'metadata'), config = join(root, 'configuration.h'), launcher = join(root, 'launcher'), helper = join(root, 'helper'), entry = join(root, 'entry.cjs');
mkdirSync(metadata, { mode: 0o700 });
mkdirSync(join(root, 'config'), { mode: 0o700 });
const node = realpathSync(process.execPath), sha = file => createHash('sha256').update(readFileSync(file)).digest('hex'), header = process.env.XIAOK_NATIVE_NODE_HEADERS;
const fault = Number(process.env.XIAOK_MIGRATION_FAULT || 0);
assert.ok(Number.isInteger(fault) && fault >= 0 && fault <= 8);
writeFileSync(config, [['MI_FIXED_ROOT', metadata], ['MI_LAUNCHER_EXEC', launcher], ['MI_MAIN_EXEC', node], ['MI_EXPECTED_MAIN_SHA256', sha(node)], ['MI_FIXTURE_MAIN_ENTRY', entry]].map(([k, v]) => '#define ' + k + ' ' + JSON.stringify(v)).join('\n') + '\n' + (fault ? '#define NR_FIXTURE_MIGRATION_FAILURE ' + fault + '\n' : ''));
process.env.XIAOK_MIGRATION_TEST_CONFIGURATION = config;
process.env.XIAOK_NATIVE_NODE_HEADERS = header;
const { prepareRootNmpLedgerFixture } = await import('./root-nmp-ledger-fixture.mjs');
const f = prepareRootNmpLedgerFixture({ rootIoConfiguration: config });
process.env.XIAOK_CONFIG_DIR = join(root, 'config');
const api = createRequire(import.meta.url)(f.binary), owner = api.openOriginal();
let capture;
try {
    api.installFresh(owner);
    if (process.env.XIAOK_MIGRATION_SYNTHETIC_MNP === '1') {
        assert.equal(typeof api.fixtureSeedMigrationPhysicalHistory, 'function');
        api.fixtureSeedMigrationPhysicalHistory(owner);
    }
    for (let i = 0; i < 7; i++) {
        api.enqueue(owner, api.fixtureSubject(owner, i));
        if (i < 5) {
            const c = api.claimNext(owner);
            api.consumeLaunch(owner, c.reservation);
        }
    }
    capture = api.readOriginalRootPoolLedger(owner);
}
finally {
    api.close(owner);
}
const ledger = JSON.parse(capture.canonicalJson), file = join(f.domain, 'root-resource-v1.sqlite'), before = readFileSync(file), identity = statSync(file, { bigint: true });
writeFileSync(join(root, 'old-capture.json'), capture.canonicalJson);
writeFileSync(entry, 'process.env.XIAOK_CONFIG_DIR=' + JSON.stringify(join(root, 'config')) + ';const fs=require("node:fs"),api=require(' + JSON.stringify(f.binary) + ');try{const result=api.componentBootstrapInstalledRootStore();fs.writeFileSync(' + JSON.stringify(join(root, 'root-io-facts.json')) + ',JSON.stringify(result));console.log(JSON.stringify({kind:"actual-root-io-migration-component",node:process.version,result,productionQualified:false,genuineMain:false}));}catch(error){console.error(error);process.exitCode=1;}\n');
const records = [];
function build(exe, args) { const p = spawnSync(exe, args, { cwd: repo, encoding: 'utf8' }); records.push({ pid: p.pid, argv: [exe, ...args], status: p.status, stdout: p.stdout, stderr: p.stderr }); writeFileSync(join(root, 'builds.json'), JSON.stringify(records, null, 2)); assert.equal(p.error, undefined); assert.equal(p.status, 0, p.stderr); }
const common = ['-std=c11', '-Werror', '-Wno-deprecated-declarations', '-Wno-unused-function', '-DMI_FIXTURE_BUILD=1', '-DMI_ENROLLMENT_COMPONENT_BUILD=1', '-DMI_ORIGINAL_ADOPTION_ENTRY=1', '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(config), '-I', join(repo, 'native/main-installation'), '-I', join(repo, 'native/root-resource-authority'), '-I', join(repo, 'tests/native/fixtures')];
build('/usr/bin/cc', [...common, join(repo, 'native/main-installation/main-installation-entry.c'), join(repo, 'native/main-installation/wire.c'), '-framework', 'Security', '-lbsm', '-o', launcher]);
build('/usr/bin/cc', [...common, join(repo, 'tests/native/fixtures/root-nmp-adoption-files.c'), join(repo, 'native/main-installation/wire.c'), '-framework', 'Security', '-framework', 'CoreFoundation', '-framework', 'OpenDirectory', '-lbsm', '-o', helper]);
const args = [f.domain, metadata, ledger.poolId, capture.sha256, 'ipc'];
const child = spawnSync(helper, args, { cwd: root, encoding: 'utf8', timeout: 20000 });
const run = { root, source: f.domain, metadata, addon: f.binary, pid: child.pid, argv: [helper, ...args], status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, node: process.version, oldDevice: String(identity.dev), oldInode: String(identity.ino), oldPoolId: ledger.poolId, genuineEntryApproval: false, productionQualified: false };
writeFileSync(join(root, 'run.json'), JSON.stringify(run, null, 2));
writeFileSync(join(D, 'latest-root-io-run.json'), JSON.stringify(run, null, 2));
console.log(JSON.stringify(run));
assert.equal(child.error, undefined);
if (!fault)
    assert.equal(child.status, 0, child.stdout + child.stderr);
else
    assert.notEqual(child.status, 0);
const target = join(metadata, 'authority', 'root-resource.sqlite'), current = statSync(target, { bigint: true });
assert.equal(current.dev, identity.dev);
assert.equal(current.ino, identity.ino);
if (fault) {
    const check = new DatabaseSync(target, { readOnly: true });
    try {
        const floor = check.prepare('SELECT * FROM root_resource_floor').get();
        assert.equal(floor.schema_version, fault >= 7 ? 4 : 3);
        assert.equal(check.prepare('SELECT pool_id FROM root_pool_identity').get().pool_id, ledger.poolId);
        for (const table of ledger.tables.filter(t => !['root_resource_floor', 'root_pool_identity'].includes(t.name))) {
            const stmt = check.prepare('SELECT * FROM ' + table.name + (table.name === 'root_physical_policy' ? ' ORDER BY kind' : table.name === 'root_resource_policy' ? ' ORDER BY singleton' : table.name.includes('receipts') ? ' ORDER BY record_id COLLATE BINARY,kind COLLATE BINARY' : ' ORDER BY record_id COLLATE BINARY'));
            stmt.setReadBigInts(true);
            const actual = stmt.all().map(row => table.columns.map(c => { const v = row[c]; return v === null ? ['null'] : typeof v === 'bigint' ? ['integer', String(v)] : typeof v === 'string' ? ['text', Buffer.from(v).toString('hex')] : ['blob', Buffer.from(v).toString('hex')]; }));
            assert.deepEqual(actual, table.rows, table.name);
        }
        console.log(JSON.stringify({ kind: 'actual-migration-fault-checked', fault, schemaVersion: floor.schema_version, samePoolAndSevenTables: true, inode: String(current.ino), root, productionQualified: false }));
    }
    finally {
        check.close();
    }
    process.exit(0);
}
const facts = JSON.parse(readFileSync(join(root, 'root-io-facts.json'), 'utf8'));
assert.equal(facts.poolId, ledger.poolId);
assert.equal(facts.schemaVersion, 4);
assert.equal(facts.rootFilesClosed, true);
assert.equal(facts.unknown, false);
const db = new DatabaseSync(target, { readOnly: true });
try {
    for (const table of ledger.tables.filter(t => !['root_resource_floor', 'root_pool_identity'].includes(t.name))) {
        const stmt = db.prepare('SELECT * FROM ' + table.name + (table.name === 'root_physical_policy' ? ' ORDER BY kind' : table.name === 'root_resource_policy' ? ' ORDER BY singleton' : table.name.includes('receipts') ? ' ORDER BY record_id COLLATE BINARY,kind COLLATE BINARY' : ' ORDER BY record_id COLLATE BINARY'));
        stmt.setReadBigInts(true);
        const actual = stmt.all().map(row => table.columns.map(c => { const v = row[c]; return v === null ? ['null'] : typeof v === 'bigint' ? ['integer', String(v)] : typeof v === 'string' ? ['text', Buffer.from(v).toString('hex')] : ['blob', Buffer.from(v).toString('hex')]; }));
        assert.deepEqual(actual, table.rows, table.name);
    }
}
finally {
    db.close();
}
console.log(JSON.stringify({ kind: 'same-inode-root-io-migration-checks', root, poolId: ledger.poolId, inode: String(current.ino), productionQualified: false }));
