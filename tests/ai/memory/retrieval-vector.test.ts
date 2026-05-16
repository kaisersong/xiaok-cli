import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as os from 'node:os';
import { hybridSearch } from '../../../src/ai/memory/retrieval.js';
import { EmbeddingClient } from '../../../src/ai/memory/embedding.js';
import { runMigrations } from '../../../src/ai/memory/migrations.js';

describe('vectorSearch', () => {
  let db: Database.Database;

  beforeEach(() => {
    const tmpPath = path.join(os.tmpdir(), `test-vector-${Date.now()}.db`);
    db = new Database(tmpPath);
    runMigrations(db);
  });

  it('returns results sorted by cosine similarity', async () => {
    const config = { provider: 'api' as const, apiUrl: 'http://localhost:11434/v1', model: 'test', dimensions: 4 };
    const client = new EmbeddingClient(db, config);

    db.prepare("INSERT INTO memory_l1_extracted (id, source_ids, summary, tags) VALUES (?, '[]', ?, '[]')")
      .run('mem1', 'hello world');
    db.prepare("INSERT INTO memory_l1_extracted (id, source_ids, summary, tags) VALUES (?, '[]', ?, '[]')")
      .run('mem2', 'goodbye world');

    const emb1 = new Float32Array([0.9, 0.1, 0.0, 0.0]);
    const emb2 = new Float32Array([0.0, 0.0, 0.9, 0.9]);
    db.prepare("INSERT INTO memory_embeddings (memory_id, layer, embedding, created_at) VALUES (?, ?, ?, datetime('now'))")
      .run('mem1', 1, Buffer.from(emb1.buffer));
    db.prepare("INSERT INTO memory_embeddings (memory_id, layer, embedding, created_at) VALUES (?, ?, ?, datetime('now'))")
      .run('mem2', 1, Buffer.from(emb2.buffer));

    const queryVec = new Float32Array([1.0, 0.0, 0.0, 0.0]);
    client.embed = async () => queryVec;

    const results = await hybridSearch(db, client, 'hello', { vectorWeight: 0.5, bm25Weight: 0 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('mem1');
  });

  it('skips embeddings with mismatched dimensions', async () => {
    const config = { provider: 'api' as const, apiUrl: 'http://localhost:11434/v1', model: 'test', dimensions: 4 };
    const client = new EmbeddingClient(db, config);

    db.prepare("INSERT INTO memory_l1_extracted (id, source_ids, summary, tags) VALUES (?, '[]', ?, '[]')")
      .run('mem-old', 'old embedding');

    const oldEmb = new Float32Array(768).fill(0.5);
    db.prepare("INSERT INTO memory_embeddings (memory_id, layer, embedding, created_at) VALUES (?, ?, ?, datetime('now'))")
      .run('mem-old', 1, Buffer.from(oldEmb.buffer));

    const queryVec = new Float32Array([1.0, 0.0, 0.0, 0.0]);
    client.embed = async () => queryVec;

    const results = await hybridSearch(db, client, 'test', { vectorWeight: 1.0, bm25Weight: 0 });
    expect(results).toHaveLength(0);
  });

  it('filters out embeddings below 0.3 similarity threshold', async () => {
    const config = { provider: 'api' as const, apiUrl: 'http://localhost:11434/v1', model: 'test', dimensions: 4 };
    const client = new EmbeddingClient(db, config);

    db.prepare("INSERT INTO memory_l1_extracted (id, source_ids, summary, tags) VALUES (?, '[]', ?, '[]')")
      .run('mem-far', 'distant');

    const farEmb = new Float32Array([0.1, 0.7, 0.7, 0.0]);
    db.prepare("INSERT INTO memory_embeddings (memory_id, layer, embedding, created_at) VALUES (?, ?, ?, datetime('now'))")
      .run('mem-far', 1, Buffer.from(farEmb.buffer));

    const queryVec = new Float32Array([1.0, 0.0, 0.0, 0.0]);
    client.embed = async () => queryVec;

    const results = await hybridSearch(db, client, 'test', { vectorWeight: 1.0, bm25Weight: 0 });
    expect(results).toHaveLength(0);
  });
});
