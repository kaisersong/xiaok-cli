// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { DesktopShutdownCoordinator } from '../../electron/desktop-shutdown-coordinator.js';
import { captureIpcData } from '../../electron/ipc-data-snapshot.js';
import { captureMobileRelayStatus } from '../../electron/mobile-readonly-typed-ipc.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
const channel = 'desktop:mobile:openRelaySignIn';
afterEach(() => vi.useRealTimers());
async function fixture(url: unknown = 'wss://owned.invalid/ws', configured = true) {
  resetIpcSchemaRegistryForTests();
  const source = readFileSync(process.env['XIAOK_TEST_SIGNIN_MAIN_SOURCE'] ?? new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const root: string[] = [], selected: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      const name = declaration.name.getText(ast);
      if (ast.statements.includes(node) && ['mainWindow', 'meetingRecorderController', 'shutdownAwareIpc'].includes(name)) root.push(node.getText(ast));
      if (['mobileRelayConfig', 'latestMobileRelayStatus', 'mobileSignInOwner', 'mobileSignInProducers'].includes(name)) selected.push(node.getText(ast));
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (call.expression.getText(ast) === 'registerMobileSignInIpc' || call.expression.getText(ast) === 'shutdownAwareIpc.handle' && call.arguments[0]?.getText(ast) === `'${channel}'`) selected.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  const auth = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  expect(root).toHaveLength(3); expect(auth).toBeDefined(); expect(selected.length).toBeGreaterThan(2);
  let createOwner: unknown, register: unknown;
  if (source.includes('createMobileRelaySignInOwner')) createOwner = (await import('../../electron/mobile-relay-signin.js')).createMobileRelaySignInOwner;
  if (source.includes('registerMobileSignInIpc')) register = (await import('../../electron/mobile-signin-typed-ipc.js')).registerMobileSignInIpc;
  const dirname = resolve('dist/main/desktop/electron'), frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href }, recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const sender = { mainFrame: frame, isDestroyed: () => false }, recorder = { mainFrame: recorderFrame, isDestroyed: () => false };
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate(), urls: string[] = [], debug = vi.fn();
  let response: unknown = Promise.resolve(undefined);
  const config = { relayUrl: url, relayJwt: 'owned-surrogate-jwt' };
  const js = ts.transpileModule([...root, auth!.getText(ast), 'mainWindow=initialMain; meetingRecorderController=initialRecorder;', ...selected,
    `return { setWindows(main, controller) { mainWindow=main; meetingRecorderController=controller; }, setStatus(status) { latestMobileRelayStatus=status; }, owner: ${createOwner ? 'mobileSignInOwner' : 'undefined'} };`,
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const main = compileFunction(js, ['ipcMain', 'desktopShutdownGate', 'ShutdownAwareIpcMain', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process', 'initialMain', 'initialRecorder', 'loadMobileRelayConfig', 'shell', 'debugMain', 'captureIpcData', 'captureMobileRelayStatus', 'createMobileRelaySignInOwner', 'registerMobileSignInIpc'])(
    { handle: (name: string, listener: IpcHandlerListener) => listeners.set(name, listener) }, gate, ShutdownAwareIpcMain, isTrustedDesktopRendererUrl, join, dirname, { env: {} }, { webContents: sender, isDestroyed: () => false }, { ownsWebContents: (value: unknown) => value === recorder }, () => configured ? config : null,
    { openExternal: (target: string) => { urls.push(target); return response; } }, debug, captureIpcData, captureMobileRelayStatus, createOwner, register,
  );
  expect([...listeners.keys()]).toEqual([channel]);
  return { main, sender, recorder, frame, recorderFrame, config, urls, debug, gate, listeners, setResponse(value: unknown) { response = value; }, invoke: (...args: unknown[]) => Reflect.apply(listeners.get(channel)!, undefined, [{ sender, senderFrame: frame }, ...args]) };
}
describe('actual Main relay sign-in explicit action', () => {
  it('registers one original round29 zero tuple with shell-open risk', async () => {
    await fixture(); expect([...IPC_SCHEMA_REGISTRY.keys()]).toEqual([channel]); const entry = IPC_SCHEMA_REGISTRY.get(channel)!;
    expect(entry.rolloutRound).toBe(29); expect(entry.payloadMode).toBe('tuple'); expect(entry.riskTags).toEqual(['shell-open']);
  });
  it.each(['/ws', '/ws/', '/', '/prefix/ws', '/wsx'])('derives the exact credential-free path from %s', async path => {
    const f = await fixture('wss://owned.invalid' + path), expected = path === '/prefix/ws' ? '/prefix/auth/login' : path === '/wsx' ? '/wsx/auth/login' : '/auth/login';
    expect(await f.invoke()).toEqual({ ok: true, url: 'https://owned.invalid' + expected }); expect(f.urls).toEqual(['https://owned.invalid' + expected]);
    expect(new URL(f.urls[0]!).pathname).not.toContain('//'); expect(f.debug).toHaveBeenCalledExactlyOnceWith('mobile-relay:sign-in-opened', { targetKind: 'relay-auth-login' });
  });
  it.each(['ws', 'wss', 'http', 'https'])('preserves the configured %s origin with HTTP(S) output', async protocol => {
    const f = await fixture(protocol + '://owned.invalid/ws'), prefix = protocol === 'ws' || protocol === 'http' ? 'http' : 'https';
    expect(await f.invoke()).toEqual({ ok: true, url: prefix + '://owned.invalid/auth/login' });
  });
  it('preserves the owned Recorder explicit action through the actual Main authority', async () => {
    const f = await fixture();
    expect(await Reflect.apply(f.listeners.get(channel)!, undefined, [{ sender: f.recorder, senderFrame: f.recorderFrame }])).toEqual({ ok: true, url: 'https://owned.invalid/auth/login' });
    expect(f.urls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
  });
  it.each(['javascript:alert(1)', 'file:///owned', 'https://user:secret@owned.invalid/ws', 'wss://owned.invalid/ws?token=owned-secret', 'wss://owned.invalid/ws#owned-secret', 'https://owned.invalid//ws', 'invalid', 42, {}])('rejects invalid owner URL without shell or sensitive logs (%s)', async url => {
    const f = await fixture(url); expect(await f.invoke()).toEqual({ ok: false, error: 'relay_url_invalid' }); expect(f.urls).toEqual([]);
    expect(JSON.stringify(f.debug.mock.calls)).not.toContain('owned-secret'); expect(JSON.stringify(f.debug.mock.calls)).not.toContain('secret@');
  });
  it('preserves the original known unknown-URL result with zero shell calls', async () => {
    const f = await fixture(''); expect(await f.invoke()).toEqual({ ok: false, error: 'relay_url_unknown' }); expect(f.urls).toEqual([]);
  });
  it('preserves the actual missing-config fallback with zero shell calls', async () => {
    const f = await fixture(undefined, false); expect(await f.invoke()).toEqual({ ok: false, error: 'relay_url_unknown' }); expect(f.urls).toEqual([]);
  });
  it('captures a corrupted fallback status before its URL getter without claiming a live bridge', async () => {
    const f = await fixture(undefined, false); let reads = 0;
    f.main.setStatus(Object.defineProperty({ running: false, connected: false, roomId: '', lastError: null, credentialState: 'missing', requiresUserReauth: true }, 'relayUrl', {
      enumerable: true, get() { reads++; return 'wss://owned.invalid/ws'; },
    }));
    await expect(async () => f.invoke()).rejects.toThrow('mobile_signin_operation_unknown'); expect(reads).toBe(0); expect(f.urls).toEqual([]);
  });
  it('rejects caller target/source transport additions before the producer', async () => {
    const f = await fixture(); await expect(async () => f.invoke({ url: 'https://forged.invalid', requestSource: 'user' })).rejects.toThrow('mobile_signin_input_invalid'); expect(f.urls).toEqual([]);
  });
  it('captures config before reading a URL accessor and normalizes only the fixed error code', async () => {
    const f = await fixture(); let reads = 0; Object.defineProperty(f.config, 'relayUrl', { enumerable: true, get() { reads++; return 'wss://owned.invalid/ws'; } });
    await expect(async () => f.invoke()).rejects.toThrow('mobile_signin_operation_unknown'); expect(reads).toBe(0); expect(f.urls).toEqual([]);
  });
  it('holds the token and shares one physical shell promise, detaching each reply', async () => {
    const f = await fixture(); let finish!: () => void; f.setResponse(new Promise<void>(resolve => { finish = resolve; }));
    const a = f.invoke(), b = f.invoke(); expect(f.urls).toHaveLength(1); expect(f.gate.outstanding).toBe(2); finish(); const [first, second] = await Promise.all([a, b]);
    expect(first).toEqual(second); expect(first).not.toBe(second); expect(f.gate.outstanding).toBe(0); await f.invoke(); expect(f.urls).toHaveLength(2);
  });
  it('propagates shell rejection without false ACK and clears pending for a later explicit click', async () => {
    const f = await fixture(), failure = Error('owned-shell-failure'), rejected = Promise.reject(failure); void rejected.catch(() => {}); f.setResponse(rejected);
    await expect(async () => f.invoke()).rejects.toBe(failure); f.setResponse(Promise.resolve(undefined)); expect(await f.invoke()).toMatchObject({ ok: true }); expect(f.urls).toHaveLength(2);
  });
  it.each([undefined, null, {}, Promise.resolve('bad-completion')])('rejects non-Promise or nonvoid shell completion %s', async value => {
    const f = await fixture(); f.setResponse(value); await expect(async () => f.invoke()).rejects.toThrow('mobile_signin_operation_unknown'); expect(f.gate.outstanding).toBe(0);
  });
  it('rejects a shell Promise constructor accessor without executing it', async () => {
    const f = await fixture(); let reads = 0; f.setResponse(Object.defineProperty(Promise.resolve(undefined), 'constructor', { get() { reads++; return Promise; } }));
    await expect(async () => f.invoke()).rejects.toThrow('mobile_signin_operation_unknown'); expect(reads).toBe(0);
  });
  it.each(['unknown', 'old-main', 'subframe'])('denies %s before caller getters or shell', async mode => {
    const f = await fixture(); let sender = f.sender, frame: unknown = f.frame;
    if (mode === 'unknown') sender = { ...f.sender }; if (mode === 'old-main') f.main.setWindows({ webContents: {}, isDestroyed: () => false }, null); if (mode === 'subframe') frame = { url: f.frame.url };
    let reads = 0; const raw = Object.defineProperty({}, 'url', { enumerable: true, get() { reads++; return 'forged'; } });
    await expect(async () => Reflect.apply(f.listeners.get(channel)!, undefined, [{ sender, senderFrame: frame }, raw])).rejects.toThrow('desktop_user_sender_forbidden'); expect(reads).toBe(0); expect(f.urls).toEqual([]);
  });
  it('keeps held shell covered through the original default 5s coordinator limit', async () => {
    vi.useFakeTimers(); const f = await fixture(); let finish!: () => void; f.setResponse(new Promise<void>(resolve => { finish = resolve; })); const pending = f.invoke();
    const closeStore = vi.fn(), continuation = vi.fn(), log = vi.fn();
    const coordinator = new DesktopShutdownCoordinator({ gate: f.gate, providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => ({ cleanupFailed: [] }) }, ingressOwners: [], durableStores: [{ name: 'owned-store', close: closeStore }], destroyWindows: () => f.main.setWindows(null, null), releaseMainSourcePin: async () => {}, disposeLifetimeResources: async () => {}, continuation, log });
    const closing = coordinator.onBeforeQuit().shutdown;
    try {
      await vi.advanceTimersByTimeAsync(5_000); const report = await closing;
      expect(report.ordinaryDrained).toBe(false); expect(report.deferredReason).toBe('store_close_deferred_to_process_exit');
      expect(log).toHaveBeenCalledWith('shutdown_ordinary_cleanup_timeout', expect.any(Object)); expect(report.storesClosed).toBe(false); expect(closeStore).not.toHaveBeenCalled(); expect(continuation).toHaveBeenCalledTimes(1); expect(f.gate.outstanding).toBe(1);
    } finally { finish(); await pending; }
    expect(f.gate.outstanding).toBe(0);
  });
});
