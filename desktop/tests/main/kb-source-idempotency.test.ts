import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKbRetriever } from '../../electron/kb-retrieval.js';
import { createSourceExtractor } from '../../electron/kb-source-extractor.js';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import { createKbTools } from '../../electron/kb-tools.js';
import type { KbStore } from '../../electron/kb-store.js';

type ContentHashClaim = (
  sourceId: string,
  sha256: string,
  requestSource: 'user' | 'agent' | 'scheduler',
) => { source: { id: string; sha256: string }; created: boolean };

describe('Knowledge source import idempotency', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-idempotency-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  function addSourceTool() {
    const retriever = createKbRetriever({
      db: (store as unknown as { _db: never })._db,
      embedFn: () => null,
    });
    return createKbTools(store, retriever, { sourceExtractor: createSourceExtractor() })
      .find(tool => tool.definition.name === 'kb_add_source')!;
  }

  it('reuses the canonical source when the same file is imported with the same title', async () => {
    const collection = store.createCollection({ name: 'Idempotent', embeddingModelId: 'm', embeddingDim: 384 });
    const filePath = join(rootDir, 'identity.md');
    writeFileSync(filePath, '# 身份\n同一个文件不能重复污染知识库。');
    const addSource = addSourceTool();

    const first = await addSource.execute({
      collection_id: collection.id,
      title: '身份.md',
      kind: 'file',
      file_path: filePath,
    }) as string;
    const chunksAfterFirst = store.getCollection(collection.id)!.chunkCountCached;
    const second = await addSource.execute({
      collection_id: collection.id,
      title: '身份.md',
      kind: 'file',
      file_path: filePath,
    }) as string;

    expect(first).toContain('已写入文件');
    expect(second).toMatch(/已存在|跳过重复导入/);
    expect(store.listSources(collection.id)).toHaveLength(1);
    expect(store.getCollection(collection.id)!.chunkCountCached).toBe(chunksAfterFirst);
    expect(store.listSources(collection.id)[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not let a changed file title bypass content idempotency', async () => {
    const collection = store.createCollection({ name: 'Retitled', embeddingModelId: 'm', embeddingDim: 384 });
    const filePath = join(rootDir, 'same.md');
    writeFileSync(filePath, '相同正文');
    const addSource = addSourceTool();

    await addSource.execute({ collection_id: collection.id, title: '原始标题', kind: 'file', file_path: filePath });
    await addSource.execute({ collection_id: collection.id, title: '原始标题（幂等测试）', kind: 'file', file_path: filePath });

    expect(store.listSources(collection.id)).toHaveLength(1);
  });

  it('reuses the same logical body across file and paste ingress paths', async () => {
    const collection = store.createCollection({ name: 'Cross ingress', embeddingModelId: 'm', embeddingDim: 384 });
    const filePath = join(rootDir, 'cross.md');
    writeFileSync(filePath, '跨入口也不能重复。');
    const addSource = addSourceTool();

    await addSource.execute({ collection_id: collection.id, title: '文件标题', kind: 'file', file_path: filePath });
    await addSource.execute({ collection_id: collection.id, title: '粘贴标题', kind: 'paste', text: '跨入口也不能重复。' });

    expect(store.listSources(collection.id)).toHaveLength(1);
  });

  it('keeps the same content isolated between collections', async () => {
    const firstCollection = store.createCollection({ name: 'First', embeddingModelId: 'm', embeddingDim: 384 });
    const secondCollection = store.createCollection({ name: 'Second', embeddingModelId: 'm', embeddingDim: 384 });
    const addSource = addSourceTool();

    await addSource.execute({ collection_id: firstCollection.id, title: 'A', kind: 'paste', text: 'collection 隔离正文' });
    await addSource.execute({ collection_id: secondCollection.id, title: 'B', kind: 'paste', text: 'collection 隔离正文' });

    expect(store.listSources(firstCollection.id)).toHaveLength(1);
    expect(store.listSources(secondCollection.id)).toHaveLength(1);
  });

  it('creates a new source version when the logical body changes', async () => {
    const collection = store.createCollection({ name: 'Versions', embeddingModelId: 'm', embeddingDim: 384 });
    const filePath = join(rootDir, 'versioned.md');
    const addSource = addSourceTool();

    writeFileSync(filePath, '版本一');
    await addSource.execute({ collection_id: collection.id, title: '版本文档', kind: 'file', file_path: filePath });
    writeFileSync(filePath, '版本二');
    await addSource.execute({ collection_id: collection.id, title: '版本文档', kind: 'file', file_path: filePath });

    const sources = store.listSources(collection.id);
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map(source => source.sha256)).size).toBe(2);
  });

  it('normalizes BOM and line endings before computing the logical body hash', async () => {
    const collection = store.createCollection({ name: 'Canonical text', embeddingModelId: 'm', embeddingDim: 384 });
    const addSource = addSourceTool();

    await addSource.execute({ collection_id: collection.id, title: 'Windows', kind: 'paste', text: '\uFEFF第一行\r\n第二行' });
    await addSource.execute({ collection_id: collection.id, title: 'macOS', kind: 'paste', text: '第一行\n第二行' });

    expect(store.listSources(collection.id)).toHaveLength(1);
  });

  it('serializes concurrent imports of the same logical body to one source', async () => {
    const collection = store.createCollection({ name: 'Concurrent', embeddingModelId: 'm', embeddingDim: 384 });
    const filePath = join(rootDir, 'concurrent.md');
    writeFileSync(filePath, '并发导入正文');
    const addSource = addSourceTool();

    const results = await Promise.all([
      addSource.execute({ collection_id: collection.id, title: '并发一', kind: 'file', file_path: filePath }),
      addSource.execute({ collection_id: collection.id, title: '并发二', kind: 'file', file_path: filePath }),
    ]);

    expect(results.some(result => String(result).match(/已存在|跳过重复导入/))).toBe(true);
    expect(store.listSources(collection.id)).toHaveLength(1);
  });

  it('enforces the content identity across independent database connections', () => {
    const dbPath = join(rootDir, 'knowledge.db');
    const collection = store.createCollection({ name: 'Two connections', embeddingModelId: 'm', embeddingDim: 384 });
    const otherStore = createKbStoreSqlite(dbPath);
    const first = store.addSource({ collectionId: collection.id, kind: 'paste', title: '连接一' }, 'user');
    const second = otherStore.addSource({ collectionId: collection.id, kind: 'paste', title: '连接二' }, 'user');
    const hash = 'c'.repeat(64);

    try {
      const firstClaim = store.claimSourceContentHash(first.id, hash, 'user');
      const secondClaim = otherStore.claimSourceContentHash(second.id, hash, 'user');

      expect(firstClaim).toMatchObject({ created: true, source: { id: first.id } });
      expect(secondClaim).toMatchObject({ created: false, source: { id: first.id } });
      expect(store.listSources(collection.id)).toHaveLength(1);
    } finally {
      otherStore.close();
    }
  });

  it('rejects an agent claim against a user-owned pending source', () => {
    const collection = store.createCollection({ name: 'Authority', embeddingModelId: 'm', embeddingDim: 384 });
    const source = store.addSource({ collectionId: collection.id, kind: 'paste', title: '用户正文' }, 'user');
    const claim = (store as unknown as { claimSourceContentHash?: ContentHashClaim }).claimSourceContentHash;

    expect(claim).toBeTypeOf('function');
    expect(() => claim!.call(store, source.id, 'a'.repeat(64), 'agent')).toThrow(/not allowed|request source/i);
    expect(store.getSource(source.id)).toMatchObject({ sha256: '', parseStatus: 'pending' });
  });

  it('requires a content hash before a non-meeting source can become parsed', () => {
    const collection = store.createCollection({ name: 'Hash gate', embeddingModelId: 'm', embeddingDim: 384 });
    const source = store.addSource({ collectionId: collection.id, kind: 'paste', title: '无 hash' }, 'user');

    expect(() => store.updateSourceParseResult(source.id, { parseStatus: 'parsed' }, 'user')).toThrow(/hash/i);
    expect(store.getSource(source.id)).toMatchObject({ parseStatus: 'pending', sha256: '' });

    const meeting = store.addSource({
      collectionId: collection.id,
      kind: 'meeting',
      title: '真实会议',
      parseStatus: 'parsed',
      metadata: { meetingId: 'meeting-hash-exempt' },
    }, 'user');
    expect(meeting).toMatchObject({ kind: 'meeting', parseStatus: 'parsed', sha256: '' });
  });

  it('backfills one canonical hash from overlapping legacy chunks without deleting duplicates', () => {
    const dbPath = join(rootDir, 'legacy.db');
    store.close();
    store = createKbStoreSqlite(dbPath);
    const collection = store.createCollection({ name: 'Legacy', embeddingModelId: 'm', embeddingDim: 384 });
    const first = store.addSource({ collectionId: collection.id, kind: 'file', title: '旧文件一', filePath: '/legacy/same.md' }, 'user');
    const duplicate = store.addSource({ collectionId: collection.id, kind: 'file', title: '旧文件二', filePath: '/legacy/same.md' }, 'user');
    const overlapping = [
      { idx: 0, text: 'abcde', charStart: 0, charEnd: 5 },
      { idx: 1, text: 'defgh', charStart: 3, charEnd: 8 },
    ];
    store.insertChunks(first.id, overlapping);
    store.insertChunks(duplicate.id, overlapping);
    const expectedCanonicalId = [first, duplicate]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))[0].id;
    const rawDb = (store as unknown as { _db: { prepare(sql: string): { run(...args: unknown[]): unknown } } })._db;
    rawDb.prepare("UPDATE sources SET parse_status = 'parsed' WHERE id IN (?, ?)").run(first.id, duplicate.id);
    store.close();

    store = createKbStoreSqlite(dbPath);
    const sourcesAfterFirstOpen = store.listSources(collection.id);
    const canonical = sourcesAfterFirstOpen.find(source => source.sha256 !== '');
    expect(sourcesAfterFirstOpen).toHaveLength(2);
    expect(sourcesAfterFirstOpen.filter(source => source.sha256 !== '')).toHaveLength(1);
    expect(canonical?.id).toBe(expectedCanonicalId);
    expect(store.getCollection(collection.id)?.chunkCountCached).toBe(4);
    const canonicalHash = canonical?.sha256;
    store.close();

    store = createKbStoreSqlite(dbPath);
    expect(store.listSources(collection.id).filter(source => source.sha256 !== '')).toHaveLength(1);
    expect(store.getSource(expectedCanonicalId)?.sha256).toBe(canonicalHash);
    expect(store.getCollection(collection.id)?.chunkCountCached).toBe(4);
  });

  it('keeps Desktop IPC on the same store-level content-hash gate', () => {
    const ipcSource = readFileSync(join(process.cwd(), 'electron', 'ipc.ts'), 'utf8');
    expect(ipcSource).toMatch(/claimSourceContentHash/);
  });

  it('documents duplicate imports as a no-op in the agent tool contract', () => {
    expect(addSourceTool().definition.description).toMatch(/相同.*(?:不重复|已有)/);
  });
});
