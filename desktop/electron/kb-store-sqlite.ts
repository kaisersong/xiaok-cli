/**
 * Knowledge Base — SQLite Store Implementation
 *
 * Implements KbStore interface backed by knowledge.db (independent from memory.db).
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  Collection,
  CollectionState,
  Chunk,
  CreateCollectionInput,
  GetSourceOutput,
  Source,
  AddSourceInput,
  SourceEmbeddingProgress,
  ChunkEmbeddingStatus,
  SourceParseStatus,
} from './kb-types.js';
import type { KbStore } from './kb-store.js';

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'global',
    cwd TEXT NOT NULL DEFAULT '',
    embedding_model_id TEXT NOT NULL,
    embedding_dim INTEGER NOT NULL,
    chunk_count_cached INTEGER NOT NULL DEFAULT 0,
    auto_accept_web_persist INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    uri TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    sha256 TEXT NOT NULL DEFAULT '',
    byte_size INTEGER NOT NULL DEFAULT 0,
    raw_path TEXT NOT NULL DEFAULT '',
    extracted_text_path TEXT NOT NULL DEFAULT '',
    parse_status TEXT NOT NULL DEFAULT 'pending',
    parse_error TEXT NOT NULL DEFAULT '',
    parse_attempts INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    segmented_text TEXT,
    char_start INTEGER NOT NULL DEFAULT 0,
    char_end INTEGER NOT NULL DEFAULT 0,
    page_index INTEGER,
    slide_index INTEGER,
    sheet_name TEXT,
    cell_range TEXT,
    embedding_status TEXT NOT NULL DEFAULT 'pending',
    embedding_error TEXT NOT NULL DEFAULT '',
    embedding_attempts INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    UNIQUE(source_id, idx)
  );

  CREATE TABLE IF NOT EXISTS chunk_embeddings (
    chunk_id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL,
    embedding BLOB NOT NULL,
    embedding_dim INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sources_collection ON sources(collection_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id, idx);
  CREATE INDEX IF NOT EXISTS idx_chunks_collection ON chunks(collection_id);
  CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_collection ON chunk_embeddings(collection_id);

  CREATE TRIGGER IF NOT EXISTS chunks_count_inc AFTER INSERT ON chunks BEGIN
    UPDATE collections SET chunk_count_cached = chunk_count_cached + 1, updated_at = NEW.created_at WHERE id = NEW.collection_id;
    UPDATE sources SET chunk_count = chunk_count + 1, updated_at = NEW.created_at WHERE id = NEW.source_id;
  END;

  CREATE TRIGGER IF NOT EXISTS chunks_count_dec AFTER DELETE ON chunks BEGIN
    UPDATE collections SET chunk_count_cached = chunk_count_cached - 1 WHERE id = OLD.collection_id;
    UPDATE sources SET chunk_count = chunk_count - 1 WHERE id = OLD.source_id;
  END;
`;

export function createKbStoreSqlite(dbPath: string): KbStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  db.exec('PRAGMA foreign_keys = ON');

  const now = () => Date.now();

  function createCollection(input: CreateCollectionInput): Collection {
    const id = randomUUID();
    const ts = now();
    db.prepare(`
      INSERT INTO collections (id, name, description, color, scope, cwd, embedding_model_id, embedding_dim, chunk_count_cached, auto_accept_web_persist, created_at, updated_at)
      VALUES (@id, @name, @description, @color, @scope, @cwd, @embeddingModelId, @embeddingDim, 0, 0, @ts, @ts)
    `).run({ id, name: input.name, description: input.description ?? '', color: input.color ?? '', scope: input.scope ?? 'global', cwd: input.cwd ?? '', embeddingModelId: input.embeddingModelId, embeddingDim: input.embeddingDim, ts });
    return getCollection(id)!;
  }

  function getCollection(id: string): Collection | undefined {
    const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapCollection(row) : undefined;
  }

  function listCollections(): Collection[] {
    return (db.prepare('SELECT * FROM collections ORDER BY created_at ASC').all() as Record<string, unknown>[]).map(mapCollection);
  }

  function renameCollection(id: string, name: string, description?: string): Collection | undefined {
    const ts = now();
    if (description !== undefined) {
      db.prepare('UPDATE collections SET name = @name, description = @desc, updated_at = @ts WHERE id = @id').run({ id, name, desc: description, ts });
    } else {
      db.prepare('UPDATE collections SET name = @name, updated_at = @ts WHERE id = @id').run({ id, name, ts });
    }
    return getCollection(id);
  }

  function deleteCollection(id: string): void {
    db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  }

  function addSource(input: AddSourceInput): Source {
    const id = randomUUID();
    const ts = now();
    db.prepare(`
      INSERT INTO sources (id, collection_id, kind, title, uri, mime_type, sha256, byte_size, raw_path, extracted_text_path, parse_status, parse_error, parse_attempts, chunk_count, metadata_json, created_at, updated_at)
      VALUES (@id, @collectionId, @kind, @title, @uri, '', '', 0, '', '', 'pending', '', 0, 0, '{}', @ts, @ts)
    `).run({ id, collectionId: input.collectionId, kind: input.kind, title: input.title, uri: input.uri ?? '', ts });
    return getSource(id)!;
  }

  function getSource(id: string): Source | undefined {
    const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapSource(row) : undefined;
  }

  function listSources(collectionId: string): Source[] {
    return (db.prepare('SELECT * FROM sources WHERE collection_id = ? ORDER BY created_at ASC').all(collectionId) as Record<string, unknown>[]).map(mapSource);
  }

  function deleteSource(id: string): void {
    db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  }

  function retrySource(id: string): Source | undefined {
    const ts = now();
    db.prepare("UPDATE sources SET parse_status = 'pending', parse_error = '', parse_attempts = 0, updated_at = @ts WHERE id = @id").run({ id, ts });
    return getSource(id);
  }

  function getSourceEmbeddingProgress(sourceId: string): SourceEmbeddingProgress {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN embedding_status = 'embedded' THEN 1 ELSE 0 END), 0) AS embedded,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN embedding_status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
      FROM chunks WHERE source_id = ?
    `).get(sourceId) as { embedded: number; total: number; failed: number } | undefined;
    return row ?? { embedded: 0, total: 0, failed: 0 };
  }

  function insertChunks(sourceId: string, inputs: Array<{ idx: number; text: string; charStart: number; charEnd: number; pageIndex?: number; slideIndex?: number; sheetName?: string; cellRange?: string }>): Chunk[] {
    const src = getSource(sourceId);
    if (!src) throw new Error('Source not found');
    const ts = now();
    const stmt = db.prepare(`
      INSERT INTO chunks (id, source_id, collection_id, idx, text, segmented_text, char_start, char_end, page_index, slide_index, sheet_name, cell_range, embedding_status, embedding_error, embedding_attempts, metadata_json, created_at)
      VALUES (@id, @sourceId, @collectionId, @idx, @text, NULL, @charStart, @charEnd, @pageIndex, @slideIndex, @sheetName, @cellRange, 'pending', '', 0, '{}', @ts)
    `);
    const ids: string[] = [];
    for (const c of inputs) {
      const id = randomUUID();
      ids.push(id);
      stmt.run({ id, sourceId, collectionId: src.collectionId, idx: c.idx, text: c.text, charStart: c.charStart, charEnd: c.charEnd, pageIndex: c.pageIndex ?? null, slideIndex: c.slideIndex ?? null, sheetName: c.sheetName ?? null, cellRange: c.cellRange ?? null, ts });
    }
    return ids.map(id => getChunk(id)!);
  }

  function getChunk(id: string): Chunk | undefined {
    const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapChunk(row) : undefined;
  }

  function listChunks(sourceId: string): Chunk[] {
    return (db.prepare('SELECT * FROM chunks WHERE source_id = ? ORDER BY idx ASC').all(sourceId) as Record<string, unknown>[]).map(mapChunk);
  }

  function markChunkEmbedded(chunkId: string): void {
    db.prepare("UPDATE chunks SET embedding_status = 'embedded', embedding_error = '' WHERE id = ?").run(chunkId);
  }

  function markChunkFailed(chunkId: string, error: string): void {
    db.prepare("UPDATE chunks SET embedding_status = 'failed', embedding_error = @error, embedding_attempts = embedding_attempts + 1 WHERE id = @id").run({ id: chunkId, error });
  }

  function getCollectionState(collectionId: string): CollectionState | undefined {
    const col = getCollection(collectionId);
    if (!col) return undefined;
    const sources = listSources(collectionId).map(s => ({
      id: s.id,
      title: s.title,
      parseStatus: s.parseStatus,
      embeddingProgress: getSourceEmbeddingProgress(s.id),
    }));
    return { collection: col, sources };
  }

  function getSourceWithContent(sourceId: string, offset = 0, limit = 32_000): GetSourceOutput | undefined {
    const src = getSource(sourceId);
    if (!src) return undefined;
    const chunks = listChunks(sourceId);
    const fullText = chunks.map(c => c.text).join('');
    const totalChars = fullText.length;
    const sliced = fullText.slice(offset, offset + limit);
    const hasMore = offset + limit < totalChars;
    const outline = deriveOutline(chunks);
    return {
      source: src,
      outline,
      text: sliced,
      hasMore,
      nextOffset: hasMore ? offset + limit : undefined,
      totalChars,
    };
  }

  function deriveOutline(chunks: Chunk[]): GetSourceOutput['outline'] {
    const seen = new Set<string>();
    const outline: GetSourceOutput['outline'] = [];
    for (const c of chunks) {
      if (c.pageIndex != null) {
        const key = `page:${c.pageIndex}`;
        if (!seen.has(key)) { seen.add(key); outline.push({ kind: 'page', index: c.pageIndex, charStart: c.charStart, charEnd: c.charEnd }); }
      } else if (c.slideIndex != null) {
        const key = `slide:${c.slideIndex}`;
        if (!seen.has(key)) { seen.add(key); outline.push({ kind: 'slide', index: c.slideIndex, charStart: c.charStart, charEnd: c.charEnd }); }
      } else if (c.sheetName != null) {
        const key = `sheet:${c.sheetName}`;
        if (!seen.has(key)) { seen.add(key); outline.push({ kind: 'sheet', index: outline.length, title: c.sheetName, charStart: c.charStart, charEnd: c.charEnd }); }
      }
    }
    return outline;
  }

  function close(): void {
    db.close();
  }

  return {
    _db: db,
    createCollection, getCollection, listCollections, renameCollection, deleteCollection,
    addSource, getSource, listSources, deleteSource, retrySource, getSourceEmbeddingProgress,
    insertChunks, listChunks, markChunkEmbedded, markChunkFailed,
    getCollectionState, getSourceWithContent, close,
  };
}

function mapCollection(row: Record<string, unknown>): Collection {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    color: row.color as string,
    scope: row.scope as Collection['scope'],
    cwd: row.cwd as string,
    embeddingModelId: row.embedding_model_id as string,
    embeddingDim: row.embedding_dim as number,
    chunkCountCached: row.chunk_count_cached as number,
    autoAcceptWebPersist: (row.auto_accept_web_persist as number) === 1,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function mapSource(row: Record<string, unknown>): Source {
  return {
    id: row.id as string,
    collectionId: row.collection_id as string,
    kind: row.kind as Source['kind'],
    title: row.title as string,
    uri: row.uri as string,
    mimeType: row.mime_type as string,
    sha256: row.sha256 as string,
    byteSize: row.byte_size as number,
    rawPath: row.raw_path as string,
    extractedTextPath: row.extracted_text_path as string,
    parseStatus: row.parse_status as SourceParseStatus,
    parseError: row.parse_error as string,
    parseAttempts: row.parse_attempts as number,
    chunkCount: row.chunk_count as number,
    metadata: JSON.parse((row.metadata_json as string) || '{}'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function mapChunk(row: Record<string, unknown>): Chunk {
  return {
    id: row.id as string,
    sourceId: row.source_id as string,
    collectionId: row.collection_id as string,
    idx: row.idx as number,
    text: row.text as string,
    charStart: row.char_start as number,
    charEnd: row.char_end as number,
    pageIndex: row.page_index as number | null,
    slideIndex: row.slide_index as number | null,
    sheetName: row.sheet_name as string | null,
    cellRange: row.cell_range as string | null,
    embeddingStatus: row.embedding_status as ChunkEmbeddingStatus,
    embeddingError: row.embedding_error as string,
    metadata: JSON.parse((row.metadata_json as string) || '{}'),
    createdAt: row.created_at as number,
  };
}
