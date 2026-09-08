// @vitest-environment node
import Module, { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
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

async function setup(kind: 'typed' | 'packaged') {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>();
  const emitter = new EventEmitter();
  const ipc = {
    invoke: vi.fn((channel: string, input: unknown) => Promise.resolve().then(() => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`missing fixture handler: ${channel}`);
      return handler({}, input);
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
  const result = { goal: { state: { goalId: 'goal', revision: 1 } }, preparedTask: prepared };
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
  const window = { isDestroyed: () => false, once: vi.fn(), webContents: { id: 1,
    send: (channel: string, payload: unknown) => emitter.emit(channel, {}, payload) } };
  await registerDesktopIpc({ handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => {
    handlers.set(channel, handler);
  } } as never, window as never, service as never);
  return { api: api!, service, result, prepared, publish: (payload: unknown) => publish(payload), emitter,
    invoke: (method: Method, input: unknown) => (api![method] as (value: unknown) => Promise<unknown>)(input) };
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
