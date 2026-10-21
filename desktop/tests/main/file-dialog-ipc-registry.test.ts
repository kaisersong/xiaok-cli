import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  clipboardRead: vi.fn(), clipboardReadBuffer: vi.fn(), showSaveDialog: vi.fn(), send: vi.fn(),
  appPath: process.env.TEMP ?? process.env.TMPDIR ?? process.cwd(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => native.appPath },
  clipboard: { read: native.clipboardRead, readBuffer: native.clipboardReadBuffer },
  dialog: { showSaveDialog: native.showSaveDialog }, shell: {},
}));
import { registerDesktopIpc } from '../../electron/ipc.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { createPreloadApi } from '../../electron/preload-api.js';

const roundOne = ['openFileInSystemApp', 'readFileContent', 'saveFile', 'artifactBackup', 'artifactRevert', 'artifactCleanup', 'artifactWatch', 'artifactUnwatch'];
const defaultFilters = [{ name: 'Markdown', extensions: ['md'] }];

describe('actual file-selection IPC registry round two', () => {
  let root: string;
  let handlers: Map<string, IpcHandlerListener>;
  let gate: DesktopShutdownGate;
  let registrar: ShutdownAwareIpcMain;
  const event = { sender: {} };
  const window = { isDestroyed: () => false, webContents: { send: native.send } };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-file-dialog-')); native.appPath = root;
    handlers = new Map(); gate = new DesktopShutdownGate();
    registrar = new ShutdownAwareIpcMain({ handle: (channel, handler) => { handlers.set(channel, handler); } }, gate);
    resetIpcSchemaRegistryForTests();
    native.clipboardRead.mockReset().mockReturnValue('');
    native.clipboardReadBuffer.mockReset().mockReturnValue(Buffer.alloc(0));
    native.showSaveDialog.mockReset().mockResolvedValue({ canceled: false, filePath: join(root, 'chosen.txt') });
    await registerDesktopIpc(registrar, window as never, { getDataRoot: () => join(root, 'data') } as never);
  }, 60000);
  afterEach(async () => {
    vi.unstubAllEnvs();
    const { getDesktopMemoryStore } = await import('../../electron/desktop-services.js');
    const store = getDesktopMemoryStore(join(root, 'data'));
    if ('close' in store && typeof store.close === 'function') store.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  function invoke(channel: string, ...payload: unknown[]) {
    return Promise.resolve(handlers.get(channel)!(event as never, ...payload));
  }

  it('adds exactly the two selected channels to round two and retains the original eight at round one', () => {
    expect([...IPC_SCHEMA_REGISTRY.values()].filter(entry => entry.rolloutRound === 2).map(entry => entry.channel).sort())
      .toEqual(['desktop:readClipboardFilePaths', 'desktop:showSaveDialog']);
    for (const name of roundOne) expect(IPC_SCHEMA_REGISTRY.get(`desktop:${name}`)?.rolloutRound).toBe(1);
    expect(IPC_SCHEMA_REGISTRY.get('desktop:readClipboardFilePaths')).toMatchObject({
      sourceFile: 'desktop/electron/ipc.ts', riskTags: ['clipboard', 'fs-read'],
    });
    expect(IPC_SCHEMA_REGISTRY.get('desktop:showSaveDialog')).toMatchObject({
      sourceFile: 'desktop/electron/ipc.ts', riskTags: ['dialog'],
    });
  });

  it.each(['missing', 'undefined', 'null', 'null-filters', 'empty-filters'])('preserves save-dialog defaults for %s', async variant => {
    const args: unknown[] = variant === 'missing' ? [] : [variant === 'undefined' ? undefined : variant === 'null' ? null : variant === 'null-filters' ? { filters: null } : { filters: [] }];
    await expect(invoke('desktop:showSaveDialog', ...args)).resolves.toEqual({ canceled: false, filePath: join(root, 'chosen.txt') });
    expect(native.showSaveDialog).toHaveBeenCalledWith(window, { defaultPath: undefined, filters: variant === 'empty-filters' ? [] : undefined });
    expect(gate.outstanding).toBe(0);
  });
  it.each(['report.md', '', ' filename with spaces ', 'C:\\Reports\\draft.md', '\\\\server\\share\\draft.md'])('passes default filename unchanged: %j', async defaultPath => {
    await invoke('desktop:showSaveDialog', { defaultPath });
    expect(native.showSaveDialog).toHaveBeenCalledWith(window, { defaultPath, filters: undefined });
  });
  it.each([{name:'download.bin',content:'data:application/octet-stream;base64,AAEC/w==',bytes:Buffer.from([0,1,2,255])},{name:'data.json',content:'{"kind":"local","count":2}',bytes:Buffer.from('{"kind":"local","count":2}')}])('generic $name keeps its original extension and actual saveFile bytes without default format filters',async({name,content,bytes})=>{
    const selected=join(root,name);native.showSaveDialog.mockResolvedValue({canceled:false,filePath:selected});
    const result=await invoke('desktop:showSaveDialog',{defaultPath:name});expect(result).toEqual({canceled:false,filePath:selected});
    expect(native.showSaveDialog).toHaveBeenCalledWith(window,{defaultPath:name,filters:undefined});
    await expect(invoke('desktop:saveFile',{filePath:selected,content})).resolves.toMatchObject({success:true});expect(readFileSync(selected)).toEqual(bytes);
  });
  it.each([defaultFilters[0],{name:'PDF',extensions:['pdf']}])('explicit $name export caller retains its exact supplied filter',async filter=>{
    await invoke('desktop:showSaveDialog',{defaultPath:'explicit.'+filter.extensions[0],filters:[filter]});
    expect(native.showSaveDialog).toHaveBeenCalledWith(window,{defaultPath:'explicit.'+filter.extensions[0],filters:[filter]});
  });
  it('preserves empty/wildcard filters and ignores unrelated fields without granting authority', async () => {
    const filters = [{ name: 'Anything', extensions: ['*', '', 'custom'], ignored: 'legacy-extra' }];
    await invoke('desktop:showSaveDialog', { defaultPath: 'relative.md', filters, requestSource: 'agent' }, 'ignored-second-payload');
    expect(native.showSaveDialog).toHaveBeenCalledWith(window, { defaultPath: 'relative.md', filters: [{ name: 'Anything', extensions: ['*', '', 'custom'] }] });
  });
  it.each([false, 1, 'string', [], { defaultPath: 1 }, { filters: {} }, { filters: [null] }, { filters: [{ name: 1, extensions: [] }] }, { filters: [{ name: 'x', extensions: [1] }] }])('refuses malformed known payload before native dialog IO: %j', async input => {
    await expect(invoke('desktop:showSaveDialog', input)).rejects.toThrow();
    expect(native.showSaveDialog).not.toHaveBeenCalled(); expect(gate.outstanding).toBe(0);
  });
  it.each([{ canceled: true, filePath: 'ignored' }, { canceled: false, filePath: '' }, { canceled: false }])('retains empty-path cancellation ABI: %j', async result => {
    native.showSaveDialog.mockResolvedValue(result);
    await expect(invoke('desktop:showSaveDialog', {})).resolves.toEqual({ canceled: true, filePath: '' });
  });
  it('preserves the full selected path and primary-window owner', async () => {
    const selected = 'C:\\Reports\\' + 'name'.repeat(14000);
    native.showSaveDialog.mockResolvedValue({ canceled: false, filePath: selected });
    await expect(invoke('desktop:showSaveDialog', {})).resolves.toEqual({ canceled: false, filePath: selected });
    expect(native.showSaveDialog.mock.calls[0][0]).toBe(window);
  });
  it('propagates the original native dialog error and releases the shutdown token', async () => {
    const error = new Error('native-dialog-failed'); native.showSaveDialog.mockRejectedValue(error);
    await expect(invoke('desktop:showSaveDialog', {})).rejects.toBe(error); expect(gate.outstanding).toBe(0);
  });
  it('returns the existing production contract violation for malformed native output', async () => {
    vi.stubEnv('NODE_ENV', 'production'); native.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 42 });
    await expect(invoke('desktop:showSaveDialog', {})).resolves.toEqual({ ok: false, error: 'ipc_contract_violation' });
    expect(native.showSaveDialog).toHaveBeenCalledTimes(1); expect(gate.outstanding).toBe(0);
  });
  it('validates real clipboard candidates and expands directories while preserving ignored payloads', async () => {
    const folder = join(root, 'clipboard directory'); mkdirSync(folder);
    const first = join(folder, 'first.txt'), second = join(folder, 'second.txt');
    writeFileSync(first, 'first'); writeFileSync(second, 'second');
    native.clipboardReadBuffer.mockImplementation((format: string) => format === 'FileNameW'
      ? Buffer.from(`${folder}\0${first}\0${join(root, 'missing')}\0`, 'utf16le') : Buffer.alloc(0));
    const expected = [first, second].sort();
    await expect(invoke('desktop:readClipboardFilePaths')).resolves.toEqual(expected);
    await expect(invoke('desktop:readClipboardFilePaths', { ignored: true }, 'second', ['third'])).resolves.toEqual(expected);
    expect(gate.outstanding).toBe(0);
  });
  it('keeps shutdown rejection before input parsing and before either native IO', async () => {
    gate.close();
    await expect(invoke('desktop:showSaveDialog', { defaultPath: 3 })).rejects.toThrow('shutting_down');
    await expect(invoke('desktop:readClipboardFilePaths', { ignored: true })).rejects.toThrow('shutting_down');
    expect(native.showSaveDialog).not.toHaveBeenCalled(); expect(native.clipboardReadBuffer).not.toHaveBeenCalled();
    expect(gate.outstanding).toBe(0);
  });
  it.each([2, 3])('preserves event and all %s original payload references in the actual shutdown registrar', async count => {
    const payloads = [{ one: 1 }, ['two'], { three: 3 }].slice(0, count);
    const listener = vi.fn(async (_event: unknown, ..._payload: unknown[]) => 'forwarded'); registrar.handle(`fixture:${count}`, listener);
    await expect(invoke(`fixture:${count}`, ...payloads)).resolves.toBe('forwarded');
    expect(listener.mock.calls[0][0]).toBe(event);
    for (let index = 0; index < count; index++) expect(listener.mock.calls[0][index + 1]).toBe(payloads[index]);
    expect(gate.outstanding).toBe(0); gate.close();
    await expect(invoke(`fixture:${count}`, ...payloads)).rejects.toThrow('shutting_down'); expect(listener).toHaveBeenCalledTimes(1);
  });
  it('connects real registered producers to both typed and sandbox CJS preload consumers', async () => {
    const path = join(root, 'clipboard.txt'); writeFileSync(path, 'clipboard');
    native.clipboardReadBuffer.mockImplementation((format: string) => format === 'FileNameW' ? Buffer.from(`${path}\0`, 'utf16le') : Buffer.alloc(0));
    const calls: unknown[][] = [];
    const ipcRenderer = { invoke: (channel: string, ...payload: unknown[]) => { calls.push([channel, ...payload]); return invoke(channel, ...payload); }, on: () => {}, removeListener: () => {} };
    const typed = createPreloadApi(ipcRenderer as never);
    let sandbox: typeof typed | undefined;
    runInNewContext(readFileSync(join(import.meta.dirname, '../../electron/preload.cjs'), 'utf8'), {
      require: (name: string) => name === 'os' ? { userInfo: () => ({ username: 'fixture' }) } : { contextBridge: { exposeInMainWorld: (_name: unknown, api: typeof typed) => { sandbox = api; } }, ipcRenderer },
    });
    if (!sandbox) throw Error('sandbox preload did not expose API');
    for (const api of [typed, sandbox]) {
      await expect(api.showSaveDialog({ filters: null })).resolves.toEqual({ canceled: false, filePath: join(root, 'chosen.txt') });
      await expect(api.readClipboardFilePaths()).resolves.toEqual([path]);
    }
    expect(calls.map(call => call[0])).toEqual(['desktop:showSaveDialog', 'desktop:readClipboardFilePaths', 'desktop:showSaveDialog', 'desktop:readClipboardFilePaths']);
    expect(calls[0][1]).toEqual({ filters: null }); expect(calls[1]).toHaveLength(1);
  });
});
