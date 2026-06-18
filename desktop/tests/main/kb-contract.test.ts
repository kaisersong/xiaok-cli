/**
 * PR0 — Knowledge Base Contract Tests
 *
 * These tests define the behavioral contract for the KB system.
 * They exercise the KbStore, Chunker, and SourceExtractor interfaces.
 * In PR0, a stub implementation is used that throws 'not implemented'.
 * When PR-A lands the real implementation, these tests pass.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KbStore, Chunker, SourceExtractor } from '../../electron/kb-store.js';
import type { Collection, Source, Chunk } from '../../electron/kb-types.js';

import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import { createChunker } from '../../electron/kb-chunker.js';
import { createSourceExtractor } from '../../electron/kb-source-extractor.js';

describe('KB Contract — KbStore', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates a collection with required fields', () => {
    const col = store.createCollection({
      name: 'Research',
      embeddingModelId: 'bge-small-zh-v1.5',
      embeddingDim: 512,
    });
    expect(col).toMatchObject({
      name: 'Research',
      embeddingModelId: 'bge-small-zh-v1.5',
      embeddingDim: 512,
      scope: 'global',
      chunkCountCached: 0,
    });
    expect(col.id).toBeTruthy();
    expect(col.createdAt).toBeGreaterThan(0);
  });

  it('lists collections', () => {
    store.createCollection({ name: 'A', embeddingModelId: 'm', embeddingDim: 384 });
    store.createCollection({ name: 'B', embeddingModelId: 'm', embeddingDim: 384 });
    const list = store.listCollections();
    expect(list).toHaveLength(2);
  });

  it('deletes collection and cascades to sources and chunks', () => {
    const col = store.createCollection({ name: 'ToDelete', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'test' });
    store.insertChunks(src.id, [{ idx: 0, text: 'hello', charStart: 0, charEnd: 5 }]);
    store.deleteCollection(col.id);
    expect(store.getCollection(col.id)).toBeUndefined();
    expect(store.getSource(src.id)).toBeUndefined();
  });

  it('adds a source to a collection', () => {
    const col = store.createCollection({ name: 'C', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'file', title: 'Report.pdf' });
    expect(src).toMatchObject({
      collectionId: col.id,
      kind: 'file',
      title: 'Report.pdf',
      parseStatus: 'pending',
    });
  });

  it('inserts chunks for a source', () => {
    const col = store.createCollection({ name: 'D', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'note' });
    const chunks = store.insertChunks(src.id, [
      { idx: 0, text: 'chunk one', charStart: 0, charEnd: 9 },
      { idx: 1, text: 'chunk two', charStart: 9, charEnd: 18 },
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ idx: 0, text: 'chunk one', embeddingStatus: 'pending' });
  });

  it('marks chunk as embedded', () => {
    const col = store.createCollection({ name: 'E', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'x' });
    const chunks = store.insertChunks(src.id, [{ idx: 0, text: 'x', charStart: 0, charEnd: 1 }]);
    store.markChunkEmbedded(chunks[0].id);
    const updated = store.listChunks(src.id);
    expect(updated[0].embeddingStatus).toBe('embedded');
  });

  it('marks chunk as failed', () => {
    const col = store.createCollection({ name: 'F', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'x' });
    const chunks = store.insertChunks(src.id, [{ idx: 0, text: 'x', charStart: 0, charEnd: 1 }]);
    store.markChunkFailed(chunks[0].id, 'onnx crash');
    const updated = store.listChunks(src.id);
    expect(updated[0].embeddingStatus).toBe('failed');
    expect(updated[0].embeddingError).toBe('onnx crash');
  });

  it('returns embedding progress for a source', () => {
    const col = store.createCollection({ name: 'G', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'multi' });
    store.insertChunks(src.id, [
      { idx: 0, text: 'a', charStart: 0, charEnd: 1 },
      { idx: 1, text: 'b', charStart: 1, charEnd: 2 },
      { idx: 2, text: 'c', charStart: 2, charEnd: 3 },
    ]);
    const chunks = store.listChunks(src.id);
    store.markChunkEmbedded(chunks[0].id);
    store.markChunkFailed(chunks[1].id, 'err');
    const progress = store.getSourceEmbeddingProgress(src.id);
    expect(progress).toEqual({ embedded: 1, total: 3, failed: 1 });
  });

  it('retrySource resets parse status', () => {
    const col = store.createCollection({ name: 'H', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'file', title: 'bad.pdf' });
    // Simulate failed state would be set by ingest worker — here we just verify retry resets
    const retried = store.retrySource(src.id);
    expect(retried).toMatchObject({ parseStatus: 'pending', parseAttempts: 0 });
  });

  it('getCollectionState returns aggregated progress', () => {
    const col = store.createCollection({ name: 'I', embeddingModelId: 'm', embeddingDim: 384 });
    store.addSource({ collectionId: col.id, kind: 'paste', title: 'one' });
    store.addSource({ collectionId: col.id, kind: 'url', title: 'two' });
    const state = store.getCollectionState(col.id);
    expect(state).toBeDefined();
    expect(state!.sources).toHaveLength(2);
  });

  it('getSourceWithContent supports offset/limit pagination', () => {
    const col = store.createCollection({ name: 'J', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'long' });
    // Insert chunks manually (ingest pipeline would do this in production)
    store.insertChunks(src.id, [
      { idx: 0, text: 'a'.repeat(50), charStart: 0, charEnd: 50 },
      { idx: 1, text: 'b'.repeat(50), charStart: 50, charEnd: 100 },
    ]);
    const result = store.getSourceWithContent(src.id, 0, 50);
    expect(result).toBeDefined();
    expect(result!.text).toHaveLength(50);
    expect(result!.hasMore).toBe(true);
    expect(result!.nextOffset).toBe(50);
    expect(result!.totalChars).toBe(100);
  });
});

describe('KB Contract — Chunker', () => {
  it('splits text into overlapping chunks', () => {
    const chunker = createChunker();
    const result = chunker.chunk({ text: 'a'.repeat(1600) });
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].charStart).toBe(0);
    expect(result[0].charEnd).toBeGreaterThan(0);
    expect(result[0].text.length).toBeLessThanOrEqual(900);
  });

  it('preserves page index for PDF-like content', () => {
    const chunker = createChunker();
    // Need text long enough to produce multiple chunks
    const page1 = 'a'.repeat(600);
    const page2 = 'b'.repeat(600);
    const text = page1 + page2;
    const result = chunker.chunk({
      text,
      pageBreaks: [600],
    });
    expect(result.length).toBeGreaterThan(1);
    const page2Chunks = result.filter(c => c.pageIndex === 1);
    expect(page2Chunks.length).toBeGreaterThan(0);
  });

  it('handles empty text', () => {
    const chunker = createChunker();
    const result = chunker.chunk({ text: '' });
    expect(result).toEqual([]);
  });
});

describe('KB Contract — SourceExtractor', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-extractor-${Date.now()}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('extracts text from a plain text file', async () => {
    const extractor = createSourceExtractor();
    const filePath = join(rootDir, 'test.txt');
    writeFileSync(filePath, 'hello world');
    const result = await extractor.extract({ filePath, mimeType: 'text/plain' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('hello world');
  });

  it('extracts text from pasted content', () => {
    const extractor = createSourceExtractor();
    const result = extractor.extractFromText('some notes', 'My Notes');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('some notes');
  });

  it('returns error for unsupported format', async () => {
    const extractor = createSourceExtractor();
    const filePath = join(rootDir, 'test.exe');
    writeFileSync(filePath, Buffer.alloc(10));
    const result = await extractor.extract({ filePath, mimeType: 'application/x-msdownload' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
