// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { registerIpcHandler, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { filePathInput, readFileResult } from '../../electron/file-ipc-schemas.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(devServer?: string) {
  resetIpcSchemaRegistryForTests();
  const root = mkdtempSync(join(tmpdir(), 'xiaok-invoke-admission-')); roots.push(root);
  const path = join(root, 'owned-surrogate.json'), contents = '{"owned":"surrogate-only"}'; writeFileSync(path, contents);
  const dirname = resolve('dist/main/desktop/electron'), rendererFile = join(dirname, '../../../renderer/index.html');
  const trustedUrl = devServer ?? pathToFileURL(rendererFile).href;
  const mainFrame = { url: trustedUrl }, recorderFrame = { url: trustedUrl + '#/meeting-recorder/owned' };
  const mainSender = { mainFrame, isDestroyed: () => false }, recorderSender = { mainFrame: recorderFrame, isDestroyed: () => false };
  const mainWindow = { webContents: mainSender, isDestroyed: () => false };
  const owned = new Set<unknown>([recorderSender]);
  const recorderController = { ownsWebContents: (sender: unknown) => owned.has(sender) };
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const declarations: string[] = [];
  for (const name of ['mainWindow', 'meetingRecorderController', 'shutdownAwareIpc']) {
    const statement = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name));
    expect(statement, name).toBeDefined(); declarations.push(statement!.getText(ast));
  }
  const admission = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  const code = ts.transpileModule([
    ...declarations, admission?.getText(ast) ?? '',
    'return { ipc: shutdownAwareIpc, setWindows(main, recorder) { mainWindow = main; meetingRecorderController = recorder; } };',
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const production = compileFunction(code, ['ipcMain', 'desktopShutdownGate', 'ShutdownAwareIpcMain', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process'])(
    { handle: (channel: string, listener: IpcHandlerListener) => listeners.set(channel, listener) }, gate, ShutdownAwareIpcMain, isTrustedDesktopRendererUrl, join, dirname, { env: { XIAOK_DESKTOP_DEV_SERVER: devServer } },
  );
  production.setWindows(mainWindow, recorderController);
  const ipcSource = readFileSync(new URL('../../electron/ipc.ts', import.meta.url), 'utf8');
  const ipcAst = ts.createSourceFile('ipc.ts', ipcSource, ts.ScriptTarget.Latest, true);
  let wrapper = '', reader = '', mime = '', map = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ipcAst) === 'fileHandler') wrapper = 'const ' + node.getText(ipcAst) + ';';
    if (ts.isVariableDeclaration(node) && node.name.getText(ipcAst) === 'DATA_URL_MIME_BY_EXTENSION') map = 'const ' + node.getText(ipcAst) + ';';
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'getDataUrlMimeType') mime = node.getText(ipcAst);
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ipcAst) === 'fileHandler' && node.expression.arguments[0]?.getText(ipcAst) === "'desktop:readFileContent'") reader = node.getText(ipcAst);
    ts.forEachChild(node, visit);
  }; visit(ipcAst);
  for (const selected of [wrapper, reader, mime, map]) expect(selected).not.toBe('');
  const read = vi.fn((...args: Parameters<typeof readFile>) => Reflect.apply(readFile, undefined, args));
  const readerCode = ts.transpileModule([map, mime, wrapper, reader].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  compileFunction(readerCode, ['ipcMain', 'registerIpcHandler', 'filePathInput', 'readFileResult', 'extname', 'readFile', 'log'])(production.ipc, registerIpcHandler, filePathInput, readFileResult, extname, read, () => {});
  const invoke = (channel: string, event: unknown, ...args: unknown[]) => Reflect.apply(listeners.get(channel)!, undefined, [event, ...args]);
  return { root, path, contents, production, gate, read, listeners, invoke, mainFrame, recorderFrame, mainSender, recorderSender, mainWindow, recorderController, owned, trustedUrl };
}
describe('actual Main-bound invoke admission across production file and future channels', () => {
  it.each([undefined, 'http://127.0.0.1:5173/'])('preserves owned Main and Recorder reads with exact renderer/hash URL (%s)', async devServer => {
    const f = fixture(devServer);
    for (const sender of [f.mainSender, f.recorderSender]) expect(await f.invoke('desktop:readFileContent', { sender, senderFrame: sender.mainFrame }, { filePath: f.path })).toEqual({ content: f.contents });
    expect(f.read).toHaveBeenCalledTimes(2); expect(f.gate.outstanding).toBe(0);
  });
  it.each(['unknown', 'no-window', 'replaced-main', 'retired-recorder', 'destroyed', 'missing-frame', 'subframe', 'other-file', 'query', 'other-dev-page'])('rejects %s before payload getter or real owned-file read', async mode => {
    const f = fixture(mode === 'other-dev-page' ? 'http://127.0.0.1:5173/' : undefined);
    let sender = f.mainSender, senderFrame: unknown = f.mainFrame;
    if (mode === 'unknown') sender = { mainFrame: f.mainFrame, isDestroyed: () => false };
    if (mode === 'no-window') f.production.setWindows(null, null);
    if (mode === 'replaced-main') f.production.setWindows({ webContents: {}, isDestroyed: () => false }, f.recorderController);
    if (mode === 'retired-recorder') { sender = f.recorderSender; senderFrame = f.recorderFrame; f.owned.clear(); }
    if (mode === 'destroyed') sender.isDestroyed = () => true;
    if (mode === 'missing-frame') senderFrame = null;
    if (mode === 'subframe') senderFrame = { url: f.trustedUrl };
    if (mode === 'other-file') f.mainFrame.url = pathToFileURL(join(f.root, 'untrusted.html')).href;
    if (mode === 'query') f.mainFrame.url += '?owned=forged';
    if (mode === 'other-dev-page') f.mainFrame.url = 'http://127.0.0.1:5173/untrusted';
    let getterReads = 0; const raw = Object.defineProperty({}, 'filePath', { enumerable: true, get() { getterReads++; return f.path; } });
    await expect(f.invoke('desktop:readFileContent', { sender, senderFrame }, raw)).rejects.toThrow('desktop_user_sender_forbidden');
    expect(getterReads).toBe(0); expect(f.read).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
  });
  it('actually blocks an unauthorized valid absolute path rather than merely rejecting a getter shape', async () => {
    const f = fixture(), sender = { mainFrame: f.mainFrame, isDestroyed: () => false };
    await expect(f.invoke('desktop:readFileContent', { sender, senderFrame: f.mainFrame }, { filePath: f.path })).rejects.toThrow('desktop_user_sender_forbidden');
    expect(f.read).not.toHaveBeenCalled(); expect(readFileSync(f.path, 'utf8')).toBe(f.contents);
  });
  it('observes fresh replacement Main and closes the old sender without a second raw owner', async () => {
    const f = fixture(), frame = { url: f.trustedUrl }, sender = { mainFrame: frame, isDestroyed: () => false };
    f.production.setWindows({ webContents: sender, isDestroyed: () => false }, f.recorderController);
    await expect(f.invoke('desktop:readFileContent', { sender: f.mainSender, senderFrame: f.mainFrame }, { filePath: f.path })).rejects.toThrow('desktop_user_sender_forbidden');
    expect(await f.invoke('desktop:readFileContent', { sender, senderFrame: frame }, { filePath: f.path })).toEqual({ content: f.contents });
  });
  it('guards newly registered sibling channels with no hand-maintained channel allowlist', async () => {
    const f = fixture(), effect = vi.fn(() => 'owned-result');
    for (const name of ['saveFile', 'openFileInSystemApp', 'artifactBackup', 'artifactRevert', 'artifactCleanup', 'artifactWatch', 'artifactUnwatch', 'readClipboardFilePaths', 'showSaveDialog', 'futureOwnedSibling']) f.production.ipc.handle('desktop:' + name, effect);
    const sender = { mainFrame: f.mainFrame, isDestroyed: () => false };
    for (const channel of f.listeners.keys()) await expect(f.invoke(channel, { sender, senderFrame: f.mainFrame }, { filePath: f.path })).rejects.toThrow('desktop_user_sender_forbidden');
    expect(effect).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
  });
  it('keeps an already admitted held handler physically covered after the window disappears', async () => {
    const f = fixture(); let finish!: () => void;
    f.production.ipc.handle('desktop:owned-held', () => new Promise<void>(resolve => { finish = resolve; }));
    const pending = f.invoke('desktop:owned-held', { sender: f.mainSender, senderFrame: f.mainFrame });
    expect(f.gate.outstanding).toBe(1); f.production.setWindows(null, null); f.gate.close();
    expect(await f.gate.drain(1)).toBe(false); finish(); await pending;
    expect(f.gate.outstanding).toBe(0); expect(await f.gate.drain(1)).toBe(true);
  });
  it('preserves shutting_down priority and performs no late IO', async () => {
    const f = fixture(); f.gate.close();
    await expect(f.invoke('desktop:readFileContent', {}, { filePath: f.path })).rejects.toThrow('shutting_down');
    expect(f.read).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
  });
});
describe('actual shutdown owner synchronous admission contract', () => {
  it.each([false, true, null, {}, Promise.resolve(undefined)])('rejects a nonvoid admission return before listener (%s)', async value => {
    const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate(), effect = vi.fn();
    const ipc = Reflect.construct(ShutdownAwareIpcMain, [{ handle: (channel: string, listener: IpcHandlerListener) => listeners.set(channel, listener) }, gate, () => value]);
    ipc.handle('desktop:nonvoid', effect);
    await expect(Reflect.apply(listeners.get('desktop:nonvoid')!, undefined, [{}])).rejects.toThrow('desktop_invoke_authority_invalid');
    expect(effect).not.toHaveBeenCalled(); expect(gate.outstanding).toBe(0);
  });
  it('releases the original token on admission throw and never invokes the listener', async () => {
    const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate(), effect = vi.fn(), failure = Error('owned_denial');
    const ipc = Reflect.construct(ShutdownAwareIpcMain, [{ handle: (channel: string, listener: IpcHandlerListener) => listeners.set(channel, listener) }, gate, () => { throw failure; }]);
    ipc.handle('desktop:throw', effect);
    await expect(Reflect.apply(listeners.get('desktop:throw')!, undefined, [{}])).rejects.toBe(failure);
    expect(effect).not.toHaveBeenCalled(); expect(gate.outstanding).toBe(0);
  });
});
