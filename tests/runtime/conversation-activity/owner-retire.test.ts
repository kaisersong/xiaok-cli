import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { retireOutdatedOwner } from '../../../src/runtime/conversation-activity/owner-retire.js';
function fixture() {
  const status = { pid: process.pid + 1000, ownerEpoch: 'epoch', rootHash: 'hash' };
  const deps = { platform: 'linux' as NodeJS.Platform, currentPid: process.pid, currentUid: 42,
    readStatusFile: vi.fn(async () => status), readCmdline: vi.fn(async () => ['node', '/app/owner-entry.js', join('/root', 'activity-owner.config.json')]),
    readUid: vi.fn(async () => 42), kill: vi.fn(), isAlive: vi.fn(async () => false), readPendingTasks: vi.fn(async () => 'none' as const), sleep: vi.fn(async () => {}) };
  return { status, deps };
}
it('signals only the verified owner and waits for disappearance', async () => {
  const { status, deps } = fixture(); deps.isAlive.mockResolvedValueOnce(true);
  expect(await retireOutdatedOwner('/root', status, deps)).toBe('retired');
  expect(deps.kill.mock.calls).toEqual([[status.pid, 'SIGTERM']]); expect(deps.sleep).toHaveBeenCalledWith(50);
});
it.each(['pid', 'entry', 'root', 'uid', 'self', 'win32', 'freebsd', 'epoch', 'hash'])('refuses invalid identity: %s', async kind => {
  const { status, deps } = fixture();
  if (kind === 'pid') deps.readStatusFile.mockResolvedValue({ ...status, pid: status.pid + 1 });
  if (kind === 'epoch') deps.readStatusFile.mockResolvedValue({ ...status, ownerEpoch: 'other' });
  if (kind === 'hash') deps.readStatusFile.mockResolvedValue({ ...status, rootHash: 'other' });
  if (kind === 'entry') deps.readCmdline.mockResolvedValue(['node', join('/root', 'activity-owner.config.json')]);
  if (kind === 'root') deps.readCmdline.mockResolvedValue(['owner-entry.js', join('/root-other', 'activity-owner.config.json')]);
  if (kind === 'uid') deps.readUid.mockResolvedValue(43);
  if (kind === 'self') status.pid = process.pid;
  if (kind === 'win32' || kind === 'freebsd') deps.platform = kind;
  expect(await retireOutdatedOwner('/root', status, deps)).toBe('kept_unverified'); expect(deps.kill).not.toHaveBeenCalled(); expect(deps.readPendingTasks).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5, NaN])('rejects invalid pid %s', async pid => {
  const { status, deps } = fixture(); status.pid = pid;
  expect(await retireOutdatedOwner('/root', status, deps)).toBe('kept_unverified'); expect(deps.kill).not.toHaveBeenCalled(); expect(deps.readPendingTasks).not.toHaveBeenCalled();
});
it('times out at 3 seconds without SIGKILL', async () => {
  const { status, deps } = fixture(); deps.isAlive.mockResolvedValue(true);
  expect(await retireOutdatedOwner('/root', status, deps)).toBe('kept_unverified');
  expect(deps.sleep).toHaveBeenCalledTimes(60); expect(deps.kill.mock.calls).toEqual([[status.pid, 'SIGTERM']]);
});
it('accepts ESRCH when signaling an already exited owner', async () => {
  const { status, deps } = fixture(); deps.kill.mockImplementation(() => { throw Object.assign(new Error(), { code: 'ESRCH' }); });
  expect(await retireOutdatedOwner('/root', status, deps)).toBe('retired');
});
it('fails closed on observation or signal errors', async () => {
  const { status, deps } = fixture(); deps.readUid.mockRejectedValue(new Error('denied'));
  expect(await retireOutdatedOwner('/root', status, deps)).toBe('kept_unverified'); expect(deps.kill).not.toHaveBeenCalled(); expect(deps.readPendingTasks).not.toHaveBeenCalled();
});
it.each(['darwin', 'linux'] as const)('verifies command boundaries on %s', async platform => {
  const { status, deps } = fixture(); deps.platform = platform;
  const readCmdline = vi.fn(async () => platform === 'darwin' ? 'node /app/owner-entry.js /root/activity-owner.config.json' : ['node', '/app/owner-entry.js', '/root/activity-owner.config.json']);
  expect(await retireOutdatedOwner('/root', status, { ...deps, readCmdline })).toBe('retired');
  readCmdline.mockResolvedValue(platform === 'darwin' ? 'node owner-entry.js /root/activity-owner.config.json.other' : ['owner-entry.js', '/root/activity-owner.config.json.other']);
  deps.kill.mockClear(); deps.readPendingTasks.mockClear(); expect(await retireOutdatedOwner('/root', status, { ...deps, readCmdline })).toBe('kept_unverified'); expect(deps.kill).not.toHaveBeenCalled(); expect(deps.readPendingTasks).not.toHaveBeenCalled();
});
it('does not treat permission errors as process disappearance', async () => {
  const { status, deps } = fixture(); deps.isAlive.mockRejectedValue(Object.assign(new Error(), { code: 'EPERM' }));
  expect(await retireOutdatedOwner('/root', status, deps)).toBe('kept_unverified'); expect(deps.kill.mock.calls).toEqual([[status.pid, 'SIGTERM']]);
});

it.each(['pending', 'unknown'] as const)('keeps owner with %s tasks', async state => {
  const { status, deps } = fixture();
  expect(await retireOutdatedOwner('/root', status, { ...deps, readPendingTasks: async () => state })).toBe(`kept_${state}`);
  expect(deps.kill).not.toHaveBeenCalled();
});
it('reads tasks after identity checks immediately before kill', async () => {
  const { status, deps } = fixture(); const order: string[] = [];
  await retireOutdatedOwner('/root', status, { ...deps,
    readStatusFile: async () => { order.push('status'); return status; },
    readCmdline: async () => { order.push('command'); return ['owner-entry.js', join('/root', 'activity-owner.config.json')]; },
    readUid: async () => { order.push('uid'); return 42; },
    readPendingTasks: async () => { order.push('tasks'); return 'none'; },
    kill: () => { order.push('kill'); },
  }); expect(order).toEqual(['status', 'command', 'uid', 'tasks', 'kill']);
});
it('keeps owner when task reading throws or times out', async () => {
  vi.useFakeTimers();
  try {
    for (const readPendingTasks of [async () => { throw new Error('read'); }, () => new Promise<never>(() => {})]) {
      const { status, deps } = fixture(); const pending = retireOutdatedOwner('/root', status, { ...deps, readPendingTasks });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toBe('kept_unknown'); expect(deps.kill).not.toHaveBeenCalled();
    }
  } finally { vi.useRealTimers(); }
});
