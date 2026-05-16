import Database from 'better-sqlite3';

const CURRENT_SCHEMA_VERSION = 2;

export function getSchemaVersion(db: Database.Database): number {
  const hasTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_meta'"
  ).get();
  if (!hasTable) return 0;

  const row = db.prepare(
    "SELECT value FROM memory_meta WHERE key = 'schema_version'"
  ).get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

function setSchemaVersion(db: Database.Database, version: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO memory_meta (key, value) VALUES ('schema_version', ?)"
  ).run(String(version));
}

function migrateV0toV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_l0_raw (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      segmented_content TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      mem_type TEXT,
      cwd TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      compacted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS memory_l1_extracted (
      id TEXT PRIMARY KEY,
      source_ids TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'global',
      mem_type TEXT,
      cwd TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_l2_scenario (
      id TEXT PRIMARY KEY,
      source_ids TEXT NOT NULL DEFAULT '[]',
      scenario TEXT NOT NULL,
      key_facts TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_l3_persona (
      id TEXT PRIMARY KEY,
      source_ids TEXT NOT NULL DEFAULT '[]',
      trait TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      layer INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(memory_id, layer)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_l0_fts USING fts5(
      content,
      content='memory_l0_raw',
      content_rowid='rowid',
      tokenize="unicode61"
    );

    CREATE INDEX IF NOT EXISTS idx_l0_session ON memory_l0_raw(session_id);
    CREATE INDEX IF NOT EXISTS idx_l0_compacted ON memory_l0_raw(compacted);
    CREATE INDEX IF NOT EXISTS idx_emb_memory ON memory_embeddings(memory_id, layer);
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memory_l0_ai AFTER INSERT ON memory_l0_raw BEGIN
      INSERT INTO memory_l0_fts(rowid, content)
        VALUES (new.rowid, COALESCE(new.segmented_content, new.content));
    END;
    CREATE TRIGGER IF NOT EXISTS memory_l0_ad AFTER DELETE ON memory_l0_raw BEGIN
      INSERT INTO memory_l0_fts(memory_l0_fts, rowid, content)
        VALUES('delete', old.rowid, COALESCE(old.segmented_content, old.content));
    END;
    CREATE TRIGGER IF NOT EXISTS memory_l0_au AFTER UPDATE ON memory_l0_raw BEGIN
      INSERT INTO memory_l0_fts(memory_l0_fts, rowid, content)
        VALUES('delete', old.rowid, COALESCE(old.segmented_content, old.content));
      INSERT INTO memory_l0_fts(rowid, content)
        VALUES (new.rowid, COALESCE(new.segmented_content, new.content));
    END;
  `);

  setSchemaVersion(db, 1);
}

function migrateV1toV2(db: Database.Database): void {
  db.exec('DELETE FROM memory_embeddings');
  setSchemaVersion(db, 2);
}

const MIGRATIONS: Record<number, (db: Database.Database) => void> = {
  1: migrateV0toV1,
  2: migrateV1toV2,
};

export function runMigrations(db: Database.Database): void {
  const current = getSchemaVersion(db);
  for (let v = current + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (migrate) {
      migrate(db);
    }
  }
}
