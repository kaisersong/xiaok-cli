import Database from 'better-sqlite3';
import { EmbeddingClient } from './embedding.js';
import { segmentQuery } from './segment.js';

export interface SearchOptions {
  bm25Weight?: number;
  vectorWeight?: number;
  rrfK?: number;
  limit?: number;
  layers?: number[];
}

export interface SearchResult {
  id: string;
  layer: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface RankEntry {
  id: string;
  layer: number;
  content: string;
  metadata: Record<string, unknown>;
  rank: number;
}

/**
 * Build FTS5 query from segmented tokens.
 * Each token is quoted and connected with OR for recall.
 * Filters out single-character tokens to reduce noise from nodejieba's
 * character-level splitting of non-Chinese text.
 */
function buildFtsQuery(segmentedQuery: string): string | null {
  const tokens = segmentedQuery.split(/\s+/).filter(t => t.length > 1);
  if (tokens.length === 0) return null;
  return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

export async function hybridSearch(
  db: Database.Database,
  embeddingClient: EmbeddingClient,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const {
    bm25Weight = 0.5,
    vectorWeight = 0.0,
    rrfK = 60,
    limit = 10,
    layers = [0, 1, 2, 3],
  } = options;

  const segmentedQuery = segmentQuery(query);

  if (segmentedQuery.trim() === '') {
    return [];
  }

  const rrfScores = new Map<string, { score: number; layer: number; content: string; metadata: Record<string, unknown> }>();

  if (bm25Weight > 0) {
    const ftsQuery = buildFtsQuery(segmentedQuery);
    const bm25Results = bm25Search(db, ftsQuery, segmentedQuery, layers);
    const maxRank = bm25Results.length || 1;
    for (const entry of bm25Results) {
      const key = `${entry.layer}:${entry.id}`;
      const normalizedRank = entry.rank / maxRank;
      const existing = rrfScores.get(key) || { score: 0, layer: entry.layer, content: entry.content, metadata: entry.metadata };
      existing.score += bm25Weight / (rrfK + normalizedRank * rrfK);
      rrfScores.set(key, existing);
    }
  }

  if (vectorWeight > 0) {
    try {
      const queryEmbedding = await embeddingClient.embed(query);
      const vecResults = vectorSearch(db, queryEmbedding, layers, limit * 3);
      const maxVecRank = vecResults.length || 1;
      for (const entry of vecResults) {
        const key = `${entry.layer}:${entry.id}`;
        const normalizedRank = entry.rank / maxVecRank;
        const existing = rrfScores.get(key) || { score: 0, layer: entry.layer, content: entry.content, metadata: entry.metadata };
        existing.score += vectorWeight / (rrfK + normalizedRank * rrfK);
        rrfScores.set(key, existing);
      }
    } catch {
      // sqlite-vec not available, skip vector search
    }
  }

  const sorted = Array.from(rrfScores.entries())
    .map(([key, data]) => ({
      id: key.substring(key.indexOf(':') + 1),
      layer: data.layer,
      content: data.content,
      score: data.score,
      metadata: data.metadata,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return sorted;
}

function bm25Search(db: Database.Database, ftsQuery: string | null, segmentedQuery: string, layers: number[]): RankEntry[] {
  const results: RankEntry[] = [];
  let rank = 0;

  if (layers.includes(0) && ftsQuery) {
    try {
      const rows = db.prepare(`
        SELECT r.id, r.content, r.session_id, r.role, r.created_at
        FROM memory_l0_fts f
        JOIN memory_l0_raw r ON r.rowid = f.rowid
        WHERE memory_l0_fts MATCH ?
        ORDER BY rank
        LIMIT 50
      `).all(ftsQuery) as any[];

      for (const row of rows) {
        results.push({
          id: row.id, layer: 0, content: row.content,
          metadata: { sessionId: row.session_id, role: row.role, createdAt: row.created_at },
          rank: ++rank,
        });
      }
    } catch {
      // FTS match may fail on certain queries, fall through to LIKE
    }
  }

  const likeTerms = segmentedQuery.split(/\s+/).filter(Boolean);

  if (layers.includes(1) && likeTerms.length > 0) {
    const conditions = likeTerms.map(() => `(summary LIKE ? OR tags LIKE ?)`).join(' AND ');
    const params = likeTerms.flatMap(t => [`%${t}%`, `%${t}%`]);
    const rows = db.prepare(
      `SELECT id, summary, tags, created_at FROM memory_l1_extracted WHERE ${conditions} LIMIT 50`
    ).all(...params) as any[];

    for (const row of rows) {
      results.push({
        id: row.id, layer: 1, content: row.summary,
        metadata: { tags: JSON.parse(row.tags || '[]'), createdAt: row.created_at },
        rank: ++rank,
      });
    }
  }

  if (layers.includes(2) && likeTerms.length > 0) {
    const conditions = likeTerms.map(() => `(scenario LIKE ? OR key_facts LIKE ?)`).join(' AND ');
    const params = likeTerms.flatMap(t => [`%${t}%`, `%${t}%`]);
    const rows = db.prepare(
      `SELECT id, scenario, key_facts, created_at FROM memory_l2_scenario WHERE ${conditions} LIMIT 50`
    ).all(...params) as any[];

    for (const row of rows) {
      results.push({
        id: row.id, layer: 2, content: row.scenario,
        metadata: { keyFacts: JSON.parse(row.key_facts || '[]'), createdAt: row.created_at },
        rank: ++rank,
      });
    }
  }

  if (layers.includes(3) && likeTerms.length > 0) {
    const conditions = likeTerms.map(() => `(trait LIKE ? OR evidence LIKE ?)`).join(' AND ');
    const params = likeTerms.flatMap(t => [`%${t}%`, `%${t}%`]);
    const rows = db.prepare(
      `SELECT id, trait, evidence, confidence, created_at FROM memory_l3_persona WHERE ${conditions} LIMIT 50`
    ).all(...params) as any[];

    for (const row of rows) {
      results.push({
        id: row.id, layer: 3, content: row.trait,
        metadata: { evidence: JSON.parse(row.evidence || '[]'), confidence: row.confidence, createdAt: row.created_at },
        rank: ++rank,
      });
    }
  }

  return results;
}

function vectorSearch(
  db: Database.Database,
  _queryEmbedding: Float32Array,
  _layers: number[],
  _limit: number
): RankEntry[] {
  // sqlite-vec integration deferred — vectorWeight defaults to 0
  return [];
}
