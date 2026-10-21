import { runInNewContext } from 'node:vm';
// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { registerRecorderWindowIpc } from '../../electron/recorder-window-typed-ipc.js';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createMeetingRecorderWindowController } from '../../electron/meeting-recorder-window.js';

class FakeWebContents extends EventEmitter {
  send = vi.fn();
}

class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = [];
  static fromWebContents = vi.fn();

  webContents = new FakeWebContents();
  destroyed = false;
  focused = false;
  visible = false;
  bounds = { x: 100, y: 80, width: 980, height: 680 };
  loadFile = vi.fn().mockResolvedValue(undefined);
  loadURL = vi.fn().mockResolvedValue(undefined);
  show = vi.fn(() => { this.visible = true; });
  focus = vi.fn(() => { this.focused = true; });
  restore = vi.fn();
  center = vi.fn();
  close = vi.fn(() => { this.emit('close', { preventDefault: vi.fn() }); });
  destroy = vi.fn(() => { this.destroyed = true; this.emit('closed'); });
  isDestroyed = vi.fn(() => this.destroyed);
  isFocused = vi.fn(() => this.focused);
  isMinimized = vi.fn(() => false);
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setWindowButtonVisibility = vi.fn();
  setResizable = vi.fn();
  setMinimumSize = vi.fn();
  setMaximumSize = vi.fn();
  setSize = vi.fn((width: number, height: number) => {
    this.bounds = { ...this.bounds, width, height };
  });
  setPosition = vi.fn((x: number, y: number) => {
    this.bounds = { ...this.bounds, x, y };
  });
  getBounds = vi.fn(() => this.bounds);

  constructor(public options: Record<string, unknown>) {
    super();
    FakeBrowserWindow.instances.push(this);
  }
}

function createController(platform: NodeJS.Platform = 'darwin') {
  FakeBrowserWindow.instances = [];
  const notificationPort = { show: vi.fn().mockResolvedValue({ ok: true }) };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };
  const controller = createMeetingRecorderWindowController({
    BrowserWindow: FakeBrowserWindow as never,
    getMainWindow: () => mainWindow as never,
    notificationPort,
    platform,
    preloadPath: '/app/preload.cjs',
    rendererFile: '/app/index.html',
    screen: {
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    } as never,
  });
  return { controller, mainWindow, notificationPort };
}


// Native window ports are the existing controller fixture; this does not claim OS IPC/window proof.
function actualMainFixture() {
  resetIpcSchemaRegistryForTests();
  const fixture = createController();
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  const isMainWindowSender =');
  const end = source.indexOf('  // KSwarm service', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const listeners = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
  const shutdownAwareIpc = { handle(channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => unknown) { listeners.set(channel, listener); } };
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(js, { mainWindow: fixture.mainWindow, meetingRecorderController: fixture.controller, shutdownAwareIpc, registerRecorderWindowIpc });
  expect(listeners.size).toBe(6);
  return { ...fixture, invoke: (method: string, sender: unknown, ...args: unknown[]) => listeners.get(`desktop:${method}`)!({ sender }, ...args) };
}
const methods = ['meetingOpenRecorderWindow', 'meetingSetRecorderWindowMode', 'meetingSetRecorderSessionState', 'meetingNotifyRecorderSummaryReady', 'meetingNotifyRecordingSaved', 'meetingCloseRecorderWindow'];
function effectCounts(fixture: ReturnType<typeof actualMainFixture>): unknown {
  return { windows: FakeBrowserWindow.instances.length, notification: fixture.notificationPort.show.mock.calls.length, saved: fixture.mainWindow.webContents.send.mock.calls.length,
    windowCalls: FakeBrowserWindow.instances.map(window => Object.fromEntries(Object.entries(window).filter(([key, value]) => ['loadFile', 'loadURL', 'show', 'focus', 'restore', 'center', 'close', 'destroy', 'setAlwaysOnTop', 'setVisibleOnAllWorkspaces', 'setWindowButtonVisibility', 'setResizable', 'setMinimumSize', 'setMaximumSize', 'setSize', 'setPosition'].includes(key) && vi.isMockFunction(value)).map(([key, value]) => [key, (value as ReturnType<typeof vi.fn>).mock.calls.length]))) };
}
describe('actual Main recorder six semantic registrations', () => {
  it('preserves all six normal controller replies and the Windows controller remains separately covered', async () => {
    const f = actualMainFixture();
    expect(await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: ' owned ' })).toEqual({ ok: true });
    const w = FakeBrowserWindow.instances[0]!;
    expect(w.loadFile).toHaveBeenCalledWith('/app/index.html', { hash: '/meeting-recorder/owned' });
    expect(await f.invoke(methods[1]!, w.webContents, { mode: 'compact' })).toEqual({ ok: true });
    expect(await f.invoke(methods[2]!, w.webContents, { state: 'recording' })).toEqual({ ok: true });
    w.focused = false;
    expect(await f.invoke(methods[3]!, w.webContents, { title: 'Summary' })).toEqual({ ok: true });
    expect(f.notificationPort.show).toHaveBeenCalledWith(expect.objectContaining({ body: 'Summary' }));
    expect(await f.invoke(methods[4]!, w.webContents, { collectionId: ' owned ' })).toEqual({ ok: true });
    expect(f.mainWindow.webContents.send).toHaveBeenCalledWith('desktop:meetingRecordingSaved', { collectionId: ' owned ' });
    expect(await f.invoke(methods[5]!, w.webContents)).toEqual({ ok: true });
    expect(w.close).toHaveBeenCalledTimes(1);
  });
  it.each(methods)('rejects unauthorized %s before getter or proxy input inspection', async method => {
    const f = actualMainFixture(); let reads = 0;
    const raw = Object.defineProperty({}, 'collectionId', { enumerable: true, get() { reads++; throw Error('getter_must_not_run'); } });
    const before = effectCounts(f);
    expect(await f.invoke(method, {}, raw)).toEqual({ ok: false, error: 'unauthorized_sender' });
    const proxy = new Proxy({}, { ownKeys() { reads++; throw Error('proxy_must_not_run'); } });
    expect(await f.invoke(method, {}, proxy)).toEqual({ ok: false, error: 'unauthorized_sender' });
    expect(reads).toBe(0); expect(effectCounts(f)).toEqual(before);
  });
  it.each(methods.slice(0, 5))('rejects authorized getter in %s without reading or effects', async method => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!;
    const key = method === methods[1] ? 'mode' : method === methods[2] ? 'state' : method === methods[3] ? 'title' : 'collectionId';
    let reads = 0; const raw = Object.defineProperty({}, key, { enumerable: true, get() { reads++; return key === 'mode' ? 'compact' : key === 'state' ? 'processing' : 'owned'; } });
    const before = effectCounts(f);
    expect(await f.invoke(method, method === methods[0] ? f.mainWindow.webContents : w.webContents, raw)).toEqual({ ok: false, error: 'recorder_input_invalid' });
    expect(reads).toBe(0); expect(effectCounts(f)).toEqual(before);
  });
  it('preserves required-field business refusals and summary blank-title compatibility', async () => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!; w.focused = false;
    for (const [method, error] of [[methods[0], 'collection_id_required'], [methods[1], 'invalid_mode'], [methods[2], 'invalid_state'], [methods[4], 'collection_id_required']] as const) {
      for (const payload of [undefined, null, {}]) {
        const before = effectCounts(f);
        expect(await f.invoke(method!, method === methods[0] ? f.mainWindow.webContents : w.webContents, payload)).toEqual({ ok: false, error });
        expect(effectCounts(f)).toEqual(before);
      }
    }
    for (const payload of [undefined, null, {}, { title: 123 }]) expect(await f.invoke(methods[3]!, w.webContents, payload)).toEqual({ ok: true });
    expect(await f.invoke(methods[3]!, w.webContents)).toEqual({ ok: true });
    expect(f.notificationPort.show).toHaveBeenLastCalledWith(expect.objectContaining({ body: '录音总结已生成' }));
  });
  it('rechecks the actual controller current-window identity after destruction and replacement', async () => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const old = FakeBrowserWindow.instances[0]!; old.destroy();
    await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'new' });
    const fresh = FakeBrowserWindow.instances[1]!;
    for (const method of methods.slice(1)) expect(await f.invoke(method, old.webContents, null)).toEqual({ ok: false, error: 'unauthorized_sender' });
    expect(await f.invoke(methods[2]!, fresh.webContents, { state: 'processing' })).toEqual({ ok: true });
  });
  it('rejects extra transport tuples and preserves denial priority for them', async () => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!;
    for (const method of methods) {
      const sender = method === methods[0] ? f.mainWindow.webContents : w.webContents;
      const before = effectCounts(f);
      expect(await f.invoke(method, sender, { collectionId: 'owned', mode: 'compact', state: 'recording', title: 'Summary' }, {})).toEqual({ ok: false, error: 'recorder_input_invalid' });
      expect(await f.invoke(method, {}, {}, {})).toEqual({ ok: false, error: 'unauthorized_sender' });
      expect(effectCounts(f)).toEqual(before);
    }
  });
  it('preserves focused-summary skipped and safe-data output fields', async () => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!;
    expect(await f.invoke(methods[3]!, w.webContents, { title: 'Summary' })).toEqual({ ok: true, skipped: true });
    expect(f.notificationPort.show).not.toHaveBeenCalled();
  });
  it.each(methods)('rejects malformed output from actual Main %s', async method => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!;
    const slot = ['open', 'setMode', 'setSessionState', 'notifySummaryReady', 'notifySaved', 'close'][methods.indexOf(method)]!;
    // Intentionally malformed private host-port reply, not a normal native-window fixture.
    Reflect.set(f.controller, slot, () => ({ ok: 'not_boolean' }));
    const args = method === methods[5] ? [] : [{ collectionId: 'owned', mode: 'compact', state: 'recording', title: 'Summary' }];
    await expect(f.invoke(method, method === methods[0] ? f.mainWindow.webContents : w.webContents, ...args)).rejects.toThrow('recorder_operation_unknown');
  });
  it.each(methods)('does not execute output getters from actual Main %s', async method => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!;
    const slot = ['open', 'setMode', 'setSessionState', 'notifySummaryReady', 'notifySaved', 'close'][methods.indexOf(method)]!;
    let reads = 0; const raw = Object.defineProperty({}, 'ok', { enumerable: true, get() { reads++; return true; } });
    Reflect.set(f.controller, slot, () => raw);
    const args = method === methods[5] ? [] : [{ collectionId: 'owned', mode: 'compact', state: 'recording', title: 'Summary' }];
    await expect(f.invoke(method, method === methods[0] ? f.mainWindow.webContents : w.webContents, ...args)).rejects.toThrow('recorder_operation_unknown');
    expect(reads).toBe(0);
  });
  it('copies the real registrar reply rather than exporting a private producer alias', async () => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!; const raw = { ok: true };
    Reflect.set(f.controller, 'setMode', () => raw);
    const reply = await f.invoke(methods[1]!, w.webContents, { mode: 'compact' });
    expect(reply).not.toBe(raw); raw.ok = false; expect(reply).toEqual({ ok: true });
  });
  it('uses native Then without executing a native Promise own then accessor', async () => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!; let reads = 0; const promise = Promise.resolve({ ok: true });
    Object.defineProperty(promise, 'then', { get() { reads++; throw Error('own_then_must_not_run'); } });
    Reflect.set(f.controller, 'setMode', () => promise);
    expect(await f.invoke(methods[1]!, w.webContents, { mode: 'compact' })).toEqual({ ok: true });
    expect(reads).toBe(0);
  });
  it('rejects a native Promise constructor accessor without executing it', async () => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!; let reads = 0; const promise = Promise.resolve({ ok: true });
    Object.defineProperty(promise, 'constructor', { get() { reads++; throw Error('ctor_must_not_run'); } });
    Reflect.set(f.controller, 'setMode', () => promise);
    await expect(f.invoke(methods[1]!, w.webContents, { mode: 'compact' })).rejects.toThrow('recorder_operation_unknown');
    expect(reads).toBe(0);
  });
  it('rejects a thenable output without executing its accessor', async () => {
    const f = actualMainFixture(); await f.invoke(methods[0]!, f.mainWindow.webContents, { collectionId: 'owned' });
    const w = FakeBrowserWindow.instances[0]!; let reads = 0;
    const raw = Object.defineProperty({ ok: true }, 'then', { enumerable: true, get() { reads++; throw Error('thenable_must_not_run'); } });
    Reflect.set(f.controller, 'setMode', () => raw);
    await expect(f.invoke(methods[1]!, w.webContents, { mode: 'compact' })).rejects.toThrow('recorder_operation_unknown');
    expect(reads).toBe(0);
  });

});
