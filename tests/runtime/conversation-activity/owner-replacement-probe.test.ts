import { afterEach, expect, it, vi } from 'vitest';
import { probeReplacementOwner } from '../../../src/runtime/conversation-activity/cli.js';
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
