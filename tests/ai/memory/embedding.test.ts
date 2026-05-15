import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EmbeddingClient } from '../../../src/ai/memory/embedding.js';
import { runMigrations } from '../../../src/ai/memory/migrations.js';

describe('EmbeddingClient', () => {
  let db: Database.Database;
  let tmpDir: string;
  let client: EmbeddingClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-emb-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    runMigrations(db);
    client = new EmbeddingClient(db, {
      apiUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('should embed text and cache result', async () => {
    const fakeEmbedding = new Float32Array(768).fill(0.1);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ embedding: Array.from(fakeEmbedding) }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await client.embed('hello world');
    expect(result).toHaveLength(768);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const cached = await client.embed('hello world');
    expect(cached).toHaveLength(768);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should store and retrieve embedding from SQLite', async () => {
    const fakeEmbedding = new Float32Array(768).fill(0.5);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ embedding: Array.from(fakeEmbedding) }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await client.embedAndStore('mem-1', 1, 'test content');

    const stored = client.getStoredEmbedding('mem-1', 1);
    expect(stored).not.toBeNull();
    expect(stored!.length).toBe(768);
  });

  it('should use cache: prefix to avoid collision with real memory IDs', async () => {
    const fakeEmbedding = new Float32Array(768).fill(0.2);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ embedding: Array.from(fakeEmbedding) }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await client.embed('cache test');

    const rows = db.prepare(
      "SELECT memory_id FROM memory_embeddings WHERE layer = -1"
    ).all() as any[];
    for (const row of rows) {
      expect(row.memory_id.startsWith('cache:')).toBe(true);
    }
  });
});
