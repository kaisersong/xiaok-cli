import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const native = vi.hoisted(() => ({ windows: [] as any[], showSaveDialog: vi.fn(), appPath: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => native.appPath },
  BrowserWindow: { getAllWindows: () => native.windows, fromWebContents: (sender: unknown) => native.windows.find(w => w.webContents === sender) },
  clipboard: { read: vi.fn(), readImage: vi.fn() }, dialog: { showOpenDialog: vi.fn(), showSaveDialog: native.showSaveDialog },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  systemPreferences: { askForMediaAccess: vi.fn(), getMediaAccessStatus: vi.fn() },
}));
import { registerDesktopIpc } from '../../electron/ipc.js';
import { IPC_SCHEMA_REGISTRY, registerIpcHandler, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain } from '../../electron/shutdown-aware-ipc-main.js';
import { createPreloadApi } from '../../electron/preload-api.js';

const cases = [
  ['getArtifactWorkspaceSnapshot', {}, ['fs-read', 'fs-write-userData']],
  ['closeArtifactWorkspace', {}, ['fs-write-userData']],
  ['readArtifactWorkspaceVersionPreview', { versionId: 'version' }, ['fs-read', 'fs-write-userData']],
  ['exportArtifactWorkspaceVersion', { versionId: 'version' }, ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'dialog']],
  ['createArtifactPlaceholder', { requestedKind: 'html', expectedStructureRevision: 3 }, ['fs-read', 'fs-write-userData']],
  ['submitArtifactGeneration', { placeholderNodeId: 'node', prompt: 'draft' }, ['fs-read', 'fs-write', 'fs-write-userData', 'exec', 'network', 'external-process']],
  ['cancelArtifactGeneration', { generationRequestId: 'request' }, ['fs-read', 'fs-write-userData', 'external-process']],
  ['retryArtifactGeneration', { generationRequestId: 'request' }, ['fs-read', 'fs-write', 'fs-write-userData', 'exec', 'network', 'external-process']],
  ['preferArtifactVersion', { lineageId: 'lineage', versionId: 'version', expectedStructureRevision: 3 }, ['fs-read', 'fs-write-userData']],
  ['removeArtifactWorkspaceNode', { nodeId: 'node', expectedStructureRevision: 3 }, ['fs-read', 'fs-write-userData']],
  ['updateArtifactWorkspaceLayout', { patches: [{ nodeId: 'node', x: 1, y: 2, zIndex: 3, expectedLayoutRevision: 4 }] }, ['fs-read', 'fs-write-userData']],
  ['saveArtifactWorkspaceViewport', { viewport: { x: 1, y: 2, zoom: 1.5 }, expectedViewRevision: 4 }, ['fs-read', 'fs-write-userData']],
  ['createArtifactWorkspaceCollection', { title: 'collection', expectedStructureRevision: 3 }, ['fs-read', 'fs-write-userData']],
  ['createArtifactWorkspaceNote', { noteText: 'note', expectedStructureRevision: 3 }, ['fs-read', 'fs-write-userData']],
  ['updateArtifactWorkspaceNote', { nodeId: 'node', noteText: 'note', expectedStructureRevision: 3 }, ['fs-read', 'fs-write-userData']],
  ['createArtifactWorkspaceRelation', { fromNodeId: 'from', toNodeId: 'to', kind: 'references', expectedStructureRevision: 3 }, ['fs-read', 'fs-write-userData']],
  ['setArtifactCollectionMembership', { collectionNodeId: 'collection', memberNodeId: 'node', included: true, expectedStructureRevision: 3 }, ['fs-read', 'fs-write-userData']],
  ['recordArtifactWorkspaceEvent', { eventName: 'revision_branched' }, ['fs-write-userData']],
] as const;
const snapshotCases = cases.filter(([name]) => !['closeArtifactWorkspace', 'readArtifactWorkspaceVersionPreview', 'exportArtifactWorkspaceVersion', 'recordArtifactWorkspaceEvent'].includes(name));
const failure = { ok: false, error: { code: 'runtime_unavailable', message: 'Artifact workspace operation failed' } };
function snapshot() {
  return {
    workspace: { id: 'workspace', conversationId: 'conversation', workspaceRootId: 'desktop-artifact-workspace-v1', schemaVersion: 1, structureRevision: 3, createdAt: 'now', updatedAt: 'now' },
    access: { revision: 'write', spatial: 'enabled' }, nodes: [], relations: [], lineages: [], generationRequests: [],
    versions: [{ id: 'version', lineageId: 'lineage', storageKind: 'single_file', sourceKind: 'workspace_generation', kind: 'html', checksum: 'digest', status: 'ready', createdAt: 'now', preferred: true, preview: { available: true, title: 'draft', contentKind: 'text' } }],
    staging: [{ id: 'stage', source: 'generation', availability: 'present', fileRef: 'staging/internal.html', owner: 'system_staging', keep: true, createdAt: 'now', expiresAt: 'later' }],
  };
}
function outputFor(name: string): unknown {
  if (name === 'closeArtifactWorkspace') return { closed: true };
  if (name === 'readArtifactWorkspaceVersionPreview') return { versionId: 'version', kind: 'html', title: 'draft', contentKind: 'text', content: 'hello' };
  if (name === 'exportArtifactWorkspaceVersion') return { sourcePath: '/host/private/source.html', fileName: 'draft.html' };
  if (name === 'recordArtifactWorkspaceEvent') return { recorded: true };
  return snapshot();
}

describe('artifact workspace entire invoke domain through production registry', () => {
  let root: string;
  let handlers: Map<string, (...args: any[]) => unknown>;
  let gate: DesktopShutdownGate;
  const window = { id: 1, isDestroyed: () => false, webContents: { id: 11, send: vi.fn() }, once: vi.fn() };
  const services: Record<string, any> = {};
  const event = { sender: window.webContents };
  const invoke = (name: string, input: unknown, sender = event) => Promise.resolve(handlers.get(`desktop:artifactWorkspace:${name}`)!(sender, input));
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-artifact-ipc-contract-')); native.appPath = root; native.windows = [window];
    handlers = new Map(); gate = new DesktopShutdownGate(); resetIpcSchemaRegistryForTests();
    services.getDataRoot = () => join(root, 'data');
    for (const [name] of cases) services[name] = vi.fn();
    await registerDesktopIpc(new ShutdownAwareIpcMain({ handle: (channel, handler) => { handlers.set(channel, handler); } }, gate), window as never, services as never);
  }, 60000);
  beforeEach(() => {
    vi.unstubAllEnvs();
    window.once.mockClear();
    native.showSaveDialog.mockReset().mockResolvedValue({ canceled: false, filePath: '/user/chosen.html' });
    for (const [name] of cases) services[name].mockReset().mockImplementation(() => outputFor(name));
  });
  afterAll(async () => {
    vi.unstubAllEnvs(); resetIpcSchemaRegistryForTests();
    const { getDesktopMemoryStore } = await import('../../electron/desktop-services.js');
    const store = getDesktopMemoryStore(join(root, 'data'));
    if ('close' in store && typeof store.close === 'function') store.close();
    rmSync(root, { recursive: true, force: true });
  });
  it('registers all 18 Artifact and 12 Activity third-round channels with exact metadata and preserves earlier rounds', () => {
    const activityChannels = [
      'list', 'work', 'mcpInputs', 'mcpAnswer', 'mcpCancel', 'unread', 'read',
      'subscribe', 'unsubscribe', 'overview', 'reporting', 'stop',
    ].map(name => `desktop:activity:${name}`);
    const originalChannels = cases.map(([name]) => `desktop:artifactWorkspace:${name}`);
    expect([...IPC_SCHEMA_REGISTRY.values()].filter(row => row.rolloutRound === 3).map(row => row.channel).sort()).toEqual([...originalChannels, ...activityChannels].sort());
    expect(originalChannels).toHaveLength(18);
    expect(activityChannels).toHaveLength(12);
    for (const [name, , riskTags] of cases) expect(IPC_SCHEMA_REGISTRY.get(`desktop:artifactWorkspace:${name}`)).toMatchObject({ sourceFile: 'desktop/electron/ipc.ts', rolloutRound: 3, riskTags });
    for (const channel of activityChannels) {
      expect(IPC_SCHEMA_REGISTRY.get(channel)).toMatchObject({
        sourceFile: 'conversation-activity-ipc.ts', rolloutRound: 3, riskTags: ['internal-mutation'],
      });
    }
    expect([...IPC_SCHEMA_REGISTRY.values()].filter(row => row.rolloutRound === 1)).toHaveLength(8);
    expect([...IPC_SCHEMA_REGISTRY.values()].filter(row => row.rolloutRound === 2)).toHaveLength(2);
  });
  it.each(cases)('preserves %s legal payload and strips authority without changing revision values', async (name, fields) => {
    const result = await invoke(name, { conversationId: 'conversation', ...fields, workspaceRootId: '/untrusted/root', requestSource: 'agent', actorId: 'forged', viewKey: 'forged', destinationPath: '/forged' });
    expect(result).toMatchObject({ ok: true });
    const input = services[name].mock.calls[0][0];
    expect(input).toEqual({ conversationId: 'conversation', ...fields, workspaceRootId: 'desktop-artifact-workspace-v1' });
    if (name === 'exportArtifactWorkspaceVersion') expect(services[name].mock.calls[1][0].destinationPath).toBe('/user/chosen.html');
    expect(gate.outstanding).toBe(0);
  });
  for (const raw of [undefined, null, [], { conversationId: '' }]) {
    it.each(cases)('rejects %s malformed identity before service or view allocation', async name => {
      const secondWindow = { id: 2, webContents: { id: 22 }, once: vi.fn() }; native.windows = [window, secondWindow];
      const result = await invoke(name, raw, { sender: secondWindow.webContents } as never);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_target' } });
      expect(services[name]).not.toHaveBeenCalled(); expect(secondWindow.once).not.toHaveBeenCalled();
      expect(native.showSaveDialog).not.toHaveBeenCalled(); expect(gate.outstanding).toBe(0);
    });
  }
  it.each(cases)('models %s output contract without accepting malformed success', name => {
    const entry = IPC_SCHEMA_REGISTRY.get(`desktop:artifactWorkspace:${name}`);
    expect(entry).toBeDefined();
    const data = name === 'exportArtifactWorkspaceVersion' ? { exported: true } : outputFor(name);
    expect(entry!.output.safeParse({ ok: true, data }).success).toBe(true);
    expect(entry!.output.safeParse({ ok: true, data: { forged: true } }).success).toBe(false);
    expect(entry!.output.safeParse({ ok: false, error: { code: 'forged', message: 'unsafe' } }).success).toBe(false);
  });
  it.each([
    ['createArtifactPlaceholder', { requestedKind: 'forged', expectedStructureRevision: 1 }],
    ['submitArtifactGeneration', { prompt: 'draft' }],
    ['updateArtifactWorkspaceLayout', { patches: [{ nodeId: 'node', x: 'wrong', y: 0, zIndex: 0, expectedLayoutRevision: 1 }] }],
    ['saveArtifactWorkspaceViewport', { viewport: { x: 0, y: 0, zoom: 'wrong' } }],
    ['createArtifactWorkspaceRelation', { fromNodeId: 'from', toNodeId: 'to', kind: 'forged', expectedStructureRevision: 1 }],
    ['recordArtifactWorkspaceEvent', { eventName: 'forged', metadata: { nested: {} } }],
    ['getArtifactWorkspaceSnapshot', { selectedArtifact: { artifactId: '' } }],
  ])('retains %s nested/enum/target rejects before service', async (name, fields) => {
    await expect(invoke(name as string, { conversationId: 'conversation', ...fields })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_target' } });
    expect(services[name as string]).not.toHaveBeenCalled();
  });
  it.each(cases)('preserves %s permission/CAS error envelope canonical state', async (name, fields) => {
    services[name].mockImplementation(() => { throw { code: 'structure_revision_conflict', message: 'conflict', canonicalNodes: [{ id: 'canonical' }] }; });
    await expect(invoke(name, { conversationId: 'conversation', ...fields })).resolves.toEqual({ ok: false, error: { code: 'structure_revision_conflict', message: 'conflict', canonical: [{ id: 'canonical' }] } });
  });
  for (const mode of ['development', 'production']) {
    it.each(snapshotCases)('rejects nested version private path for %s in '+mode, async (name, fields) => {
      vi.stubEnv('NODE_ENV', mode);
      const data = snapshot(); Object.assign(data.versions[0], { fileRef: '/private/secret', entryRef: 'private', packageManifestRef: 'private' });
      services[name].mockReturnValue(data);
      await expect(invoke(name, { conversationId: 'conversation', ...fields })).resolves.toEqual(failure);
    });
    it.each(snapshotCases.filter(([name]) => name !== 'getArtifactWorkspaceSnapshot'))('rejects mutation %s unknown output field in '+mode, async (name, fields) => {
      vi.stubEnv('NODE_ENV', mode); services[name].mockReturnValue({ ...snapshot(), unmodeled: '/private' });
      await expect(invoke(name, { conversationId: 'conversation', ...fields })).resolves.toEqual(failure);
    });
    it.each(['closeArtifactWorkspace', 'readArtifactWorkspaceVersionPreview', 'recordArtifactWorkspaceEvent'])('rejects malformed %s output in '+mode, async name => {
      vi.stubEnv('NODE_ENV', mode); services[name].mockReturnValue(name === 'readArtifactWorkspaceVersionPreview' ? { ...outputFor(name) as object, title: 4 } : { closed: 'yes', recorded: 'yes' });
      await expect(invoke(name, { conversationId: 'conversation', versionId: 'version', eventName: 'revision_branched' })).resolves.toEqual(failure);
    });
  }
  it('preserves getSnapshot legacy projection and removes only its staging fileRef', async () => {
    services.getArtifactWorkspaceSnapshot.mockReturnValue({ ...snapshot(), ignored: 'legacy' });
    const result = await invoke('getArtifactWorkspaceSnapshot', { conversationId: 'conversation' }) as any;
    expect(result.ok).toBe(true); expect(result.data.ignored).toBeUndefined(); expect(result.data.staging[0].fileRef).toBeUndefined();
  });
  it.each(snapshotCases.filter(([name]) => name !== 'getArtifactWorkspaceSnapshot'))('retains declared legacy staging fileRef for %s', async (name, fields) => {
    const result = await invoke(name, { conversationId: 'conversation', ...fields }) as any;
    expect(result.ok).toBe(true); expect(result.data.staging[0].fileRef).toBe('staging/internal.html');
  });
  it('preserves preview legacy projection and text content repair', async () => {
    services.readArtifactWorkspaceVersionPreview.mockReturnValue({ ...outputFor('readArtifactWorkspaceVersionPreview') as object, content: 42, ignored: 'legacy' });
    await expect(invoke('readArtifactWorkspaceVersionPreview', { conversationId: 'conversation', versionId: 'version' })).resolves.toEqual({ ok: true, data: { versionId: 'version', kind: 'html', title: 'draft', contentKind: 'text', content: '' } });
  });
  it('preserves export cancel and never exports to renderer-provided destination', async () => {
    native.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(invoke('exportArtifactWorkspaceVersion', { conversationId: 'conversation', versionId: 'version', destinationPath: '/forged' })).resolves.toEqual({ ok: true, data: { exported: false, canceled: true } });
    expect(services.exportArtifactWorkspaceVersion).toHaveBeenCalledTimes(1);
  });
  it('connects every typed and CJS preload method to the real registered listener', async () => {
    const ipcRenderer = { invoke: (channel: string, ...payload: unknown[]) => Promise.resolve(handlers.get(channel)!(event, ...payload)), on: vi.fn(), removeListener: vi.fn() };
    const typed = createPreloadApi(ipcRenderer as never);
    let sandbox: typeof typed | undefined;
    runInNewContext(readFileSync(join(import.meta.dirname, '../../electron/preload.cjs'), 'utf8'), { require: (name: string) => name === 'os' ? { userInfo: () => ({ username: 'fixture' }) } : { contextBridge: { exposeInMainWorld: (_name: unknown, api: typeof typed) => { sandbox = api; } }, ipcRenderer } });
    if (!sandbox) throw Error('CJS preload not exposed');
    for (const api of [typed, sandbox]) for (const [name, fields] of cases) {
      const method = api[name] as (input: any) => Promise<unknown>;
      await expect(method({ conversationId: 'conversation', ...fields })).resolves.toMatchObject({ ok: true });
      await expect(method({ conversationId: '' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_target' } });
    }
  });
  it('keeps shutdown ahead of input parsing and drains tokens', async () => {
    gate.close();
    await expect(invoke('getArtifactWorkspaceSnapshot', null)).rejects.toThrow('shutting_down');
    expect(services.getArtifactWorkspaceSnapshot).not.toHaveBeenCalled(); expect(gate.outstanding).toBe(0);
  });
});

describe('host-only error adapters on existing production registrar', () => {
  afterAll(() => resetIpcSchemaRegistryForTests());
  function setup(adapters: Record<string, unknown>, handler = vi.fn(async () => ({ ok: true, value: 1 } as unknown))) {
    const handlers = new Map<string, any>();
    registerIpcHandler({ registrar: { handle: (channel, fn) => { handlers.set(channel, fn); } }, channel: 'fixture:error-adapter', input: z.object({ n: z.number() }), output: z.union([z.object({ ok: z.literal(true), value: z.number() }).strict(), z.object({ ok: z.literal(false), error: z.string() }).strict()]), sourceFile: 'test', rolloutRound: 3, handler, ...adapters });
    return { invoke: (raw: unknown) => handlers.get('fixture:error-adapter')({}, raw), handler };
  }
  it('adapts invalid input, validates adapted output and never calls handler', async () => {
    const fixture = setup({ inputError: () => ({ ok: false, error: 'invalid' }) });
    await expect(fixture.invoke(null)).resolves.toEqual({ ok: false, error: 'invalid' }); expect(fixture.handler).not.toHaveBeenCalled();
  });
  it('rejects invalid adapter fallback instead of returning unchecked output', async () => {
    const fixture = setup({ inputError: () => ({ ok: false, error: 7 }) });
    await expect(fixture.invoke(null)).rejects.toThrow();
  });
  it('does not use input adapter to swallow handler failure', async () => {
    const adapter = vi.fn(); const fixture = setup({ inputError: adapter }, vi.fn(async () => { throw Error('handler-failure'); }));
    await expect(fixture.invoke({ n: 1 })).rejects.toThrow('handler-failure'); expect(adapter).not.toHaveBeenCalled();
  });
  it('validates output adapter fallback once and rejects malformed fallback', async () => {
    const adapter = vi.fn(() => ({ ok: false, error: 7 })); const fixture = setup({ outputError: adapter }, vi.fn(async () => ({ broken: true })));
    await expect(fixture.invoke({ n: 1 })).rejects.toThrow(); expect(adapter).toHaveBeenCalledTimes(1);
  });
});
