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

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
