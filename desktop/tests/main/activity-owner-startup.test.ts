import { describe, expect, it, vi } from 'vitest';
import { ACTIVITY_OWNER_UNAVAILABLE_NOTICE, createOnceNotice, startKSwarmWithActivityOwner } from '../../electron/activity-owner-startup.js';
import { zh } from '../../renderer/src/locales/zh.js';
import { en } from '../../renderer/src/locales/en.js';

const sourceConfig = { kswarm: { url: 'u', mutationToken: 't', brokerUrl: 'b', roomToken: 'r' }, managedSources: [] } as never;
function deps(attach: () => Promise<void>, over: Record<string, unknown> = {}) {
  const kswarmService = { activityOwnerConfig: vi.fn(async () => sourceConfig), releaseActivityOwnerDelegation: vi.fn(), start: vi.fn(async () => {}) };
  return { kswarmService, attachConversationActivityOwner: vi.fn(attach), activityEnabled: true, log: vi.fn(), ...over };
}

describe('Desktop startup when the activity owner cannot be attached', () => {
  it('starts KSwarm even when attach fails, releases delegation, and shows the notice without the internal code', async () => {
    const show = vi.fn(); const d = deps(async () => { throw new Error('activity_owner_config_mismatch'); });
    const result = await startKSwarmWithActivityOwner(d as never, createOnceNotice(show));
    expect(result).toEqual({ attached: false });
    expect(d.kswarmService.releaseActivityOwnerDelegation).toHaveBeenCalledTimes(1);
    expect(d.kswarmService.start).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith('xiaoK 的后台组件和当前版本不一致，部分功能暂时无法启动。请退出所有 xiaok 窗口后重新打开。');
    expect(String(show.mock.calls[0][0])).not.toMatch(/activity_|mismatch|config/);
  });

  it('shows the notice once per failure however often the attach is retried, and again only for a different failure', async () => {
    const show = vi.fn(); const once = createOnceNotice(show);
    for (let i = 0; i < 5; i++) await startKSwarmWithActivityOwner(deps(async () => { throw new Error('activity_owner_config_mismatch'); }) as never, once);
    expect(show).toHaveBeenCalledTimes(1);
    await startKSwarmWithActivityOwner(deps(async () => { throw new Error('activity_owner_start_timeout'); }) as never, once);
    expect(show).toHaveBeenCalledTimes(2);
    expect(show.mock.calls.every(([text]) => text === ACTIVITY_OWNER_UNAVAILABLE_NOTICE)).toBe(true);
  });

  it('a throwing notice presenter cannot stop KSwarm from starting', async () => {
    const d = deps(async () => { throw new Error('activity_owner_exited'); });
    await expect(startKSwarmWithActivityOwner(d as never, createOnceNotice(() => { throw new Error('no notification'); }))).resolves.toEqual({ attached: false });
    expect(d.kswarmService.start).toHaveBeenCalledTimes(1);
  });

  it('does nothing extra when the owner attaches, or when conversation activity is disabled', async () => {
    const show = vi.fn(); const ok = deps(async () => {});
    await expect(startKSwarmWithActivityOwner(ok as never, createOnceNotice(show))).resolves.toEqual({ attached: true });
    expect(ok.kswarmService.releaseActivityOwnerDelegation).not.toHaveBeenCalled(); expect(ok.kswarmService.start).toHaveBeenCalledTimes(1);
    const off = deps(async () => { throw new Error('must not be called'); }, { activityEnabled: false });
    await startKSwarmWithActivityOwner(off as never, createOnceNotice(show));
    expect(off.attachConversationActivityOwner).not.toHaveBeenCalled(); expect(off.kswarmService.start).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });

  it('still reports a genuine KSwarm start failure (only the attach error is absorbed)', async () => {
    const d = deps(async () => {}); d.kswarmService.start.mockRejectedValueOnce(new Error('kswarm_start_failed'));
    await expect(startKSwarmWithActivityOwner(d as never, createOnceNotice(vi.fn()))).rejects.toThrow('kswarm_start_failed');
  });

  it('UI strings carry the notice in zh and en and never an internal code', () => {
    expect(zh.conversationActivity.ownerUnavailable).toBe(ACTIVITY_OWNER_UNAVAILABLE_NOTICE);
    for (const text of [zh.conversationActivity.ownerUnavailable, en.conversationActivity.ownerUnavailable, ACTIVITY_OWNER_UNAVAILABLE_NOTICE]) {
      expect(text).not.toMatch(/activity_owner|config_mismatch|_unavailable/);
    }
    expect(en.conversationActivity.ownerUnavailable.length).toBeGreaterThan(20);
  });
});
