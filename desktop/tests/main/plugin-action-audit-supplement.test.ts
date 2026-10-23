// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
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

// These supplement the frozen138. They do not replace or relax any original case.
const fullStatus = { pluginName: 'owned-plugin', dependencyId: 'owned-dep', displayName: 'Owned dependency', pluginInstalled: true, state: 'degraded', code: 'health_check_failed', resolvedBinary: process.execPath, version: '1.2', detail: 'Known degraded fact', canInstall: false, canUpdate: true, canDiagnose: true, task: { taskId: 'owned-task', dependencyId: 'owned-plugin:owned-dep', state: 'cancelling' }, future: { aliases: ['retained'] } };
const full: Record<string, unknown> = {
  installPlugin: { success: false, error: 'invalid_plugin_name', future: { aliases: ['retained'] } },
  installPluginDependency: { success: false, error: 'dependency_task_busy', status: fullStatus, output: 'known output', future: { aliases: ['retained'] } },
  updatePluginDependency: { success: true, status: fullStatus, output: 'known output', future: { aliases: ['retained'] } },
  diagnosePluginDependency: { success: true, status: fullStatus, output: 'known doctor output', future: { aliases: ['retained'] } },
  cancelPluginDependencyTask: { cancelling: false, future: { aliases: ['retained'] } },
  retryPluginComponent: [{ name: 'owned-component', pluginName: 'owned-plugin', toolCount: 2, connected: false, enabled: false, lastError: 'Known backend state', lastErrorDetail: { category: null, message: 'Known backend detail', detectedVersion: '1.0', requiredVersion: '2.0' }, future: { aliases: ['retained'] } }],
  openPluginDependencyPermissionSettings: undefined,
};
it.each(actionMethods)('%s rejects real input toJSON without executing a serializer or process', async method => {
  const f = await fixture(); let reads = 0; const payload = { toJSON() { reads++; return input[method]![0]; } };
  await expect(async () => f.invoke(method, payload)).rejects.toThrow('plugin_action_input_invalid'); expect(reads).toBe(0); expect(ports.exec).not.toHaveBeenCalled(); expect(ports.process).not.toHaveBeenCalled(); expect(ports.open).not.toHaveBeenCalled();
});
it.each(actionMethods)('%s rejects output toJSON before serializer execution on the actual registrar', async method => {
  const f = await fixture(); let reads = 0; const raw = method === 'retryPluginComponent' ? [{ ...(full.retryPluginComponent as object[])[0], toJSON() { reads++; return {}; } }] : { ...(typeof full[method] === 'object' ? full[method] as object : {}), toJSON() { reads++; return {}; } };
  substitute(f, method, Promise.resolve(raw));
  if (method === 'openPluginDependencyPermissionSettings' && process.platform !== 'darwin') { await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow('unsupported_action'); expect(ports.open).not.toHaveBeenCalled(); }
  else await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow('plugin_action_projection_unavailable');
  expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
it.each(actionMethods)('%s preserves and detaches complete normal status/server/metadata facts, including false/cancelling/void', async method => {
  const f = await fixture(), raw = full[method]; substitute(f, method, Promise.resolve(raw));
  if (method === 'openPluginDependencyPermissionSettings' && process.platform !== 'darwin') { await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow('unsupported_action'); expect(ports.open).not.toHaveBeenCalled(); return; }
  const a = await f.invoke(method, ...input[method]!), b = await f.invoke(method, ...input[method]!); expect(a).toEqual(raw); expect(b).toEqual(raw);
  if (raw && typeof raw === 'object') { expect(a).not.toBe(raw); expect(a).not.toBe(b); if (Array.isArray(raw)) { expect(a[0]).not.toBe(raw[0]); expect(a[0].future.aliases).not.toBe((raw[0] as { future: { aliases: string[] } }).future.aliases); } else { expect(a.future.aliases).not.toBe((raw as { future: { aliases: string[] } }).future.aliases); if ('status' in raw) expect(a.status.future.aliases).not.toBe(fullStatus.future.aliases); } }
  expect(f.gate.outstanding).toBe(0);
});
it.each(actionMethods)('%s projects a hostile producer error accessor without reading message or reflecting secret text', async method => {
  const f = await fixture(); let reads = 0; const error = Object.defineProperty({}, 'message', { enumerable: true, get() { reads++; return 'PRIVATE_ERROR_MARKER'; } });
  if (method === 'openPluginDependencyPermissionSettings' && process.platform !== 'darwin') { await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow('unsupported_action'); return; }
  substitute(f, method, Promise.reject(error)); await expect(async () => f.invoke(method, ...input[method]!)).rejects.toThrow(method === 'openPluginDependencyPermissionSettings' ? 'plugin_permission_settings_failed' : 'plugin_action_failed'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
for (const method of ['installPlugin', 'installPluginDependency', 'updatePluginDependency', 'diagnosePluginDependency'] as const) for (const kind of ['known-code', 'private-text'] as const) it(method + ' preserves business false with ' + kind + ' fixed error field', async () => {
  const f = await fixture(); const known = method === 'installPlugin' ? 'invalid_plugin_name' : method === 'diagnosePluginDependency' ? 'plugin_dependency_diagnose_not_available' : 'confirmation_required';
  substitute(f, method, Promise.resolve({ success: false, error: kind === 'known-code' ? known : 'PRIVATE_FAILURE_MARKER', future: { retained: true } }));
  const result = await f.invoke(method, ...input[method]!); expect(result.success).toBe(false); expect(result.error).toBe(kind === 'known-code' ? known : method === 'installPlugin' ? 'plugin_install_failed' : method === 'diagnosePluginDependency' ? 'plugin_diagnose_failed' : 'plugin_dependency_operation_failed'); expect(result.future).toEqual({ retained: true }); expect(JSON.stringify(result)).not.toContain('PRIVATE_FAILURE_MARKER');
});
