// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
const channels = ['desktop:services:getStatus', 'desktop:services:restart'] as const;
const baseSnapshot = () => ({ checkedAt: 123, services: [{ id: 'kswarm', label: 'KSwarm', running: true, reachable: true, port: 4400, pid: 1234, restartCount: 0, lastError: null, detail: 'retained', future: { data: ['kept'] } }], future: { kept: true } });
async function fixture() {
  resetIpcSchemaRegistryForTests();
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const declarations: string[] = [], registrations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (['mainWindow', 'meetingRecorderController', 'shutdownAwareIpc'].includes(declaration.name.getText(ast)) && ast.statements.includes(node)) declarations.push(node.getText(ast));
        if (['restartRuntimeBridgeService', 'runtimeBridgeClients', 'runtimeBridgeStarted', 'serviceControl', 'serviceControlProducers'].includes(declaration.name.getText(ast))) registrations.push(node.getText(ast));
      }
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (call.expression.getText(ast) === 'registerServiceControlIpc' || call.expression.getText(ast) === 'shutdownAwareIpc.handle' && channels.some(channel => call.arguments[0]?.getText(ast) === `'${channel}'`)) registrations.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  const admission = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  expect(declarations).toHaveLength(3); expect(admission).toBeDefined(); expect(registrations.length).toBeGreaterThan(3);
  let createControl: unknown, register: unknown;
  if (source.includes('createDesktopServiceControl')) createControl = (await import('../../electron/desktop-service-control.js')).createDesktopServiceControl;
  if (source.includes('registerServiceControlIpc')) register = (await import('../../electron/service-control-typed-ipc.js')).registerServiceControlIpc;
  const dirname = resolve('dist/main/desktop/electron'), frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href };
  const recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const sender = { mainFrame: frame, isDestroyed: () => false }, recorder = { mainFrame: recorderFrame, isDestroyed: () => false };
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate(), snapshot = baseSnapshot();
  const sdk = { getServiceStatus: vi.fn(async (): Promise<unknown> => snapshot), restartRelatedService: vi.fn(async (_id: string): Promise<unknown> => undefined) };
  const js = ts.transpileModule([...declarations, admission!.getText(ast), 'mainWindow = initialMain; meetingRecorderController = initialRecorder;', ...registrations,
    `return { setWindows(main, controller) { mainWindow = main; meetingRecorderController = controller; }, setBridgeRestart(fn) { restartRuntimeBridgeService = fn; }, setBridgeState(started) { runtimeBridgeStarted = started; }, facade: ${createControl ? 'serviceControl' : 'undefined'} };`,
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const main = compileFunction(js, ['ipcMain', 'desktopShutdownGate', 'ShutdownAwareIpcMain', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process', 'initialMain', 'initialRecorder', 'kswarmService', 'createDesktopServiceControl', 'registerServiceControlIpc'])(
    { handle: (channel: string, listener: IpcHandlerListener) => listeners.set(channel, listener) }, gate, ShutdownAwareIpcMain, isTrustedDesktopRendererUrl, join, dirname, { env: {} }, { webContents: sender, isDestroyed: () => false }, { ownsWebContents: (candidate: unknown) => candidate === recorder }, sdk, createControl, register,
  );
  expect([...listeners.keys()].sort()).toEqual([...channels].sort());
  const invoke = (channel: string, ...args: unknown[]) => Reflect.apply(listeners.get(channel)!, undefined, [{ sender, senderFrame: frame }, ...args]);
  return { main, gate, snapshot, sdk, sender, recorder, frame, recorderFrame, listeners, invoke };
}
describe('actual Main services two registrations and owned facade', () => {
  it('registers only the original two tuple channels in round28', async () => {
    await fixture(); expect([...IPC_SCHEMA_REGISTRY.keys()].sort()).toEqual([...channels].sort());
    for (const entry of IPC_SCHEMA_REGISTRY.values()) { expect(entry.rolloutRound).toBe(28); expect(entry.payloadMode).toBe('tuple'); }
  });
  it.each(['main', 'recorder'])('preserves complete SDK and current Runtime Bridge facts for owned %s', async role => {
    const f = await fixture(); f.main.setBridgeState(true);
    const sender = role === 'main' ? f.sender : f.recorder;
    const result = await Reflect.apply(f.listeners.get(channels[0])!, undefined, [{ sender, senderFrame: sender.mainFrame }]);
    expect(result).toEqual({ ...f.snapshot, services: [...f.snapshot.services, { id: 'runtime-bridge', label: 'Runtime Bridge', running: true, reachable: true, port: 0, pid: null, restartCount: 0, lastError: null, detail: '0 client(s) registered' }] });
    const restart = vi.fn(async () => undefined); f.main.setBridgeRestart(restart);
    await Reflect.apply(f.listeners.get(channels[1])!, undefined, [{ sender, senderFrame: sender.mainFrame }, 'runtime-bridge']); expect(restart).toHaveBeenCalledTimes(1); expect(f.gate.outstanding).toBe(0);
  });
  it.each(['unknown-id', 'toString', '--broker', '', null, {}])('rejects invalid restart target %s before the actual SDK or bridge path', async id => {
    const f = await fixture(), restart = vi.fn(async () => undefined); f.main.setBridgeRestart(restart);
    await expect(async () => f.invoke(channels[1], id)).rejects.toThrow('service_input_invalid'); expect(f.sdk.restartRelatedService).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
  });
  it.each(channels)('rejects extra transport arguments for %s before SDK work', async channel => {
    const f = await fixture();
    await expect(async () => f.invoke(channel, ...(channel === channels[0] ? [{}] : ['kswarm', { requestSource: 'user' }]))).rejects.toThrow('service_input_invalid');
    expect(f.sdk.getServiceStatus).not.toHaveBeenCalled(); expect(f.sdk.restartRelatedService).not.toHaveBeenCalled();
  });
  it('rejects uninitialized Runtime Bridge instead of acknowledging a no-op', async () => {
    const f = await fixture(); await expect(async () => f.invoke(channels[1], 'runtime-bridge')).rejects.toThrow('service_runtime_unavailable'); expect(f.sdk.restartRelatedService).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
  });
  it('observes a fresh replacement Runtime Bridge function', async () => {
    const f = await fixture(), first = vi.fn(async () => undefined), second = vi.fn(async () => undefined);
    f.main.setBridgeRestart(first); await f.invoke(channels[1], 'runtime-bridge'); f.main.setBridgeRestart(second); await f.invoke(channels[1], 'runtime-bridge');
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
  });
  it('rejects SDK getters before the actual Main spread/append', async () => {
    const f = await fixture(); let reads = 0; const value = Object.defineProperty(baseSnapshot(), 'services', { enumerable: true, get() { reads++; return []; } });
    f.sdk.getServiceStatus.mockResolvedValueOnce(value);
    await expect(async () => f.invoke(channels[0])).rejects.toThrow('service_projection_unavailable'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
  });
  it('detaches the SDK snapshot and preserves optional and unknown nested fields', async () => {
    const f = await fixture(), result = await f.invoke(channels[0]); result.future.kept = false; result.services[0].future.data[0] = 'changed';
    expect(f.snapshot.future.kept).toBe(true); expect(f.snapshot.services[0]!.future.data).toEqual(['kept']);
  });
  it.each(['proxy', 'then-getter', 'toJSON', 'promise-constructor', 'promise-subclass'])('rejects hostile SDK %s before assimilation or hooks', async mode => {
    const f = await fixture(); let reads = 0; let value: unknown = baseSnapshot();
    if (mode === 'proxy') value = new Proxy(value as object, { get(target, key) { reads++; return Reflect.get(target, key); }, ownKeys(target) { reads++; return Reflect.ownKeys(target); } });
    if (mode === 'then-getter') value = Object.defineProperty(value, 'then', { enumerable: true, get() { reads++; return undefined; } });
    if (mode === 'toJSON') value = { ...baseSnapshot(), toJSON() { reads++; return {}; } };
    if (mode === 'promise-constructor') value = Object.defineProperty(Promise.resolve(baseSnapshot()), 'constructor', { get() { reads++; return Promise; } });
    if (mode === 'promise-subclass') { class CustomPromise extends Promise<unknown> {} value = CustomPromise.resolve(baseSnapshot()); }
    // Vitest spy attaches settlement observers and itself reads Promise.constructor.
    // Use a plain SDK boundary callback so this assertion measures only production.
    expect(Reflect.set(f.sdk, 'getServiceStatus', () => value)).toBe(true);
    await expect(async () => f.invoke(channels[0])).rejects.toThrow('service_projection_unavailable'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
  });
  it.each(['development', 'production'])('rejects a malformed restart result without a successful error envelope in %s', async mode => {
    const previous = process.env.NODE_ENV; process.env.NODE_ENV = mode;
    try { const f = await fixture(); f.sdk.restartRelatedService.mockResolvedValueOnce({ ok: false }); await expect(async () => f.invoke(channels[1], 'kswarm')).rejects.toThrow('service_operation_unknown'); }
    finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  });
  it.each(['unknown', 'old-main', 'subframe', 'missing-frame'])('denies %s before payload access and any SDK read/restart', async mode => {
    const f = await fixture(); let sender = f.sender, frame: unknown = f.frame;
    if (mode === 'unknown') sender = { ...f.sender };
    if (mode === 'old-main') f.main.setWindows({ webContents: {}, isDestroyed: () => false }, null);
    if (mode === 'subframe') frame = { url: f.frame.url };
    if (mode === 'missing-frame') frame = null;
    let reads = 0; const raw = Object.defineProperty({}, 'serviceId', { enumerable: true, get() { reads++; return 'kswarm'; } });
    for (const channel of channels) await expect(async () => Reflect.apply(f.listeners.get(channel)!, undefined, [{ sender, senderFrame: frame }, raw])).rejects.toThrow('desktop_user_sender_forbidden');
    expect(reads).toBe(0); expect(f.sdk.getServiceStatus).not.toHaveBeenCalled(); expect(f.sdk.restartRelatedService).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
  });
  it('holds the original shutdown token until an admitted actual SDK result settles', async () => {
    const f = await fixture(); let release!: () => void; f.sdk.restartRelatedService.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined); }));
    const pending = f.invoke(channels[1], 'intent-broker'); expect(f.gate.outstanding).toBe(1); f.main.setWindows(null, null); f.gate.close(); expect(await f.gate.drain(1)).toBe(false);
    release(); await pending; expect(f.gate.outstanding).toBe(0);
  });
});
