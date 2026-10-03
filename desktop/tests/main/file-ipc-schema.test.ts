import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ openPath: vi.fn(async () => ''), send: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/test' }, clipboard: {}, dialog: {}, shell: { openPath: mocks.openPath } }));
import { registerDesktopIpc } from '../../electron/ipc.js';
import { IPC_SCHEMA_REGISTRY } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain } from '../../electron/shutdown-aware-ipc-main.js';
import { createPreloadApi } from '../../electron/preload-api.js';
describe('real file IPC schema rollout', () => {
    let root: string;
    let handlers: Map<string, Function>;
    let gate: DesktopShutdownGate;
    beforeEach(async () => { root = mkdtempSync(join(tmpdir(), 'xiaok-file-schema-')); handlers = new Map(); gate = new DesktopShutdownGate(); const registrar = new ShutdownAwareIpcMain({ handle: (c, h) => { handlers.set(c, h); } }, gate); await registerDesktopIpc(registrar, { isDestroyed: () => false, webContents: { send: mocks.send } } as never, { getDataRoot: () => join(root, 'data') } as never); mocks.openPath.mockClear(); }, 60000);
    afterEach(() => rmSync(root, { recursive: true, force: true }));
    it('registers all eight same-domain channels in the existing registry', () => { for (const name of ['openFileInSystemApp', 'readFileContent', 'saveFile', 'artifactBackup', 'artifactRevert', 'artifactCleanup', 'artifactWatch', 'artifactUnwatch'])
        expect(IPC_SCHEMA_REGISTRY.has('desktop:' + name)).toBe(true); });
    it.each([null, { filePath: 1 }, { filePath: 'relative' }, { filePath: '/tmp/a\0b' }, { filePath: '/tmp/a', extra: 'authority' }])('refuses invalid file object before open IO: %j', async (raw) => { await expect(handlers.get('desktop:openFileInSystemApp')!({}, raw)).rejects.toThrow(); expect(mocks.openPath).not.toHaveBeenCalled(); });
    it('save rejects non-string content and purpose bypass before mutation', async () => { const path = join(root, 'keep.txt'); writeFileSync(path, 'keep'); for (const input of [{ filePath: path, content: 1 }, { filePath: path, content: 'overwrite', purpose: 'bypass' }, { filePath: path, content: 'overwrite', requestSource: 'agent' }])
        await expect(handlers.get('desktop:saveFile')!({}, input)).rejects.toThrow(); expect(readFileSync(path, 'utf8')).toBe('keep'); });
    it.each(['artifactBackup', 'artifactRevert', 'artifactCleanup', 'artifactWatch', 'artifactUnwatch'])('rejects wrong wire argument on sibling %s', async (name) => { await expect(handlers.get('desktop:' + name)!({}, { filePath: join(root, 'x') })).rejects.toThrow(); });
    it('keeps legal text read/write/open compatible and shutdown blocks IO', async () => { const path = join(root, 'hello.txt'); await expect(handlers.get('desktop:saveFile')!({}, { filePath: path, content: '中文' })).resolves.toEqual({ success: true }); await expect(handlers.get('desktop:readFileContent')!({}, { filePath: path })).resolves.toEqual({ content: '中文' }); await expect(handlers.get('desktop:openFileInSystemApp')!({}, { filePath: path })).resolves.toEqual({ ok: true }); gate.close(); await expect(handlers.get('desktop:saveFile')!({}, { filePath: path, content: 'bad' })).rejects.toThrow('shutting_down'); expect(readFileSync(path, 'utf8')).toBe('中文'); });
    it('preserves null when backing up a missing absolute path', async () => {
        await expect(handlers.get('desktop:artifactBackup')!({}, join(root,'missing.html'))).resolves.toBeNull();
    });
    it('typed and real sandbox preload preserve identical payloads', async () => { const calls: unknown[][] = []; const invoke = (...args: unknown[]) => { calls.push(args); return Promise.resolve({ ok: true }); }; const api = createPreloadApi({ invoke, on: () => { }, removeListener: () => { } } as never); let sandbox: any; runInNewContext(readFileSync(join(import.meta.dirname, '../../electron/preload.cjs'), 'utf8'), { require: (name: string) => name === 'os' ? { userInfo: () => ({ username: 'fixture' }) } : ({ contextBridge: { exposeInMainWorld: (_: unknown, x: unknown) => { sandbox = x; } }, ipcRenderer: { invoke, on: () => { }, removeListener: () => { } } }) }); for (const impl of [api, sandbox]) {
        await impl.openFileInSystemApp('/tmp/a');
        await impl.readFileContent('/tmp/a');
        await impl.saveFile({ filePath: '/tmp/a', content: 'x' });
    } expect(calls.slice(0, 3)).toEqual(calls.slice(3)); });
});
