// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof fs>();
  return { ...original, readFile: vi.fn(original.readFile), appendFile: vi.fn(original.appendFile) };
});
type ReadOptions = { signal: AbortSignal; trackPending(raw: Promise<unknown>): void };
function deferred() { let resolve!: () => void; return { promise: new Promise<void>(yes => { resolve = yes; }), resolve: () => resolve() }; }
function recover(store: FileTaskSnapshotStore, options: ReadOptions) {
  return (store.recoverTask as (taskId: string, options?: ReadOptions) => Promise<TaskSnapshot | null>)('snapshot-fixture', options);
}
function track(signal: AbortSignal) {
  const raw: Promise<unknown>[] = []; let settled = 0;
  return { raw, settled: () => settled, options: { signal, trackPending(promise: Promise<unknown>) {
    raw.push(promise); void promise.then(() => { settled++; }, () => { settled++; });
  } } };
}
async function flush() { await nextTurn(); await nextTurn(); }

describe('D4: production snapshot read can abandon continuation without clearing physical IO or write queues', () => {
  const roots: string[] = []; const releases: Array<() => void> = [];
  let actual: typeof fs;
  beforeEach(async () => {
    actual = await vi.importActual<typeof fs>('node:fs/promises');
    vi.mocked(fs.readFile).mockReset().mockImplementation(actual.readFile);
    vi.mocked(fs.appendFile).mockReset().mockImplementation(actual.appendFile);
  });
  afterEach(async () => {
    releases.splice(0).forEach(release => release()); await flush(); vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-snapshot-read-bdd-')); roots.push(root);
    const writer = new FileTaskSnapshotStore(root);
    const initial: TaskSnapshot = { taskId: 'snapshot-fixture', sessionId: 'session', status: 'running', prompt: 'fixture', materials: [],
      events: [], createdAt: 1, updatedAt: 1 };
    await writer.save(initial);
    const latest: TaskSnapshot = { ...initial, updatedAt: 2, events: [{ type: 'result', result: { summary: 'REAL_JOURNAL_RESULT', artifacts: [] } }] };
    await writer.save(latest, initial);
    vi.mocked(fs.readFile).mockClear(); vi.mocked(fs.appendFile).mockClear();
    return { root, writer, latest, reader: new FileTaskSnapshotStore(root) };
  }

  it.each(['uncached', 'cached'] as const)('preabort before %s read throws exact reason, does no IO, and does not register a phantom pending read', async source => {
    const f = await fixture(); const reader = source === 'cached' ? f.writer : f.reader;
    const controller = new AbortController(); const reason = Object.assign(new Error('already stopped'), { code: 'ENOENT' }); controller.abort(reason);
    const pending = track(controller.signal);
    await expect(recover(reader, pending.options)).rejects.toBe(reason);
    expect(fs.readFile).not.toHaveBeenCalled(); expect(pending.raw).toEqual([]);
    expect(await reader.recoverTask('snapshot-fixture')).toEqual(f.latest);
  });

  it.each(['checkpoint', 'journal'] as const)('abort during actual %s dependency rejects the reader but raw promise stays tracked until released; no late cache or additional read', async stage => {
    const f = await fixture(); const entered = deferred(); const held = deferred(); releases.push(held.resolve);
    const controller = new AbortController(); const reason = new Error('delivery timeout'); const pending = track(controller.signal);
    let first = true; let heldRaw: Promise<unknown> | undefined;
    vi.mocked(fs.readFile).mockImplementation((...args: Parameters<typeof fs.readFile>) => {
      const raw = actual.readFile(...args);
      const match = String(args[0]).endsWith(stage === 'checkpoint' ? 'snapshot-fixture.json' : '.journal.jsonl');
      if (!match || !first) return raw;
      first = false; heldRaw = raw.then(async text => { entered.resolve(); await held.promise; return text; });
      return heldRaw as ReturnType<typeof fs.readFile>;
    });
    let settled = false;
    const outcome = recover(f.reader, pending.options).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    await entered.promise; controller.abort(reason); await flush();
    try {
      expect.soft(settled).toBe(true); expect.soft(pending.raw).toContain(heldRaw);
      expect.soft(pending.settled()).toBe(stage === 'checkpoint' ? 0 : 1);
      for (const args of vi.mocked(fs.readFile).mock.calls) expect(args[1]).toBe('utf8'); // no raw IO AbortSignal
    } finally { held.resolve(); await outcome; await Promise.allSettled(pending.raw); }
    expect(await outcome).toEqual({ error: reason });
    expect(fs.readFile).toHaveBeenCalledTimes(stage === 'checkpoint' ? 1 : 2);
    vi.mocked(fs.readFile).mockClear();
    expect(await f.reader.recoverTask('snapshot-fixture')).toEqual(f.latest);
    expect(fs.readFile).toHaveBeenCalledTimes(2); // cancelled attempt did not install a late cache
  });

  it.each(['ENOENT', 'EIO'] as const)('abort wins over a late %s and does not masquerade as missing/partial success', async code => {
    const f = await fixture(); const entered = deferred(); const held = deferred(); releases.push(held.resolve);
    const controller = new AbortController(); const reason = 'original caller reason'; const pending = track(controller.signal);
    vi.mocked(fs.readFile).mockImplementation(async () => { entered.resolve(); await held.promise; throw Object.assign(new Error('late storage failure'), { code }); });
    const outcome = recover(f.reader, pending.options).then(value => ({ value }), error => ({ error }));
    await entered.promise; controller.abort(reason); held.resolve();
    expect(await outcome).toEqual({ error: reason }); await Promise.allSettled(pending.raw);
    expect(pending.raw).toHaveLength(1); expect(pending.settled()).toBe(1);
  });

  it('waiting for a real in-flight write abandons only this reader, not the writer queue or its late successful bytes', async () => {
    const f = await fixture(); const entered = deferred(); const held = deferred(); releases.push(held.resolve);
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => { await actual.appendFile(...args); entered.resolve(); await held.promise; });
    const next = { ...f.latest, updatedAt: 3, events: [...f.latest.events, { type: 'result' as const, result: { summary: 'WRITER_SURVIVES', artifacts: [] } }] };
    let writeSettled = false; const write = f.writer.save(next, f.latest).finally(() => { writeSettled = true; }); await entered.promise;
    const controller = new AbortController(); const reason = new Error('stop waiting for write'); const pending = track(controller.signal);
    let readSettled = false; const read = recover(f.writer, pending.options).then(value => ({ value }), error => ({ error })).finally(() => { readSettled = true; });
    controller.abort(reason); await flush();
    try { expect.soft(readSettled).toBe(true); expect.soft(writeSettled).toBe(false); expect.soft(pending.raw).toHaveLength(1); expect.soft(pending.settled()).toBe(0); }
    finally { held.resolve(); await write; await read; await Promise.allSettled(pending.raw); }
    expect(await read).toEqual({ error: reason }); expect(writeSettled).toBe(true);
    expect(await new FileTaskSnapshotStore(f.root).recoverTask('snapshot-fixture')).toEqual(next);
  });

  it('successful guarded read uses real journal reconstruction and removes its abort listeners; a late abort cannot invalidate the cache', async () => {
    const f = await fixture(); const controller = new AbortController(); const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener'); const pending = track(controller.signal);
    expect(await recover(f.reader, pending.options)).toEqual(f.latest); await Promise.all(pending.raw);
    expect(pending.raw).toHaveLength(2); expect(pending.settled()).toBe(2);
    expect(add.mock.calls.length).toBeGreaterThan(0); expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    controller.abort(new Error('after completion')); vi.mocked(fs.readFile).mockClear();
    expect(await f.reader.recoverTask('snapshot-fixture')).toEqual(f.latest); expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('a non-aborted genuine missing checkpoint remains null, while a genuine IO failure still propagates without a new fallback', async () => {
    const f = await fixture(); const controller = new AbortController(); const pending = track(controller.signal);
    await expect((f.reader.recoverTask as (id: string, options?: ReadOptions) => Promise<TaskSnapshot | null>)('missing', pending.options)).resolves.toBeNull();
    const reason = Object.assign(new Error('storage failed'), { code: 'EIO' }); vi.mocked(fs.readFile).mockRejectedValueOnce(reason);
    await expect(recover(f.reader, pending.options)).rejects.toBe(reason);
  });
});
