import { assertNativeSqliteProducerTableKinds, assertNativeSqliteStoredProducerColumns } from './native-sqlite-census.js';
const SQL = 'CREATE TABLE verification_storage_features(feature TEXT PRIMARY KEY NOT NULL,minimum_schema INTEGER NOT NULL)';
export function assertStorageOwnerSchema(database, manifest) {
    assertNativeSqliteProducerTableKinds(database);
    const table = database.prepare("SELECT sql FROM main.sqlite_master WHERE type='table' AND name='verification_storage_features'").get();
    if (!table)
        return;
    if (table.sql !== SQL)
        throw Error('kswarm_storage_schema');
    assertNativeSqliteStoredProducerColumns(database, 'verification_storage_features');
    for (const row of database.prepare('SELECT feature,minimum_schema FROM main.verification_storage_features').all()) {
        if (row.feature !== 'kswarm-owner' || row.minimum_schema !== 2 || manifest.version !== 3 || manifest.completionOwnerSchema !== 2)
            throw Error('kswarm_storage_schema');
    }
}
export function prepareStorageOwnerSchema(database) {
    const table = database.prepare("SELECT sql FROM main.sqlite_master WHERE type='table' AND name='verification_storage_features'").get();
    if (table) {
        if (table.sql !== SQL)
            throw Error('kswarm_storage_schema');
    }
    else
        database.exec(SQL);
}
export function recordKSwarmStorageFeature(database) {
    if (!database.inTransaction)
        throw Error('kswarm_storage_transaction');
    prepareStorageOwnerSchema(database);
    const existing = database.prepare('SELECT feature,minimum_schema FROM main.verification_storage_features').all();
    if (existing.some(r => r.feature !== 'kswarm-owner' || r.minimum_schema !== 2))
        throw Error('kswarm_storage_schema');
    if (!existing.length && database.prepare('INSERT INTO main.verification_storage_features VALUES(?,?)').run('kswarm-owner', 2).changes !== 1)
        throw Error('kswarm_storage_schema');
    const actual = database.prepare('SELECT feature,minimum_schema FROM main.verification_storage_features').all();
    if (JSON.stringify(actual) !== JSON.stringify([{ feature: 'kswarm-owner', minimum_schema: 2 }]))
        throw Error('kswarm_storage_schema');
}
