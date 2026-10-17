import { describe, expect, it, vi } from 'vitest';
import { registerMemoryDistillationIpc, createDesktopMemoryLlm, getActiveMemoryEmbeddingModel, selectMemoryEmbeddingModel } from '../../electron/memory-distillation.js';
import type { Config } from '../../../src/types.js';

describe('Desktop memory distillation owner', () => {
  it('uses current configuration on every side call and follows main-model changes', async () => {
    const config = { defaultModelId: 'main-a', models: { 'main-a': {}, 'main-b': {}, 'memory-a': {} } } as unknown as Config;
    const build = vi.fn(async (_config: Config, id?: string) => async () => id ?? _config.defaultModelId);
    const llm = createDesktopMemoryLlm(async () => config, build);
    expect(await llm('p')).toBe('main-a');
    config.defaultModelId = 'main-b'; expect(await llm('p')).toBe('main-b');
    config.memory = { modelId: 'memory-a' }; expect(await llm('p')).toBe('memory-a');
    config.memory.modelId = 'deleted'; expect(await llm('p')).toBe('main-b');
    expect(build).toHaveBeenCalledTimes(4);
  });
  it('registers a real forced user operation, rejects foreign sender and propagates errors', async () => {
    let handler!: (event: unknown, ...args: unknown[]) => Promise<unknown>;
    const result = { status: 'completed' as const, l1: 0, l2: 2, l3: 1 };
    const compact = vi.fn(async () => result);
    registerMemoryDistillationIpc({ handle: (_name, fn) => { handler = fn; } }, { compact }, e => e === 'trusted');
    await expect(handler('foreign')).rejects.toThrow('memory_compaction_forbidden');
    expect(compact).not.toHaveBeenCalled();
    await expect(handler('trusted', 'unexpected')).rejects.toThrow();
    expect(await handler('trusted')).toEqual(result);
    expect(compact).toHaveBeenCalledWith({ requestSource: 'user', force: true });
    compact.mockRejectedValueOnce(new Error('provider quota'));
    await expect(handler('trusted')).rejects.toThrow('provider quota');
  });
  it('does not claim success for an unsupported fallback backend', async () => {
    let handler!: (event: unknown, ...args: unknown[]) => Promise<unknown>;
    registerMemoryDistillationIpc({ handle: (_name, fn) => { handler = fn; } }, {}, () => true);
    await expect(handler('trusted')).rejects.toThrow('memory_backend_unavailable');
  });
  it('keeps embedding selection independent from the main and distillation models', () => {
    const config = { defaultModelId: 'chat', memory: { modelId: 'deepseek', embedding: { provider: 'api', model: 'a', apiUrl: 'http://localhost', dimensions: 384 } } } as Config;
    const selected = selectMemoryEmbeddingModel(config, 'b', ['a', 'b']);
    expect(selected.config.memory).toEqual({ modelId: 'deepseek', embedding: { provider: 'api', model: 'b', apiUrl: 'http://localhost', dimensions: 384 } });
    expect(selected.config.defaultModelId).toBe('chat');
    expect(config.memory?.embedding?.model).toBe('a');
    expect(getActiveMemoryEmbeddingModel(selected.config, ['a', 'b'])).toBe('b');
    expect(selectMemoryEmbeddingModel(selected.config, 'b', ['a', 'b']).changed).toBe(false);
  });
  it('only admits registry embedding IDs as a legacy fallback', () => {
    expect(getActiveMemoryEmbeddingModel({ memory: { modelId: 'embedding' } } as Config, ['embedding'])).toBe('embedding');
    expect(getActiveMemoryEmbeddingModel({ memory: { modelId: 'deepseek' } } as Config, ['embedding'])).toBe('all-MiniLM-L6-v2');
    expect(() => selectMemoryEmbeddingModel({} as Config, 'not-downloaded-registry-id', ['embedding'])).toThrow();
  });
});
