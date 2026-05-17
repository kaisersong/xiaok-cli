import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createMemoryStoreAsync } from '../../../src/ai/memory/store.js';

describe('createMemoryStoreAsync - default store', () => {
  it('should create LayeredMemoryStore by default (no config)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-defstore-'));
    const dbPath = path.join(tmpDir, 'memory.db');
    const store = await createMemoryStoreAsync({ dbPath });

    expect(store).toBeDefined();
    expect(typeof store.save).toBe('function');
    expect(typeof store.listRelevant).toBe('function');
    // LayeredMemoryStore has these optional methods
    expect(typeof store.search).toBe('function');
    expect(typeof store.writeRawMessage).toBe('function');
    expect(typeof store.compact).toBe('function');
    expect(typeof store.getStats).toBe('function');
    expect(typeof store.setLLMFn).toBe('function');
    expect(typeof store.delete).toBe('function');
    expect(typeof store.clearAll).toBe('function');

    store.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create FileMemoryStore when type is file', async () => {
    const store = await createMemoryStoreAsync({ type: 'file' });
    expect(store).toBeDefined();
    expect(typeof store.save).toBe('function');
    // FileMemoryStore does not have these methods
    expect(store.search).toBeUndefined();
    expect(store.compact).toBeUndefined();
    expect(store.getStats).toBeUndefined();
  });

  it('should have working writeRawMessage and search', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-defstore2-'));
    const dbPath = path.join(tmpDir, 'memory.db');
    const store = await createMemoryStoreAsync({ dbPath });

    await store.writeRawMessage!('s1', 'user', '我的项目使用Vite构建');
    const results = await store.search!('Vite');
    expect(results.length).toBeGreaterThan(0);

    store.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should have working compact (no-op without LLM)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-defstore3-'));
    const dbPath = path.join(tmpDir, 'memory.db');
    const store = await createMemoryStoreAsync({ dbPath });

    // Should not throw even without LLM function
    await store.compact!();

    store.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
