/**
 * M3 收益验证：在不改动任何生产代码、不给 desktop 新增依赖的前提下，
 * 量化"加向量腿"能给 golden set 带来多少提升。
 *
 * 背景：把向量腿接进 desktop 需要 onnxruntime-node 进 desktop dependencies，
 * 实测按平台是 darwin 72MB / win32 127MB，会让安装包 mac +37% / win +69%。
 * 所以必须先证明收益，再决定是否付这个体积代价。
 *
 * 三臂对比：lexical（现状生产实现）、vector（纯向量）、fused（RRF 融合）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OnnxEmbeddingEngine } from '../../../src/ai/memory/onnx-engine.js';
import { extractQueryTerms } from '../../../desktop/electron/kb-query-terms.js';
import { createChunker } from '../../../desktop/electron/kb-chunker.js';
import { GOLDEN_QUERIES, type LiteralOverlap } from './golden-set.mjs';

const CORPUS_DIR = join(homedir(), '.xiaok', 'eval-fixtures', 'kb-retrieval');
const MODEL_ID = 'bge-small-zh-v1.5';
const TOP_K = 10;
const POOL = TOP_K * 3;
const RRF_K = 60;

interface Chunk { sourceId: string; sourceTitle: string; text: string; vector?: Float32Array }
interface Scored { chunk: Chunk; score: number }

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function searchLexical(chunks: Chunk[], query: string): Scored[] {
  const terms = extractQueryTerms(query);
  if (terms.length === 0) return [];
  const out: Scored[] = [];
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    const matched = terms.filter(t => lower.includes(t)).length;
    if (matched > 0) out.push({ chunk, score: matched / terms.length });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, POOL);
}

function searchVector(chunks: Chunk[], queryVector: Float32Array): Scored[] {
  const out: Scored[] = [];
  for (const chunk of chunks) {
    if (!chunk.vector) continue;
    out.push({ chunk, score: cosine(queryVector, chunk.vector) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, POOL);
}

function rrfFuse(lexical: Scored[], vector: Scored[]): Scored[] {
  const acc = new Map<string, { chunk: Chunk; score: number }>();
  const add = (list: Scored[], weight: number) => {
    list.forEach((item, rank) => {
      const key = `${item.chunk.sourceId}::${item.chunk.text.slice(0, 40)}`;
      const prev = acc.get(key);
      const contribution = weight / (RRF_K + rank + 1);
      if (prev) prev.score += contribution;
      else acc.set(key, { chunk: item.chunk, score: contribution });
    });
  };
  add(lexical, 0.5);
  add(vector, 0.5);
  return [...acc.values()].sort((a, b) => b.score - a.score);
}

function firstSourceRank(ranked: Scored[], expectTitle: string): number {
  const seen = new Set<string>();
  let rank = 0;
  for (const item of ranked) {
    if (seen.has(item.chunk.sourceId)) continue;
    seen.add(item.chunk.sourceId);
    if (item.chunk.sourceTitle.includes(expectTitle)) return rank;
    rank += 1;
  }
  return -1;
}

interface Arm { hit1: number; hit5: number; mrr: number; n: number; falsePositive: number }
const newArm = (): Arm => ({ hit1: 0, hit5: 0, mrr: 0, n: 0, falsePositive: 0 });

function score(arm: Arm, expectTitle: string, ranked: Scored[]): void {
  if (expectTitle === '__NONE__') {
    if (ranked.length > 0) arm.falsePositive += 1;
    return;
  }
  arm.n += 1;
  const rank = firstSourceRank(ranked, expectTitle);
  if (rank === 0) arm.hit1 += 1;
  if (rank >= 0 && rank < 5) arm.hit5 += 1;
  if (rank >= 0) arm.mrr += 1 / (rank + 1);
}

function show(label: string, arm: Arm): void {
  const pct = (v: number) => `${((100 * v) / Math.max(arm.n, 1)).toFixed(1)}%`;
  console.log(
    `  ${label.padEnd(8)} Hit@1=${String(arm.hit1).padStart(2)}/${arm.n} (${pct(arm.hit1).padStart(6)})`
    + `  Hit@5=${String(arm.hit5).padStart(2)}/${arm.n}`
    + `  MRR=${(arm.mrr / Math.max(arm.n, 1)).toFixed(3)}`
    + `  无答案误召=${arm.falsePositive}`,
  );
}

async function main(): Promise<void> {
  const manifestPath = join(CORPUS_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`语料缺失，先跑 prepare-corpus.mts`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<{ title: string; file: string; sourceId: string }>;

  const chunker = createChunker();
  const chunks: Chunk[] = [];
  for (const entry of manifest) {
    const text = readFileSync(join(CORPUS_DIR, entry.file), 'utf8');
    for (const piece of chunker.chunk({ text, mimeType: 'text/plain' })) {
      chunks.push({ sourceId: entry.sourceId, sourceTitle: entry.title, text: piece.text });
    }
  }
  console.log(`语料：${manifest.length} source / ${chunks.length} chunk`);

  const engine = new OnnxEmbeddingEngine(MODEL_ID);
  const status = await engine.init();
  if (status.engine !== 'onnx') {
    console.error(`本地模型不可用（${JSON.stringify(status)}），无法验证向量腿`);
    process.exit(1);
  }
  console.log(`embedder: ${status.engine} dim=${status.dimensions}`);

  const started = Date.now();
  for (const chunk of chunks) {
    const [vector] = await engine.embed([chunk.text]);
    chunk.vector = vector;
  }
  console.log(`索引 ${chunks.length} chunk 用时 ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  const buckets: LiteralOverlap[] = ['high', 'partial', 'low'];
  const overall = { lexical: newArm(), vector: newArm(), fused: newArm() };
  const perBucket = new Map(buckets.map(b => [b, { lexical: newArm(), vector: newArm(), fused: newArm() }]));

  for (const q of GOLDEN_QUERIES) {
    const [queryVector] = await engine.embed([q.query]);
    const lexical = searchLexical(chunks, q.query);
    const vector = searchVector(chunks, queryVector!);
    const fused = rrfFuse(lexical, vector);

    for (const target of [overall, perBucket.get(q.literalOverlap)!]) {
      score(target.lexical, q.expectTitle, lexical);
      score(target.vector, q.expectTitle, vector);
      score(target.fused, q.expectTitle, fused);
    }
  }

  await engine.close();

  console.log('=== 全部查询 ===');
  show('lexical', overall.lexical);
  show('vector', overall.vector);
  show('fused', overall.fused);

  for (const b of buckets) {
    const arms = perBucket.get(b)!;
    console.log(`\n=== 字面重叠 ${b} ===`);
    show('lexical', arms.lexical);
    show('vector', arms.vector);
    show('fused', arms.fused);
  }
}

await main();
