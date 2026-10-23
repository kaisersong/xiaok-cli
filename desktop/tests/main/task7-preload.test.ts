// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
const snapshot = { taskId: 'task', sessionId: 'thread', status: 'completed', prompt: 'old', materials: [], events: [], createdAt: 1, updatedAt: 2 };
function port() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const remove = (channel: string, listener: (...args: unknown[]) => void) => {
    if (listeners.get(channel) === listener) listeners.delete(channel);
  };
  return { listeners,
    invoke: vi.fn(async (channel: string, ..._args: unknown[]): Promise<unknown> => channel === 'desktop:recoverTask' ? { snapshot, recoveredFromTaskId: 'task' } : channel === 'desktop:getActiveTask' || channel.startsWith('desktop:createTask') ? { taskId: 'task' } : undefined),
    on: vi.fn((channel, listener) => { listeners.set(channel, listener); }),
    removeListener: vi.fn(remove), off: vi.fn(remove), send: vi.fn(),
  };
}
async function check(api: ReturnType<typeof createPreloadApi>, ipc: ReturnType<typeof port>) {
  const rows = [
    ['createTask', [{ prompt: 'p', materials: [], context: { threadId: 'thread', taskIds: ['old'] } }], 'desktop:createTask'],
    ['createTaskWithFiles', [{ prompt: 'p', filePaths: ['C:\\Users\\User\\file.txt'], context: { threadId: 'thread', taskIds: ['old'] } }], 'desktop:createTaskWithFiles'],
    ['answerQuestion', [{ taskId: 'task', answer: { type: 'materials', questionId: 'q', materialIds: ['m'] } }], 'desktop:answerQuestion'],
    ['cancelTask', ['task'], 'desktop:cancelTask'], ['recoverTask', ['task', 'old'], 'desktop:recoverTask'], ['getActiveTask', [], 'desktop:getActiveTask'],
  ] as const;
  for (const [method, args, channel] of rows) {
    ipc.invoke.mockClear(); const value = await Reflect.apply(api[method], api, args);
    const expected = method === 'cancelTask' ? [{ taskId: 'task' }] : method === 'recoverTask' ? [{ taskId: 'task', legacyPrompt: 'old' }] : args;
    expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith(channel, ...expected);
    expect(value).toEqual(method === 'recoverTask' ? { snapshot, recoveredFromTaskId: 'task' } : method.startsWith('create') || method === 'getActiveTask' ? { taskId: 'task' } : undefined);
    const failure = Error('task-domain-failure'); ipc.invoke.mockRejectedValueOnce(failure); await expect(Reflect.apply(api[method], api, args)).rejects.toBe(failure);
  }
  let register!: () => void; ipc.invoke.mockImplementationOnce(() => new Promise<void>(resolve => { register = resolve; }));
  const handler = vi.fn(), release = api.subscribeTask('task', handler, 0);
  const payload = ipc.invoke.mock.calls.at(-1)![1] as { taskId: string; sinceIndex: number; subscriptionId: string };
  expect(payload).toEqual({ taskId: 'task', sinceIndex: 0, subscriptionId: expect.any(String) });
  ipc.listeners.get('desktop:taskEvent:task')!({}, { type: 'progress', eventId: 'e', message: 'event' }); expect(handler).toHaveBeenCalledOnce();
  release(); expect(ipc.listeners.has('desktop:taskEvent:task')).toBe(false);
  expect(ipc.invoke.mock.calls.some(([channel]) => channel === 'desktop:unsubscribeTask')).toBe(false);
  register(); await new Promise<void>(resolve => setImmediate(resolve));
  expect(ipc.invoke).toHaveBeenLastCalledWith('desktop:unsubscribeTask', { taskId: 'task', subscriptionId: payload.subscriptionId });
}
it('actual TS preload preserves all seven task APIs, exact tuples, DTOs and subscription registration barrier', async () => { const ipc = port(); await check(createPreloadApi(ipc), ipc); });
it('actual sandbox CJS preload preserves the same seven task APIs and physical event listener cleanup', async () => {
  const ipc = port(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), { require(name: string) {
    if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_name: string, value: typeof api) { api = value; } } };
    if (name === 'os') return os; throw Error('unexpected preload dependency');
  } }); await check(api, ipc);
});
