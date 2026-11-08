import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareRootNmpLedgerFixture } from './helpers/root-nmp-ledger-fixture.mjs';
const mac = { skip: process.platform !== 'darwin' };
function setup() { const f = prepareRootNmpLedgerFixture(); process.env.XIAOK_CONFIG_DIR = join(f.root, 'config'); return { f, api: createRequire(import.meta.url)(f.binary) }; }
test('original Native v7 migration validation reads its complete nonempty graph without changing pool bytes or inode', mac, () => {
    const { f, api } = setup();
    const owner = api.openOriginal();
    try {
        api.installFresh(owner);
        for (let i = 0; i < 7; i++) {
            api.enqueue(owner, api.fixtureSubject(owner, i));
            if (i < 5) {
                const c = api.claimNext(owner);
                api.consumeLaunch(owner, c.reservation);
            }
        }
        const file = join(f.domain, 'root-resource-v1.sqlite'), before = readFileSync(file), identity = statSync(file, { bigint: true });
        assert.equal(typeof api.fixtureValidateOrdinaryV7History, 'function');
        assert.equal(api.fixtureValidateOrdinaryV7History(owner), undefined);
        assert.deepEqual(readFileSync(file), before);
        assert.equal(statSync(file, { bigint: true }).ino, identity.ino);
        const ledger = JSON.parse(api.readOriginalRootPoolLedger(owner).canonicalJson);
        assert.equal(ledger.tables.find(t => t.name === 'root_resources').rows.length, 7);
        console.log(JSON.stringify({ kind: 'actual-native-v7-validation', root: f.root, poolId: ledger.poolId, inode: String(identity.ino), productionQualified: false }));
    }
    finally {
        api.close(owner);
    }
});
test('v7 migration preflight refuses an extra actual SQLite index and preserves that original source', mac, () => {
    const { f, api } = setup();
    let owner = api.openOriginal();
    try {
        api.installFresh(owner);
    }
    finally {
        api.close(owner);
    }
    const file = join(f.domain, 'root-resource-v1.sqlite');
    const raw = new DatabaseSync(file);
    try {
        raw.exec('CREATE INDEX migration_unexpected_index ON root_resources(state)');
    }
    finally {
        raw.close();
    }
    const before = readFileSync(file);
    owner = api.openOriginal();
    try {
        assert.equal(typeof api.fixtureValidateOrdinaryV7History, 'function');
        assert.throws(() => api.fixtureValidateOrdinaryV7History(owner), /ROOT_RESOURCE_V7_HISTORY_UNCONFIRMED/);
        assert.deepEqual(readFileSync(file), before);
    }
    finally {
        api.close(owner);
    }
});
