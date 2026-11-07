import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createLLMFromAdapter,
  LayeredMemoryStore,
  type LayeredMemoryConfig,
} from '../../../src/ai/memory/layered-store.js';
import type { ModelAdapter } from '../../../src/types.js';
import { assertStoreDatabaseClosed, closeStoreAndRemove } from './helpers/close-store.js';

describe('LayeredMemoryStore', () => {
  let store: LayeredMemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-lms-test-'));
    const config: LayeredMemoryConfig = {
      dbPath: path.join(tmpDir, 'memory.db'),
      embedding: {
        apiUrl: 'http://localhost:11434/v1',
        model: 'nomic-embed-text',
        dimensions: 768,
      },
      compaction: { autoCompact: false },
    };
    store = new LayeredMemoryStore(config);
  });

  afterEach(async () => {
    await closeStoreAndRemove(store, tmpDir);
  });

  it('should save and search', async () => {
    const record = {
      id: 'test-1',
      scope: 'global' as const,
      title: '用户偏好TypeScript',
      summary: '用户在开发中偏好使用TypeScript',
      tags: ['typescript'],
      updatedAt: Date.now(),
    };

    await store.save(record);
    const results = await store.search('TypeScript');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should preserve scope in listRelevant', async () => {
    await store.save({
      id: 'global-1', scope: 'global', title: 'global mem', summary: 'global content',
      tags: [], updatedAt: Date.now(),
    });

    const results = await store.listRelevant({
      cwd: '/test', query: 'global',
    });
    expect(results.some(r => r.scope === 'global')).toBe(true);
  });

  it('preserves assistant provenance and supports stable identity lookup', async () => {
    await store.save({
      id: 'assistant-memory:candidate-1',
      scope: 'project',
      cwd: '/workspace/project-a',
      title: '汇报偏好',
      summary: '先说结论。',
      tags: ['preference'],
      updatedAt: 1,
      type: 'project',
      provenance: {
        kind: 'assistant_candidate',
        candidateId: 'candidate-1',
        loopRunId: 'run-1',
        backend: 'layered',
        evidenceRefs: [{ kind: 'task', id: 'task-1' }],
      },
    });

    expect(store.getById('assistant-memory:candidate-1')).toEqual({
      id: 'assistant-memory:candidate-1',
      scope: 'project',
      cwd: '/workspace/project-a',
      title: '汇报偏好',
      summary: '先说结论。',
      tags: ['preference'],
      type: 'project',
      provenance: {
        kind: 'assistant_candidate',
        candidateId: 'candidate-1',
        loopRunId: 'run-1',
        backend: 'layered',
        evidenceRefs: [{ kind: 'task', id: 'task-1' }],
      },
      updatedAt: expect.any(Number),
    });
  });

  // #150 CI（Windows EBUSY/EPERM）：save 之后的向量写还在途时，close() 返回 promise，
  // memory.db 句柄要等它 resolve 才关。调用方不 await 就删目录，在 Windows 上必然失败；
  // 这里直接断言句柄状态，所以 Linux/macOS 上同样能抓到。
  describe('close() with a vector write still in flight (#150)', () => {
    type Internals = { db: { open: boolean }; embeddingClient: { embed(text: string): Promise<Float32Array> } };
    let release!: () => void;
    const record = {
      id: 'close-inflight', scope: 'global' as const, title: '关闭前', summary: '关闭前写入的记忆',
      tags: [], updatedAt: 1, type: 'user' as const,
    };
    beforeEach(() => {
      const gate = new Promise<void>((resolve) => { release = resolve; });
      (store as unknown as Internals).embeddingClient.embed = async () => { await gate; return new Float32Array(768).fill(0.25); };
    });

    it('keeps memory.db open until the pending write lands and closes it once close() resolves', async () => {
      await store.save(record);
      const db = (store as unknown as Internals).db;
      const closing = store.close();
      expect(closing).toBeInstanceOf(Promise);
      expect(db.open).toBe(true);
      release();
      await closing;
      expect(db.open).toBe(false);
    });

    it('a caller that removes files right after close() without awaiting it is caught on every platform', async () => {
      await store.save(record);
      void store.close();
      expect(() => assertStoreDatabaseClosed(store)).toThrow(/still open after close/);
      release();
    });

    it('closeStoreAndRemove waits for the pending write, then removes the directory with the database closed', async () => {
      await store.save(record);
      const dir = tmpDir;
      let finished = false;
      const done = closeStoreAndRemove(store, dir).then(() => { finished = true; });
      await new Promise((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
      expect(fs.existsSync(dir)).toBe(true);
      release();
      await done;
      expect((store as unknown as Internals).db.open).toBe(false);
      expect(fs.existsSync(dir)).toBe(false);
    });
  });

  it('should write raw messages to L0 and search them', async () => {
    await store.writeRawMessage('session-1', 'user', '我喜欢用React开发前端');
    const results = await store.search('React');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should track layer counts', async () => {
    await store.writeRawMessage('s1', 'user', 'msg1');
    await store.writeRawMessage('s1', 'user', 'msg2');
    expect(store.getLayerCount(0)).toBe(2);
  });

  it('keeps the real memory side request affinity-free and drains usage before a pending error', async () => {
    const sentinel = new Error('memory pending error');
    let argumentCount = 0;
    let capturedOptions: unknown = 'not-called';
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: function (_messages, _tools, _systemPrompt, options) {
        argumentCount = arguments.length;
        capturedOptions = options;
        return (async function* () {
          yield {
            type: 'usage' as const,
            usage: { inputTokens: 11, outputTokens: 3 },
          };
          throw sentinel;
        })();
      },
    };

    await expect(createLLMFromAdapter(adapter)('extract memory')).rejects.toBe(sentinel);
    expect(argumentCount).toBe(4);
    expect(capturedOptions).toEqual({ maxOutputTokens: 8192, reasoningMode: 'disabled', signal: expect.any(AbortSignal) });
  });
});


describe('memory side-call termination', () => {
  it('rejects valid JSON without a terminal done chunk', async () => {
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* () { yield { type: 'text', delta: '{"scenarios":[]}' }; } };
    await expect(createLLMFromAdapter(adapter)('p')).rejects.toThrow('memory_output_incomplete');
  });
  it('aborts the whole side-call at its deadline and removes its timer', async () => {
    vi.useFakeTimers();
    try {
      const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* (_m, _t, _s, options) {
        await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
        yield { type: 'done' };
      } };
      const pending = createLLMFromAdapter(adapter)('p');
      const rejection = expect(pending).rejects.toThrow('memory_compaction_timeout');
      await vi.advanceTimersByTimeAsync(120_000); await rejection;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
