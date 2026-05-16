import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { OnnxEmbeddingEngine } from '../../../src/ai/memory/onnx-engine.js';

describe('OnnxEmbeddingEngine', () => {
  it('returns {engine: "none"} when model files are missing', async () => {
    const engine = new OnnxEmbeddingEngine('__nonexistent__');
    const status = await engine.init();
    expect(status.engine).toBe('none');
    expect(status.dimensions).toBe(0);
  });

  it('throws when embed() called with uninitialized engine', async () => {
    const engine = new OnnxEmbeddingEngine('__nonexistent__');
    await engine.init();
    await expect(engine.embed(['test'])).rejects.toThrow('ONNX engine not initialized');
  });

  it('returns same status on repeated init() calls', async () => {
    const engine = new OnnxEmbeddingEngine('__nonexistent__');
    const s1 = await engine.init();
    const s2 = await engine.init();
    expect(s1).toEqual(s2);
  });

  it('close() does not throw when never initialized', async () => {
    const engine = new OnnxEmbeddingEngine();
    await expect(engine.close()).resolves.toBeUndefined();
  });
});
