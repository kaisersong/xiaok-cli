import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKbRetriever } from '../../electron/kb-retrieval.js';
import { createSourceExtractor } from '../../electron/kb-source-extractor.js';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import { createKbTools } from '../../electron/kb-tools.js';
import type { KbStore } from '../../electron/kb-store.js';

describe('Knowledge Office ingestion', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-office-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('routes Office files through the injected parser while leaving text extraction unchanged', async () => {
    const calls: string[] = [];
    const extractor = createSourceExtractor({
      officeParser: {
        parse: async ({ absolutePath }) => {
          calls.push(absolutePath);
          return {
            ok: true,
            markdown: '# 预算表\n|部门|预算|\n|---|---|\n|研发|100|',
            format: 'xlsb',
            engine: 'anydoc',
            engineVersion: '0.1.8',
            chars: 43,
            truncated: false,
          };
        },
      },
    });
    const officePath = join(rootDir, '预算.xlsb');
    const textPath = join(rootDir, 'notes.txt');
    writeFileSync(officePath, 'binary office');
    writeFileSync(textPath, 'plain text');

    await expect(extractor.extract({ filePath: officePath, mimeType: 'application/octet-stream' }))
      .resolves.toMatchObject({ ok: true, engine: 'anydoc', engineVersion: '0.1.8', truncated: false });
    await expect(extractor.extract({ filePath: textPath, mimeType: 'text/plain' }))
      .resolves.toMatchObject({ ok: true, text: 'plain text' });
    expect(calls).toEqual([officePath]);
  });

  it('fails durable ingestion when the Office result is truncated', async () => {
    const extractor = createSourceExtractor({
      officeParser: {
        parse: async () => ({
          ok: true,
          markdown: 'partial',
          format: 'doc',
          engine: 'anydoc',
          engineVersion: '0.1.8',
          chars: 16_000_001,
          truncated: true,
        }),
      },
    });
    const filePath = join(rootDir, 'large.doc');
    writeFileSync(filePath, 'legacy office');
    await expect(extractor.extract({ filePath, mimeType: 'application/msword' }))
      .resolves.toMatchObject({ ok: false, errorCode: 'resource_limit' });
  });

  it('makes kb_add_source a write tool and parses Office content instead of decoding it as UTF-8', async () => {
    const collection = store.createCollection({ name: 'Office', embeddingModelId: 'm', embeddingDim: 384 });
    const filePath = join(rootDir, 'board.doc');
    writeFileSync(filePath, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    const extractor = createSourceExtractor({
      officeParser: {
        parse: async () => ({
          ok: true,
          markdown: '# 董事会\n决定扩大研发投入',
          format: 'doc',
          engine: 'anydoc',
          engineVersion: '0.1.8',
          chars: 15,
          truncated: false,
        }),
      },
    });
    const retriever = createKbRetriever({ db: (store as unknown as { _db: never })._db, embedFn: () => null });
    const tools = createKbTools(store, retriever, { sourceExtractor: extractor });
    const addSource = tools.find(tool => tool.definition.name === 'kb_add_source')!;
    expect(addSource.permission).toBe('write');
    expect(addSource.definition.description).toMatch(/严禁.*覆盖|只能创建/);

    const output = await addSource.execute({
      collection_id: collection.id,
      title: '董事会文件',
      kind: 'file',
      file_path: filePath,
      source_id: 'user-owned-source',
      requestSource: 'user',
    });

    expect(output).toContain('已写入文件');
    const sources = store.listSources(collection.id);
    expect(sources).toHaveLength(1);
    expect(sources[0].metadata).toMatchObject({ createdBy: 'agent', engine: 'anydoc' });
    expect(store.listChunks(sources[0].id).map(chunk => chunk.text).join('')).toContain('扩大研发投入');
  });

  it('persists stable Office parser failures without creating chunks', async () => {
    const collection = store.createCollection({ name: 'Failures', embeddingModelId: 'm', embeddingDim: 384 });
    const filePath = join(rootDir, 'encrypted.doc');
    writeFileSync(filePath, 'encrypted office');
    const extractor = createSourceExtractor({
      officeParser: {
        parse: async () => ({ ok: false, code: 'encrypted_document', message: 'encrypted', retryable: false }),
      },
    });
    const retriever = createKbRetriever({ db: (store as unknown as { _db: never })._db, embedFn: () => null });
    const addSource = createKbTools(store, retriever, { sourceExtractor: extractor })
      .find(tool => tool.definition.name === 'kb_add_source')!;

    const output = await addSource.execute({
      collection_id: collection.id,
      title: '加密文档',
      kind: 'file',
      file_path: filePath,
    });

    expect(output).toContain('encrypted_document');
    const source = store.listSources(collection.id)[0];
    expect(source).toMatchObject({ parseStatus: 'failed', parseError: 'encrypted' });
    expect(source.metadata).toMatchObject({ createdBy: 'agent', errorCode: 'encrypted_document' });
    expect(store.listChunks(source.id)).toHaveLength(0);
  });
});
