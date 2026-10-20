import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/xiaok-electron-test' },
  clipboard: { read: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

import { registerDesktopIpc } from '../../electron/ipc.js';

describe('desktop:subscribeTask sinceIndex passthrough', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-subscribe-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // dataRoot-backed stores may keep short-lived handles; cleanup is best-effort.
    }
  });

  function makeHarness(events: Array<{ type: string; n?: number }>) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    };
    const sent: unknown[] = [];
    const window = {
      isDestroyed: () => false,
      webContents: { send: (_channel: string, payload: unknown) => { sent.push(payload); } },
    };
    const subscribeCalls: Array<{ taskId: string; options: unknown }> = [];
    const services = {
      authorizeTaskRead: vi.fn(async () => {}),
      assertTaskReadCurrent:vi.fn(()=>{}),
      getDataRoot: () => join(rootDir, 'data'),
      async *subscribeTask(taskId: string, options?: { sinceIndex?: number; signal?: AbortSignal }) {
        subscribeCalls.push({ taskId, options });
        const start = typeof options?.sinceIndex === 'number' ? options.sinceIndex : 0;
        for (let i = start; i < events.length; i++) {
          yield events[i] as never;
        }
      },
    };
    const options = { multiAgentAuthorize: () => ({ actorId: 'desktop-user:profile' }) };
    return { handlers, sent, window, services, subscribeCalls, ipcMain, options };
  }

  async function flush() {
    // Allow the fire-and-forget async streaming loop inside the handler to drain.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('forwards only events at/after sinceIndex when provided', async () => {
    const events = [{ type: 'a', n: 0 }, { type: 'b', n: 1 }, { type: 'c', n: 2 }, { type: 'd', n: 3 }];
    const h = makeHarness(events);
    await registerDesktopIpc(h.ipcMain as never, h.window as never, h.services as never, h.options);

    await h.handlers.get('desktop:subscribeTask')?.({}, { taskId: 'task_x', sinceIndex: 2 });
    await flush();

    expect(h.subscribeCalls).toEqual([{ taskId: 'task_x', options: { sinceIndex: 2, signal: expect.any(AbortSignal) } }]);
    expect(h.sent).toEqual([{ type: 'c', n: 2 }, { type: 'd', n: 3 }]);
  });

  it('forwards full history when sinceIndex is omitted', async () => {
    const events = [{ type: 'a', n: 0 }, { type: 'b', n: 1 }];
    const h = makeHarness(events);
    await registerDesktopIpc(h.ipcMain as never, h.window as never, h.services as never, h.options);

    await h.handlers.get('desktop:subscribeTask')?.({}, { taskId: 'task_y' });
    await flush();

    expect(h.subscribeCalls).toEqual([{ taskId: 'task_y', options: { signal: expect.any(AbortSignal) } }]);
    expect(h.sent).toEqual([{ type: 'a', n: 0 }, { type: 'b', n: 1 }]);
  });

  it('treats sinceIndex of 0 as a full replay (not falsy-dropped)', async () => {
    const events = [{ type: 'a', n: 0 }, { type: 'b', n: 1 }];
    const h = makeHarness(events);
    await registerDesktopIpc(h.ipcMain as never, h.window as never, h.services as never, h.options);

    await h.handlers.get('desktop:subscribeTask')?.({}, { taskId: 'task_z', sinceIndex: 0 });
    await flush();

    expect(h.subscribeCalls).toEqual([{ taskId: 'task_z', options: { sinceIndex: 0, signal: expect.any(AbortSignal) } }]);
    expect(h.sent).toEqual([{ type: 'a', n: 0 }, { type: 'b', n: 1 }]);
  });

  it('rejects untrusted read, subscription and cancellation sibling entries before touching a task', async () => {
    const h = makeHarness([]);
    await registerDesktopIpc(h.ipcMain as never, h.window as never, h.services as never, { multiAgentAuthorize: () => null });
    for (const channel of ['desktop:subscribeTask', 'desktop:recoverTask', 'desktop:cancelTask', 'desktop:answerQuestion']) {
      await expect(h.handlers.get(channel)!({}, { taskId: 'someone-else' })).rejects.toThrow('task_actor_forbidden');
    }
    expect(h.subscribeCalls).toEqual([]); expect(h.services.authorizeTaskRead).not.toHaveBeenCalled();
  });
  it('uses owner control authorization for cancellation and a negative approval, never revoked-content read authorization', async () => {
    const h = makeHarness([]), control = vi.fn(async () => {}), cancel = vi.fn(async () => {}), answer = vi.fn(async () => {});
    h.services.authorizeTaskRead.mockRejectedValue(new Error('not_readable'));
    Object.assign(h.services, { authorizeTaskControl: control, cancelTask: cancel, answerQuestion: answer });
    await registerDesktopIpc(h.ipcMain as never, h.window as never, h.services as never, h.options);
    await expect(h.handlers.get('desktop:cancelTask')!({}, { taskId: 'own' })).resolves.toBeUndefined();
    await expect(h.handlers.get('desktop:answerQuestion')!({}, { taskId: 'own', answer: { questionId: 'approval', type: 'choice', choiceId: 'deny' } })).resolves.toBeUndefined();
    expect(control).toHaveBeenCalledTimes(2); expect(cancel).toHaveBeenCalledOnce(); expect(answer).toHaveBeenCalledOnce();
    await expect(h.handlers.get('desktop:answerQuestion')!({}, { taskId: 'own', answer: { questionId: 'approval', type: 'choice', choiceId: 'approve' } })).rejects.toThrow('not_readable');
  });
  it('checks a synchronous current fence at actual send after async authorization returns',async()=>{
    const h=makeHarness([{type:'result'}]);let calls=0,revoked=false;
    h.services.authorizeTaskRead.mockImplementation(async()=>{if(++calls===2)queueMicrotask(()=>{revoked=true;});});
    const current=vi.fn(()=>{if(revoked)throw new Error('not_readable');});Object.assign(h.services,{assertTaskReadCurrent:current});
    await registerDesktopIpc(h.ipcMain as never,h.window as never,h.services as never,h.options);await h.handlers.get('desktop:subscribeTask')!({},{taskId:'task_race'});await flush();expect(current).toHaveBeenCalled();expect(h.sent).toEqual([]);
  });

  it('releases the exact subscriber without an old disposer aborting its replacement', async () => {
    const h = makeHarness([]), signals: AbortSignal[] = [];
    h.services.subscribeTask = async function* (_task, options) {
      signals.push(options!.signal!);
      await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => resolve(), { once: true }));
    };
    await registerDesktopIpc(h.ipcMain as never, h.window as never, h.services as never, h.options);
    await h.handlers.get('desktop:subscribeTask')!({}, { taskId: 'task', subscriptionId: 'first' });
    await h.handlers.get('desktop:subscribeTask')!({}, { taskId: 'task', subscriptionId: 'second' });
    expect(signals[0].aborted).toBe(true);
    await h.handlers.get('desktop:unsubscribeTask')!({}, { taskId: 'task', subscriptionId: 'first' });
    expect(signals[1].aborted).toBe(false);
    await h.handlers.get('desktop:unsubscribeTask')!({}, { taskId: 'task', subscriptionId: 'second' });
    expect(signals[1].aborted).toBe(true);
  });
});
