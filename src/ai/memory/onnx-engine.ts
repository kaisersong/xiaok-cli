import * as path from 'node:path';
import * as fs from 'node:fs';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { getModelDir } from './model-registry.js';

export interface OnnxEmbeddingResult {
  engine: 'onnx';
  dimensions: number;
}

export interface OnnxEmbeddingFail {
  engine: 'none';
  dimensions: 0;
}

export type OnnxStatus = OnnxEmbeddingResult | OnnxEmbeddingFail;

export class OnnxEmbeddingEngine {
  private session: InferenceSession | null = null;
  private tokenizer: { encode: (text: string) => { ids: number[]; attention_mask: number[] }; setPadding: (opts: { maxLength: number; padding: string }) => void } | null = null;
  private readonly modelDir: string;
  private initPromise: Promise<OnnxStatus> | null = null;

  constructor(modelId?: string) {
    this.modelDir = getModelDir(modelId);
  }

  async init(): Promise<OnnxStatus> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<OnnxStatus> {
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
      tok.setPadding!({ maxLength: 512, padding: 'LONGEST' });
      this.tokenizer = tok;

      const dummyIds = new Tensor('int64', new BigInt64Array([101n, 102n]), [1, 2]);
      const dummyMask = new Tensor('int64', new BigInt64Array([1n, 1n]), [1, 2]);
      const dummyTypes = new Tensor('int64', new BigInt64Array([0n, 0n]), [1, 2]);
      const dummyOut = await this.session.run({ input_ids: dummyIds, attention_mask: dummyMask, token_type_ids: dummyTypes });
      const actualDims = (dummyOut['last_hidden_state'] as Tensor).dims[2] as number;

      return { engine: 'onnx', dimensions: actualDims };
    } catch (err) {
      console.warn('[onnx-engine] Failed to initialize:', (err as Error).message);
      return { engine: 'none', dimensions: 0 };
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const status = await this.init();
    if (status.engine !== 'onnx' || !this.session || !this.tokenizer) {
      throw new Error('ONNX engine not initialized');
    }

    const results: Float32Array[] = [];
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

      const lastHidden = output['last_hidden_state'] as Tensor;
      const embedding = this.meanPool(lastHidden, attentionMask);
      results.push(embedding);
    }

    return results;
  }

  private meanPool(hiddenState: Tensor, attentionMask: Tensor): Float32Array {
    const dims = hiddenState.dims;
    const seqLen = dims[1];
    const hiddenSize = dims[2];
    const data = hiddenState.data as Float32Array;
    const mask = attentionMask.data as BigInt64Array;

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

  async close(): Promise<void> {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
    this.tokenizer = null;
    this.initPromise = null;
  }
}
