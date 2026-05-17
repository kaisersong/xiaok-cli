import * as path from 'node:path';
import * as fs from 'node:fs';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { getModelDir } from './model-registry.js';
export class OnnxEmbeddingEngine {
    session = null;
    tokenizer = null;
    modelDir;
    initPromise = null;
    constructor(modelId) {
        this.modelDir = getModelDir(modelId);
    }
    async init() {
        if (this.initPromise)
            return this.initPromise;
        this.initPromise = this._init();
        return this.initPromise;
    }
    async _init() {
        const modelPath = path.join(this.modelDir, 'model.onnx');
        const tokenizerPath = path.join(this.modelDir, 'tokenizer.json');
        if (!fs.existsSync(modelPath) || !fs.existsSync(tokenizerPath)) {
            return { engine: 'none', dimensions: 0 };
        }
        try {
            this.session = await InferenceSession.create(modelPath, {
                executionProviders: ['cpu'],
                graphOptimizationLevel: 'all',
            });
            const { Tokenizer } = await import('@huggingface/tokenizers');
            const tokenizerJson = fs.readFileSync(tokenizerPath, 'utf-8');
            const tok = Tokenizer.fromString(tokenizerJson);
            tok.setPadding({ maxLength: 512, padding: 'LONGEST' });
            this.tokenizer = tok;
            const dims = this.session.outputNames.length > 0
                ? this.session.outputNames[0]
                : 'last_hidden_state';
            return { engine: 'onnx', dimensions: 384 };
        }
        catch (err) {
            console.warn('[onnx-engine] Failed to initialize:', err.message);
            return { engine: 'none', dimensions: 0 };
        }
    }
    async embed(texts) {
        const status = await this.init();
        if (status.engine !== 'onnx' || !this.session || !this.tokenizer) {
            throw new Error('ONNX engine not initialized');
        }
        const results = [];
        for (const text of texts) {
            const encoded = this.tokenizer.encode(text);
            const inputIds = new Tensor('int64', BigInt64Array.from(encoded.ids.map(BigInt)), [1, encoded.ids.length]);
            const attentionMask = new Tensor('int64', BigInt64Array.from(encoded.attention_mask.map(BigInt)), [1, encoded.attention_mask.length]);
            const tokenTypeIds = new Tensor('int64', new BigInt64Array(inputIds.size), [1, encoded.ids.length]);
            const output = await this.session.run({
                input_ids: inputIds,
                attention_mask: attentionMask,
                token_type_ids: tokenTypeIds,
            });
            const lastHidden = output['last_hidden_state'];
            const embedding = this.meanPool(lastHidden, attentionMask);
            results.push(embedding);
        }
        return results;
    }
    meanPool(hiddenState, attentionMask) {
        const dims = hiddenState.dims;
        const seqLen = dims[1];
        const hiddenSize = dims[2];
        const data = hiddenState.data;
        const mask = attentionMask.data;
        const result = new Float32Array(hiddenSize);
        let maskSum = 0;
        for (let t = 0; t < seqLen; t++) {
            const m = Number(mask[t]);
            maskSum += m;
            for (let h = 0; h < hiddenSize; h++) {
                result[h] += data[t * hiddenSize + h] * m;
            }
        }
        const norm = Math.max(maskSum, 1e-9);
        for (let h = 0; h < hiddenSize; h++) {
            result[h] /= norm;
        }
        let len = 0;
        for (let h = 0; h < hiddenSize; h++) {
            len += result[h] * result[h];
        }
        len = Math.sqrt(Math.max(len, 1e-12));
        for (let h = 0; h < hiddenSize; h++) {
            result[h] /= len;
        }
        return result;
    }
    async close() {
        if (this.session) {
            this.session.release();
            this.session = null;
        }
        this.tokenizer = null;
        this.initPromise = null;
    }
}
