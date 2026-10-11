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
import { buildMobilePairingPayload } from '../../electron/mobile-gateway.js';

const channels = ['desktop:mobile:getRelayStatus', 'desktop:mobile:getPairingInfo'] as const;
async function fixture() {
  resetIpcSchemaRegistryForTests();
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const declarations: string[] = [], registrations: string[] = [];
  let onStatus = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (['mainWindow', 'meetingRecorderController', 'shutdownAwareIpc'].includes(declaration.name.getText(ast)) && ast.statements.includes(node)) declarations.push(node.getText(ast));
        if (['mobileRelayConfig', 'latestMobileRelayStatus', 'mobileReadonlyProducers'].includes(declaration.name.getText(ast))) registrations.push(node.getText(ast));
      }
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (call.expression.getText(ast) === 'registerMobileReadonlyIpc'
        || call.expression.getText(ast) === 'shutdownAwareIpc.handle' && channels.some(channel => call.arguments[0]?.getText(ast) === `'${channel}'`)) registrations.push(node.getText(ast));
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'onStatus' && ts.isArrowFunction(node.initializer)) onStatus = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }; visit(ast);
  const admission = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  expect(declarations).toHaveLength(3); expect(registrations.length).toBeGreaterThan(2); expect(onStatus).not.toBe(''); expect(admission).toBeDefined();
  let register: unknown, capture: unknown;
  if (source.includes('registerMobileReadonlyIpc')) {
    const actual = await import('../../electron/mobile-readonly-typed-ipc.js');
    register = actual.registerMobileReadonlyIpc; capture = actual.captureMobileRelayStatus;
  }
  const dirname = resolve('dist/main/desktop/electron');
  const frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href };
  const recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const mainSender = { mainFrame: frame, isDestroyed: () => false, send: vi.fn() };
  const recorderSender = { mainFrame: recorderFrame, isDestroyed: () => false };
  const initialMain = { webContents: mainSender, isDestroyed: () => false };
  const initialRecorder = { ownsWebContents: (sender: unknown) => sender === recorderSender };
  const identity = { desktopId: 'owned-id', mobileAccessToken: 'owned-surrogate-token', mobileRelayRoomSecret: 'owned-surrogate-secret', createdAt: 'owned-created' };
  const config = { relayUrl: 'wss://owned.invalid/ws', relayJwt: 'owned-surrogate-jwt' };
  const gatewayStatus = { running: true, host: '0.0.0.0', port: 47891, baseURL: 'http://127.0.0.1:47891', reachableURLs: ['http://192.168.1.2:47891'] };
  const gateway = { getStatus: vi.fn(() => gatewayStatus) }, build = vi.fn(buildMobilePairingPayload), debug = vi.fn();
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const code = ts.transpileModule([
    ...declarations, admission!.getText(ast), 'mainWindow = initialMain; meetingRecorderController = initialRecorder;', ...registrations,
    `return { setStatus(status) { latestMobileRelayStatus = status; }, setWindows(main, recorder) { mainWindow = main; meetingRecorderController = recorder; }, onStatus: ${onStatus} };`,
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const production = compileFunction(code, ['ipcMain', 'desktopShutdownGate', 'ShutdownAwareIpcMain', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process', 'initialMain', 'initialRecorder', 'loadMobileRelayConfig', 'mobileIdentity', 'mobileGateway', 'buildMobilePairingPayload', 'registerMobileReadonlyIpc', 'captureMobileRelayStatus', 'debugMain'])(
    { handle: (channel: string, listener: IpcHandlerListener) => listeners.set(channel, listener) }, gate, ShutdownAwareIpcMain, isTrustedDesktopRendererUrl, join, dirname, { env: {} }, initialMain, initialRecorder, () => config, identity, gateway, build, register, capture, debug,
  );
  expect([...listeners.keys()].sort()).toEqual([...channels].sort());
  const status = { running: true, connected: false, relayUrl: config.relayUrl, roomId: 'owned-room', lastError: 'owned-owner-business-error', credentialState: 'expired', credentialExpiresAt: '', requiresUserReauth: true, future: { values: ['kept'] } };
  production.setStatus(status);
  const invoke = (channel: string, sender: unknown = mainSender, senderFrame: unknown = frame, ...args: unknown[]) => Reflect.apply(listeners.get(channel)!, undefined, [{ sender, senderFrame }, ...args]);
  return { production, invoke, listeners, gate, identity, config, gateway, build, debug, status, frame, recorderFrame, mainSender, recorderSender, initialRecorder };
}

describe('actual Main mobile readonly2 registration through the sole shutdown owner', () => {
  it('registers exactly the two original tuples in round27 with existing preload channel names', async () => {
    await fixture(); expect([...IPC_SCHEMA_REGISTRY.keys()].sort()).toEqual([...channels].sort());
    for (const entry of IPC_SCHEMA_REGISTRY.values()) { expect(entry.rolloutRound).toBe(27); expect(entry.payloadMode).toBe('tuple'); }
  });
  it.each(['main', 'recorder'])('preserves complete real pairing producer and relay facts for owned %s', async window => {
    const f = await fixture(), sender = window === 'main' ? f.mainSender : f.recorderSender, frame = sender.mainFrame;
    expect(await f.invoke(channels[0], sender, frame)).toEqual(f.status);
    const pairing = await f.invoke(channels[1], sender, frame);
    expect(pairing).toEqual(buildMobilePairingPayload({ desktopName: 'Xiaok Desktop', identity: f.identity, gatewayStatus: f.gateway.getStatus(), ...f.config }));
    const params = new URL(pairing.deepLink).searchParams;
    expect(params.get('token')).toBe(f.identity.mobileAccessToken); expect(params.get('relayJWT')).toBe(f.config.relayJwt); expect(params.get('relayRoomSecret')).toBe(f.identity.mobileRelayRoomSecret);
    expect(f.build).toHaveBeenCalledTimes(1); expect(f.gate.outstanding).toBe(0);
  });
  it.each(channels)('rejects extra transport args for %s before the producer', async channel => {
    const f = await fixture();
    await expect(async () => f.invoke(channel, f.mainSender, f.frame, {})).rejects.toThrow('mobile_input_invalid');
    expect(f.build).not.toHaveBeenCalled(); expect(f.gateway.getStatus).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
  });
  it.each(['unknown', 'old-main', 'subframe', 'missing-frame', 'destroyed', 'retired-recorder'])('denies %s before sensitive reads and payload access', async mode => {
    const f = await fixture(); let sender = f.mainSender, frame: unknown = f.frame;
    if (mode === 'unknown') sender = { ...f.mainSender };
    if (mode === 'old-main') f.production.setWindows({ webContents: {}, isDestroyed: () => false }, f.initialRecorder);
    if (mode === 'subframe') frame = { url: f.frame.url };
    if (mode === 'missing-frame') frame = null;
    if (mode === 'destroyed') sender.isDestroyed = () => true;
    if (mode === 'retired-recorder') { sender = f.recorderSender as typeof sender; frame = f.recorderFrame; f.production.setWindows(null, null); }
    let reads = 0; const raw = Object.defineProperty({}, 'credential', { enumerable: true, get() { reads++; return 'never'; } });
    for (const channel of channels) await expect(async () => f.invoke(channel, sender, frame, raw)).rejects.toThrow('desktop_user_sender_forbidden');
    expect(reads).toBe(0); expect(f.build).not.toHaveBeenCalled(); expect(f.gateway.getStatus).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
  });
  it('returns detached full status including unknown nested fields', async () => {
    const f = await fixture(), result = await f.invoke(channels[0]);
    expect(result).not.toBe(f.status); expect(result.future).not.toBe(f.status.future);
    result.future.values[0] = 'changed'; expect(f.status.future.values).toEqual(['kept']);
  });
  it.each(channels)('rejects malformed %s output without a fake successful fallback', async channel => {
    const f = await fixture();
    if (channel === channels[0]) f.production.setStatus({ ...f.status, connected: 'invalid' });
    else f.build.mockReturnValueOnce({ deepLink: 'invalid' } as never);
    await expect(async () => f.invoke(channel)).rejects.toThrow('mobile_projection_unavailable'); expect(f.gate.outstanding).toBe(0);
  });
  it('propagates opaque actual producer exceptions without reading message or retrying', async () => {
    const f = await fixture(); let reads = 0;
    const error = Object.defineProperty({}, 'message', { get() { reads++; return 'private'; } });
    f.gateway.getStatus.mockImplementation(() => { throw error; });
    await expect(async () => f.invoke(channels[1])).rejects.toBe(error);
    expect(reads).toBe(0); expect(f.gateway.getStatus).toHaveBeenCalledTimes(1); expect(f.gate.outstanding).toBe(0);
  });
  it.each(['getter', 'then-getter', 'proxy', 'toJSON', 'cycle', 'promise-constructor', 'promise-subclass'])('rejects hostile %s projection before executing user hooks', async mode => {
    const f = await fixture(); let reads = 0; let value: unknown = { ...f.status };
    if (mode === 'getter') value = Object.defineProperty(value, 'connected', { enumerable: true, get() { reads++; return true; } });
    if (mode === 'then-getter') value = Object.defineProperty(value, 'then', { enumerable: true, get() { reads++; return undefined; } });
    if (mode === 'proxy') value = new Proxy(value as object, { get(target, key) { reads++; return Reflect.get(target, key); }, ownKeys(target) { reads++; return Reflect.ownKeys(target); } });
    if (mode === 'toJSON') value = { ...f.status, toJSON() { reads++; return f.status; } };
    if (mode === 'cycle') { const circular = { ...f.status, future: {} }; circular.future = circular; value = circular; }
    if (mode === 'promise-constructor') value = Object.defineProperty(Promise.resolve(f.status), 'constructor', { get() { reads++; return Promise; } });
    if (mode === 'promise-subclass') { class CustomPromise extends Promise<unknown> {} value = CustomPromise.resolve(f.status); }
    f.production.setStatus(value);
    await expect(async () => f.invoke(channels[0])).rejects.toThrow('mobile_projection_unavailable'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
  });
  it('validates actual onStatus before debug getters and skips malformed broadcasts', async () => {
    const f = await fixture(); let reads = 0;
    const bad = Object.defineProperty({ ...f.status }, 'running', { enumerable: true, get() { reads++; return true; } });
    f.production.onStatus(bad);
    expect(reads).toBe(0); expect(f.mainSender.send).not.toHaveBeenCalled();
    expect(f.debug).toHaveBeenCalledExactlyOnceWith('mobile-relay:projection-unavailable', { code: 'mobile_projection_unavailable' });
    await expect(async () => f.invoke(channels[0])).rejects.toThrow('mobile_projection_unavailable');
  });
  it('broadcasts a detached full status using the actual onStatus callback', async () => {
    const f = await fixture(); f.production.onStatus(f.status);
    expect(f.mainSender.send).toHaveBeenCalledExactlyOnceWith('desktop:mobileRelayStatus', f.status);
    const wire = f.mainSender.send.mock.calls[0]![1]; expect(wire).not.toBe(f.status);
    wire.future.values[0] = 'wire changed'; expect(f.status.future.values).toEqual(['kept']);
    expect(await f.invoke(channels[0])).toEqual(f.status);
  });
  it('retains a held standard Promise under the original gate until settled', async () => {
    const f = await fixture(); let release!: (value: typeof f.status) => void;
    f.production.setStatus(new Promise(resolve => { release = resolve; }));
    const held = f.invoke(channels[0]); expect(f.gate.outstanding).toBe(1);
    f.production.setWindows(null, null); f.gate.close(); expect(await f.gate.drain(1)).toBe(false);
    release(f.status); expect(await held).toEqual(f.status); expect(f.gate.outstanding).toBe(0);
    await expect(async () => f.invoke(channels[1])).rejects.toThrow('shutting_down'); expect(f.build).not.toHaveBeenCalled();
  });
});
