import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CliConversationActivities } from '../../../src/runtime/conversation-activity/cli.js';
import { ACTIVITY_STARTUP_WAIT_MS, attachCliConversationActivitiesWithinBudget, createActivityStartupNotices } from '../../../src/runtime/conversation-activity/cli-loader.js';
const options = { print: false, isTTY: true, conversationActivity: undefined, attachOptions: {} as Parameters<typeof CliConversationActivities.attach>[0] };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup() {
  let resolve!: (instance: CliConversationActivities) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<CliConversationActivities>((yes, no) => { resolve = yes; reject = no; });
  const notices = createActivityStartupNotices({ configDir: '' });
  const onLate = vi.fn(), onSettled = vi.fn(), onDebug = vi.fn();
  const promise = attachCliConversationActivitiesWithinBudget({ ...options, startupNotices: notices, onDebug }, { onLate, onSettled }, {
    importCli: async () => ({ CliConversationActivities: { attach: () => pending } }),
  });
  return { promise, resolve, reject, notices, onLate, onSettled, onDebug };
}
it('returns at 2000ms and delivers a late instance without a timeout notice', async () => {
  const s = setup(); let settled = false; void s.promise.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(ACTIVITY_STARTUP_WAIT_MS - 1); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(await s.promise).toBeUndefined();
  expect(s.notices.take()).toBeUndefined();
  expect(s.onDebug).toHaveBeenCalledWith('cli_activity_startup_deferred', '');
  const instance = {} as CliConversationActivities; s.resolve(instance);
  await vi.advanceTimersByTimeAsync(0);
  expect(s.onLate).toHaveBeenCalledExactlyOnceWith(instance); expect(s.onSettled).toHaveBeenCalledOnce();
  expect(s.notices.take()?.text).toBe('已在后台启动任务跟进，设 XIAOK_CONVERSATION_ACTIVITY=0 可关闭。');
});
it('returns an instance within budget without late callbacks', async () => {
  const s = setup(); const instance = {} as CliConversationActivities;
  setTimeout(() => s.resolve(instance), 200); await vi.advanceTimersByTimeAsync(200);
  expect(await s.promise).toBe(instance); expect(s.onLate).not.toHaveBeenCalled(); expect(s.onSettled).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it.each([false, true])('queues ordinary owner failure (deferred=%s)', async deferred => {
  const s = setup();
  if (deferred) { await vi.advanceTimersByTimeAsync(2000); expect(await s.promise).toBeUndefined(); }
  s.reject(new Error('owner failed')); await vi.advanceTimersByTimeAsync(0);
  expect(await s.promise).toBeUndefined();
  expect(s.notices.take()?.text).toBe('异步任务跟进暂不可用，其他功能不受影响。如不需要，可设 XIAOK_CONVERSATION_ACTIVITY=0 关闭。');
  s.notices.queueOwnerUnavailable(); expect(s.notices.take()).toBeUndefined();
  expect(s.onLate).not.toHaveBeenCalled(); expect(s.onSettled).toHaveBeenCalledTimes(deferred ? 1 : 0);
});
