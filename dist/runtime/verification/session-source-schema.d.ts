/** Complete sqlite_master reference produced by the actual SQLiteSessionStore
 * constructor (schema version 3). A source format upgrade must explicitly
 * qualify its full DDL; matching names alone cannot prove the original schema.
 * Data only: no statement from this manifest is executed. */
export declare const SESSION_SOURCE_SCHEMA: readonly Readonly<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string;
} | {
    type: string;
    name: string;
    tbl_name: string;
    sql: null;
}>[];
