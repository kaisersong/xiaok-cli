import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LayeredMemoryStore, createLLMFromAdapter } from '../../../src/ai/memory/layered-store.js';
import type { ModelAdapter } from '../../../src/types.js';

let store: LayeredMemoryStore | undefined;
let root: string;
afterEach(() => {
  store?.close(); store = undefined;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('background memory diagnostics', () => {
  it.each(['normal', 'debug'])('records three incomplete outputs without writing terminal bytes (%s)', async mode => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-memory-background-'));
    vi.stubEnv('XIAOK_CONFIG_DIR', root);
    if (mode === 'debug') vi.stubEnv('XIAOK_LOG', 'debug');
    store = new LayeredMemoryStore({ dbPath: join(root, 'memory.db'), compaction: { compactIntervalMs: 1000, l0MinMessages: 1 } });
    await store.writeRawMessage('synthetic-session', 'user', 'Retain this synthetic original');
    const adapter: ModelAdapter = { getModelName: () => 'synthetic', stream: async function* () {
      yield { type: 'text', delta: '{"summaries":[]}' }; // No terminal done.
    } };
    vi.useFakeTimers();
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.setLLMFn(createLLMFromAdapter(adapter));
    await vi.advanceTimersByTimeAsync(3000);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    const log = readFileSync(join(root, 'logs', 'xiaok.log'), 'utf8');
    expect(log.match(/auto-compaction failed/g)).toHaveLength(3);
    expect(log.match(/memory_output_incomplete/g)).toHaveLength(3);
    expect(store.getStats()).toMatchObject({ l0: 1, l1: 0 });
    await expect(store.compact({ requestSource: 'user' })).rejects.toThrow('memory_output_incomplete');
  });

  it('records a stable code instead of an unknown multiline provider message', async () => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-memory-background-'));
    vi.stubEnv('XIAOK_CONFIG_DIR', root);
    store = new LayeredMemoryStore({ dbPath: join(root, 'memory.db'), compaction: { compactIntervalMs: 1000, l0MinMessages: 1 } });
    await store.writeRawMessage('synthetic-session', 'user', 'Retain this synthetic original');
    vi.useFakeTimers();
    const stderr = vi.spyOn(process.stderr, 'write');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.setLLMFn(async () => { throw new Error('SYNTHETIC_PROVIDER_BODY\nSYNTHETIC_DETAIL'); });
    await vi.advanceTimersByTimeAsync(1000);
    expect(stderr).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    const log = readFileSync(join(root, 'logs', 'xiaok.log'), 'utf8');
    expect(log).toContain('memory_compaction_failed');
    expect(log).not.toContain('SYNTHETIC_PROVIDER_BODY');
    expect(log).not.toContain('SYNTHETIC_DETAIL');
  });
});
