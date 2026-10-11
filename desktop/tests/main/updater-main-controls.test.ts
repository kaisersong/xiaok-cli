// @vitest-environment node
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { registerUpdaterIpc } from '../../electron/updater-typed-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
const methods = ['getUpdateStatus', 'checkForUpdates', 'quitAndInstall'];
function fixture() {
  resetIpcSchemaRegistryForTests();
  const listeners = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
  const mainWindow = { webContents: {} };
  const status = { checking: false, available: true, downloading: false, downloaded: true, progress: 100, version: 'owned-next' };
  const getUpdateStatus = vi.fn(() => status), checkForUpdates = vi.fn(async (_context: unknown) => undefined);
  const updaterHandoff = { begin: vi.fn((_context: unknown) => ({ status: 'pending' })), projection: vi.fn(() => ({ status: 'install_handoff_pending' })) };
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let authority = '';
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'isMainWindowSender') authority = 'const ' + node.getText(ast) + ';'; ts.forEachChild(node, visit); }; visit(ast);
  const start = source.indexOf('  // Register update IPC handlers'), end = source.indexOf('  let globalBackgroundAutoRunEnabled', start);
  expect(authority).not.toBe(''); expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const js = ts.transpileModule(authority + '\n' + source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const registrar = { handle(channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => unknown) { listeners.set(channel, listener); } };
  // Main literals belong to the actual host realm; a separate VM realm changes their data prototype.
  compileFunction(js, ['mainWindow', 'getUpdateStatus', 'checkForUpdates', 'updaterHandoff', 'app', 'registerUpdaterIpc', 'shutdownAwareIpc'])(mainWindow, getUpdateStatus, checkForUpdates, updaterHandoff, { getVersion: () => 'owned-current' }, registerUpdaterIpc, registrar);
  expect(listeners.size).toBe(3);
  return { mainWindow, status, getUpdateStatus, checkForUpdates, updaterHandoff, invoke: (method: string, sender: unknown, ...args: unknown[]) => listeners.get(`desktop:${method}`)!({ sender }, ...args) };
}
describe('actual Main updater three registrations', () => {
  it('preserves status, void check and the complete synchronous handoff DTO', async () => {
    const f = fixture();
    expect(await f.invoke(methods[0]!, f.mainWindow.webContents)).toMatchObject({ ...f.status, currentVersion: 'owned-current' });
    expect(await f.invoke(methods[1]!, f.mainWindow.webContents)).toBeUndefined();
    expect(f.checkForUpdates).toHaveBeenCalledExactlyOnceWith({ requestSource: 'user' });
    expect(await f.invoke(methods[2]!, f.mainWindow.webContents)).toEqual({ status: 'pending', projection: { status: 'install_handoff_pending' } });
    expect(f.updaterHandoff.begin).toHaveBeenCalledExactlyOnceWith({ requestSource: 'user' });
  });
  it.each(methods)('authenticates %s before an unauthorized payload getter', async method => {
    const f = fixture(); let reads = 0;
    const raw = Object.defineProperty({}, 'grant', { enumerable: true, get() { reads++; throw Error('must_not_read'); } });
    await expect(async () => f.invoke(method, {}, raw)).rejects.toThrow('updater_request_source_forbidden');
    expect(reads).toBe(0); expect(f.getUpdateStatus).not.toHaveBeenCalled(); expect(f.checkForUpdates).not.toHaveBeenCalled(); expect(f.updaterHandoff.begin).not.toHaveBeenCalled();
  });
  it.each(methods)('rejects extra transport input for %s before producer effects', async method => {
    const f = fixture();
    await expect(f.invoke(method, f.mainWindow.webContents, {})).rejects.toThrow('updater_input_invalid');
    expect(f.getUpdateStatus).not.toHaveBeenCalled(); expect(f.checkForUpdates).not.toHaveBeenCalled(); expect(f.updaterHandoff.begin).not.toHaveBeenCalled();
  });
  it('rejects malformed reader data without overwriting private owner status', async () => {
    const f = fixture(); f.status.progress = Number.NaN;
    await expect(f.invoke(methods[0]!, f.mainWindow.webContents)).rejects.toThrow('updater_projection_unavailable');
    expect(Number.isNaN(f.status.progress)).toBe(true);
  });
});
