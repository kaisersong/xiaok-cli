// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
it('preserves the owner-issued event index and source epoch instead of making a renderer counter authoritative', () => {
  const listeners = new Map<string, Function>();
  const ipc = { invoke: vi.fn(async () => undefined), on: (channel: string, listener: Function) => listeners.set(channel, listener), off: vi.fn() };
  const api = createPreloadApi(ipc as never); const receive = vi.fn(); const off = api.subscribeTask('task_real', receive, 12);
  const event = { type: 'result', result: { summary: 'done', artifacts: [] } };
  listeners.get('desktop:taskEvent:task_real')!(null, { taskId: 'task_real', sourceDataEpoch: 'owner_epoch', eventIndex: 17, event });
  expect(receive).toHaveBeenCalledWith(event, { taskId: 'task_real', sourceDataEpoch: 'owner_epoch', eventIndex: 17 });
  off();
});
