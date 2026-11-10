// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import * as storeApi from '../../electron/kb-store-sqlite.js';
import * as extractorApi from '../../electron/kb-source-extractor.js';
import { readOptionalOriginalOfficeProcessSourceRequest } from '../../electron/office-document-parser.js';
import { readOptionalOriginalPdfWorkerSourceRequest } from '../../electron/pdf-text.js';
it('recognizes only the original Store addSource receipt and extractor function birth', () => {
  const api = storeApi as Record<string, any>,
    extractors = extractorApi as Record<string, any>;
  expect(api.readOriginalKnowledgeSourceReceipt).toBeTypeOf('function');
  expect(extractors.readOriginalKnowledgeExtractorBinding).toBeTypeOf(
    'function',
  );
  const root = mkdtempSync(join(tmpdir(), 'material-origin-')),
    path = join(root, 'knowledge.db');
  const store = storeApi.createKbStoreSqlite(path);
  try {
    const collection = store.createCollection(
      {
        name: 'actual',
        description: '',
        embeddingModelId: 'test',
        embeddingDim: 8,
      },
      'user',
    );
    const source = store.addSource(
      {
        collectionId: collection.id,
        kind: 'file',
        title: 'actual',
        filePath: join(root, 'document.pdf'),
      },
      'user',
    );
    const origin = api.readOriginalKnowledgeSourceReceipt(store, source, path);
    expect(origin.source.id).toBe(source.id);
    expect(origin.requestSource).toBe('user');
    const parse = async () => ({
      ok: false,
      code: 'unsupported_format',
      message: 'test',
      retryable: false,
    });
    const extractor = extractorApi.createSourceExtractor({
      officeParser: { parse } as never,
    });
    expect(
      extractors.readOriginalKnowledgeExtractorBinding(extractor).officeParse,
    ).toBe(parse);
    let traps = 0;
    const foreign = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error('get');
        },
        ownKeys() {
          traps++;
          throw Error('keys');
        },
      },
    );
    expect(() =>
      api.readOriginalKnowledgeSourceReceipt(foreign, source, path),
    ).toThrow();
    expect(() =>
      api.readOriginalKnowledgeSourceReceipt(store, { ...source }, path),
    ).toThrow();
    expect(() =>
      api.readOriginalKnowledgeSourceReceipt(
        store,
        source,
        join(root, 'foreign.db'),
      ),
    ).toThrow();
    expect(() =>
      extractors.readOriginalKnowledgeExtractorBinding(foreign),
    ).toThrow();
    expect(readOptionalOriginalOfficeProcessSourceRequest(foreign)).toBeNull();
    expect(readOptionalOriginalPdfWorkerSourceRequest(foreign)).toBeNull();
    expect(traps).toBe(0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
