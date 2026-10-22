// @vitest-environment node
import Module, { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { actualGoalSourceMainAuthority } from './goal-source-main-authority-fixture.js';
import { projection } from '../support/goal-get-fixture.js';
import { GOAL_TASK_MUTATION_OUTPUT } from '../../shared/goal-task-mutation-ipc-contract.js';
beforeEach(resetIpcSchemaRegistryForTests);
import { createPreloadApi, type FullDesktopApi } from '../../electron/preload-api.js';

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'xiaok-goal-source-ipc') },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => undefined },
  clipboard: { read: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
}));
import { registerDesktopIpc } from '../../electron/ipc.js';

const requestId = '1e46092d-627b-4ee3-8e4a-70c1bc17497e';
const methods = [
  ['createGoal', 'create'], ['replaceGoal', 'replace'], ['resumeGoal', 'resume'],
] as const;
type Method = typeof methods[number][0];
const inputFor = (method: Method) => method === 'resumeGoal'
  ? { threadId: 'thread', turnLimit: 4 }
  : { threadId: 'thread', objective: 'answer', expectedEvidenceKinds: ['answer'], turnLimit: 4 };

async function setup(kind: 'typed' | 'packaged', finer = true) {
  const handlers = new Map<string, IpcHandlerListener>();
  const frame = { url: pathToFileURL(resolve('dist/renderer/index.html')).href };
  let destroyed = false;
  const sender = { id: 1, mainFrame: frame, isDestroyed: () => destroyed, send: (channel: string, payload: unknown) => emitter.emit(channel, {}, payload) };
  const recorder = { mainFrame: frame, isDestroyed: () => false };
  let event: unknown = { sender, senderFrame: frame };
  const emitter = new EventEmitter();
  const ipc = {
    invoke: vi.fn((channel: string, input: unknown) => Promise.resolve().then(() => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`missing fixture handler: ${channel}`);
      return Reflect.apply(handler, undefined, [event, input]);
    })),
    on: (channel: string, listener: (...args: unknown[]) => void) => { emitter.on(channel, listener); },
    off: (channel: string, listener: (...args: unknown[]) => void) => { emitter.off(channel, listener); },
  };
  let api: FullDesktopApi;
  if (kind === 'typed') api = createPreloadApi(ipc);
  else {
    const require = createRequire(import.meta.url), file = resolve('electron/preload.cjs');
    type Loader = (name: string, parent: unknown, main: boolean) => unknown;
    const internals = Module as unknown as { _load: Loader }, original = internals._load;
    internals._load = (name, parent, main) => name === 'electron'
      ? { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_key: string, value: FullDesktopApi) => { api = value; } } }
      : original(name, parent, main);
    try { delete require.cache[file]; require(file); }
    finally { internals._load = original; delete require.cache[file]; }
  }
  const prepared = { attachmentId: 'attachment', threadId: 'thread', taskId: 'task', expiresAt: 30_000,
    goalRef: { goalId: 'goal', revision: 1 },
    executionScope: { kind: 'goal_turn', origin: 'user', threadId: 'thread', goalId: 'goal', epoch: 1, goalTurnId: 'turn' },
    attachmentSource: { kind: 'request', requestId } };
  const result = { goal: projection(), preparedTask: prepared };
  expect(GOAL_TASK_MUTATION_OUTPUT.safeParse(result).success).toBe(true);
  // This fixture measures the real IPC parser and both preload implementations.
  // Actual coordinator/SQLite source derivation is covered by P1/P4, not this stub.
  const service = {
    getDataRoot: () => join(tmpdir(), 'xiaok-goal-source-ipc'),
    createGoal: vi.fn(async (_input: unknown) => result),
    replaceGoal: vi.fn(async (_input: unknown) => result),
    resumeGoal: vi.fn(async (_input: unknown) => result),
    subscribeGoalTaskPrepared: (handler: (payload: unknown) => void) => { publish = handler; return () => {}; },
  };
  let publish!: (payload: unknown) => void;
  const window = { isDestroyed: () => false, once: vi.fn(), webContents: sender };
  const authority = actualGoalSourceMainAuthority(window, recorder, service);
  const gate = new DesktopShutdownGate();
  const ownedIpc = new ShutdownAwareIpcMain({ handle: (channel, handler) => { handlers.set(channel, handler); } }, gate, authority.authorize);
  await registerDesktopIpc(ownedIpc as never, window as never, service as never,
    finer ? { multiAgentAuthorize: authority.finer as never } : {});
  const invoke = (method: Method, input: unknown) => (api![method] as (value: unknown) => Promise<unknown>)(input);
  return { api: api!, service, result, prepared, publish: (payload: unknown) => publish(payload), emitter,
    invoke, sender, frame, recorder, authority, gate, destroy: () => { destroyed = true; },
    invokeAs: async (method: Method, input: unknown, other: unknown) => {
      const previous = event; event = other;
      try { return await invoke(method, input); } finally { event = previous; }
    } };

}

describe.each(['typed', 'packaged'] as const)('W2-P2 %s Goal source transport', kind => {
  it.each(methods)('%s admits the canonical request id through the actual semantic IPC parser', async (method) => {
    const f = await setup(kind), input = { ...inputFor(method), requestId };
    await expect(f.invoke(method, input)).resolves.toEqual(f.result);
    expect(f.service[method]).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each(methods)('%s preserves the existing omitted-id caller contract', async method => {
    const f = await setup(kind), input = inputFor(method);
    await expect(f.invoke(method, input)).resolves.toEqual(f.result);
    expect(f.service[method]).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each(methods)('%s rejects malformed ids before entering the service', async method => {
    const f = await setup(kind);
    for (const invalid of ['', null, 1, {}, [], ` ${requestId}`, `${requestId} `, requestId.toUpperCase(),
      requestId.replace('-4ee3-', '-5ee3-'), 'x'.repeat(201)]) {
      await expect(f.invoke(method, { ...inputFor(method), requestId: invalid })).rejects.toThrow('invalid_goal_request_id');
      expect(f.service[method]).not.toHaveBeenCalled();
    }
  });

  it.each(methods)('%s never admits a caller-defined source or predecessor', async method => {
    const f = await setup(kind);
    for (const field of ['attachmentSource', 'kind', 'predecessorTaskId']) {
      await expect(f.invoke(method, { ...inputFor(method), [field]: 'automatic' })).rejects.toThrow(`invalid_goal_field:${field}`);
      expect(f.service[method]).not.toHaveBeenCalled();
    }
  });

  it.each(methods)('%s denies unowned senders before payload access or service calls', async method => {
    const f = await setup(kind), missing = await setup(kind, false); let reads = 0;
    const payload = Object.defineProperty({}, 'threadId', { enumerable: true, get() { reads++; return 'thread'; } });
    for (const event of [
      { sender: { ...f.sender }, senderFrame: f.frame },
      { sender: f.sender, senderFrame: { ...f.frame } },
    ]) await expect(f.invokeAs(method, payload, event)).rejects.toThrow('desktop_user_sender_forbidden');
    await expect(f.invokeAs(method, payload, { sender: f.recorder, senderFrame: f.frame })).rejects.toThrow('goal_task_mutation_sender_forbidden');
    await expect(missing.invoke(method, payload)).rejects.toThrow('goal_task_mutation_sender_forbidden');
    const url = f.frame.url; f.frame.url = 'https://untrusted.invalid/';
    await expect(f.invoke(method, payload)).rejects.toThrow('desktop_user_sender_forbidden'); f.frame.url = url;
    f.authority.setMain({ isDestroyed: () => false, webContents: {} });
    await expect(f.invoke(method, payload)).rejects.toThrow('desktop_user_sender_forbidden');
    f.authority.setMain({ isDestroyed: () => false, webContents: f.sender }); f.destroy();
    await expect(f.invoke(method, payload)).rejects.toThrow('desktop_user_sender_forbidden');
    expect(reads).toBe(0); expect(f.service[method]).not.toHaveBeenCalled(); expect(missing.service[method]).not.toHaveBeenCalled();
    expect(f.gate.outstanding).toBe(0); expect(missing.gate.outstanding).toBe(0);
  });

  it('forwards request/automatic prepared metadata and removes its actual event listener', async () => {
    const f = await setup(kind), received = vi.fn(), release = f.api.onGoalTaskPrepared(received);
    f.publish(f.prepared);
    const automatic = { ...f.prepared, attachmentSource: { kind: 'automatic', predecessorTaskId: 'previous-task' } };
    f.publish(automatic);
    expect(received.mock.calls).toEqual([[f.prepared], [automatic]]);
    expect(f.emitter.listenerCount('desktop:goal:taskPrepared')).toBe(1);
    release();
    expect(f.emitter.listenerCount('desktop:goal:taskPrepared')).toBe(0);
    f.publish(automatic); expect(received).toHaveBeenCalledTimes(2);
  });
});
