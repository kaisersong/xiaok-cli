/**
 * KB 检索评测 runner。
 *
 * 先自检 golden set 的期望是否真的成立（answerProbe 必须出现在 expectTitle 对应的
 * source 里），自检不过直接退出 —— 否则后面的指标全是在错误期望上算的。
 *
 * 检索臂：
 *   substring  —— 现状实现（ipc.ts:1849 与 kb-tools.ts:160 的那份 matchRatio）
 *   tfidf      —— 内存 TF-IDF over jieba token
 * 指标：Hit@1 / Hit@5 / MRR / top-10 噪声条数，并按字面重叠度分桶报告。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKbStoreSqlite } from '../../../desktop/electron/kb-store-sqlite.js';
import { createChunker } from '../../../desktop/electron/kb-chunker.js';
import { segmentQuery } from '../../../src/ai/memory/segment.js';
import { extractQueryTerms, meetsRelevanceFloor } from '../../../desktop/electron/kb-query-terms.js';
import { GOLDEN_QUERIES, NOISE_PATTERNS, type GoldenQuery, type LiteralOverlap } from './golden-set.mjs';

const CORPUS_DIR = join(homedir(), '.xiaok', 'eval-fixtures', 'kb-retrieval');
const TOP_K = 10;

interface CorpusEntry { sourceId: string; title: string; chars: number; file: string }
interface Candidate { sourceId: string; sourceTitle: string; text: string; score: number }

function loadCorpus(): CorpusEntry[] {
  const manifestPath = join(CORPUS_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`语料缺失，先跑 prepare-corpus.mts：${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as CorpusEntry[];
}

function terms(query: string): string[] {
  return extractQueryTerms(query);
}

/** 现状实现：命中词比例，无词权重、无长度归一 */
function searchSubstring(chunks: Chunk[], query: string): Candidate[] {
  const qt = terms(query);
  if (qt.length === 0) return [];
  const out: Candidate[] = [];
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    const matched = qt.filter(t => lower.includes(t)).length;
    if (meetsRelevanceFloor(matched / qt.length)) {
      out.push({ sourceId: chunk.sourceId, sourceTitle: chunk.sourceTitle, text: chunk.text, score: matched / qt.length });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

interface Chunk { sourceId: string; sourceTitle: string; text: string; tokens: string[] }

/** 内存 TF-IDF over jieba token —— 评审建议的 FTS5 替代方案 */
function buildIdf(chunks: Chunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    for (const token of new Set(chunk.tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  const n = chunks.length;
  for (const [token, count] of df) idf.set(token, Math.log(1 + (n - count + 0.5) / (count + 0.5)));
  return idf;
}

function searchTfIdf(chunks: Chunk[], query: string, idf: Map<string, number>): Candidate[] {
  const qt = terms(query);
  if (qt.length === 0) return [];
  const out: Candidate[] = [];
  for (const chunk of chunks) {
    let score = 0;
    for (const token of qt) {
      const tf = chunk.tokens.filter(t => t === token).length;
      if (tf === 0) continue;
      const weight = idf.get(token) ?? Math.log(1 + chunks.length);
      score += weight * (tf / (tf + 1.2 * (0.25 + 0.75 * chunk.tokens.length / 400)));
    }
    if (score > 0) out.push({ sourceId: chunk.sourceId, sourceTitle: chunk.sourceTitle, text: chunk.text, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

function dedupeBySource(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.sourceId)) continue;
    seen.add(c.sourceId);
    out.push(c);
  }
  return out;
}

function countNoise(candidates: Candidate[]): number {
  return candidates.slice(0, TOP_K).filter(c => NOISE_PATTERNS.some(p => p.test(c.text))).length;
}

interface ArmResult { hit1: number; hit5: number; mrrSum: number; noise: number; evaluated: number; falsePositives: number }

function emptyArm(): ArmResult {
  return { hit1: 0, hit5: 0, mrrSum: 0, noise: 0, evaluated: 0, falsePositives: 0 };
}

function scoreQuery(arm: ArmResult, q: GoldenQuery, ranked: Candidate[]): void {
  arm.noise += countNoise(ranked);
  if (q.expectTitle === '__NONE__') {
    // 无答案查询：任何高分召回都是虚假召回
    if (ranked.length > 0) arm.falsePositives += 1;
    return;
  }
  arm.evaluated += 1;
  const bySource = dedupeBySource(ranked);
  const rank = bySource.findIndex(c => c.sourceTitle.includes(q.expectTitle));
  if (rank === 0) arm.hit1 += 1;
  if (rank >= 0 && rank < 5) arm.hit5 += 1;
  if (rank >= 0) arm.mrrSum += 1 / (rank + 1);
}

function report(label: string, arm: ArmResult): void {
  const pct = (n: number) => `${((100 * n) / Math.max(arm.evaluated, 1)).toFixed(1)}%`;
  console.log(
    `  ${label.padEnd(11)} Hit@1=${String(arm.hit1).padStart(2)}/${arm.evaluated} (${pct(arm.hit1).padStart(6)})`
    + `  Hit@5=${String(arm.hit5).padStart(2)}/${arm.evaluated} (${pct(arm.hit5).padStart(6)})`
    + `  MRR=${(arm.mrrSum / Math.max(arm.evaluated, 1)).toFixed(3)}`
    + `  top10噪声=${arm.noise}`
    + `  无答案误召=${arm.falsePositives}`,
  );
}

async function main(): Promise<void> {
  const corpus = loadCorpus();
  const workDir = mkdtempSync(join(tmpdir(), 'kb-eval-'));
  const dbPath = join(workDir, 'eval.db');

  try {
    const store = createKbStoreSqlite(dbPath);
    const collection = store.createCollection({
      name: 'eval', embeddingModelId: 'bge-small-zh-v1.5', embeddingDim: 512,
    });
    const chunker = createChunker();

    for (const entry of corpus) {
      const text = readFileSync(join(CORPUS_DIR, entry.file), 'utf8');
      const source = store.addSource({ collectionId: collection.id, kind: 'paste', title: entry.title, text }, 'scheduler');
      store.insertChunks(source.id, chunker.chunk({ text, mimeType: 'text/plain' }));
    }

    const db = (store as unknown as { _db: DatabaseSync })._db;
    const rows = db.prepare(
      'SELECT c.source_id, c.text, s.title FROM chunks c JOIN sources s ON s.id = c.source_id',
    ).all() as Array<{ source_id: string; text: string; title: string }>;

    const chunks: Chunk[] = rows.map(r => ({
      sourceId: r.source_id,
      sourceTitle: r.title,
      text: r.text,
      tokens: segmentQuery(r.text).split(/\s+/).filter(Boolean).map(t => t.toLowerCase()),
    }));

    console.log(`语料：${corpus.length} source / ${chunks.length} chunk`);

    // --- 自检：期望必须真的成立 ---
    const bad: string[] = [];
    for (const q of GOLDEN_QUERIES) {
      if (q.expectTitle === '__NONE__') {
        const leaked = chunks.some(c => q.answerProbe && c.text.includes(q.answerProbe));
        if (leaked) bad.push(`${q.id}: 标为无答案，但语料里存在 ${q.answerProbe}`);
        continue;
      }
      const target = chunks.filter(c => c.sourceTitle.includes(q.expectTitle));
      if (target.length === 0) bad.push(`${q.id}: 找不到 expectTitle=${q.expectTitle} 对应的 source`);
      else if (!target.some(c => c.text.includes(q.answerProbe))) {
        bad.push(`${q.id}: ${q.expectTitle} 里不含 answerProbe=${JSON.stringify(q.answerProbe)}`);
      }
    }
    if (bad.length > 0) {
      console.error('\ngolden set 自检失败，指标无意义，先修期望：');
      for (const line of bad) console.error(`  - ${line}`);
      process.exit(1);
    }
    console.log('golden set 自检通过：所有期望在语料中成立\n');

    const idf = buildIdf(chunks);
    const buckets: LiteralOverlap[] = ['high', 'partial', 'low'];
    const arms = { substring: emptyArm(), tfidf: emptyArm() };
    const perBucket = new Map<LiteralOverlap, { substring: ArmResult; tfidf: ArmResult }>();
    for (const b of buckets) perBucket.set(b, { substring: emptyArm(), tfidf: emptyArm() });

    for (const q of GOLDEN_QUERIES) {
      const sub = searchSubstring(chunks, q.query);
      const tfi = searchTfIdf(chunks, q.query, idf);
      scoreQuery(arms.substring, q, sub);
      scoreQuery(arms.tfidf, q, tfi);
      const bucket = perBucket.get(q.literalOverlap)!;
      scoreQuery(bucket.substring, q, sub);
      scoreQuery(bucket.tfidf, q, tfi);
    }

    console.log('=== 全部查询 ===');
    report('substring', arms.substring);
    report('tfidf', arms.tfidf);

    for (const b of buckets) {
      const bucket = perBucket.get(b)!;
      if (bucket.substring.evaluated === 0 && bucket.substring.falsePositives === 0) continue;
      console.log(`\n=== 字面重叠 ${b} ===`);
      report('substring', bucket.substring);
      report('tfidf', bucket.tfidf);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

await main();
