import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Internals = { db: { open: boolean }; embeddingClient: { embedRaw(text: string): Promise<Float32Array> } };

// #150 CI: a LayeredMemoryStore close() waits for writes accepted before it (M3) and keeps
// memory.db open until then. A store replaced on a data-root switch is closed without the
// caller awaiting; shutdown must still wait for it before the process exits or files go away.
describe('desktop memory store close (#150)', () => {
  const priorConfig = process.env.XIAOK_CONFIG_DIR;
  const base = mkdtempSync(join(tmpdir(), 'xiaok-desktop-memclose-'));
  process.env.XIAOK_CONFIG_DIR = join(base, 'config');
  afterAll(() => {
    if (priorConfig === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = priorConfig;
    rmSync(base, { recursive: true, force: true });
  });
  // Exercise the actual emitted ESM graph: its synchronous optional-memory
  // loader must resolve the same compiled module, outside Vite's TS resolver.
  const { closeDesktopMemoryStore, getDesktopMemoryBackend, getDesktopMemoryStore } =
    createRequire(import.meta.url)('../../dist/main/desktop/electron/desktop-services.js') as typeof import('../../electron/desktop-services.js');
  // Pay the one-time cold start (native SQLite load, migrations, first segmentation) here, not inside
  // the case: on a cold Windows runner it can take seconds and is not what the case measures.
  beforeAll(async () => {
    const warmRoot = join(base, 'warm');
    const warm = getDesktopMemoryStore(warmRoot);
    (warm as unknown as Internals).embeddingClient.embedRaw = async () => new Float32Array(384).fill(0.25);
    await warm.save({ id: 'warm-up', scope: 'global', title: '预热', summary: '冷启动预热写入', tags: [], updatedAt: 1, type: 'user' });
    await closeDesktopMemoryStore(warmRoot);
    expect((warm as unknown as Internals).db.open).toBe(false);
  });

  // Windows: 20 real runs took 3698–4429ms; two fresh store constructions dominated.
  // Keep every close/retirement assertion and grant only this case more runner time.
  it('closeDesktopMemoryStore resolves only after the retired store has landed its pending write and closed memory.db', async () => {
    const rootA = join(base, 'a');
    const rootB = join(base, 'b');
    const first = getDesktopMemoryStore(rootA);
    expect(getDesktopMemoryBackend(rootA)).toBe('layered');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // The vector write goes embedAndStore -> embedRaw (9656a0a8); gate that seam, and fail loudly if it moves.
    expect(typeof (first as unknown as Internals).embeddingClient.embedRaw).toBe('function');
    (first as unknown as Internals).embeddingClient.embedRaw = async () => { await gate; return new Float32Array(384).fill(0.25); };
    await first.save({ id: 'retired-inflight', scope: 'global', title: '切换前', summary: '切换数据根之前的写入', tags: [], updatedAt: 1, type: 'user' });
    const firstDb = (first as unknown as Internals).db;

    getDesktopMemoryStore(rootB); // data-root switch retires the first store while its vector write is in flight
    expect(firstDb.open).toBe(true);

    let finished = false;
    const closing = closeDesktopMemoryStore(rootB).then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    expect(firstDb.open).toBe(true);

    release();
    await closing;
    expect(firstDb.open).toBe(false);
    expect((getDesktopMemoryStore(rootB) as unknown as Internals).db.open).toBe(false);
  }, process.platform === 'win32' ? 10_000 : undefined);
});
