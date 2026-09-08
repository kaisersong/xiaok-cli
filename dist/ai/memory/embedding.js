import * as crypto from 'node:crypto';
import { OnnxEmbeddingEngine } from './onnx-engine.js';
export class EmbeddingClient {
    db;
    config;
    cache = new Map();
    onnxEngine = null;
    onnxStatus = null;
    onnxUnavailableWarned = false;
    constructor(db, config) {
        this.db = db;
        this.config = config;
        if (config.provider === 'local') {
            this.onnxEngine = new OnnxEmbeddingEngine(config.model);
        }
    }
    cacheKey(text) {
        return 'cache:' + crypto.createHash('sha256').update(text).digest('hex');
    }
    async embed(text) {
        const key = this.cacheKey(text);
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        const row = this.db.prepare('SELECT embedding FROM memory_embeddings WHERE memory_id = ? AND layer = -1').get(key);
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
    persistEmbedding(key, embedding) {
        const buf = Buffer.from(embedding.buffer);
        this.db.prepare("INSERT OR REPLACE INTO memory_embeddings (memory_id, layer, embedding, created_at) VALUES (?, -1, ?, datetime('now'))").run(key, buf);
    }
    async embedBatch(texts) {
        const results = new Array(texts.length).fill(null);
        const toFetch = [];
        for (let i = 0; i < texts.length; i++) {
            const key = this.cacheKey(texts[i]);
            if (this.cache.has(key)) {
                results[i] = this.cache.get(key);
                continue;
            }
            const row = this.db.prepare('SELECT embedding FROM memory_embeddings WHERE memory_id = ? AND layer = -1').get(key);
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
        return results;
    }
    async embedAndStore(memoryId, layer, text) {
        const embedding = await this.embed(text);
        const buf = Buffer.from(embedding.buffer);
        this.db.prepare(`INSERT OR REPLACE INTO memory_embeddings (memory_id, layer, embedding, created_at)
       VALUES (?, ?, ?, datetime('now'))`).run(memoryId, layer, buf);
        return embedding;
    }
    getStoredEmbedding(memoryId, layer) {
        const row = this.db.prepare('SELECT embedding FROM memory_embeddings WHERE memory_id = ? AND layer = ?').get(memoryId, layer);
        if (!row)
            return null;
        return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
    }
    async callEmbedApi(texts) {
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
        const data = await resp.json();
        return data.data.map(d => new Float32Array(d.embedding));
    }
    async close() {
        if (this.onnxEngine) {
            await this.onnxEngine.close();
        }
    }
}
