import {freezeCapturedData} from './captured-source-json.js';
/** Original sibling KSwarm constructor schema; no caller SQL. */
export const KSWARM_STATE_SOURCE_SCHEMA = [
  {
    "type": "index",
    "name": "idx_state_entities_project",
    "tbl_name": "state_entities",
    "sql": "CREATE INDEX idx_state_entities_project ON state_entities (project_id)"
  },
  {
    "type": "index",
    "name": "idx_state_history_entity",
    "tbl_name": "state_entity_history",
    "sql": "CREATE INDEX idx_state_history_entity ON state_entity_history (collection, entity_key, revision DESC)"
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_state_entities_1",
    "tbl_name": "state_entities",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_state_meta_1",
    "tbl_name": "state_meta",
    "sql": null
  },
  {
    "type": "table",
    "name": "state_entities",
    "tbl_name": "state_entities",
    "sql": "CREATE TABLE state_entities ( collection TEXT NOT NULL, entity_key TEXT NOT NULL, project_id TEXT, state_json TEXT NOT NULL, checksum TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, entity_key) )"
  },
  {
    "type": "table",
    "name": "state_entity_history",
    "tbl_name": "state_entity_history",
    "sql": "CREATE TABLE state_entity_history ( collection TEXT NOT NULL, entity_key TEXT NOT NULL, project_id TEXT, state_json TEXT NOT NULL, checksum TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL )"
  },
  {
    "type": "table",
    "name": "state_meta",
    "tbl_name": "state_meta",
    "sql": "CREATE TABLE state_meta ( meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL )"
  }
] as const;
export const KSWARM_STATE_COLUMNS = {
  "state_entities": [
    {
      "cid": 0,
      "name": "collection",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 1,
      "hidden": 0
    },
    {
      "cid": 1,
      "name": "entity_key",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 2,
      "hidden": 0
    },
    {
      "cid": 2,
      "name": "project_id",
      "type": "TEXT",
      "notnull": 0,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 3,
      "name": "state_json",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 4,
      "name": "checksum",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 5,
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 6,
      "name": "updated_at",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    }
  ],
  "state_entity_history": [
    {
      "cid": 0,
      "name": "collection",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 1,
      "name": "entity_key",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 2,
      "name": "project_id",
      "type": "TEXT",
      "notnull": 0,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 3,
      "name": "state_json",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 4,
      "name": "checksum",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 5,
      "name": "revision",
      "type": "INTEGER",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    },
    {
      "cid": 6,
      "name": "updated_at",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    }
  ],
  "state_meta": [
    {
      "cid": 0,
      "name": "meta_key",
      "type": "TEXT",
      "notnull": 0,
      "dflt_value": null,
      "pk": 1,
      "hidden": 0
    },
    {
      "cid": 1,
      "name": "meta_value",
      "type": "TEXT",
      "notnull": 1,
      "dflt_value": null,
      "pk": 0,
      "hidden": 0
    }
  ]
} as const;
export const KSWARM_STATE_QUERIES = {
  "state_entities": {
    "table": "state_entities",
    "columns": [
      "collection",
      "entity_key",
      "project_id",
      "state_json",
      "checksum",
      "revision",
      "updated_at"
    ]
  },
  "state_entity_history": {
    "table": "state_entity_history",
    "columns": [
      "collection",
      "entity_key",
      "project_id",
      "state_json",
      "checksum",
      "revision",
      "updated_at"
    ]
  },
  "state_meta": {
    "table": "state_meta",
    "columns": [
      "meta_key",
      "meta_value"
    ]
  }
} as const;
export type KSwarmStateQueryId=keyof typeof KSWARM_STATE_QUERIES;
export const KSWARM_STATE_TABLES=Object.freeze(Object.keys(KSWARM_STATE_QUERIES) as KSwarmStateQueryId[]);

freezeCapturedData(KSWARM_STATE_SOURCE_SCHEMA);
freezeCapturedData(KSWARM_STATE_COLUMNS);
freezeCapturedData(KSWARM_STATE_QUERIES);
