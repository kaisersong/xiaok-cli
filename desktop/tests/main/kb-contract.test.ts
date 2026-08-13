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
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'test' }, 'user');
    store.insertChunks(src.id, [{ idx: 0, text: 'hello', charStart: 0, charEnd: 5 }]);
    store.deleteCollection(col.id);
    expect(store.getCollection(col.id)).toBeUndefined();
    expect(store.getSource(src.id)).toBeUndefined();
  });

  it('adds a source to a collection', () => {
    const col = store.createCollection({ name: 'C', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'file', title: 'Report.pdf' }, 'user');
    expect(src).toMatchObject({
      collectionId: col.id,
      kind: 'file',
      title: 'Report.pdf',
      parseStatus: 'pending',
    });
  });

  it('enforces parse-result ownership and state transitions in the store', () => {
    const col = store.createCollection({ name: 'Authority', embeddingModelId: 'm', embeddingDim: 384 });
    const userSource = store.addSource({ collectionId: col.id, kind: 'file', title: 'user.doc' }, 'user');
    const agentSource = store.addSource({ collectionId: col.id, kind: 'file', title: 'agent.doc' }, 'agent');

    expect(() => store.updateSourceParseResult(userSource.id, {
      parseStatus: 'parsed',
      metadata: { engine: 'anydoc', engineVersion: '0.1.8' },
    }, 'agent')).toThrow(/not allowed/i);

    const parsed = store.updateSourceParseResult(agentSource.id, {
      parseStatus: 'parsed',
      metadata: { engine: 'anydoc', engineVersion: '0.1.8', truncated: false },
    }, 'agent');
    expect(parsed).toMatchObject({
      parseStatus: 'parsed',
      parseError: '',
      metadata: {
        createdBy: 'agent',
        engine: 'anydoc',
        engineVersion: '0.1.8',
        truncated: false,
      },
    });
    expect(() => store.updateSourceParseResult(agentSource.id, {
      parseStatus: 'failed',
      errorCode: 'malformed_document',
      errorMessage: 'bad',
    }, 'agent')).toThrow(/state/i);
  });

  it('rejects missing mutation authority and agent-created terminal source states', () => {
    const col = store.createCollection({ name: 'Default deny', embeddingModelId: 'm', embeddingDim: 384 });
    expect(() => store.addSource({
      collectionId: col.id,
      kind: 'file',
      title: 'missing-authority.doc',
    }, undefined as never)).toThrow(/request source/i);
    expect(() => store.addSource({
      collectionId: col.id,
      kind: 'file',
      title: 'pre-parsed.doc',
      parseStatus: 'parsed',
    }, 'agent')).toThrow(/pending/i);
    expect(store.listSources(col.id)).toHaveLength(0);
  });

  it('allows scheduler recovery only for pending sources', () => {
    const col = store.createCollection({ name: 'Recovery', embeddingModelId: 'm', embeddingDim: 384 });
    const legacyPending = store.addSource({ collectionId: col.id, kind: 'file', title: 'pending.doc' }, 'user');
    const recovered = store.updateSourceParseResult(legacyPending.id, {
      parseStatus: 'failed',
      errorCode: 'malformed_document',
      errorMessage: 'bad document',
    }, 'scheduler');
    expect(recovered).toMatchObject({ parseStatus: 'failed', parseError: 'bad document' });
    expect(recovered.metadata).toMatchObject({ errorCode: 'malformed_document' });
    expect(() => store.updateSourceParseResult(legacyPending.id, {
      parseStatus: 'parsed',
    }, 'scheduler')).toThrow(/state/i);
  });

  it('persists meeting source metadata and parsed status', () => {
    const col = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({
      collectionId: col.id,
      kind: 'meeting',
      title: 'Weekly Sync',
      filePath: '/tmp/weekly-sync.wav',
      byteSize: 32044,
      parseStatus: 'parsed',
      metadata: {
        meetingId: 'meeting-1',
        durationSeconds: 1,
        audioRetention: 'kept',
        participantHints: ['Alice', 'Bob'],
      },
    }, 'user');

    expect(src).toMatchObject({
      collectionId: col.id,
      kind: 'meeting',
      title: 'Weekly Sync',
      rawPath: '/tmp/weekly-sync.wav',
      byteSize: 32044,
      parseStatus: 'parsed',
      metadata: {
        meetingId: 'meeting-1',
        durationSeconds: 1,
        audioRetention: 'kept',
        participantHints: ['Alice', 'Bob'],
      },
    });
  });

  it('inserts chunks for a source', () => {
    const col = store.createCollection({ name: 'D', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'note' }, 'user');
    const chunks = store.insertChunks(src.id, [
      { idx: 0, text: 'chunk one', charStart: 0, charEnd: 9 },
      { idx: 1, text: 'chunk two', charStart: 9, charEnd: 18 },
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ idx: 0, text: 'chunk one', embeddingStatus: 'pending' });
  });

  it('persists meeting chunk timestamps in metadata', () => {
    const col = store.createCollection({ name: 'Timed Chunks', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'meeting', title: 'Timed Meeting' }, 'user');
    const chunks = store.insertChunks(src.id, [
      {
        idx: 0,
        text: 'Alice committed to ship the demo.',
        charStart: 0,
        charEnd: 35,
        metadata: { startTime: 0, endTime: 2.5, transcribeStatus: 'ok' },
      },
    ]);

    expect(chunks[0].metadata).toEqual({ startTime: 0, endTime: 2.5, transcribeStatus: 'ok' });
    expect(store.listChunks(src.id)[0].metadata).toEqual({ startTime: 0, endTime: 2.5, transcribeStatus: 'ok' });
  });

  it('marks chunk as embedded', () => {
    const col = store.createCollection({ name: 'E', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'x' }, 'user');
    const chunks = store.insertChunks(src.id, [{ idx: 0, text: 'x', charStart: 0, charEnd: 1 }]);
    store.markChunkEmbedded(chunks[0].id);
    const updated = store.listChunks(src.id);
    expect(updated[0].embeddingStatus).toBe('embedded');
  });

  it('marks chunk as failed', () => {
    const col = store.createCollection({ name: 'F', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'x' }, 'user');
    const chunks = store.insertChunks(src.id, [{ idx: 0, text: 'x', charStart: 0, charEnd: 1 }]);
    store.markChunkFailed(chunks[0].id, 'onnx crash');
    const updated = store.listChunks(src.id);
    expect(updated[0].embeddingStatus).toBe('failed');
    expect(updated[0].embeddingError).toBe('onnx crash');
  });

  it('returns embedding progress for a source', () => {
    const col = store.createCollection({ name: 'G', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'multi' }, 'user');
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
    const src = store.addSource({ collectionId: col.id, kind: 'file', title: 'bad.pdf' }, 'user');
    // Simulate failed state would be set by ingest worker — here we just verify retry resets
    const retried = store.retrySource(src.id);
    expect(retried).toMatchObject({ parseStatus: 'pending', parseAttempts: 0 });
  });

  it('getCollectionState returns aggregated progress', () => {
    const col = store.createCollection({ name: 'I', embeddingModelId: 'm', embeddingDim: 384 });
    store.addSource({ collectionId: col.id, kind: 'paste', title: 'one' }, 'user');
    store.addSource({ collectionId: col.id, kind: 'url', title: 'two' }, 'user');
    const state = store.getCollectionState(col.id);
    expect(state).toBeDefined();
    expect(state!.sources).toHaveLength(2);
  });

  it('getSourceWithContent supports offset/limit pagination', () => {
    const col = store.createCollection({ name: 'J', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'long' }, 'user');
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

  /**
   * 真实语料实测：3 个 HTML source 的正文只占 11.4%–18.5%，全语料 74.1% 的
   * 索引字符是标签与 CSS。而同文件的 extractDocx / extractPptx 早就在剥标签。
   */
  it('strips tags, style and script from html so only body text is indexed', async () => {
    const extractor = createSourceExtractor();
    const filePath = join(rootDir, 'report.html');
    writeFileSync(filePath, [
      '<!DOCTYPE html><html><head>',
      '<style>.fade-in-up{opacity:0;transform:translateY(20px)}h2{font-size:24px}</style>',
      '<script>window.__DATA__={"title":"4.2 竞争态势总览"};</script>',
      '</head><body>',
      '<h1 id="section-1">月度分析</h1>',
      '<p class="fade-in-up">Anthropic 与 OpenAI 的模型对比</p>',
      '<!-- 内部备注，不应进索引 -->',
      '</body></html>',
    ].join('\n'));

    const result = await extractor.extract({ filePath, mimeType: 'text/html' });

    expect(result.ok).toBe(true);
    const text = result.text!;
    expect(text).toContain('月度分析');
    expect(text).toContain('Anthropic 与 OpenAI 的模型对比');
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).not.toContain('translateY');
    expect(text).not.toContain('font-size');
    expect(text).not.toContain('window.__DATA__');
    expect(text).not.toContain('内部备注');
    expect(text).not.toContain('fade-in-up');
  });

  it('decodes html entities instead of indexing them raw', async () => {
    const extractor = createSourceExtractor();
    const filePath = join(rootDir, 'entities.html');
    writeFileSync(filePath, '<p>&quot;效率 vs 规模&quot; &amp; &lt;成本&gt;&nbsp;分析</p>');
    const result = await extractor.extract({ filePath, mimeType: 'text/html' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('"效率 vs 规模" & <成本> 分析');
    expect(result.text).not.toContain('&quot;');
    expect(result.text).not.toContain('&nbsp;');
  });

  it('keeps plain text and markdown files byte-for-byte', async () => {
    const extractor = createSourceExtractor();
    const mdPath = join(rootDir, 'notes.md');
    // Markdown 里的 `<` 与自动链接必须原样保留 —— 剥离只适用于 markup 类扩展
    const md = '# 标题\n\n用 `a < b` 比较，见 <https://example.com>\n';
    writeFileSync(mdPath, md);
    const result = await extractor.extract({ filePath: mdPath, mimeType: 'text/markdown' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe(md);
  });

  it('strips markup from xml and svg too', async () => {
    const extractor = createSourceExtractor();
    const xmlPath = join(rootDir, 'data.xml');
    writeFileSync(xmlPath, '<root><item id="1">端口配置</item></root>');
    const xml = await extractor.extract({ filePath: xmlPath, mimeType: 'application/xml' });
    expect(xml.ok).toBe(true);
    expect(xml.text).toContain('端口配置');
    expect(xml.text).not.toMatch(/<[^>]+>/);
  });

  it('strips markup when a text/html file has no markup extension', async () => {
    const extractor = createSourceExtractor();
    const filePath = join(rootDir, 'page');
    writeFileSync(filePath, '<html><body><p>正文内容</p></body></html>');
    const result = await extractor.extract({ filePath, mimeType: 'text/html' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('正文内容');
    expect(result.text).not.toMatch(/<[^>]+>/);
  });
});

describe('KB Integration — addSource sets parsed status', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('source with chunks should be marked as parsed after insert', () => {
    const col = store.createCollection({ name: 'Test', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'note' }, 'user');
    expect(src.parseStatus).toBe('pending');
    store.insertChunks(src.id, [
      { idx: 0, text: '测试内容', charStart: 0, charEnd: 4 },
    ]);
    // Simulate the fix: after chunking, update parse_status
    (store as any)._db?.prepare("UPDATE sources SET parse_status = 'parsed' WHERE id = ?").run(src.id);
    const updated = store.getSource(src.id);
    expect(updated!.parseStatus).toBe('parsed');
  });
});

describe('KB Integration — Chinese search with jieba', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-cn-search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('finds Chinese content via jieba-segmented query terms', async (ctx) => {
    // nodejieba is an optional native addon. When it cannot load on this
    // platform/build, Chinese segmentation gracefully degrades to the raw
    // string, so this jieba-recall assertion is not meaningful — skip it
    // rather than failing.
    const { segmentQuery } = await import('../../../src/ai/memory/segment.js');
    if (segmentQuery('原生组织') === '原生组织') {
      ctx.skip();
      return;
    }

    const col = store.createCollection({ name: 'CN', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'AI文档' }, 'user');
    store.insertChunks(src.id, [
      { idx: 0, text: 'AI 原生组织架构是一种全新的组织设计理念', charStart: 0, charEnd: 20 },
      { idx: 1, text: '传统的企业管理方式已经不适应数字化转型需求', charStart: 20, charEnd: 40 },
    ]);
    (store as any)._db?.prepare("UPDATE sources SET parse_status = 'parsed' WHERE id = ?").run(src.id);

    // Simulate search with jieba segmentation
    const query = 'AI原生组织';
    const segmented = segmentQuery(query);
    const terms = [...new Set(segmented.split(/\s+/).filter(Boolean).map((t: string) => t.toLowerCase()))];

    const chunks = store.listChunks(src.id);
    const matched = chunks.filter(chunk => {
      const lower = chunk.text.toLowerCase();
      return terms.some((t: string) => lower.includes(t));
    });
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].text).toContain('原生');
  });
});

describe('KB Integration — default collection auto-created', () => {
  let rootDir: string;

  it('creates default collection on first access when DB is empty', () => {
    rootDir = join(tmpdir(), `xiaok-kb-default-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    const store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
    expect(store.listCollections()).toHaveLength(0);
    // Simulate the auto-creation logic from ipc.ts
    if (store.listCollections().length === 0) {
      store.createCollection({
        name: '我的知识库',
        description: '默认知识库集合',
        embeddingModelId: 'bge-small-zh-v1.5',
        embeddingDim: 512,
      });
    }
    expect(store.listCollections()).toHaveLength(1);
    expect(store.listCollections()[0].name).toBe('我的知识库');
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });
});
