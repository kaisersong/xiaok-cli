/** Original sibling KSwarm constructor schema; no caller SQL. */
export declare const KSWARM_STATE_SOURCE_SCHEMA: readonly [{
    readonly type: "index";
    readonly name: "idx_state_entities_project";
    readonly tbl_name: "state_entities";
    readonly sql: "CREATE INDEX idx_state_entities_project ON state_entities (project_id)";
}, {
    readonly type: "index";
    readonly name: "idx_state_history_entity";
    readonly tbl_name: "state_entity_history";
    readonly sql: "CREATE INDEX idx_state_history_entity ON state_entity_history (collection, entity_key, revision DESC)";
}, {
    readonly type: "index";
    readonly name: "sqlite_autoindex_state_entities_1";
    readonly tbl_name: "state_entities";
    readonly sql: null;
}, {
    readonly type: "index";
    readonly name: "sqlite_autoindex_state_meta_1";
    readonly tbl_name: "state_meta";
    readonly sql: null;
}, {
    readonly type: "table";
    readonly name: "state_entities";
    readonly tbl_name: "state_entities";
    readonly sql: "CREATE TABLE state_entities ( collection TEXT NOT NULL, entity_key TEXT NOT NULL, project_id TEXT, state_json TEXT NOT NULL, checksum TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, entity_key) )";
}, {
    readonly type: "table";
    readonly name: "state_entity_history";
    readonly tbl_name: "state_entity_history";
    readonly sql: "CREATE TABLE state_entity_history ( collection TEXT NOT NULL, entity_key TEXT NOT NULL, project_id TEXT, state_json TEXT NOT NULL, checksum TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL )";
}, {
    readonly type: "table";
    readonly name: "state_meta";
    readonly tbl_name: "state_meta";
    readonly sql: "CREATE TABLE state_meta ( meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL )";
}];
export declare const KSWARM_STATE_COLUMNS: {
    readonly state_entities: readonly [{
        readonly cid: 0;
        readonly name: "collection";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 1;
        readonly hidden: 0;
    }, {
        readonly cid: 1;
        readonly name: "entity_key";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 2;
        readonly hidden: 0;
    }, {
        readonly cid: 2;
        readonly name: "project_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 3;
        readonly name: "state_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 4;
        readonly name: "checksum";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 5;
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 6;
        readonly name: "updated_at";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }];
    readonly state_entity_history: readonly [{
        readonly cid: 0;
        readonly name: "collection";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 1;
        readonly name: "entity_key";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 2;
        readonly name: "project_id";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 3;
        readonly name: "state_json";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 4;
        readonly name: "checksum";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 5;
        readonly name: "revision";
        readonly type: "INTEGER";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }, {
        readonly cid: 6;
        readonly name: "updated_at";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }];
    readonly state_meta: readonly [{
        readonly cid: 0;
        readonly name: "meta_key";
        readonly type: "TEXT";
        readonly notnull: 0;
        readonly dflt_value: null;
        readonly pk: 1;
        readonly hidden: 0;
    }, {
        readonly cid: 1;
        readonly name: "meta_value";
        readonly type: "TEXT";
        readonly notnull: 1;
        readonly dflt_value: null;
        readonly pk: 0;
        readonly hidden: 0;
    }];
};
export declare const KSWARM_STATE_QUERIES: {
    readonly state_entities: {
        readonly table: "state_entities";
        readonly columns: readonly ["collection", "entity_key", "project_id", "state_json", "checksum", "revision", "updated_at"];
    };
    readonly state_entity_history: {
        readonly table: "state_entity_history";
        readonly columns: readonly ["collection", "entity_key", "project_id", "state_json", "checksum", "revision", "updated_at"];
    };
    readonly state_meta: {
        readonly table: "state_meta";
        readonly columns: readonly ["meta_key", "meta_value"];
    };
};
export type KSwarmStateQueryId = keyof typeof KSWARM_STATE_QUERIES;
export declare const KSWARM_STATE_TABLES: readonly ("state_entities" | "state_entity_history" | "state_meta")[];
