// Real service, registrar, shutdown gate and Main authorizer; SDK data/network are controlled.
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction, runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { createPreloadApi } from '../../electron/preload-api.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
export const METHODS = ['exportTraceBundle', 'diagnose'] as const;
export type Method = typeof METHODS[number];
export const CHANNELS = { exportTraceBundle: 'desktop:trace:export', diagnose: 'desktop:diagnose' } as const;
export const TARGET = { kind: 'project', id: 'project-1' } as const;
export const outputFailure = (method: Method) => method === 'exportTraceBundle' ? 'diagnostics_export_operation_unknown' : 'diagnostics_projection_unavailable';
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const roots: string[] = [], cleanups: Array<() => Promise<unknown>> = [];
let previousConfig: string | undefined;
beforeEach(() => { previousConfig = process.env.XIAOK_CONFIG_DIR; resetIpcSchemaRegistryForTests(); });
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousConfig === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previousConfig;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
export async function fixture(status = 200) {
  const root = mkdtempSync(join(tmpdir(), 'diagnostics-input2-owned-')), data = join(root, 'data');
  roots.push(root); mkdirSync(data); process.env.XIAOK_CONFIG_DIR = join(root, 'config');
  const detail = {
    project: { id: 'project-1', name: 'Owned project', status: 'active' },
    tasks: [{ id: 'blocked-1', title: 'Owned review', status: 'blocked', blockedReason: 'Missing evidence', dependencies: [], artifacts: [] }],
    agents: [{ id: 'worker', name: 'Worker', status: 'idle' }], projectHealth: { status: 'blocked' },
    dispatchPlan: { dispatchable: [{ taskId: 'ready-1', reason: 'ready' }] },
  };
  const requests: string[] = [];
  let response: (path: string) => Response | Promise<Response> = () => status === 200 ? Response.json(detail) : new Response('{}', { status });
  const sdk = { start: async () => {}, stop: async () => {}, restart: async () => {},
    getStatus: () => ({ running: false, port: 4400, pid: null, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {}, request: async (path: string) => { requests.push(path); return response(path); } };
  const service = createDesktopServices({ dataRoot: data, kswarmService: sdk as never, runner: async () => { throw Error('input2_must_not_execute_task'); } });
  cleanups.push(async () => { await service.closeTaskSourceWritersForMigration(); await service.disposeMultiAgent(); });
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  expect(declaration).toBeDefined();
  const dirname = resolve('dist/main/desktop/electron'), frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href };
  const recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const sender = { mainFrame: frame, isDestroyed: () => false }, recorder = { mainFrame: recorderFrame, isDestroyed: () => false };
  const code = ts.transpileModule('let mainWindow=initialMain,meetingRecorderController=initialRecorder;\n' + declaration!.getText(ast)
    + '\nreturn { authorize:authorizeDesktopInvoke,setMain(value){mainWindow=value;} };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const authority = compileFunction(code, ['initialMain', 'initialRecorder', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process'])(
    { webContents: sender, isDestroyed: () => false }, { ownsWebContents: (value: unknown) => value === recorder }, isTrustedDesktopRendererUrl, join, dirname, { env: {} });
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const ipc = new ShutdownAwareIpcMain({ handle: (name, listener) => { expect(listeners.has(name)).toBe(false); listeners.set(name, listener); } }, gate, authority.authorize);
  await registerDesktopIpc(ipc, { isDestroyed: () => false, webContents: { id: 1, send() {} } } as never, service);
  const invokeEvent = (method: Method, event: unknown, ...args: unknown[]) => Reflect.apply(listeners.get(CHANNELS[method])!, undefined, [event, ...args]);
  const invoke = (method: Method, ...args: unknown[]) => invokeEvent(method, { sender, senderFrame: frame }, ...args);
  const transport = { invoke: (channel: string, ...args: unknown[]) => Reflect.apply(listeners.get(channel)!, undefined, [{ sender, senderFrame: frame }, ...args]), on() {}, off() {}, removeListener() {} };
  const preload = createPreloadApi(transport as never);
  let cjs: typeof preload;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require: (name: string) => name === 'electron' ? { contextBridge: { exposeInMainWorld: (name: string, api: typeof preload) => { if (name === 'xiaokDesktop') cjs = api; } }, ipcRenderer: transport } : name === 'os' ? os : undefined,
    console, Buffer, process,
  }, { filename: 'actual-diagnostics-input2-preload.cjs' });
  return { root, data, service, listeners, ipc, gate, frame, recorderFrame, sender, recorder, authority, invoke, invokeEvent, preload, cjs: cjs!, requests, detail,
    setResponse: (next: typeof response) => { response = next; },
    seedSnapshot: async () => {
      const store = new FileTaskSnapshotStore(join(data, 'tasks')); cleanups.push(() => store.closeAndDrain());
      await store.save({ taskId: 'task-1', sessionId: 'session-1', status: 'completed', prompt: 'Owned business task', materials: [],
        events: [{ type: 'progress', eventId: 'event-1', message: 'Owned evidence', stage: 'execution' }], createdAt: 100, updatedAt: 200 });
    },
  };
}
