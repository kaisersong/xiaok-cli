import type Database from 'better-sqlite3';

export const SESSION_STORE_SCHEMA_VERSION = 2;

export function applySessionStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      forked_from_session_id TEXT,
      lineage_json TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      compactions_json TEXT NOT NULL,
      prompt_snapshot_id TEXT,
      memory_refs_json TEXT NOT NULL,
      approval_refs_json TEXT NOT NULL,
      background_job_refs_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      message_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      text_content TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
      session_id UNINDEXED,
      message_index UNINDEXED,
      text_content
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id, message_index);
  `);

  ensureColumn(db, 'sessions', 'intent_delegation_json', 'TEXT');
  ensureColumn(db, 'sessions', 'skill_eval_json', 'TEXT');

  db.prepare(`
    INSERT INTO session_meta (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SESSION_STORE_SCHEMA_VERSION));
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const existingColumns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (existingColumns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
