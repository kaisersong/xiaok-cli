import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getSchemaVersion } from '../../../src/ai/memory/migrations.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('migrations', () => {
  let db: Database.Database;
  let tmpDir: string;

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should start at schema version 0 on empty db', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-mig-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    expect(getSchemaVersion(db)).toBe(0);
  });

  it('should migrate to version 1 and create all tables', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-mig-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));

    runMigrations(db);

    expect(getSchemaVersion(db)).toBe(1);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name);

    expect(tables).toContain('memory_meta');
    expect(tables).toContain('memory_l0_raw');
    expect(tables).toContain('memory_l1_extracted');
    expect(tables).toContain('memory_l2_scenario');
    expect(tables).toContain('memory_l3_persona');
    expect(tables).toContain('memory_embeddings');
    expect(tables).toContain('memory_l0_fts');
  });

  it('should be idempotent', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-mig-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));

    runMigrations(db);
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(1);
  });
});
