import { assertNativeSqliteProducerTableKinds, assertNativeSqliteStoredProducerColumns } from './native-sqlite-census.js';
/** The one original controller trigger. External source DB triggers are not admitted here. */
export const PUBLICATION_SETTLEMENT_FENCE_SQL = "CREATE TRIGGER publication_unapproved_settlement_fence BEFORE INSERT ON settlement_decisions\n WHEN EXISTS(SELECT 1 FROM publication_operations p WHERE json_extract(p.review_json,'$.tuple.operationId')=NEW.operation_id AND p.state='not_approved')\n BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM publication_operations p WHERE json_extract(p.review_json,'$.tuple.operationId')=NEW.operation_id AND p.state='not_approved' AND p.owner_key=NEW.owner_key AND json_extract(p.review_json,'$.tuple')=NEW.tuple_json) THEN RAISE(ABORT,'publication_operation_not_approved') ELSE RAISE(ABORT,'publication_operation_tuple_binding') END; END";
export function assertKSwarmSqlIntegrity(db) {
    assertNativeSqliteProducerTableKinds(db);
    for (const table of ['verification_owners', 'mandatory_observation_checks', 'verification_owner_dependencies', 'verification_registered_owners', 'verification_profiles', 'verification_registered_invocations', 'owner_enrollment_invocation_receipts', 'owner_enrollment_kswarm_subjects', 'verification_storage_features'])
        assertNativeSqliteStoredProducerColumns(db, table);
    if (db.pragma('writable_schema', { simple: true }) !== 0)
        throw Error('enrollment_kswarm_sql_integrity');
    const namespaces = db.pragma('database_list');
    if (!Array.isArray(namespaces) || namespaces.some(row => !row || typeof row.name !== 'string' || !['main', 'temp'].includes(row.name)))
        throw Error('enrollment_kswarm_sql_integrity');
    const main = db.prepare("SELECT name,tbl_name,sql FROM main.sqlite_master WHERE type='trigger'").all();
    if (main.some(row => row.name !== 'publication_unapproved_settlement_fence' || row.tbl_name !== 'settlement_decisions' || row.sql !== PUBLICATION_SETTLEMENT_FENCE_SQL) || db.prepare("SELECT 1 FROM temp.sqlite_master WHERE type IN ('trigger','table','view')").get())
        throw Error('enrollment_kswarm_sql_integrity');
}
