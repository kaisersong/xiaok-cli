import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const native = vi.hoisted(() => ({ appPath: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => native.appPath }, BrowserWindow: { getAllWindows: () => [], fromWebContents: () => undefined },
  clipboard: { read: vi.fn(), readImage: vi.fn() }, dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() }, systemPreferences: { askForMediaAccess: vi.fn(), getMediaAccessStatus: vi.fn() },
}));
import { registerDesktopIpc } from '../../electron/ipc.js';
import { getDesktopMemoryStore, getDesktopMemoryBackend } from '../../electron/desktop-services.js';
import { IPC_SCHEMA_REGISTRY, registerIpcHandler, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain } from '../../electron/shutdown-aware-ipc-main.js';
import { createPreloadApi } from '../../electron/preload-api.js';
import * as modelRegistry from '../../../src/ai/memory/model-registry.js';
import * as configuration from '../../../src/utils/config.js';
import type { MemoryStore } from '../../../src/ai/memory/store.js';
const cases = [
  ['listMemories', [], ['fs-read']],
  ['createMemory', [{ content: 'contract memory', tags: ['tag'], source: 'legacy' }], ['fs-read', 'fs-write-userData']],
  ['updateMemory', [{ id: 'fixture', content: 'updated', tags: ['tag'] }], ['fs-read', 'fs-delete', 'fs-write-userData']],
  ['deleteMemory', ['fixture'], ['fs-delete', 'fs-write-userData']],
  ['importMemories', ['- imported contract memory'], ['fs-read', 'fs-write-userData']],
  ['memoryStats', [], ['fs-read']],
  ['memoryCompact', [], ['fs-read', 'fs-write-userData', 'network']],
  ['memoryPersonaTraits', [], ['fs-read']],
  ['memoryListLayer', [1, 7, 3], ['fs-read']],
  ['memoryDeleteEntry', ['fixture', 1], ['fs-delete', 'fs-write-userData']],
  ['memoryClearAll', [], ['fs-delete', 'fs-write-userData']],
  ['memoryGetModelId', [], ['fs-read']],
  ['memorySetModelId', ['all-MiniLM-L6-v2'], ['fs-read', 'fs-write-userData']],
  ['getEmbeddingModels', [], ['fs-read']],
  ['downloadEmbeddingModel', ['all-MiniLM-L6-v2'], ['fs-read', 'fs-delete', 'network', 'fs-write-userData']],
  ['setEmbeddingModel', ['all-MiniLM-L6-v2'], ['fs-read', 'fs-delete', 'fs-write-userData']],
] as const;
const layerRow = { id: 'row', content: 'content', createdAt: 'now', tags: ['tag'] };
const memoryRow = { id: 'row', content: 'content', tags: ['tag'], createdAt: 123 };
const noArguments = ['listMemories', 'memoryStats', 'memoryCompact', 'memoryPersonaTraits', 'memoryClearAll', 'memoryGetModelId', 'getEmbeddingModels'];
function validOutput(name: string): unknown {
  if (name === 'listMemories') return [memoryRow];
  if (name === 'createMemory' || name === 'updateMemory') return memoryRow;
  if (name === 'importMemories') return { imported: 1, deduped: 0, parseErrors: [] };
  if (name === 'memoryCompact') return { status: 'completed', l1: 1, l2: 1, l3: 0 };
  if (name === 'memoryStats') return { l0: 1, l1: 1, l2: 0, l3: 0, dbSizeBytes: 100 };
  if (name === 'memoryPersonaTraits') return [{ trait: 'patient', confidence: .5 }];
  if (name === 'memoryListLayer') return [layerRow];
  if (name === 'memoryGetModelId') return 'all-MiniLM-L6-v2';
  if (name === 'getEmbeddingModels') return [{ id: 'model', name: 'model', dims: 384, size: '90MB', languages: 'en', downloaded: false, active: true, manualHint: { urls: [{ file: 'model.onnx', url: 'https://example.invalid/model' }], targetDir: '/host/embedding' } }];
  if (name === 'downloadEmbeddingModel' || name === 'setEmbeddingModel') return undefined;
  return true;
}

describe('complete16 Memory domain through real registration and preload', () => {
  let root: string, priorConfig: string | undefined, store: MemoryStore & Required<Pick<MemoryStore, 'delete' | 'listLayer' | 'getStats' | 'getPersonaTraits'>>, gate: DesktopShutdownGate;
  let handlers: Map<string, (...args: any[]) => unknown>;
  const webContents = { id: 1, send: vi.fn() };
  const event = { sender: webContents }, window = { id: 1, isDestroyed: () => false, webContents, once: vi.fn() };
  const addedMethods: string[] = [];
  const invoke = (name: string, ...args: unknown[]) => Promise.resolve(handlers.get(`desktop:${name}`)!(event, ...args));
  const optionalMethod = (name: 'listLayer' | 'getPersonaTraits' | 'compact') => {
    if (!store[name]) { Object.defineProperty(store, name, { value: () => name === 'compact' ? Promise.resolve({status: 'unchanged', l1: 0, l2: 0, l3: 0}) : [], writable: true, configurable: true }); addedMethods.push(name); }
  };
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-memory-ipc-')); native.appPath = root;
    priorConfig = process.env.XIAOK_CONFIG_DIR; process.env.XIAOK_CONFIG_DIR = root;
    handlers = new Map(); gate = new DesktopShutdownGate(); resetIpcSchemaRegistryForTests();
    await registerDesktopIpc(new ShutdownAwareIpcMain({ handle: (channel, fn) => { handlers.set(channel, fn); } }, gate), window as never, { getDataRoot: () => root } as never);
    store = getDesktopMemoryStore(root) as typeof store;
    console.info('MEMORY_IPC_ACTUAL_BACKEND', getDesktopMemoryBackend(root));
  }, 60000);
  beforeEach(() => { vi.unstubAllEnvs(); vi.spyOn(modelRegistry, 'downloadModel').mockResolvedValue(undefined); });
  afterEach(() => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    for (const name of addedMethods.splice(0)) delete (store as any)[name];
  });
  afterAll(() => {
    store.close?.(); resetIpcSchemaRegistryForTests();
    if (priorConfig === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = priorConfig;
    rmSync(root, { recursive: true, force: true });
  });
  it('registers exactly complete16 at round4 and preserves old28 single metadata', () => {
    expect([...IPC_SCHEMA_REGISTRY.values()].filter(row => Number(row.rolloutRound) === 4).map(row => row.channel).sort()).toEqual(cases.map(([name]) => `desktop:${name}`).sort());
    for (const [name, , riskTags] of cases) expect(IPC_SCHEMA_REGISTRY.get(`desktop:${name}`)).toMatchObject({ sourceFile: 'desktop/electron/ipc.ts', riskTags, payloadMode: ['memoryListLayer', 'memoryDeleteEntry', 'memoryCompact'].includes(name) ? 'tuple' : 'single' });
    for (const [round, count] of [[1, 8], [2, 2], [3, 18]]) expect([...IPC_SCHEMA_REGISTRY.values()].filter(row => Number(row.rolloutRound) === round)).toHaveLength(count);
  });
  it.each(cases)('has a complete typed output schema for %s', name => {
    const entry = IPC_SCHEMA_REGISTRY.get(`desktop:${name}`); expect(entry).toBeDefined();
    expect(entry!.output.safeParse(validOutput(name)).success).toBe(true);
    expect(entry!.output.safeParse({ forged: true }).success).toBe(false);
  });
  it('passes all consumed triple values and retains nullish defaults, omissions and unused extras', async () => {
    optionalMethod('listLayer'); const spy = vi.spyOn(store, 'listLayer').mockReturnValue([layerRow]);
    for (const [args, expected] of [ [[2, 7, 3], [2, 7, 3]], [[2], [2, 50, 0]], [[2, undefined, undefined], [2, 50, 0]], [[2, null, null], [2, 50, 0]], [[2, 0, 0, 'ignored'], [2, 0, 0]] ] as const) {
      await expect(invoke('memoryListLayer', ...args)).resolves.toEqual([layerRow]); expect(spy).toHaveBeenLastCalledWith(...expected);
    }
  });
  it('passes id and layer independently including the original omitted-layer behavior', async () => {
    const spy = vi.spyOn(store, 'delete').mockResolvedValue(true);
    await expect(invoke('memoryDeleteEntry', 'id', 3)).resolves.toBe(true); expect(spy).toHaveBeenLastCalledWith('id', 3);
    await expect(invoke('memoryDeleteEntry', 'id')).resolves.toBe(true); expect(spy).toHaveBeenLastCalledWith('id', undefined);
    await expect(invoke('memoryDeleteEntry', 'other', 0, 'ignored')).resolves.toBe(true); expect(spy).toHaveBeenLastCalledWith('other', 0);
  });
  it('rejects malformed update before the existing delete-then-save sequence', async () => {
    const protectedEntry = await invoke('createMemory', { content: 'protected actual owner record', tags: ['protected'] }) as typeof memoryRow;
    const remove = vi.spyOn(store, 'delete'), save = vi.spyOn(store, 'save');
    await expect(invoke('updateMemory', { id: protectedEntry.id, content: 4 })).rejects.toThrow();
    const remaining = await invoke('listMemories') as Array<typeof memoryRow>;
    expect.soft(remaining.some(entry => entry.id === protectedEntry.id)).toBe(true);
    expect.soft(remove).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it('never forwards spoofed source/authority into records and preserves fixed user/global ownership', async () => {
    const save = vi.spyOn(store, 'save').mockResolvedValue();
    await invoke('createMemory', { content: 'untouched whitespace ', tags: ['tag'], source: 'legacy', requestSource: 'agent', type: 'agent', scope: 'project', provenance: { forged: true } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: 'user', scope: 'global', summary: 'untouched whitespace ', tags: ['tag'] }));
    expect(save.mock.calls[0][0]).not.toHaveProperty('requestSource'); expect(save.mock.calls[0][0]).not.toHaveProperty('provenance');
  });
  it('rejects malformed consumed dual/triple values before store mutation/read', async () => {
    optionalMethod('listLayer'); const list = vi.spyOn(store, 'listLayer'), remove = vi.spyOn(store, 'delete');
    await expect(invoke('memoryListLayer', 1, 'bad', 3)).resolves.toEqual([]);
    await expect(invoke('memoryListLayer', 1, 7, 'bad')).resolves.toEqual([]);
    await expect(invoke('memoryDeleteEntry', 'id', null)).resolves.toBe(false);
    expect(list).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it.each(noArguments)('preserves the old ignored-payload ABI of %s', async name => {
    if (name === 'memoryCompact') {
      // Master now admits an explicit user compaction with no arguments.
      const compact = vi.spyOn(store, 'compact').mockResolvedValue({status: 'completed', l1: 1, l2: 1, l3: 0});
      await expect(invoke(name, { payloadMode: 'tuple', forged: true }, 'ignored')).rejects.toThrow();
      expect(compact).not.toHaveBeenCalled();
    } else {
      await expect(invoke(name, { payloadMode: 'tuple', forged: true }, 'ignored')).resolves.toEqual(await invoke(name));
    }
  });
  it('covers all four real producer metadata shapes, nullable SQLite type and optional createdAt', async () => {
    optionalMethod('listLayer'); const rows = [
      { ...layerRow, meta: { role: 'user', sessionId: 'session' } },
      { id: 'legacy', content: 'legacy', meta: { scope: 'global', type: null } },
      { ...layerRow, meta: { keyFacts: ['fact'] } }, { ...layerRow, meta: { evidence: ['proof'], confidence: .8 } },
    ]; vi.spyOn(store, 'listLayer').mockReturnValue(rows);
    await expect(invoke('memoryListLayer', 1, 50, 0)).resolves.toEqual(rows);
  });
  for (const mode of ['development', 'production']) {
    it('rejects unknown/malformed layer DTO/meta in '+mode, async () => {
      vi.stubEnv('NODE_ENV', mode); optionalMethod('listLayer'); const spy = vi.spyOn(store, 'listLayer');
      for (const row of [{ ...layerRow, unexpected: true }, { ...layerRow, meta: { unknown: '/private' } }, { ...layerRow, meta: { confidence: 'bad' } }]) {
        spy.mockReturnValue([row] as any); await expect(invoke('memoryListLayer', 1, 50, 0)).resolves.toEqual([]);
      }
    });
    it('rejects malformed real model DTO/config dependencies in '+mode, async () => {
      vi.stubEnv('NODE_ENV', mode);
      vi.spyOn(modelRegistry, 'getManualDownloadHint').mockReturnValue({ targetDir: '/host', urls: [{ file: 'model', url: 4 }] } as any);
      await expect(invoke('getEmbeddingModels')).resolves.toEqual([]);
      vi.spyOn(configuration, 'loadConfig').mockResolvedValue({ memory: { modelId: 4 } } as any);
      await expect(invoke('memoryGetModelId')).resolves.toBeNull();
    });
    it('rejects malformed stats/persona/delete receiver outputs in '+mode, async () => {
      vi.stubEnv('NODE_ENV', mode); optionalMethod('getPersonaTraits');
      vi.spyOn(store, 'getStats').mockReturnValue({ l0: 'bad' } as any); await expect(invoke('memoryStats')).resolves.toBeNull();
      vi.spyOn(store, 'getPersonaTraits').mockReturnValue([{ trait: 'trait', confidence: 'bad' }] as any); await expect(invoke('memoryPersonaTraits')).resolves.toEqual([]);
      vi.spyOn(store, 'delete').mockResolvedValue('bad' as any); await expect(invoke('memoryDeleteEntry', 'id', 1)).resolves.toBe(false); await expect(invoke('deleteMemory', 'id')).rejects.toThrow('ipc_contract_violation');
    });
  }
  it('retains model null/default toggles and direct config producer state', async () => {
    await expect(invoke('memorySetModelId', 'all-MiniLM-L6-v2')).resolves.toBe(true);
    await expect(invoke('memoryGetModelId')).resolves.toBe('all-MiniLM-L6-v2');
    await expect(invoke('memorySetModelId', null)).resolves.toBe(true); await expect(invoke('memoryGetModelId')).resolves.toBeNull();
    await expect(invoke('memorySetModelId')).resolves.toBe(true); await expect(invoke('memoryGetModelId')).resolves.toBeNull();
  });
  it('drives the real owner create/list/update/delete/import persistence producer through listeners', async () => {
    const created = await invoke('createMemory', { content: 'persistent contract', tags: ['contract'] }) as typeof memoryRow;
    expect(typeof created.createdAt).toBe('number'); expect(created.content).toBe('persistent contract');
    expect(await invoke('listMemories')).toContainEqual(expect.objectContaining({ id: created.id, tags: ['contract'] }));
    await invoke('updateMemory', { id: created.id, content: 'persistent update', tags: ['updated'] });
    expect(await invoke('listMemories')).toContainEqual(expect.objectContaining({ id: created.id, tags: ['updated'] }));
    await expect(invoke('deleteMemory', created.id)).resolves.toBe(true);
    expect(await invoke('listMemories')).not.toContainEqual(expect.objectContaining({ id: created.id }));
    const imported = await invoke('importMemories', '- imported real producer') as { imported: number }; expect(imported.imported).toBe(1);
  });
  it('connects all16 typed/CJS consumer methods to their actual listeners without model downloads', async () => {
    optionalMethod('compact');
    const compact = vi.spyOn(store, 'compact').mockResolvedValue({status: 'unchanged', l1: 0, l2: 0, l3: 0});
    const ipcRenderer = { invoke: (channel: string, ...args: unknown[]) => Promise.resolve(handlers.get(channel)!(event, ...args)), on: vi.fn(), removeListener: vi.fn() };
    const typed = createPreloadApi(ipcRenderer as never); let sandbox: typeof typed | undefined;
    runInNewContext(readFileSync(join(import.meta.dirname, '../../electron/preload.cjs'), 'utf8'), { require: (name: string) => name === 'os' ? { userInfo: () => ({ username: 'fixture' }) } : { contextBridge: { exposeInMainWorld: (_name: unknown, api: typeof typed) => { sandbox = api; } }, ipcRenderer } });
    if (!sandbox) throw Error('CJS preload not exposed');
    for (const api of [typed, sandbox]) for (const [name, args] of cases) {
      const value = await (api[name] as (...args: any[]) => Promise<unknown>)(...args);
      const entry = IPC_SCHEMA_REGISTRY.get(`desktop:${name}`); expect(entry).toBeDefined(); expect(entry!.output.safeParse(value).success).toBe(true);
    }
    expect(compact).toHaveBeenCalledWith({requestSource: 'user', force: true});
    expect(modelRegistry.downloadModel).toHaveBeenCalledWith('all-MiniLM-L6-v2'); expect(gate.outstanding).toBe(0);
  });
  it('keeps shutdown ahead of tuple parsing and releases every token', async () => {
    gate.close(); await expect(invoke('memoryDeleteEntry', 4, null)).rejects.toThrow('shutting_down'); expect(gate.outstanding).toBe(0);
  });
});

describe('actual generic registrar tuple opt-in and unchanged default single', () => {
  afterAll(() => resetIpcSchemaRegistryForTests());
  it('passes real2 and3 tuple values with event identity and exact parsed order', async () => {
    for (const size of [2, 3]) {
      const handlers = new Map<string, any>(), event = { sentinel: true };
      const input = size === 2 ? z.tuple([z.number(), z.string()]) : z.tuple([z.number(), z.string(), z.boolean()]);
      const handler = vi.fn(async args => args);
      registerIpcHandler({ registrar: { handle: (name, fn) => { handlers.set(name, fn); } }, channel: `fixture:tuple:${size}`, payloadMode: 'tuple', input, output: input, sourceFile: 'test', rolloutRound: 3, handler });
      const payload = size === 2 ? [2, 'second'] : [3, 'second', true];
      await expect(handlers.get(`fixture:tuple:${size}`)(event, ...payload)).resolves.toEqual(payload); expect(handler).toHaveBeenCalledWith(payload, event);
    }
  });
  it('does not let a payload choose tuple mode or change the previous ignored-extra ABI', async () => {
    let listener: any; const handler = vi.fn(async input => input);
    registerIpcHandler({ registrar: { handle: (_name, fn) => { listener = fn; } }, channel: 'fixture:default-single', input: z.object({ n: z.number() }), output: z.object({ n: z.number() }), sourceFile: 'test', rolloutRound: 3, handler });
    await expect(listener({}, { n: 1, payloadMode: 'tuple' }, 2, 3)).resolves.toEqual({ n: 1 }); expect(handler.mock.calls[0][0]).toEqual({ n: 1 });
  });
});
