import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareRootNmpLedgerFixture } from './helpers/root-nmp-ledger-fixture.mjs';
const mac = { skip: process.platform !== 'darwin' };
const fuseName = 'root-resource-migration.fuse';
function expectRetired(api) {
    let unexpected;
    let primary, primaryPresent = false;
    try {
        assert.throws(() => { unexpected = api.openOriginal(); }, /ROOT_RESOURCE_MIGRATION_RETIRED/);
    }
    catch (error) {
        primaryPresent = true;
        primary = error;
    }
    try {
        if (unexpected !== undefined)
            api.close(unexpected);
    }
    catch (cleanup) {
        if (primaryPresent)
            throw new AggregateError([primary, cleanup], 'fixture cleanup failed', { cause: primary });
        throw cleanup;
    }
    if (primaryPresent)
        throw primary;
}
function prepare() {
    const fixture = prepareRootNmpLedgerFixture();
    process.env.XIAOK_CONFIG_DIR = join(fixture.root, 'config');
    const api = createRequire(import.meta.url)(fixture.binary);
    return { fixture, api };
}
test('a durable partial migration fuse refuses ordinary fresh birth before issuer or database creation', mac, () => {
    const { fixture, api } = prepare();
    writeFileSync(join(fixture.domain, fuseName), Buffer.from([1]), { flag: 'wx', mode: 0o600 });
    expectRetired(api);
    assert.equal(existsSync(join(fixture.domain, 'issuer.lock')), false);
    assert.equal(existsSync(join(fixture.domain, 'root-resource-v1.sqlite')), false);
    console.log(JSON.stringify({ kind: 'root-nmp-fuse-before-birth', root: fixture.root, productionQualified: false }));
});
test('a migration fuse denies a new ordinary owner while preserving the original nonempty v7 inode and bytes', mac, () => {
    const { fixture, api } = prepare();
    const owner = api.openOriginal();
    try {
        api.installFresh(owner);
        for (let i = 0; i < 3; i++)
            api.enqueue(owner, api.fixtureSubject(owner, i));
    }
    finally {
        api.close(owner);
    }
    const file = join(fixture.domain, 'root-resource-v1.sqlite');
    const before = readFileSync(file), identity = statSync(file, { bigint: true });
    writeFileSync(join(fixture.domain, fuseName), Buffer.alloc(512), { flag: 'wx', mode: 0o600 });
    expectRetired(api);
    const after = statSync(file, { bigint: true });
    assert.equal(after.dev, identity.dev);
    assert.equal(after.ino, identity.ino);
    assert.deepEqual(readFileSync(file), before);
    console.log(JSON.stringify({ kind: 'root-nmp-fuse-preserves-original', root: fixture.root, inode: String(after.ino), productionQualified: false }));
});
test('an unexpected migration fuse entry is negative evidence and cannot mint a fresh ordinary database', mac, () => {
    const { fixture, api } = prepare();
    mkdirSync(join(fixture.domain, fuseName), { mode: 0o700 });
    expectRetired(api);
    assert.equal(existsSync(join(fixture.domain, 'root-resource-v1.sqlite')), false);
    console.log(JSON.stringify({ kind: 'root-nmp-fuse-unexpected-entry', root: fixture.root, productionQualified: false }));
});
