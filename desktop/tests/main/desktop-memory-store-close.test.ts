import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

import { closeDesktopMemoryStore, getDesktopMemoryBackend, getDesktopMemoryStore } from '../../electron/desktop-services.js';

type Internals = { db: { open: boolean }; embeddingClient: { embed(text: string): Promise<Float32Array> } };

// #150 CI: a LayeredMemoryStore close() waits for writes accepted before it (M3) and keeps
// memory.db open until then. A store replaced on a data-root switch is closed without the
// caller awaiting; shutdown must still wait for it before the process exits or files go away.
describe('desktop memory store close (#150)', () => {
  const priorConfig = process.env.XIAOK_CONFIG_DIR;
  const base = mkdtempSync(join(tmpdir(), 'xiaok-desktop-memclose-'));
  process.env.XIAOK_CONFIG_DIR = join(base, 'config');
  const rootA = join(base, 'a');
  const rootB = join(base, 'b');
  let lastOpenedRoot: string | undefined;
  let releasePendingWrite: (() => void) | undefined;
  // Initialize the actual case databases, including each root's migrations, outside the
  // close-lifecycle assertion. The case still reopens both real stores through production.
  beforeAll(async () => {
    for (const root of [rootA, rootB]) {
      lastOpenedRoot = root;
      const warm = getDesktopMemoryStore(root);
      (warm as unknown as Internals).embeddingClient.embed = async () => new Float32Array(384).fill(0.25);
      await warm.save({ id: 'warm-up', scope: 'global', title: '预热', summary: '冷启动预热写入', tags: [], updatedAt: 1, type: 'user' });
      await closeDesktopMemoryStore(root);
      expect((warm as unknown as Internals).db.open).toBe(false);
    }
  });
  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      releasePendingWrite?.();
      if (lastOpenedRoot) await closeDesktopMemoryStore(lastOpenedRoot);
    } catch (error) { errors.push(error); }
    try {
      if (priorConfig === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = priorConfig;
      rmSync(base, { recursive: true, force: true });
    } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'memory-close fixture cleanup failed', { cause: errors[0] });
  });

  it('closeDesktopMemoryStore resolves only after the retired store has landed its pending write and closed memory.db', async () => {
    lastOpenedRoot = rootA;
    const first = getDesktopMemoryStore(rootA);
    expect(getDesktopMemoryBackend(rootA)).toBe('layered');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    releasePendingWrite = release;
    (first as unknown as Internals).embeddingClient.embed = async () => { await gate; return new Float32Array(384).fill(0.25); };
    await first.save({ id: 'retired-inflight', scope: 'global', title: '切换前', summary: '切换数据根之前的写入', tags: [], updatedAt: 1, type: 'user' });
    const firstDb = (first as unknown as Internals).db;

    lastOpenedRoot = rootB;
    getDesktopMemoryStore(rootB); // data-root switch retires the first store while its vector write is in flight
    expect(firstDb.open).toBe(true);

    let finished = false;
    const closing = closeDesktopMemoryStore(rootB).then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    expect(firstDb.open).toBe(true);

    release();
    releasePendingWrite = undefined;
    await closing;
    expect(firstDb.open).toBe(false);
    expect((getDesktopMemoryStore(rootB) as unknown as Internals).db.open).toBe(false);
  });
});
