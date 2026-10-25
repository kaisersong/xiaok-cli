// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { DesktopShutdownCoordinator } from '../../electron/desktop-shutdown-coordinator.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
import { buildAutomationOverviewSnapshot } from '../../electron/automation-overview.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
const prefix = 'desktop:automations:', methods = ['getConfig', 'getOverviewSnapshot', 'setGlobalBackgroundAutoRun'];
afterEach(() => vi.useRealTimers());
async function fixture() {
  resetIpcSchemaRegistryForTests();
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const root: string[] = [], selected: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      const name = declaration.name.getText(ast);
      if (ast.statements.includes(node) && ['mainWindow', 'meetingRecorderController', 'shutdownAwareIpc'].includes(name)) root.push(node.getText(ast));
      if (['globalBackgroundAutoRunEnabled', 'automationsConfigSnapshot', 'automationConfigOwner', 'automationConfigProducers'].includes(name)) selected.push(node.getText(ast));
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression, text = call.expression.getText(ast);
      if (text === 'registerAutomationConfigIpc' || text === 'automationConfigProducers.set' || text === 'shutdownAwareIpc.handle' && methods.some(method => call.arguments[0]?.getText(ast) === `'${prefix}${method}'`)) selected.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  const auth = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  expect(root).toHaveLength(3); expect(auth).toBeDefined();
  let createOwner: unknown, register: unknown;
  if (source.includes('createAutomationConfigOwner')) createOwner = (await import('../../electron/automation-config-owner.js')).createAutomationConfigOwner;
  if (source.includes('registerAutomationConfigIpc')) register = (await import('../../electron/automation-config-typed-ipc.js')).registerAutomationConfigIpc;
  const dirname = resolve('dist/main/desktop/electron'), frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href }, recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const sender = { mainFrame: frame, isDestroyed: () => false }, recorder = { mainFrame: recorderFrame, isDestroyed: () => false };
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate(), writes: boolean[] = [];
  let completion: unknown = undefined, overviewOverride: unknown = undefined;
  const config = { automations: { globalBackgroundAutoRunEnabled: true }, preserved: 'owned' };
  const persist = (enabled: boolean) => { writes.push(enabled); return completion; };
  const js = ts.transpileModule([...root, auth!.getText(ast), 'mainWindow=initialMain; meetingRecorderController=initialRecorder;',
    'return (async()=>{', ...selected,
    'return { getEnabled(){return globalBackgroundAutoRunEnabled;}, owner:typeof automationConfigOwner===\'undefined\'?undefined:automationConfigOwner, setWindows(main,controller){mainWindow=main;meetingRecorderController=controller;} }; })();',
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const main = await compileFunction(js, ['ipcMain', 'desktopShutdownGate', 'ShutdownAwareIpcMain', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process', 'initialMain', 'initialRecorder', 'loadConfig', 'saveConfig', 'updateGlobalBackgroundAutoRun', 'createAutomationConfigOwner', 'registerAutomationConfigIpc', 'loopRuntime', 'timedActionStore', 'buildAutomationOverviewSnapshot'])(
    { handle: (name: string, listener: IpcHandlerListener) => listeners.set(name, listener) }, gate, ShutdownAwareIpcMain, isTrustedDesktopRendererUrl, join, dirname, { env: {} }, { webContents: sender, isDestroyed: () => false }, { ownsWebContents: (value: unknown) => value === recorder },
    async () => structuredClone(config), async (value: typeof config) => persist(value.automations.globalBackgroundAutoRunEnabled), persist, createOwner, register,
    { loopStore: { listLoopDefinitions: () => [], listLoopRuns: () => [], getAutomationStoreVersion: () => 1 } }, { listActions: () => [], listRuns: () => [], getAutomationStoreVersion: () => 2 },
    (input: Parameters<typeof buildAutomationOverviewSnapshot>[0]) => overviewOverride === undefined ? buildAutomationOverviewSnapshot(input) : overviewOverride,
  );
  expect([...listeners.keys()].sort()).toEqual(methods.map(method => prefix + method).sort());
  return { main, sender, recorder, frame, recorderFrame, writes, gate, listeners, setCompletion(value: unknown) { completion = value; }, setOverview(value: unknown) { overviewOverride = value; }, invoke: (method: string, ...args: unknown[]) => Reflect.apply(listeners.get(prefix + method)!, undefined, [{ sender, senderFrame: frame }, ...args]) };
}
describe('actual Main automation config three channels', () => {
  it('registers exactly three round30 tuples and preserves original complete overview', async () => {
    const f = await fixture(); expect([...IPC_SCHEMA_REGISTRY.keys()].sort()).toEqual(methods.map(method => prefix + method).sort());
    for (const entry of IPC_SCHEMA_REGISTRY.values()) { expect(entry.rolloutRound).toBe(30); expect(entry.payloadMode).toBe('tuple'); }
    expect(await f.invoke('getOverviewSnapshot')).toMatchObject({ sourceVersions: { loopStore: 1, timedActionStore: 2 }, globalBackgroundAutoRunEnabled: true, totals: { loops: 0, userLoops: 0, schedules: 0, activeSchedules: 0, diagnostics: 0, recentFailures: 0 }, recentFailures: [] });
  });
  it.each(['getConfig', 'getOverviewSnapshot'])('rejects extra transport args before %s producer', async method => {
    const f = await fixture(); await expect(async () => f.invoke(method, {})).rejects.toThrow('automation_config_input_invalid');
  });
  it.each([undefined, null, {}, { enabled: 1 }, { enabled: 'false' }])('rejects malformed setter %s without persistence', async input => {
    const f = await fixture(); await expect(async () => f.invoke('setGlobalBackgroundAutoRun', input)).rejects.toThrow('automation_config_input_invalid'); expect(f.writes).toEqual([]);
  });
  it('does not execute a setter getter before rejection', async () => {
    const f = await fixture(); let reads = 0; const input = Object.defineProperty({}, 'enabled', { enumerable: true, get() { reads++; return false; } });
    await expect(async () => f.invoke('setGlobalBackgroundAutoRun', input)).rejects.toThrow('automation_config_input_invalid'); expect(reads).toBe(0); expect(f.writes).toEqual([]);
  });
  it('keeps the confirmed scheduler flag while persistence is held or rejects', async () => {
    const f = await fixture(); let reject!: (error: Error) => void; f.setCompletion(new Promise<void>((_resolve, no) => { reject = no; }));
    const action = Promise.resolve(f.invoke('setGlobalBackgroundAutoRun', { enabled: false })); void action.catch(() => {}); await vi.waitFor(() => expect(f.writes).toEqual([false]));
    try { expect(f.main.getEnabled()).toBe(true); expect(f.gate.outstanding).toBe(1); } finally { reject(Error('owned_write_failed')); await action.catch(() => {}); }
    await expect(action).rejects.toThrow();
    expect(f.main.getEnabled()).toBe(true); expect(await f.invoke('getConfig')).toEqual({ globalBackgroundAutoRunEnabled: true }); expect(f.gate.outstanding).toBe(0);
  });
  it('confirms void completion, detaches snapshots and lets the next explicit operation proceed', async () => {
    const f = await fixture(); const result = await f.invoke('setGlobalBackgroundAutoRun', { enabled: false }); expect(result).toEqual({ globalBackgroundAutoRunEnabled: false }); expect(f.main.getEnabled()).toBe(false);
    expect(await f.invoke('getConfig')).not.toBe(result); await f.invoke('setGlobalBackgroundAutoRun', { enabled: true }); expect(f.writes).toEqual([false, true]); expect(f.main.getEnabled()).toBe(true);
  });
  it.each([null, {}, Promise.resolve('bad')])('rejects persistence nonvoid completion %s without publishing', async completion => {
    const f = await fixture(); f.setCompletion(completion); await expect(async () => f.invoke('setGlobalBackgroundAutoRun', { enabled: false })).rejects.toThrow('automation_config_operation_unknown'); expect(f.main.getEnabled()).toBe(true);
  });
  it('serializes two explicit held mutations without retrying either operation', async () => {
    const f = await fixture(); let finish!: () => void; f.setCompletion(new Promise<void>(yes => { finish = yes; }));
    const a = Promise.resolve(f.invoke('setGlobalBackgroundAutoRun', { enabled: false })), b = Promise.resolve(f.invoke('setGlobalBackgroundAutoRun', { enabled: true }));
    try { await vi.waitFor(() => expect(f.writes).toEqual([false])); expect(f.main.getEnabled()).toBe(true); expect(f.gate.outstanding).toBe(2); } finally { f.setCompletion(undefined); finish(); await Promise.allSettled([a, b]); }
    expect(await a).toEqual({ globalBackgroundAutoRunEnabled: false }); expect(await b).toEqual({ globalBackgroundAutoRunEnabled: true }); expect(f.writes).toEqual([false, true]); expect(f.gate.outstanding).toBe(0);
  });
  it('rejects persistence Promise constructor getter without reading it', async () => {
    const f = await fixture(); let reads = 0; f.setCompletion(Object.defineProperty(Promise.resolve(undefined), 'constructor', { get() { reads++; return Promise; } }));
    await expect(async () => f.invoke('setGlobalBackgroundAutoRun', { enabled: false })).rejects.toThrow('automation_config_operation_unknown'); expect(reads).toBe(0); expect(f.main.getEnabled()).toBe(true);
  });
  it.each([undefined, 'agent', 'scheduler'])('requires explicit user source inside the actual owner (%s)', async source => {
    const f = await fixture(); expect(f.main.owner).toBeDefined(); await expect(f.main.owner.setEnabled({ enabled: false }, source)).rejects.toThrow('automation_config_request_source_forbidden'); expect(f.writes).toEqual([]);
  });
  it.each(['unknown', 'old-main', 'subframe'])('denies %s before payload getter or persistence', async mode => {
    const f = await fixture(); let sender = f.sender, frame: unknown = f.frame;
    if (mode === 'unknown') sender = { ...sender }; if (mode === 'old-main') f.main.setWindows({ webContents: {}, isDestroyed: () => false }, null); if (mode === 'subframe') frame = { url: f.frame.url };
    let reads = 0; const input = Object.defineProperty({}, 'enabled', { enumerable: true, get() { reads++; return false; } });
    await expect(async () => Reflect.apply(f.listeners.get(prefix + 'setGlobalBackgroundAutoRun')!, undefined, [{ sender, senderFrame: frame }, input])).rejects.toThrow('desktop_user_sender_forbidden'); expect(reads).toBe(0); expect(f.writes).toEqual([]);
  });
  it('preserves the legal Recorder mutation', async () => {
    const f = await fixture(); expect(await Reflect.apply(f.listeners.get(prefix + 'setGlobalBackgroundAutoRun')!, undefined, [{ sender: f.recorder, senderFrame: f.recorderFrame }, { enabled: false }])).toEqual({ globalBackgroundAutoRunEnabled: false }); expect(f.writes).toEqual([false]);
  });
  it.each([null, {}, { generatedAt: Infinity }])('rejects malformed overview %s without a resolved error envelope', async value => {
    const f = await fixture(); f.setOverview(value); await expect(async () => f.invoke('getOverviewSnapshot')).rejects.toThrow('automation_config_operation_unknown');
  });
  it('captures complete overview extras and failure rows before getters', async () => {
    const f = await fixture(), full = await f.invoke('getOverviewSnapshot'); full.recentFailures = [{ id: '', source: 'loop_run', ownerId: '', title: '', status: 'failed', occurredAt: 0, message: '', loopOrigin: 'user_template', extra: { retained: true } }]; full.extra = { retained: true }; f.setOverview(full);
    const result = await f.invoke('getOverviewSnapshot'); expect(result).toEqual(full); expect(result).not.toBe(full); expect(result.recentFailures[0]).not.toBe(full.recentFailures[0]);
    let reads = 0; Object.defineProperty(full, 'totals', { enumerable: true, get() { reads++; return {}; } }); await expect(async () => f.invoke('getOverviewSnapshot')).rejects.toThrow('automation_config_operation_unknown'); expect(reads).toBe(0);
  });
  it('keeps held persistence under the original default 5s shutdown deadline', async () => {
    vi.useFakeTimers(); const f = await fixture(); let finish!: () => void; f.setCompletion(new Promise<void>(yes => { finish = yes; })); const action = Promise.resolve(f.invoke('setGlobalBackgroundAutoRun', { enabled: false }));
    await vi.advanceTimersByTimeAsync(0); const close = vi.fn(), continuation = vi.fn(), log = vi.fn();
    const coordinator = new DesktopShutdownCoordinator({ gate: f.gate, providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => ({ cleanupFailed: [] }) }, ingressOwners: [], durableStores: [{ name: 'owned', close }], destroyWindows: () => f.main.setWindows(null, null), releaseMainSourcePin: async () => {}, disposeLifetimeResources: async () => {}, continuation, log });
    try { const pending = coordinator.onBeforeQuit().shutdown; await vi.advanceTimersByTimeAsync(5_000); const report = await pending; expect(report.ordinaryDrained).toBe(false); expect(report.storesClosed).toBe(false); expect(report.deferredReason).toBe('store_close_deferred_to_process_exit'); expect(log).toHaveBeenCalledWith('shutdown_ordinary_cleanup_timeout', expect.any(Object)); expect(close).not.toHaveBeenCalled(); expect(continuation).toHaveBeenCalledTimes(1); expect(f.gate.outstanding).toBe(1); } finally { finish(); await action; }
    expect(f.gate.outstanding).toBe(0);
  });
});
