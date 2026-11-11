import Database from 'better-sqlite3';
import * as crypto from 'node:crypto';
import { OnnxEmbeddingEngine, type OnnxStatus } from './onnx-engine.js';

export interface EmbeddingConfig {
  provider: 'local' | 'api';
  apiUrl: string;
  model: string;
  dimensions: number;
}

const liveClients = new Set<EmbeddingClient>();
const heldModelSets = new WeakMap<EmbeddingClient, Set<string>>();
/** Includes retiring and failed-close clients; only a settled physical close retires a local model. */
export function getLiveEmbeddingModelIds(): readonly string[] {
  return [...new Set([...liveClients].flatMap(client => [...(heldModelSets.get(client) ?? [])]))];
}

export class EmbeddingClient {
  private readonly operations = new Set<Promise<unknown>>();
  private state: 'open' | 'changing' | 'closed' | 'unknown' = 'open';
  private closing?: Promise<void>;
  private readonly heldModels = new Set<string>();
  getModelId(): string { return this.config.model; }
  private admit<T>(start: () => Promise<T>): Promise<T> {
    if (this.state !== 'open') return Promise.reject(new Error('embedding_configuration_changed'));
    const pending = start(); this.operations.add(pending);
    const done = () => { this.operations.delete(pending); };
    pending.then(done, done); return pending;
  }
  private async drain(): Promise<void> { await Promise.allSettled([...this.operations]); }
  async configure(config: EmbeddingConfig): Promise<void> {
    if ((this.state !== 'open' && this.state !== 'unknown') || this.closing) throw new Error('embedding_configuration_changed');
    this.state = 'changing';
    // Reserve the admitted target before any suspension; deletion must also protect in-flight choices.
    if (config.provider === 'local') this.heldModels.add(config.model);
    try {
      // This constructor only resolves model paths; inference initialization stays lazy.
      const nextEngine = config.provider === 'local' ? new OnnxEmbeddingEngine(config.model) : null;
      await this.drain();
      // A prior failed release is retried here. No admission reopens until it really settles.
      await this.onnxEngine?.close();
      this.db.prepare('DELETE FROM memory_embeddings').run();
      this.cache.clear();
      this.config = { ...config };
      this.onnxEngine = nextEngine;
      this.onnxStatus = null; this.onnxUnavailableWarned = false;
      this.heldModels.clear();
      if (config.provider === 'local') this.heldModels.add(config.model);
      this.state = 'open';
    } catch (error) { this.state = 'unknown'; throw error; }
  }

  private db: Database.Database;
  private config: EmbeddingConfig;
  private cache: Map<string, Float32Array> = new Map();
  private onnxEngine: OnnxEmbeddingEngine | null = null;
  private onnxStatus: OnnxStatus | null = null;
  private onnxUnavailableWarned = false;

  constructor(db: Database.Database, config: EmbeddingConfig) {
    this.db = db;
    this.config = { ...config };
    heldModelSets.set(this,this.heldModels);
    liveClients.add(this);
    if (config.provider === 'local') this.heldModels.add(config.model);
    if (config.provider === 'local') {
      this.onnxEngine = new OnnxEmbeddingEngine(config.model);
    }
  }

  private cacheKey(text: string): string {
    return 'cache:' + crypto.createHash('sha256').update(text).digest('hex');
  }

  embed(text: string): Promise<Float32Array> { return this.admit(() => this.embedRaw(text)); }
  private async embedRaw(text: string): Promise<Float32Array> {
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

  embedBatch(texts: string[]): Promise<Float32Array[]> { return this.admit(() => this.embedBatchRaw(texts)); }
  private async embedBatchRaw(texts: string[]): Promise<Float32Array[]> {
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

  embedAndStore(memoryId: string, layer: number, text: string): Promise<Float32Array> {
    return this.admit(() => this.embedAndStoreRaw(memoryId, layer, text));
  }
  private async embedAndStoreRaw(memoryId: string, layer: number, text: string): Promise<Float32Array> {
    const embedding = await this.embed(text);
    const buf = Buffer.from(embedding.buffer);

    this.db.prepare(
      `INSERT OR REPLACE INTO memory_embeddings (memory_id, layer, embedding, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(memoryId, layer, buf);

    return embedding;
  }

  getStoredEmbedding(memoryId: string, layer: number): Float32Array | null {
    if (this.state !== 'open') throw new Error('embedding_configuration_changed');
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

    if (this.config.provider !== 'api') {
      // provider='local'（默认）但 ONNX 引擎不可用：快速失败，禁止静默回退到
      // 默认 HTTP 端点（如 localhost:11434）。检索/写入路径已有 try/catch，
      // 会降级为关键词检索；如需向量检索请显式配置 memory.embedding.provider='api'。
      if (!this.onnxUnavailableWarned) {
        this.onnxUnavailableWarned = true;
        console.warn('[memory] ONNX 向量引擎不可用且未配置 memory.embedding.provider=api，向量检索已禁用（关键词检索兜底）');
      }
      throw new Error('embedding unavailable: onnx engine not ready and no explicit embedding api configured');
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

  close(): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    if (this.closing) return this.closing;
    if (this.state === 'changing') return Promise.reject(new Error('embedding_configuration_changed'));
    this.state = 'unknown';
    const closing = (async () => {
      await this.drain();
      await this.onnxEngine?.close();
      this.heldModels.clear(); liveClients.delete(this); this.state = 'closed';
    })();
    this.closing = closing;
    const done = () => { if (this.closing === closing) this.closing = undefined; };
    closing.then(done, done); return closing;
  }
}
