import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { handleOwnerDisconnect, probeReplacementOwner } from '../../../src/runtime/conversation-activity/cli.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it.each(['new', 'old'])('requires a live different epoch: %s', async epoch => {
  vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockResolvedValue({ ownerEpoch: epoch, ready: true });
  const dispose = vi.spyOn(ConversationActivityOwnerClient.prototype, 'dispose');
  expect(await probeReplacementOwner('/tmp/activity-probe', 'old')).toBe(epoch !== 'old'); expect(dispose).toHaveBeenCalledOnce();
});
it('probes within 1.5 seconds and closes unanswered connections', async () => {
  vi.useFakeTimers(); vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockImplementation(() => new Promise(() => {}));
  const dispose = vi.spyOn(ConversationActivityOwnerClient.prototype, 'dispose');
  const pending = probeReplacementOwner('/tmp/activity-probe', 'old'); await vi.advanceTimersByTimeAsync(1500);
  expect(await pending).toBe(false); expect(dispose).toHaveBeenCalledOnce();
});
it('retries missing owner until positive evidence appears', async () => {
  vi.useFakeTimers(); vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockRejectedValueOnce(new Error('absent')).mockResolvedValue({ ownerEpoch: 'new' });
  const pending = probeReplacementOwner('/tmp/activity-probe', 'old'); await vi.advanceTimersByTimeAsync(100); expect(await pending).toBe(true);
});
it('ignores crash with no responding successor', async () => {
  vi.useFakeTimers(); vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockRejectedValue(new Error('absent'));
  const pending = probeReplacementOwner('/tmp/activity-probe', 'old'); await vi.advanceTimersByTimeAsync(1500); expect(await pending).toBe(false);
});
it.skipIf(process.platform === 'win32')('treats an unusable data root as no successor instead of rejecting (#145)', async () => {
  // The disconnect handler fires probeReplacementOwner without a catch; a data root that no
  // longer validates (here: the activity tree became a link) must resolve false, not reject.
  const base = mkdtempSync(join(tmpdir(), 'activity-probe-unusable-'));
  try {
    mkdirSync(join(base, 'elsewhere'));
    symlinkSync(join(base, 'elsewhere'), join(base, 'conversation-activity'));
    vi.useFakeTimers();
    const pending = probeReplacementOwner(join(base, 'conversation-activity', 'root'), 'old');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe(false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// #145（第 7 轮 DS M4）：断连处理是 fire-and-forget，onOwnerReplaced / onError 自身抛错都不能变成未处理拒绝。
it('keeps the disconnect reaction from rejecting when the callbacks throw', async () => {
  const errors: unknown[] = [];
  const replacedFailure = new Error('flush failed');
  await expect(handleOwnerDisconnect(async () => true, () => false, {
    onOwnerReplaced: () => { throw replacedFailure; }, onError: error => { errors.push(error); },
  })).resolves.toBeUndefined();
  expect(errors).toEqual([replacedFailure]);
  await expect(handleOwnerDisconnect(async () => { throw new Error('probe failed'); }, () => false, {
    onError: () => { throw new Error('diagnostics failed'); },
  })).resolves.toBeUndefined();
  let replaced = 0;
  await handleOwnerDisconnect(async () => true, () => true, { onOwnerReplaced: () => { replaced += 1; } });
  expect(replaced).toBe(0);
});
