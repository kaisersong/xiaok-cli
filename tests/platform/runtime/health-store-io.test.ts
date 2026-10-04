import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileCapabilityHealthStore } from '../../../src/platform/runtime/health-store.js';
import { createPlatformRuntimeContext } from '../../../src/platform/runtime/context.js';

const failure = vi.hoisted(() => ({ operation: '', target: '', code: '' }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const check = (operation: string, target: unknown) => {
    if (failure.operation === operation && (typeof target === 'number' || target === failure.target)) {
      throw Object.assign(new Error('injected filesystem failure'), { code: failure.code });
    }
  };
  return {
    ...fs,
    mkdirSync: (...args: Parameters<typeof fs.mkdirSync>) => { check('mkdir', args[0]); return fs.mkdirSync(...args); },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => { check('write', args[0]); return fs.writeFileSync(...args); },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => { check('rename', args[1]); return fs.renameSync(...args); },
  };
});

const roots: string[] = [];
function fixture() {
  const root = join(tmpdir(), `xiaok-health-io-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  roots.push(root); mkdirSync(root, { recursive: true });
  return { root, file: join(root, 'health.json') };
}
const snapshot = { updatedAt: 1, summary: 'capabilities: none declared', capabilities: [] };
afterEach(() => {
  Object.assign(failure, { operation: '', target: '', code: '' });
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('health cache I/O isolation', () => {
  it.each(['EPERM', 'EACCES', 'EROFS', 'ENOSPC', 'EDQUOT', 'EBUSY', 'EIO', 'EEXIST'])('keeps live snapshots after %s from directory creation', code => {
    const { root, file } = fixture(); const store = new FileCapabilityHealthStore(file);
    Object.assign(failure, { operation: 'mkdir', target: root, code });
    expect(store.set(root, snapshot)).toBe(false);
    expect(store.get(root)).toEqual(snapshot);
    Object.assign(failure, { operation: '' });
    expect(store.set(root, { ...snapshot, updatedAt: 2 })).toBe(true);
    expect(new FileCapabilityHealthStore(file).get(root)?.updatedAt).toBe(2);
  });
  it.each(['write', 'rename'])('preserves the previous cache and cleans temporary files on EPERM at %s', operation => {
    const { root, file } = fixture(); const store = new FileCapabilityHealthStore(file);
    store.set(root, snapshot); const old = readFileSync(file, 'utf8');
    Object.assign(failure, { operation, target: file, code: 'EPERM' });
    expect(store.set(root, { ...snapshot, updatedAt: 2 })).toBe(false);
    expect(store.get(root)?.updatedAt).toBe(2);
    expect(readFileSync(file, 'utf8')).toBe(old);
    expect(readdirSync(root)).toEqual(['health.json']);
  });
  it('does not swallow unknown failures or invalid snapshot serialization', () => {
    const { root, file } = fixture(); const store = new FileCapabilityHealthStore(file);
    Object.assign(failure, { operation: 'mkdir', target: root, code: 'BUG' });
    expect(() => store.set(root, snapshot)).toThrow('injected filesystem failure');
    Object.assign(failure, { operation: '' });
    const cyclic = { ...snapshot }; Object.assign(cyclic, { cyclic });
    expect(() => store.set(root, cyclic)).toThrow(/circular/i);
  });
  it.each(['mkdir', 'write', 'rename'])('starts and settles the production runtime after EPERM at %s', async operation => {
    const { root } = fixture();
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
    vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
    const file = join(root, '.xiaok', 'state', 'capability-health.json');
    Object.assign(failure, { operation, target: operation === 'mkdir' ? join(root, '.xiaok', 'state') : file, code: 'EPERM' });
    const context = await createPlatformRuntimeContext({ cwd: root, builtinCommands: ['chat'], platform: 'win32', reminderMode: 'local' });
    try {
      await context.mcpReady;
      expect(context.mcpTools).toEqual([]);
      expect(context.health.hasDegradedCapabilities()).toBe(false);
      expect(existsSync(file)).toBe(false);
    } finally { await context.dispose(); }
  });
});

describe('native Windows read-only cache', () => {
  it.skipIf(process.platform !== 'win32')('starts the production runtime with an NTFS read-only health cache', async () => {
    const { root } = fixture();
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
    vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
    const state = join(root, '.xiaok', 'state'); mkdirSync(state, { recursive: true });
    const file = join(state, 'capability-health.json');
    const old = JSON.stringify({ schemaVersion: 1, entries: [{ cwd: root, snapshot }] });
    writeFileSync(file, old); chmodSync(file, 0o444);
    try {
      expect(() => writeFileSync(file, old)).toThrow();
      const context = await createPlatformRuntimeContext({ cwd: root, builtinCommands: ['chat'], reminderMode: 'local' });
      try { await context.mcpReady; expect(context.mcpTools).toEqual([]); expect(readFileSync(file, 'utf8')).toBe(old); }
      finally { await context.dispose(); }
    } finally { chmodSync(file, 0o666); }
  });
});
