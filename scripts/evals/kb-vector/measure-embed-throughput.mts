/**
 * 实测本地 ONNX embedding 的真实吞吐（逐条推理，无批处理）。
 * 用途：更正 docs/analysis/2026-08-08 §3 中错误的 "batch=32 → 146 条/秒"。
 */
import { OnnxEmbeddingEngine } from '../../../src/ai/memory/onnx-engine.js';

const MODEL_ID = 'bge-small-zh-v1.5';

function makeChunk(chars: number, seed: number): string {
  const base = '知识库检索需要把文档切分成片段并生成向量表示，随后用余弦相似度召回相关内容。'
    + `本片段编号为 ${seed}，用于测量端到端吞吐。`;
  let out = '';
  while (out.length < chars) out += base;
  return out.slice(0, chars);
}

const engine = new OnnxEmbeddingEngine(MODEL_ID);
const status = await engine.init();
console.log('init:', JSON.stringify(status));
if (status.engine !== 'onnx') process.exit(1);

// 预热，排除首次推理的图优化开销
await engine.embed([makeChunk(200, 0)]);

for (const chars of [200, 350, 500, 688]) {
  for (const batch of [1, 8, 32]) {
    const texts = Array.from({ length: batch }, (_, i) => makeChunk(chars, i));
    const rounds = batch === 1 ? 20 : batch === 8 ? 4 : 2;
    const started = process.hrtime.bigint();
    let count = 0;
    try {
      for (let r = 0; r < rounds; r += 1) {
        await engine.embed(texts);
        count += texts.length;
      }
    } catch (err) {
      console.log(`chars=${chars} batchArg=${batch} FAILED: ${(err as Error).message.slice(0, 120)}`);
      continue;
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const perItem = elapsedMs / count;
    console.log(
      `chars=${chars} batchArg=${batch} n=${count} total=${elapsedMs.toFixed(0)}ms `
      + `perItem=${perItem.toFixed(1)}ms throughput=${(1000 / perItem).toFixed(1)}/s`,
    );
  }
}
