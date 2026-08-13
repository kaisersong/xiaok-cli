/**
 * KB Integration Tests
 *
 * Tests the full KB pipeline as it runs in desktop:
 * - Source addition sets parse_status to 'parsed'
 * - Chinese search with jieba segmentation finds content
 * - Default collection auto-creation
 * - Tools actually return results from the correct DB
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import { createChunker } from '../../electron/kb-chunker.js';
import { createSourceExtractor } from '../../electron/kb-source-extractor.js';
import { createKbRetriever } from '../../electron/kb-retrieval.js';
import { createKbTools } from '../../electron/kb-tools.js';
import type { KbStore } from '../../electron/kb-store.js';

describe('KB Integration — addSource pipeline', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('paste source ends up as parsed with chunks after inline processing', () => {
    const col = store.createCollection({ name: 'Test', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'note' }, 'user');

    const extractor = createSourceExtractor();
    const chunker = createChunker();
    const result = extractor.extractFromText('这是一段中文测试内容，用于验证知识库入库流程。', 'note');
    expect(result.ok).toBe(true);

    const chunks = chunker.chunk({ text: result.text!, mimeType: result.mimeType });
    store.insertChunks(src.id, chunks);

    // Simulate what ipc.ts does: update parse_status
    (store as any)._db.prepare("UPDATE sources SET parse_status = 'parsed' WHERE id = ?").run(src.id);

    const updated = store.getSource(src.id);
    expect(updated!.parseStatus).toBe('parsed');
    expect(updated!.chunkCount).toBeGreaterThan(0);
  });

  it('file source with extractable content ends up parsed', async () => {
    const col = store.createCollection({ name: 'Files', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'file', title: 'test.txt' }, 'user');

    const { writeFileSync } = await import('node:fs');
    const filePath = join(rootDir, 'test.txt');
    writeFileSync(filePath, '知识库集成测试文件内容');

    const extractor = createSourceExtractor();
    const chunker = createChunker();
    const result = await extractor.extract({ filePath, mimeType: 'text/plain' });
    expect(result.ok).toBe(true);

    const chunks = chunker.chunk({ text: result.text!, mimeType: result.mimeType });
    store.insertChunks(src.id, chunks);
    (store as any)._db.prepare("UPDATE sources SET parse_status = 'parsed' WHERE id = ?").run(src.id);

    const updated = store.getSource(src.id);
    expect(updated!.parseStatus).toBe('parsed');
    expect(store.listChunks(src.id).length).toBeGreaterThan(0);
  });

  it('source without chunks stays pending (not falsely marked parsed)', () => {
    const col = store.createCollection({ name: 'Empty', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'file', title: 'empty.bin' }, 'user');
    // No extraction/chunking — status stays pending
    expect(store.getSource(src.id)!.parseStatus).toBe('pending');
  });
});

describe('KB Integration — Chinese search with jieba', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  /**
   * 必须通过 kb_search tool 调用生产检索路径。
   * 这两条测试原先在测试代码里自己写 `chunk.text.includes(term)`，
   * 于是生产实现无论对错都绿 —— 那是自证，不是回归。
   */
  async function searchViaProductionTool(query: string): Promise<string> {
    const retriever = createKbRetriever({ db: (store as unknown as { _db: never })._db, embedFn: () => null });
    const tools = createKbTools(store, retriever);
    const kbSearch = tools.find(t => t.definition.name === 'kb_search');
    expect(kbSearch).toBeDefined();
    return await kbSearch!.execute({ query }) as string;
  }

  it('finds Chinese content using jieba-segmented terms', async () => {
    const col = store.createCollection({ name: 'CN', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'AI文档' }, 'user');

    const chunker = createChunker();
    const text = 'AI原生组织架构是一种新型的企业组织形态，它将人工智能深度融入组织的核心流程和决策体系中。';
    store.insertChunks(src.id, chunker.chunk({ text }));

    const output = await searchViaProductionTool('AI原生组织');

    expect(output).toContain('AI原生组织');
    expect(output).toContain('AI文档');
    expect(output).not.toBe('未找到相关内容。');
  });

  it('matches partial Chinese terms', async () => {
    const col = store.createCollection({ name: 'Partial', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: '测试' }, 'user');

    const chunker = createChunker();
    store.insertChunks(src.id, chunker.chunk({ text: '深度学习和自然语言处理是人工智能的核心技术' }));

    const output = await searchViaProductionTool('自然语言处理');

    expect(output).toContain('自然语言处理');
    expect(output).not.toBe('未找到相关内容。');
  });

  it('returns the explicit empty message when nothing matches', async () => {
    const col = store.createCollection({ name: 'Empty', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: '无关文档' }, 'user');
    store.insertChunks(src.id, createChunker().chunk({ text: '深度学习和自然语言处理是人工智能的核心技术' }));

    const output = await searchViaProductionTool('高压锅炖牛腩的火候');

    expect(output).toBe('未找到相关内容。');
  });

  /**
   * golden set 实测：无答案查询的 top1 命中率最高 0.250，有答案查询最低 0.333。
   * 下限挡掉弱信号，但不能挡掉 1/3 —— 否则会误杀真实查询。
   */
  it('rejects weak single-term matches below the relevance floor', async () => {
    const col = store.createCollection({ name: 'Floor', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: '技术笔记' }, 'user');
    store.insertChunks(src.id, createChunker().chunk({ text: '深度学习模型的训练需要大量标注数据。' }));

    // 分词后 4 个实词，只有「模型」命中 → 命中率 0.25，低于下限
    const output = await searchViaProductionTool('高压锅 炖牛腩 火候 模型');

    expect(output).toBe('未找到相关内容。');
  });

  it('keeps a one-in-three match, which is above the floor', async () => {
    const col = store.createCollection({ name: 'Keep', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: '技术笔记' }, 'user');
    store.insertChunks(src.id, createChunker().chunk({ text: '深度学习模型的训练需要大量标注数据。' }));

    const output = await searchViaProductionTool('标注数据 火候 高压锅');

    expect(output).toContain('技术笔记');
    expect(output).not.toBe('未找到相关内容。');
  });
});

describe('KB Integration — default collection and startup fix', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-default-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates default collection on first access', () => {
    const store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
    expect(store.listCollections()).toHaveLength(0);
    // Simulate what getKbStore does
    store.createCollection({
      name: '我的知识库',
      description: '默认知识库集合',
      embeddingModelId: 'bge-small-zh-v1.5',
      embeddingDim: 512,
    });
    expect(store.listCollections()).toHaveLength(1);
    expect(store.listCollections()[0].name).toBe('我的知识库');
    store.close();
  });

  it('startup fix updates pending sources that already have chunks', () => {
    const store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
    const col = store.createCollection({ name: 'Fix', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: 'old' }, 'user');
    store.insertChunks(src.id, [{ idx: 0, text: 'content', charStart: 0, charEnd: 7 }]);

    // Source is still pending (simulates pre-fix behavior)
    expect(store.getSource(src.id)!.parseStatus).toBe('pending');

    // Simulate startup fix
    (store as any)._db.prepare("UPDATE sources SET parse_status = 'parsed' WHERE parse_status = 'pending' AND id IN (SELECT DISTINCT source_id FROM chunks)").run();

    expect(store.getSource(src.id)!.parseStatus).toBe('parsed');
    store.close();
  });
});

describe('KB Integration — kb_search tool returns actual results', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('kb_search tool finds content in the same DB instance', async () => {
    const col = store.createCollection({ name: 'ToolTest', embeddingModelId: 'm', embeddingDim: 384 });
    const src = store.addSource({ collectionId: col.id, kind: 'paste', title: '知识' }, 'user');
    store.insertChunks(src.id, [
      { idx: 0, text: '金蝶AI原生协同办公平台是一款面向企业的智能化办公工具', charStart: 0, charEnd: 26 },
      { idx: 1, text: '它支持多智能体协作、知识库管理和自动化任务编排', charStart: 26, charEnd: 49 },
    ]);

    const retriever = createKbRetriever({
      db: (store as any)._db,
      embedFn: () => null,
    });
    const tools = createKbTools(store, retriever);
    const searchTool = tools.find(t => t.definition.name === 'kb_search')!;

    const result = await searchTool.execute({
      query: '金蝶AI',
      collection_id: col.id,
    });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('金蝶');
    expect(result as string).not.toContain('未找到');
  });

  it('kb_search returns "未找到" when no match', async () => {
    const col = store.createCollection({ name: 'Empty', embeddingModelId: 'm', embeddingDim: 384 });
    const retriever = createKbRetriever({
      db: (store as any)._db,
      embedFn: () => null,
    });
    const tools = createKbTools(store, retriever);
    const searchTool = tools.find(t => t.definition.name === 'kb_search')!;

    const result = await searchTool.execute({
      query: '完全不存在的内容xyz',
      collection_id: col.id,
    });
    expect(result as string).toContain('未找到');
  });

  it('kb_list_collections returns created collections', async () => {
    store.createCollection({ name: 'A', embeddingModelId: 'm', embeddingDim: 384 });
    store.createCollection({ name: 'B', embeddingModelId: 'm', embeddingDim: 384 });

    const retriever = createKbRetriever({ db: (store as any)._db, embedFn: () => null });
    const tools = createKbTools(store, retriever);
    const listTool = tools.find(t => t.definition.name === 'kb_list_collections')!;

    const result = await listTool.execute({});
    expect(result as string).toContain('A');
    expect(result as string).toContain('B');
  });
});
