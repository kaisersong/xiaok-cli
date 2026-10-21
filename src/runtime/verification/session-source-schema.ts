/** Complete sqlite_master reference produced by the actual SQLiteSessionStore
 * constructor (schema version 3). A source format upgrade must explicitly
 * qualify its full DDL; matching names alone cannot prove the original schema.
 * Data only: no statement from this manifest is executed. */
export const SESSION_SOURCE_SCHEMA = Object.freeze([
  {
    "type": "index",
    "name": "idx_session_messages_session",
    "tbl_name": "session_messages",
    "sql": "CREATE INDEX idx_session_messages_session ON session_messages(session_id, message_index)"
  },
  {
    "type": "index",
    "name": "idx_sessions_updated",
    "tbl_name": "sessions",
    "sql": "CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC)"
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_session_meta_1",
    "tbl_name": "session_meta",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_session_migrations_1",
    "tbl_name": "session_migrations",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_sessions_1",
    "tbl_name": "sessions",
    "sql": null
  },
  {
    "type": "table",
    "name": "session_messages",
    "tbl_name": "session_messages",
    "sql": "CREATE TABLE session_messages ( message_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, message_index INTEGER NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, text_content TEXT NOT NULL )"
  },
  {
    "type": "table",
    "name": "session_messages_fts",
    "tbl_name": "session_messages_fts",
    "sql": "CREATE VIRTUAL TABLE session_messages_fts USING fts5( session_id UNINDEXED, message_index UNINDEXED, text_content )"
  },
  {
    "type": "table",
    "name": "session_messages_fts_config",
    "tbl_name": "session_messages_fts_config",
    "sql": "CREATE TABLE 'session_messages_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID"
  },
  {
    "type": "table",
    "name": "session_messages_fts_content",
    "tbl_name": "session_messages_fts_content",
    "sql": "CREATE TABLE 'session_messages_fts_content'(id INTEGER PRIMARY KEY, c0, c1, c2)"
  },
  {
    "type": "table",
    "name": "session_messages_fts_data",
    "tbl_name": "session_messages_fts_data",
    "sql": "CREATE TABLE 'session_messages_fts_data'(id INTEGER PRIMARY KEY, block BLOB)"
  },
  {
    "type": "table",
    "name": "session_messages_fts_docsize",
    "tbl_name": "session_messages_fts_docsize",
    "sql": "CREATE TABLE 'session_messages_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)"
  },
  {
    "type": "table",
    "name": "session_messages_fts_idx",
    "tbl_name": "session_messages_fts_idx",
    "sql": "CREATE TABLE 'session_messages_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID"
  },
  {
    "type": "table",
    "name": "session_meta",
    "tbl_name": "session_meta",
    "sql": "CREATE TABLE session_meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL )"
  },
  {
    "type": "table",
    "name": "session_migrations",
    "tbl_name": "session_migrations",
    "sql": "CREATE TABLE session_migrations (session_id TEXT PRIMARY KEY, marker_json TEXT NOT NULL)"
  },
  {
    "type": "table",
    "name": "sessions",
    "tbl_name": "sessions",
    "sql": "CREATE TABLE sessions ( session_id TEXT PRIMARY KEY, cwd TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, forked_from_session_id TEXT, lineage_json TEXT NOT NULL, usage_json TEXT NOT NULL, compactions_json TEXT NOT NULL, prompt_snapshot_id TEXT, memory_refs_json TEXT NOT NULL, approval_refs_json TEXT NOT NULL, background_job_refs_json TEXT NOT NULL , semantic_compaction_json TEXT, compound_operations_json TEXT, store_revision INTEGER, history_digest TEXT, execution_protected INTEGER, intent_delegation_json TEXT, skill_eval_json TEXT, skill_execution_json TEXT, protected_observation_closure_json TEXT)"
  },
  {
    "type": "table",
    "name": "sqlite_sequence",
    "tbl_name": "sqlite_sequence",
    "sql": "CREATE TABLE sqlite_sequence(name,seq)"
  }
].map(row => Object.freeze(row)));
