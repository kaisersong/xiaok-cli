import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { retireOutdatedOwner } from '../../../src/runtime/conversation-activity/owner-retire.js';
function fixture() {
  const status = { pid: process.pid + 1000, ownerEpoch: 'epoch', rootHash: 'hash' };
  const deps = { platform: 'linux' as NodeJS.Platform, currentPid: process.pid, currentUid: 42,
    readStatusFile: vi.fn(async () => status), readCmdline: vi.fn(async () => ['node', '/app/owner-entry.js', join('/root', 'activity-owner.config.json')]),
    readUid: vi.fn(async () => 42), kill: vi.fn(), isAlive: vi.fn(async () => false), sleep: vi.fn(async () => {}) };
  return { status, deps };
}
it('signals only the verified owner and waits for disappearance', async () => {
  const { status, deps } = fixture(); deps.isAlive.mockResolvedValueOnce(true);
  expect(await retireOutdatedOwner('/root', status, deps)).toBe(true);
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
  expect(await retireOutdatedOwner('/root', status, deps)).toBe(false); expect(deps.kill).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5, NaN])('rejects invalid pid %s', async pid => {
  const { status, deps } = fixture(); status.pid = pid;
  expect(await retireOutdatedOwner('/root', status, deps)).toBe(false); expect(deps.kill).not.toHaveBeenCalled();
});
it('times out at 3 seconds without SIGKILL', async () => {
  const { status, deps } = fixture(); deps.isAlive.mockResolvedValue(true);
  expect(await retireOutdatedOwner('/root', status, deps)).toBe(false);
  expect(deps.sleep).toHaveBeenCalledTimes(60); expect(deps.kill.mock.calls).toEqual([[status.pid, 'SIGTERM']]);
});
it('accepts ESRCH when signaling an already exited owner', async () => {
  const { status, deps } = fixture(); deps.kill.mockImplementation(() => { throw Object.assign(new Error(), { code: 'ESRCH' }); });
  expect(await retireOutdatedOwner('/root', status, deps)).toBe(true);
});
it('fails closed on observation or signal errors', async () => {
  const { status, deps } = fixture(); deps.readUid.mockRejectedValue(new Error('denied'));
  expect(await retireOutdatedOwner('/root', status, deps)).toBe(false); expect(deps.kill).not.toHaveBeenCalled();
});
it.each(['darwin', 'linux'] as const)('verifies command boundaries on %s', async platform => {
  const { status, deps } = fixture(); deps.platform = platform;
  const readCmdline = vi.fn(async () => platform === 'darwin' ? 'node /app/owner-entry.js /root/activity-owner.config.json' : ['node', '/app/owner-entry.js', '/root/activity-owner.config.json']);
  expect(await retireOutdatedOwner('/root', status, { ...deps, readCmdline })).toBe(true);
  readCmdline.mockResolvedValue(platform === 'darwin' ? 'node owner-entry.js /root/activity-owner.config.json.other' : ['owner-entry.js', '/root/activity-owner.config.json.other']);
  deps.kill.mockClear(); expect(await retireOutdatedOwner('/root', status, { ...deps, readCmdline })).toBe(false); expect(deps.kill).not.toHaveBeenCalled();
});
it('does not treat permission errors as process disappearance', async () => {
  const { status, deps } = fixture(); deps.isAlive.mockRejectedValue(Object.assign(new Error(), { code: 'EPERM' }));
  expect(await retireOutdatedOwner('/root', status, deps)).toBe(false); expect(deps.kill.mock.calls).toEqual([[status.pid, 'SIGTERM']]);
});
