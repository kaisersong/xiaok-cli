import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hybridSearch } from '../../../src/ai/memory/retrieval.js';
import { runMigrations } from '../../../src/ai/memory/migrations.js';
import { EmbeddingClient } from '../../../src/ai/memory/embedding.js';

describe('hybridSearch', () => {
  let db: Database.Database;
  let tmpDir: string;
  let embeddingClient: EmbeddingClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-ret-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    runMigrations(db);
    embeddingClient = new EmbeddingClient(db, {
      apiUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return BM25 results when no embeddings exist', async () => {
    db.prepare(
      `INSERT INTO memory_l0_raw (id, session_id, role, content, segmented_content)
       VALUES (?, ?, ?, ?, ?)`
    ).run('m1', 's1', 'user', '用户偏好使用TypeScript进行开发', '用户 偏好 使用 TypeScript 进行 开发');

    const results = await hybridSearch(db, embeddingClient, 'TypeScript', {
      bm25Weight: 1.0,
      vectorWeight: 0.0,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('m1');
    expect(results[0].layer).toBe(0);
  });

  it('should search across layers with BM25 fallback for L1-L3', async () => {
    db.prepare(
      `INSERT INTO memory_l0_raw (id, session_id, role, content, segmented_content) VALUES (?, ?, ?, ?, ?)`
    ).run('r1', 's1', 'user', 'raw content about testing', 'raw content about testing');

    db.prepare(
      `INSERT INTO memory_l1_extracted (id, summary, tags) VALUES (?, ?, ?)`
    ).run('e1', 'extracted summary about testing', '["testing"]');

    db.prepare(
      `INSERT INTO memory_l2_scenario (id, scenario, key_facts) VALUES (?, ?, ?)`
    ).run('sc1', 'testing scenario', '["fact1"]');

    db.prepare(
      `INSERT INTO memory_l3_persona (id, trait, evidence) VALUES (?, ?, ?)`
    ).run('p1', 'prefers testing', '["always writes tests first"]');

    const results = await hybridSearch(db, embeddingClient, 'testing', {
      bm25Weight: 1.0,
      vectorWeight: 0.0,
      limit: 20,
    });

    const layers = new Set(results.map(r => r.layer));
    expect(layers).toContain(0);
    expect(layers).toContain(1);
    expect(layers).toContain(2);
    expect(layers).toContain(3);
  });

  it('should return empty results for empty query', async () => {
    const results = await hybridSearch(db, embeddingClient, '', {
      bm25Weight: 1.0,
      vectorWeight: 0.0,
    });
    expect(results).toHaveLength(0);
  });
});
