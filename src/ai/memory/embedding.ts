import Database from 'better-sqlite3';
import * as crypto from 'node:crypto';
import { OnnxEmbeddingEngine, type OnnxStatus } from './onnx-engine.js';

export interface EmbeddingConfig {
  provider: 'local' | 'api';
  apiUrl: string;
  model: string;
  dimensions: number;
}

export class EmbeddingClient {
  private db: Database.Database;
  private config: EmbeddingConfig;
  private cache: Map<string, Float32Array> = new Map();
  private onnxEngine: OnnxEmbeddingEngine | null = null;
  private onnxStatus: OnnxStatus | null = null;

  constructor(db: Database.Database, config: EmbeddingConfig) {
    this.db = db;
    this.config = config;
    if (config.provider === 'local') {
      this.onnxEngine = new OnnxEmbeddingEngine(config.model);
    }
  }

  private cacheKey(text: string): string {
    return 'cache:' + crypto.createHash('sha256').update(text).digest('hex');
  }

  async embed(text: string): Promise<Float32Array> {
    const key = this.cacheKey(text);

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const row = this.db.prepare(
      'SELECT embedding FROM memory_embeddings WHERE memory_id = ? AND layer = -1'
    ).get(key) as { embedding: Buffer } | undefined;

    if (row) {
      const arr = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      this.cache.set(key, arr);
      return arr;
    }

    const embedding = await this.callEmbedApi([text]);
    const result = embedding[0];
    this.cache.set(key, result);
    this.persistEmbedding(key, result);

    return result;
  }

  private persistEmbedding(key: string, embedding: Float32Array): void {
    const buf = Buffer.from(embedding.buffer);
    this.db.prepare(
      "INSERT OR REPLACE INTO memory_embeddings (memory_id, layer, embedding, created_at) VALUES (?, -1, ?, datetime('now'))"
    ).run(key, buf);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: (Float32Array | null)[] = new Array(texts.length).fill(null);
    const toFetch: { index: number; text: string; key: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const key = this.cacheKey(texts[i]);
      if (this.cache.has(key)) {
        results[i] = this.cache.get(key)!;
        continue;
      }
      const row = this.db.prepare(
        'SELECT embedding FROM memory_embeddings WHERE memory_id = ? AND layer = -1'
      ).get(key) as { embedding: Buffer } | undefined;
      if (row) {
        const arr = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
        this.cache.set(key, arr);
        results[i] = arr;
        continue;
      }
      toFetch.push({ index: i, text: texts[i], key });
    }

    if (toFetch.length > 0) {
      const embeddings = await this.callEmbedApi(toFetch.map(t => t.text));
      for (let i = 0; i < toFetch.length; i++) {
        const { index, key } = toFetch[i];
        results[index] = embeddings[i];
        this.cache.set(key, embeddings[i]);
      }
    }

    return results as Float32Array[];
  }

  async embedAndStore(memoryId: string, layer: number, text: string): Promise<Float32Array> {
    const embedding = await this.embed(text);
    const buf = Buffer.from(embedding.buffer);

    this.db.prepare(
      `INSERT OR REPLACE INTO memory_embeddings (memory_id, layer, embedding, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(memoryId, layer, buf);

    return embedding;
  }

  getStoredEmbedding(memoryId: string, layer: number): Float32Array | null {
    const row = this.db.prepare(
      'SELECT embedding FROM memory_embeddings WHERE memory_id = ? AND layer = ?'
    ).get(memoryId, layer) as { embedding: Buffer } | undefined;

    if (!row) return null;
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  }

  private async callEmbedApi(texts: string[]): Promise<Float32Array[]> {
    if (this.onnxEngine) {
      if (!this.onnxStatus) {
        this.onnxStatus = await this.onnxEngine.init();
      }
      if (this.onnxStatus.engine === 'onnx') {
        return this.onnxEngine.embed(texts);
      }
    }

    const resp = await fetch(`${this.config.apiUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Embedding API error: ${resp.status} ${await resp.text()}`);
    }

    const data = await resp.json() as {
      data: { embedding: number[] }[];
    };

    return data.data.map(d => new Float32Array(d.embedding));
  }

  async close(): Promise<void> {
    if (this.onnxEngine) {
      await this.onnxEngine.close();
    }
  }
}
