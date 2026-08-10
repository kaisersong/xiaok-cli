import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OnnxEmbeddingEngine } from '../../../src/ai/memory/onnx-engine.js';

describe('OnnxEmbeddingEngine', () => {
  it('returns {engine: "none"} when model files are missing', async () => {
    const engine = new OnnxEmbeddingEngine('__nonexistent__');
    const status = await engine.init();
    expect(status.engine).toBe('none');
    expect(status.dimensions).toBe(0);
  });

  it('throws when embed() called with uninitialized engine', async () => {
    const engine = new OnnxEmbeddingEngine('__nonexistent__');
    await engine.init();
    await expect(engine.embed(['test'])).rejects.toThrow('ONNX engine not initialized');
  });

  it('returns same status on repeated init() calls', async () => {
    const engine = new OnnxEmbeddingEngine('__nonexistent__');
    const s1 = await engine.init();
    const s2 = await engine.init();
    expect(s1).toEqual(s2);
  });

  it('close() does not throw when never initialized', async () => {
    const engine = new OnnxEmbeddingEngine();
    await expect(engine.close()).resolves.toBeUndefined();
  });
});

/**
 * 上面四条全部指向 `__nonexistent__`，真实初始化路径从未被执行 —— 这正是
 * `Tokenizer.fromString` 不存在却长期无人发现的原因。以下用真实模型驱动，
 * 模型缺失时跳过（CI 无模型属正常）。
 */
const REAL_MODEL_ID = 'bge-small-zh-v1.5';
const realModelDir = path.join(os.homedir(), '.xiaok', 'embedding', REAL_MODEL_ID);
const realModelPresent = existsSync(path.join(realModelDir, 'model.onnx'))
  && existsSync(path.join(realModelDir, 'tokenizer.json'));

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe.skipIf(!realModelPresent)('OnnxEmbeddingEngine（真实模型）', () => {
  it('用真实模型初始化出 onnx 引擎与正确维度', async () => {
    const engine = new OnnxEmbeddingEngine(REAL_MODEL_ID);
    try {
      const status = await engine.init();
      expect(status.engine).toBe('onnx');
      expect(status.dimensions).toBeGreaterThan(0);
    } finally {
      await engine.close();
    }
  });

  it('产出确定性且非全零的向量，维度与 init 报告一致', async () => {
    const engine = new OnnxEmbeddingEngine(REAL_MODEL_ID);
    try {
      const status = await engine.init();
      const [first, second] = await engine.embed(['青羽终端的负责人是张伟。', '青羽终端的负责人是张伟。']);

      expect(first).toBeInstanceOf(Float32Array);
      expect(first!.length).toBe(status.dimensions);
      expect(Array.from(second!)).toEqual(Array.from(first!));
      // 全零向量意味着推理没有真正跑起来
      expect(Array.from(first!).some((value) => value !== 0)).toBe(true);
    } finally {
      await engine.close();
    }
  });

  it('语义相近文本的余弦相似度高于无关文本', async () => {
    const engine = new OnnxEmbeddingEngine(REAL_MODEL_ID);
    try {
      await engine.init();
      const [anchor, near, far] = await engine.embed([
        '青羽终端的管理端口是 8443。',
        '青羽终端的管理端口已调整为 8443。',
        '今天午餐吃了牛肉面和一份凉菜。',
      ]);

      expect(cosine(anchor!, near!)).toBeGreaterThan(cosine(anchor!, far!));
    } finally {
      await engine.close();
    }
  });

  /**
   * bge-small-zh-v1.5 的 position embedding 上限是 512 token。真实 KB chunk
   * 平均 688 字，超限时 onnxruntime 抛 `idx=512 must be within [-512,511]`。
   */
  it('超过 512 token 的输入被截断而不是抛错', async () => {
    const engine = new OnnxEmbeddingEngine(REAL_MODEL_ID);
    try {
      const status = await engine.init();
      const longText = '知识库检索需要把文档切分成片段并生成向量表示。'.repeat(60);
      expect(longText.length).toBeGreaterThan(1000);

      const [vector] = await engine.embed([longText]);

      expect(vector).toBeInstanceOf(Float32Array);
      expect(vector!.length).toBe(status.dimensions);
      expect(Array.from(vector!).some((value) => value !== 0)).toBe(true);
      expect(Array.from(vector!).every((value) => Number.isFinite(value))).toBe(true);
    } finally {
      await engine.close();
    }
  });

  it('截断后同一批里的其它合法输入不受影响', async () => {
    const engine = new OnnxEmbeddingEngine(REAL_MODEL_ID);
    try {
      await engine.init();
      const short = '青羽终端的管理端口是 8443。';
      const [alone] = await engine.embed([short]);
      const vectors = await engine.embed(['长文本占位。'.repeat(200), short]);

      expect(vectors).toHaveLength(2);
      expect(Array.from(vectors[1]!)).toEqual(Array.from(alone!));
    } finally {
      await engine.close();
    }
  });

  it('只在超限尾部有差异的两段文本产出相同向量，证明截断真的发生了', async () => {
    const engine = new OnnxEmbeddingEngine(REAL_MODEL_ID);
    try {
      await engine.init();
      const head = '知识库检索需要把文档切分成片段并生成向量表示。'.repeat(60);
      const [a, b] = await engine.embed([`${head}尾部甲。`, `${head}尾部乙丙丁。`]);

      expect(Array.from(a!)).toEqual(Array.from(b!));
    } finally {
      await engine.close();
    }
  });
});
