import { describe, expect, it } from 'vitest';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemoryStore, type MemoryStore, type MemoryRecord } from '../../../src/ai/memory/store.js';

describe('MemoryStore interface', () => {
  it('FileMemoryStore implements MemoryStore', () => {
    const store: MemoryStore = new FileMemoryStore();
    expect(store.save).toBeDefined();
    expect(store.listRelevant).toBeDefined();
    expect(store.search).toBeUndefined();
  });

  it('save and listRelevant preserve scope and type', async () => {
    const tmpDir = join(tmpdir(), 'xiaok-iface-test-' + Date.now());
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    const store = new FileMemoryStore(tmpDir);

    const globalRecord: MemoryRecord = {
      id: 'global-1',
      scope: 'global',
      title: 'global memory',
      summary: 'global summary',
      tags: ['global'],
      updatedAt: Date.now(),
    };

    const projectRecord: MemoryRecord = {
      id: 'proj-1',
      scope: 'project',
      cwd: tmpDir,
      title: 'project memory',
      summary: 'project summary',
      tags: ['project'],
      type: 'project',
      updatedAt: Date.now(),
    };

    await store.save(globalRecord);
    await store.save(projectRecord);

    const projectOnly = await store.listRelevant({
      cwd: tmpDir,
      query: 'memory',
      typeFilter: 'project',
    });
    expect(projectOnly.some(r => r.id === 'proj-1')).toBe(true);
    expect(projectOnly.some(r => r.id === 'global-1')).toBe(false);

    rmSync(tmpDir, { recursive: true });
  });
});
