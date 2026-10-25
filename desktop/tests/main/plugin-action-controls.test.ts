// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ exec: vi.fn(), process: vi.fn(), open: vi.fn(), openResult: undefined as unknown, electronRoot: '' }));
vi.mock('node:child_process', async load => ({ ...await load<typeof import('node:child_process')>(), execFile: ports.exec }));
vi.mock('../../electron/dependency-task.js', async load => ({ ...await load<typeof import('../../electron/dependency-task.js')>(), runDependencyProcess: ports.process }));
// Node's electron package actual export is an executable path, not native app APIs.
// Match accepted read-only IPC fixtures, with paths confined to this fixture root.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => { if (!ports.electronRoot) throw Error('owned_electron_root_required'); return ports.electronRoot; }, getLocale: () => 'zh' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => undefined },
  clipboard: { read: vi.fn(), readImage: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: (url: string) => { ports.open(url); return ports.openResult; }, openPath: vi.fn(), showItemInFolder: vi.fn() },
  systemPreferences: { getMediaAccessStatus: vi.fn(() => 'not-determined'), askForMediaAccess: vi.fn(async () => false) },
}));
import { createDesktopServices } from '../../electron/desktop-services.js';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
const roots: string[] = [], cleanups: Array<() => Promise<void>> = [];
let previousConfig: string | undefined;
beforeEach(() => { ports.exec.mockReset().mockImplementation((_c, _a, _o, done) => { done(null, '', ''); }); ports.process.mockReset().mockResolvedValue({ success: true, output: 'owned' }); ports.open.mockReset().mockReturnValue(undefined); ports.openResult = Promise.resolve(undefined); previousConfig = process.env['XIAOK_CONFIG_DIR']; resetIpcSchemaRegistryForTests(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); if (previousConfig === undefined) delete process.env['XIAOK_CONFIG_DIR']; else process.env['XIAOK_CONFIG_DIR'] = previousConfig; vi.useRealTimers(); });
async function fixture(updateArgs: string[] | ((root: string) => string[]) = []) {
  const root = mkdtempSync(join(tmpdir(), 'meeting-mutation-owned-')), data = join(root, 'data'); roots.push(root); mkdirSync(data); ports.electronRoot = root; process.env['XIAOK_CONFIG_DIR'] = join(root, 'config');
  const sdk = { start: async () => {}, stop: async () => {}, restart: async () => {}, getStatus: () => ({ running: false, port: 4400, pid: null, restartCount: 0, lastError: null }), onStatusChange: () => () => {}, request: async () => Response.json({}) };
  const service = createDesktopServices({ dataRoot: data, kswarmService: sdk as never, pluginDependencies: [{ pluginName: 'owned-plugin', dependency: { id: 'owned-dep', kind: 'native_cli', supportedPlatforms: [process.platform], displayName: 'Owned dependency', binaryCandidates: [process.execPath], update: { kind: 'command', command: process.execPath, args: typeof updateArgs === 'function' ? updateArgs(root) : updateArgs, requiresUserConfirmation: true }, health: { doctor: [process.execPath, '--owned-doctor'] } } }], pluginDependencyStatusOptions: { platform: process.platform, runCommand: async () => ({ exitCode: 0, stdout: 'owned', stderr: '' }) }, runner: async () => { throw Error('readonly_must_not_execute_task'); } });
  cleanups.push(async () => { await service.closeTaskSourceWritersForMigration(); await service.disposeMultiAgent(); });
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'authorizeDesktopInvoke'); expect(declaration).toBeDefined();
  const dirname = resolve('dist/main/desktop/electron'), frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href }, recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const sender = { mainFrame: frame, isDestroyed: () => false }, recorder = { mainFrame: recorderFrame, isDestroyed: () => false };
  const code = ts.transpileModule("let mainWindow=initialMain,meetingRecorderController=initialRecorder;\n" + declaration!.getText(ast) + "\nreturn { authorize:authorizeDesktopInvoke,setMain(v){mainWindow=v;},setRecorder(v){meetingRecorderController=v;} };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const authority = compileFunction(code, ['initialMain', 'initialRecorder', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process'])({ webContents: sender, isDestroyed: () => false }, { ownsWebContents: (v: unknown) => v === recorder }, isTrustedDesktopRendererUrl, join, dirname, { env: {} });
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate(), ipc = new ShutdownAwareIpcMain({ handle: (name, listener) => { expect(listeners.has(name)).toBe(false); listeners.set(name, listener); } }, gate, authority.authorize);
  await registerDesktopIpc(ipc, { isDestroyed: () => false, webContents: { send() {}, id: 1 } } as never, service);
  return { root, data, service, frame, recorderFrame, sender, recorder, authority, gate, listeners, invoke: (method: string, ...args: unknown[]) => Reflect.apply(listeners.get('desktop:' + method)!, undefined, [{ sender, senderFrame: frame }, ...args]) };
}



const actionMethods = ['installPlugin', 'installPluginDependency', 'updatePluginDependency', 'cancelPluginDependencyTask', 'diagnosePluginDependency', 'retryPluginComponent', 'openPluginDependencyPermissionSettings'] as const;
const input: Record<string, unknown[]> = { installPlugin: ['owned-plugin'], installPluginDependency: [{ pluginName: 'owned-plugin', dependencyId: 'owned-dep', confirmed: true }], updatePluginDependency: [{ pluginName: 'owned-plugin', dependencyId: 'owned-dep', confirmed: true }], cancelPluginDependencyTask: [{ pluginName: 'owned-plugin', dependencyId: 'owned-dep' }], diagnosePluginDependency: [{ pluginName: 'owned-plugin', dependencyId: 'owned-dep' }], retryPluginComponent: [{ componentId: 'owned-component' }], openPluginDependencyPermissionSettings: [{ permission: 'screen' }] };
const value: Record<string, unknown> = { installPlugin: { success: true }, installPluginDependency: { success: false, error: 'confirmation_required' }, updatePluginDependency: { success: true }, cancelPluginDependencyTask: { cancelling: false }, diagnosePluginDependency: { success: true, output: 'owned' }, retryPluginComponent: [], openPluginDependencyPermissionSettings: undefined };
function substitute(f: Awaited<ReturnType<typeof fixture>>, method: string, raw: unknown) {
  if (method === 'openPluginDependencyPermissionSettings') ports.openResult = raw;
  else (f.service as unknown as Record<string, unknown>)[method] = () => raw;
}
it.each(actionMethods)('qualifies original %s with exact captured tuple and exec risk metadata', async method => {
  await fixture(); expect(IPC_SCHEMA_REGISTRY.get('desktop:' + method)).toMatchObject({ payloadMode: 'tuple', rolloutRound: 35, sourceFile: 'desktop/electron/plugin-action-typed-ipc.ts' });
});
for (const method of actionMethods) for (const kind of ['normal', 'ownThen', 'ownConstructor', 'constructor', 'species', 'capturedThenCall', 'rejection'] as const) it(method + ' actual Main/nativePromise ' + kind, async () => {
  const f = await fixture(); let reads = 0; const raw = kind === 'rejection' ? Promise.reject(Error('private-producer-marker')) : Promise.resolve(value[method]);
  // Unsupported-platform permission never reaches native shell. Avoid creating an unused rejected promise.
  if (method === 'openPluginDependencyPermissionSettings' && process.platform !== 'darwin') {
    if (kind === 'rejection') raw.catch(() => {});
    await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow('unsupported_action'); expect(ports.open).not.toHaveBeenCalled(); return;
  }
  if (kind === 'constructor') Object.defineProperty(raw, 'constructor', { configurable: true, get() { reads++; return Promise; } });
  if (kind === 'ownThen') Object.defineProperty(raw, 'then', { configurable: true, get() { reads++; throw Error('own_then_read'); } });
  if (kind === 'ownConstructor') Object.defineProperty(raw, 'constructor', { configurable: true, value: Promise });
  substitute(f, method, raw); const species = Object.getOwnPropertyDescriptor(Promise, Symbol.species)!, then = Promise.prototype.then, call = Object.getOwnPropertyDescriptor(then, 'call');
  let pending: unknown, failure: unknown, reply: unknown;
  try {
    if (kind === 'species') Object.defineProperty(Promise, Symbol.species, { configurable: true, get() { reads++; return Promise; } });
    if (kind === 'capturedThenCall') Object.defineProperty(then, 'call', { configurable: true, get() { reads++; return Function.prototype.call; } });
    try { pending = f.invoke(method, ...input[method]!); } catch (error) { failure = error; }
  } finally { Object.defineProperty(Promise, Symbol.species, species); if (call) Object.defineProperty(then, 'call', call); else Reflect.deleteProperty(then, 'call'); }
  if (!failure) try { reply = await pending; } catch (error) { failure = error; }
  expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
  if (kind === 'constructor' || kind === 'species') expect((failure as Error)?.message).toBe('plugin_action_projection_unavailable');
  else if (kind === 'rejection') { expect((failure as Error)?.message).toBe(method === 'openPluginDependencyPermissionSettings' ? 'plugin_permission_settings_failed' : 'plugin_action_failed'); }
  else { expect(failure).toBeUndefined(); expect(reply).toEqual(value[method]); }
});
it('permission species rejection prevents the real OS producer and leaves no unobserved nested promise', async () => {
  if (process.platform !== 'darwin') return;
  const f = await fixture(), species = Object.getOwnPropertyDescriptor(Promise, Symbol.species)!;
  let reads = 0, pending: unknown;
  try {
    Object.defineProperty(Promise, Symbol.species, { configurable: true, get() { reads++; return Promise; } });
    pending = f.invoke('openPluginDependencyPermissionSettings', { permission: 'screen' });
  } finally { Object.defineProperty(Promise, Symbol.species, species); }
  await expect(pending).rejects.toThrow('plugin_action_projection_unavailable');
  expect(reads).toBe(0);
  expect(ports.open).not.toHaveBeenCalled();
  expect(f.gate.outstanding).toBe(0);
});
it.each(actionMethods)('%s rejects extra/source/root and getter payload before the real service/OS', async method => {
  const f = await fixture(); let reads = 0;
  if (method !== 'openPluginDependencyPermissionSettings') substitute(f, method, Promise.resolve(value[method]));
  const payload = Object.defineProperty({}, 'pluginName', { enumerable: true, get() { reads++; return 'owned-plugin'; } });
  await expect(async () => f.invoke(method, payload)).rejects.toThrow('plugin_action_input_invalid');
  await expect(async () => f.invoke(method, ...input[method]!, { requestSource: 'user', root: 'forged' })).rejects.toThrow('plugin_action_input_invalid');
  expect(reads).toBe(0); expect(ports.open).not.toHaveBeenCalled(); expect(ports.exec).not.toHaveBeenCalled(); expect(ports.process).not.toHaveBeenCalled();
});
it.each(actionMethods)('%s captures unknown ACK and output getter/serializer before any reads', async method => {
  if (method === 'openPluginDependencyPermissionSettings' && process.platform !== 'darwin') return;
  const f = await fixture(); let reads = 0;
  const bad = method === 'openPluginDependencyPermissionSettings' ? { forged: true } : method === 'retryPluginComponent' ? [Object.defineProperty({}, 'connected', { enumerable: true, get() { reads++; return true; } })] : Object.defineProperty({ success: true }, 'error', { enumerable: true, get() { reads++; return 'private-marker'; } });
  substitute(f, method, Promise.resolve(bad)); await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow('plugin_action_projection_unavailable'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
for (const method of actionMethods) for (const kind of ['unknown', 'old-main', 'subframe', 'bad-url', 'retired-recorder']) it(method + ' source-before-input ' + kind, async () => {
  const f = await fixture(); let reads = 0;
  if (kind === 'old-main') f.authority.setMain({ isDestroyed: () => false, webContents: {} });
  if (kind === 'bad-url') f.frame.url = 'https://untrusted.invalid/';
  if (kind === 'retired-recorder') f.authority.setRecorder({ ownsWebContents: () => false });
  const sender = kind === 'unknown' ? { ...f.sender } : kind === 'retired-recorder' ? f.recorder : f.sender;
  const frame = kind === 'subframe' ? { ...f.frame } : kind === 'retired-recorder' ? f.recorderFrame : f.frame;
  const payload = Object.defineProperty({}, 'field', { enumerable: true, get() { reads++; return 'owned'; } });
  await expect(async () => Reflect.apply(f.listeners.get('desktop:' + method)!, undefined, [{ sender, senderFrame: frame }, payload])).rejects.toThrow('desktop_user_sender_forbidden');
  expect(reads).toBe(0); expect(ports.exec).not.toHaveBeenCalled(); expect(ports.process).not.toHaveBeenCalled(); expect(ports.open).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
});
it.each(actionMethods)('%s keeps the original owned Recorder admission and truthful result', async method => {
  const f = await fixture(); substitute(f, method, Promise.resolve(value[method])); const invoke = () => Reflect.apply(f.listeners.get('desktop:' + method)!, undefined, [{ sender: f.recorder, senderFrame: f.recorderFrame }, ...input[method]!]);
  if (method === 'openPluginDependencyPermissionSettings' && process.platform !== 'darwin') await expect(invoke).rejects.toThrow('unsupported_action'); else expect(await invoke()).toEqual(value[method]); expect(f.gate.outstanding).toBe(0);
});
it('real installPlugin retains original trim/ASCII-name gate and original 120s executable argv, with fixed secret-free failure', async () => {
  const f = await fixture(); expect(await f.invoke('installPlugin', ' owned-plugin ')).toEqual({ success: true }); expect(ports.exec).toHaveBeenCalledWith('xiaok', ['plugin', 'install', 'owned-plugin'], { timeout: 120000 }, expect.any(Function));
  let reads = 0; ports.exec.mockImplementation((_c, _a, _o, done) => done(Object.defineProperty({}, 'message', { get() { reads++; return 'private-error-marker'; } }), '', 'private-stderr-marker'));
  expect(await f.invoke('installPlugin', 'owned-plugin')).toEqual({ success: false, error: 'plugin_install_failed' }); expect(reads).toBe(0);
});
it.each(['installPlugin', 'diagnosePluginDependency', 'retryPluginComponent', 'cancelPluginDependencyTask', 'installPluginDependency', 'updatePluginDependency'] as const)('real %s enforces direct service user source without IPC', async method => {
  const f = await fixture(); let reads = 0;
  for (const source of [undefined, 'agent', 'scheduler']) {
    const call = () => method === 'installPlugin' ? Reflect.apply(f.service.installPlugin, f.service, ['owned-plugin', source]) : method === 'diagnosePluginDependency' ? Reflect.apply(f.service.diagnosePluginDependency, f.service, [input[method]![0], source]) : Reflect.apply((f.service as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!, f.service, [{ ...(input[method]![0] as object), requestSource: source }]);
    if (method === 'installPluginDependency' || method === 'updatePluginDependency') expect(await call()).toMatchObject({ success: false, error: 'request_source_user_required' }); else await expect(call).rejects.toThrow('request_source_user_required');
  }
  const accessor = Object.defineProperty({ pluginName: 'owned-plugin', dependencyId: 'owned-dep', componentId: 'owned-component' }, 'requestSource', { enumerable: true, get() { reads++; return 'user'; } });
  if (['retryPluginComponent', 'cancelPluginDependencyTask', 'installPluginDependency', 'updatePluginDependency'].includes(method)) await expect(async () => Reflect.apply((f.service as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!, f.service, [accessor])).rejects.toThrow('plugin_action_input_invalid');
  expect(reads).toBe(0); expect(ports.exec).not.toHaveBeenCalled(); expect(ports.process).not.toHaveBeenCalled();
});
it('real task owner retains held update token through cancellation ACK and original shutdown deadline until actual process settle', async () => {
  const f = await fixture(); let finish!: (v: unknown) => void; ports.process.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const update = f.invoke('updatePluginDependency', ...input.updatePluginDependency!); await vi.waitFor(() => expect(ports.process).toHaveBeenCalledTimes(1)); expect(f.gate.outstanding).toBe(1);
  let result: unknown;
  try {
    expect(await f.invoke('cancelPluginDependencyTask', ...input.cancelPluginDependencyTask!)).toEqual({ cancelling: true }); expect(f.gate.outstanding).toBe(1);
    expect(await f.invoke('updatePluginDependency', ...input.updatePluginDependency!)).toMatchObject({ success: false, error: 'dependency_task_busy' });
    vi.useFakeTimers(); const draining = f.gate.drain(5000); await vi.advanceTimersByTimeAsync(5001); expect(await draining).toBe(false); expect(f.gate.outstanding).toBe(1);
  } finally { finish({ success: false, error: 'dependency_cancelled' }); result = await update; }
  expect(result).toMatchObject({ success: false, error: 'dependency_cancelled' }); expect(f.gate.outstanding).toBe(0); expect(await f.invoke('cancelPluginDependencyTask', ...input.cancelPluginDependencyTask!)).toEqual({ cancelling: false });
});
it('permission-settings OS promise is held until settle and unknown ACK is rejected, never opening caller URL', async () => {
  const f = await fixture(); if (process.platform !== 'darwin') { await expect(async () => f.invoke('openPluginDependencyPermissionSettings', { permission: 'screen' })).rejects.toThrow('unsupported_action'); return; }
  let finish!: (v: unknown) => void; ports.openResult = new Promise(resolve => { finish = resolve; }); const opening = f.invoke('openPluginDependencyPermissionSettings', { permission: 'screen' }); await Promise.resolve(); expect(f.gate.outstanding).toBe(1);
  expect(ports.open).toHaveBeenCalledExactlyOnceWith('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); finish(undefined); await opening; expect(f.gate.outstanding).toBe(0);
});

it.each(actionMethods)('%s retains the original closed-gate rejection before payload or service work', async method => {
  const f = await fixture(); f.gate.close(); let reads = 0; const payload = Object.defineProperty({}, 'field', { enumerable: true, get() { reads++; return 'owned'; } }); await expect(async () => f.invoke(method, payload)).rejects.toThrow('shutting_down'); expect(reads).toBe(0); expect(ports.exec).not.toHaveBeenCalled(); expect(ports.process).not.toHaveBeenCalled(); expect(ports.open).not.toHaveBeenCalled();
});
it('actual dependency update and diagnose project hostile process errors without invoking message getters', async () => {
  const f = await fixture(); let reads = 0; const error = Object.defineProperty({}, 'message', { get() { reads++; return 'private-process-marker'; } }); ports.process.mockRejectedValue(error);
  expect(await f.invoke('updatePluginDependency', ...input.updatePluginDependency!)).toMatchObject({ success: false, error: 'plugin_dependency_operation_failed' }); await expect(async () => f.invoke('diagnosePluginDependency', ...input.diagnosePluginDependency!)).rejects.toThrow('plugin_action_failed'); expect(reads).toBe(0);
});
it('direct permission domain guard default-denies before OS dispatch, independent of platform', async () => {
  const moduleFile = new URL('../../electron/plugin-action-service.ts', import.meta.url); if (!existsSync(moduleFile)) throw Error('permission_settings_service_missing_in_actual_production');
  const helperPath = '../../electron/plugin-action-service.ts'; const module = await import(helperPath);
  for (const source of [undefined, 'agent', 'scheduler']) await expect(async () => module.openPluginPermissionSettings({ permission: 'screen' }, source, ports.open)).rejects.toThrow('request_source_user_required'); expect(ports.open).not.toHaveBeenCalled();
});

it.each(actionMethods)('%s held original IPC token survives 5s deadline and releases only on producer settlement', async method => {
  const f = await fixture(); if (method === 'openPluginDependencyPermissionSettings' && process.platform !== 'darwin') { await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow('unsupported_action'); return; }
  let finish!: (value: unknown) => void; const held = new Promise(resolve => { finish = resolve; }); substitute(f, method, held); vi.useFakeTimers(); const operation = f.invoke(method, ...input[method]!); await Promise.resolve(); expect(f.gate.outstanding).toBe(1);
  try { f.gate.close(); const drain = f.gate.drain(5000); await vi.advanceTimersByTimeAsync(5001); expect(await drain).toBe(false); expect(f.gate.outstanding).toBe(1); await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow('shutting_down'); }
  finally { finish(value[method]); await operation; } expect(f.gate.outstanding).toBe(0);
});
it.skipIf(process.platform === 'win32')('physical owned Node child holds the real dependency IPC token after cancel ACK until close, never killing by name', async () => {
  const actual = await vi.importActual<typeof import('../../electron/dependency-task.js')>('../../electron/dependency-task.js');
  const native = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const nonce = randomUUID();
  const receipt = { nonce, nativeCloseObserved: false, markerVerified: false, ownedPID: 0, ownedPGID: 0, groupVerifiedBeforeCancel: false,
    cleanupIdentityVerified: false, sentOwnedGroupKill: false, settledInFinally: false,
    pidAfter: null as { gone: boolean; code: string } | null, groupAfter: null as { gone: boolean; code: string } | null, cleanupErrors: [] as string[] };
  const f = await fixture(root => ['-e', "const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(" + JSON.stringify(join(root, 'owned-child.pid')) + ",String(process.pid));fs.writeFileSync(" + JSON.stringify(join(root, 'owned-child-marker.json')) + ",JSON.stringify({nonce:" + JSON.stringify(nonce) + ",pid:process.pid,ppid:process.ppid,executable:process.execPath}));setInterval(()=>{},1000)"]);
  ports.process.mockImplementation(async (command: string, args: string[], options: Parameters<typeof actual.runDependencyProcess>[2]) => {
    const result = await actual.runDependencyProcess(command, args, options);
    // Production runDependencyProcess resolves only from its native 'close' listener.
    receipt.nativeCloseObserved = true; return result;
  });
  const probe = (id: number): { gone: boolean; code: string } => {
    try { process.kill(id, 0); return { gone: false, code: 'alive' }; }
    catch (error) { const code = Object.getOwnPropertyDescriptor(error as object, 'code')?.value; return { gone: code === 'ESRCH', code: typeof code === 'string' ? code : 'unknown' }; }
  };
  const verifyLiveIdentity = () => {
    if (!receipt.markerVerified || !receipt.groupVerifiedBeforeCancel || receipt.ownedPID <= 0 || receipt.ownedPGID !== receipt.ownedPID) return false;
    try {
      const ids = native.execFileSync('ps', ['-o', 'pgid=,ppid=', '-p', String(receipt.ownedPID)], { encoding: 'utf8', timeout: 1000 }).trim().split(/\s+/).map(Number);
      const command = native.execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(receipt.ownedPID)], { encoding: 'utf8', timeout: 1000 });
      return ids[0] === receipt.ownedPGID && ids[1] === process.pid && command.includes(nonce) && command.includes(join(f.root, 'owned-child-marker.json'));
    } catch { return false; }
  };
  const pidFile = join(f.root, 'owned-child.pid'); const operation = f.invoke('updatePluginDependency', ...input.updatePluginDependency!); let settled = false; let result: unknown;
  try {
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 3000 });
    const markerFile = join(f.root, 'owned-child-marker.json');
    await vi.waitFor(() => expect(existsSync(markerFile)).toBe(true), { timeout: 3000 });
    const marker = JSON.parse(readFileSync(markerFile, 'utf8'));
    expect(marker.nonce).toBe(nonce); expect(marker.executable).toBe(process.execPath); expect(marker.ppid).toBe(process.pid);
    const markedPID = Number(readFileSync(pidFile, 'utf8')); expect(marker.pid).toBe(markedPID); expect(markedPID).toBeGreaterThan(0);
    receipt.ownedPID = markedPID; receipt.markerVerified = true;
    const pgid = Number(native.execFileSync('ps', ['-o', 'pgid=', '-p', String(markedPID)], { encoding: 'utf8', timeout: 1000 }).trim());
    expect(pgid).toBe(markedPID); receipt.ownedPGID = pgid; receipt.groupVerifiedBeforeCancel = true;
    expect(await f.invoke('cancelPluginDependencyTask', ...input.cancelPluginDependencyTask!)).toEqual({ cancelling: true }); expect(f.gate.outstanding).toBe(1);
    const statuses = await f.invoke('listPluginDependencyStatuses'); expect(statuses[0].task.state).toBe('cancelling');
    result = await operation; settled = true; expect(result).toMatchObject({ success: false, error: 'dependency_cancelled' }); expect(f.gate.outstanding).toBe(0);
    const pid = Number(readFileSync(pidFile, 'utf8')); expect(pid).toBeGreaterThan(0); expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    try {
      if (!settled) await f.invoke('cancelPluginDependencyTask', ...input.cancelPluginDependencyTask!).catch(() => {});
      if (receipt.ownedPID > 0 && !probe(receipt.ownedPID).gone) {
        receipt.cleanupIdentityVerified = verifyLiveIdentity();
        // Never kill an unmarked/reused PID or PGID; no process-name search.
        if (receipt.cleanupIdentityVerified) {
          try { process.kill(-receipt.ownedPGID, 'SIGKILL'); receipt.sentOwnedGroupKill = true; }
          catch (error) { receipt.cleanupErrors.push(Object.getOwnPropertyDescriptor(error as object, 'code')?.value ?? 'owned_group_kill_unknown'); }
        } else receipt.cleanupErrors.push('live_owned_identity_not_verified');
      }
      await operation.catch(() => {}); receipt.settledInFinally = true;
      if (receipt.markerVerified && receipt.groupVerifiedBeforeCancel) {
        receipt.pidAfter = probe(receipt.ownedPID); receipt.groupAfter = probe(-receipt.ownedPGID);
      }
    } finally {
      // Persist before afterEach removes scratch; raw run log retains this JSON even if business assertion fails.
      writeFileSync(join(f.root, 'owned-child-reap-receipt.json'), JSON.stringify(receipt, null, 2));
      console.info('PLUGIN7_OWNED_CHILD_REAP=' + JSON.stringify(receipt));
    }
    // These run independently in finally, including when the original dependency_cancelled assertion fails.
    expect(receipt.markerVerified).toBe(true); expect(receipt.groupVerifiedBeforeCancel).toBe(true);
    expect(receipt.nativeCloseObserved).toBe(true); expect(receipt.settledInFinally).toBe(true);
    expect(receipt.pidAfter).toEqual({ gone: true, code: 'ESRCH' });
    expect(receipt.groupAfter).toEqual({ gone: true, code: 'ESRCH' });
  }
}, 10000);
