import { segmentQuery } from './segment.js';
/**
 * Build FTS5 query from segmented tokens.
 * Each token is quoted and connected with OR for recall.
 * Filters out single-character tokens to reduce noise from nodejieba's
 * character-level splitting of non-Chinese text.
 */
function buildFtsQuery(segmentedQuery) {
    const tokens = segmentedQuery.split(/\s+/).filter(t => t.length > 1);
    if (tokens.length === 0)
        return null;
    return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}
export async function hybridSearch(db, embeddingClient, query, options = {}) {
    const { bm25Weight = 0.5, vectorWeight = 0.3, rrfK = 60, limit = 10, layers = [0, 1, 2, 3], } = options;
    const segmentedQuery = segmentQuery(query);
    if (segmentedQuery.trim() === '') {
        // Empty query: return recent L1 entries as a recency fallback
        const rows = db.prepare(`SELECT id, summary, tags, scope, mem_type, cwd, created_at
       FROM memory_l1_extracted ORDER BY created_at DESC LIMIT ?`).all(limit);
        return rows.map(row => ({
            id: row.id,
            layer: 1,
            content: row.summary,
            score: 1,
            metadata: {
                tags: JSON.parse(row.tags || '[]'),
                scope: row.scope || 'global',
                mem_type: row.mem_type,
                cwd: row.cwd,
            },
        }));
    }
    const rrfScores = new Map();
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
        }
        catch {
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
function bm25Search(db, ftsQuery, segmentedQuery, layers) {
    const results = [];
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
      `).all(ftsQuery);
            for (const row of rows) {
                results.push({
                    id: row.id, layer: 0, content: row.content,
                    metadata: { sessionId: row.session_id, role: row.role, createdAt: row.created_at },
                    rank: ++rank,
                });
            }
        }
        catch {
            // FTS match may fail on certain queries, fall through to LIKE
        }
    }
    const likeTerms = segmentedQuery.split(/\s+/).filter(Boolean);
    if (layers.includes(1) && likeTerms.length > 0) {
        const conditions = likeTerms.map(() => `(summary LIKE ? OR tags LIKE ?)`).join(' AND ');
        const params = likeTerms.flatMap(t => [`%${t}%`, `%${t}%`]);
        const rows = db.prepare(`SELECT id, summary, tags, created_at FROM memory_l1_extracted WHERE ${conditions} LIMIT 50`).all(...params);
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
        const rows = db.prepare(`SELECT id, scenario, key_facts, created_at FROM memory_l2_scenario WHERE ${conditions} LIMIT 50`).all(...params);
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
        const rows = db.prepare(`SELECT id, trait, evidence, confidence, created_at FROM memory_l3_persona WHERE ${conditions} LIMIT 50`).all(...params);
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
function vectorSearch(db, queryEmbedding, layers, limit) {
    const results = [];
    const queryDims = queryEmbedding.length;
    const rows = db.prepare('SELECT memory_id, layer, embedding FROM memory_embeddings WHERE layer >= 0 LIMIT 5000').all();
    const scored = [];
    for (const row of rows) {
        if (!layers.includes(row.layer))
            continue;
        const emb = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
        if (emb.length !== queryDims)
            continue;
        const sim = cosineSimilarity(queryEmbedding, emb);
        if (sim > 0.3) {
            scored.push({ memoryId: row.memory_id, layer: row.layer, similarity: sim });
        }
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    const top = scored.slice(0, limit);
    for (const entry of top) {
        const content = getLayerContent(db, entry.memoryId, entry.layer);
        if (!content)
            continue;
        results.push({
            id: entry.memoryId,
            layer: entry.layer,
            content: content.text,
            metadata: content.metadata,
            rank: results.length + 1,
        });
    }
    return results;
}
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom < 1e-12 ? 0 : dot / denom;
}
function getLayerContent(db, id, layer) {
    const tableMap = {
        0: { table: 'memory_l0_raw', textCol: 'content', metaCols: ['session_id', 'role', 'created_at'] },
        1: { table: 'memory_l1_extracted', textCol: 'summary', metaCols: ['tags', 'scope', 'mem_type', 'cwd', 'created_at'] },
        2: { table: 'memory_l2_scenario', textCol: 'scenario', metaCols: ['key_facts', 'created_at'] },
        3: { table: 'memory_l3_persona', textCol: 'trait', metaCols: ['evidence', 'confidence', 'created_at'] },
    };
    const spec = tableMap[layer];
    if (!spec)
        return null;
    const cols = [spec.textCol, ...spec.metaCols];
    const row = db.prepare(`SELECT ${cols.join(', ')} FROM ${spec.table} WHERE id = ?`).get(id);
    if (!row)
        return null;
    const metadata = {};
    for (const col of spec.metaCols) {
        let val = row[col];
        if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
            try {
                val = JSON.parse(val);
            }
            catch { }
        }
        metadata[col] = val;
    }
    return { text: String(row[spec.textCol]), metadata };
}
