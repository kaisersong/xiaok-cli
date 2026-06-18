/**
 * Knowledge Base — Retriever (BM25 + Vector + RRF fusion)
 *
 * Searches chunks within a collection using FTS5 BM25 + cosine vector similarity,
 * fused via Reciprocal Rank Fusion.
 */

import { DatabaseSync } from 'node:sqlite';
import type { KbRetriever } from './kb-store.js';
import type { KbSearchInput, KbSearchResult } from './kb-types.js';

export interface KbRetrieverOptions {
  db: DatabaseSync;
  embedFn: (text: string) => Float32Array | null;
  bm25Weight?: number;
  vectorWeight?: number;
  rrfK?: number;
}

export function createKbRetriever(options: KbRetrieverOptions): KbRetriever {
  const { db, embedFn, bm25Weight = 0.5, vectorWeight = 0.5, rrfK = 60 } = options;

  return {
    async search(input: KbSearchInput): Promise<KbSearchResult[]> {
      const { query, collectionId, sourceIds, topK = 10 } = input;
      if (!query.trim()) return [];

      const bm25Results = searchBm25(db, query, collectionId, sourceIds, topK * 3);
      const queryEmbedding = embedFn(query);
      const vectorResults = queryEmbedding
        ? searchVector(db, queryEmbedding, collectionId, sourceIds, topK * 3)
        : [];

      const fused = rrfFuse(bm25Results, vectorResults, bm25Weight, vectorWeight, rrfK);
      return fused.slice(0, topK);
    },
  };
}

interface ScoredChunk {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  collectionId: string;
  text: string;
  pageIndex: number | null;
  slideIndex: number | null;
  sheetName: string | null;
  score: number;
}

function searchBm25(
  db: DatabaseSync,
  query: string,
  collectionId: string,
  sourceIds: string[] | undefined,
  limit: number,
): ScoredChunk[] {
  const ftsQuery = query.replace(/['"]/g, '').trim();
  if (!ftsQuery) return [];

  let sql = `
    SELECT c.id AS chunk_id, c.source_id, c.collection_id, c.text,
           c.page_index, c.slide_index, c.sheet_name,
           s.title AS source_title
    FROM chunks c
    JOIN sources s ON s.id = c.source_id
    WHERE c.collection_id = ?
      AND c.rowid IN (SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?)
  `;
  const params: unknown[] = [collectionId, ftsQuery];

  if (sourceIds && sourceIds.length > 0) {
    sql += ` AND c.source_id IN (${sourceIds.map(() => '?').join(',')})`;
    params.push(...sourceIds);
  }
  sql += ` LIMIT ?`;
  params.push(limit);

  try {
    const rows = db.prepare(sql).all(...params as any[]) as Array<Record<string, unknown>>;
    return rows.map((row, i) => ({
      chunkId: row.chunk_id as string,
      sourceId: row.source_id as string,
      sourceTitle: row.source_title as string,
      collectionId: row.collection_id as string,
      text: row.text as string,
      pageIndex: row.page_index as number | null,
      slideIndex: row.slide_index as number | null,
      sheetName: row.sheet_name as string | null,
      score: 1 / (i + 1),
    }));
  } catch {
    return [];
  }
}

function searchVector(
  db: DatabaseSync,
  queryEmbedding: Float32Array,
  collectionId: string,
  sourceIds: string[] | undefined,
  limit: number,
): ScoredChunk[] {
  let sql = `
    SELECT ce.chunk_id, ce.embedding, c.source_id, c.collection_id, c.text,
           c.page_index, c.slide_index, c.sheet_name,
           s.title AS source_title
    FROM chunk_embeddings ce
    JOIN chunks c ON c.id = ce.chunk_id
    JOIN sources s ON s.id = c.source_id
    WHERE ce.collection_id = ?
  `;
  const params: unknown[] = [collectionId];

  if (sourceIds && sourceIds.length > 0) {
    sql += ` AND c.source_id IN (${sourceIds.map(() => '?').join(',')})`;
    params.push(...sourceIds);
  }

  const rows = db.prepare(sql).all(...params as any[]) as Array<Record<string, unknown>>;

  const scored = rows.map(row => {
    const embBuf = row.embedding as Buffer;
    const emb = new Float32Array(embBuf.buffer, embBuf.byteOffset, embBuf.byteLength / 4);
    const sim = cosineSimilarity(queryEmbedding, emb);
    return {
      chunkId: row.chunk_id as string,
      sourceId: row.source_id as string,
      sourceTitle: row.source_title as string,
      collectionId: row.collection_id as string,
      text: row.text as string,
      pageIndex: row.page_index as number | null,
      slideIndex: row.slide_index as number | null,
      sheetName: row.sheet_name as string | null,
      score: sim,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function rrfFuse(
  bm25: ScoredChunk[],
  vector: ScoredChunk[],
  bm25Weight: number,
  vectorWeight: number,
  k: number,
): KbSearchResult[] {
  const scoreMap = new Map<string, { chunk: ScoredChunk; bm25Score: number; vectorScore: number; fusedScore: number }>();

  for (let rank = 0; rank < bm25.length; rank++) {
    const c = bm25[rank];
    const rrfScore = bm25Weight / (k + rank + 1);
    const existing = scoreMap.get(c.chunkId);
    if (existing) {
      existing.bm25Score = 1 / (rank + 1);
      existing.fusedScore += rrfScore;
    } else {
      scoreMap.set(c.chunkId, { chunk: c, bm25Score: 1 / (rank + 1), vectorScore: 0, fusedScore: rrfScore });
    }
  }

  for (let rank = 0; rank < vector.length; rank++) {
    const c = vector[rank];
    const rrfScore = vectorWeight / (k + rank + 1);
    const existing = scoreMap.get(c.chunkId);
    if (existing) {
      existing.vectorScore = c.score;
      existing.fusedScore += rrfScore;
    } else {
      scoreMap.set(c.chunkId, { chunk: c, bm25Score: 0, vectorScore: c.score, fusedScore: rrfScore });
    }
  }

  const results = [...scoreMap.values()].sort((a, b) => b.fusedScore - a.fusedScore);
  return results.map(r => ({
    chunkId: r.chunk.chunkId,
    sourceId: r.chunk.sourceId,
    sourceTitle: r.chunk.sourceTitle,
    collectionId: r.chunk.collectionId,
    text: r.chunk.text,
    pageIndex: r.chunk.pageIndex,
    slideIndex: r.chunk.slideIndex,
    sheetName: r.chunk.sheetName,
    bm25Score: r.bm25Score,
    vectorScore: r.vectorScore,
    fusedScore: r.fusedScore,
  }));
}
