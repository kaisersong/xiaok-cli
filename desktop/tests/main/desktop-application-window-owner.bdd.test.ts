// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DesktopApplicationWindowOwner } from '../../electron/desktop-application-window-owner.js';

describe('BDD: application bootstrap is independent of window lifetime', () => {
  it('A1/U3 Given concurrent opens and a later destroyed view, Then bootstrap runs once and replacement only creates a view', async () => {
    let bootCount = 0; let viewCount = 0; let current: { id: number; destroyed: boolean } | null = null;
    let resolveBoot!: () => void; const barrier = new Promise<void>(resolve => { resolveBoot = resolve; });
    const owner = new DesktopApplicationWindowOwner({
      current: () => current && !current.destroyed ? current : null,
      bootstrap: async () => { ++bootCount; await barrier; return current = { id: 1, destroyed: false }; },
      createView: async () => { ++viewCount; return current = { id: 2, destroyed: false }; },
    });
    const first = owner.open(); const concurrent = owner.open(); resolveBoot();
    expect(await first).toBe(await concurrent); expect(bootCount).toBe(1);
    current!.destroyed = true;
    expect((await owner.open()).id).toBe(2); expect(viewCount).toBe(1); expect(bootCount).toBe(1);
  });

  it('A1 Given partially failed bootstrap, Then subsequent opens report the original failure and never initialize a second runtime', async () => {
    let boots = 0; let views = 0;
    const owner = new DesktopApplicationWindowOwner({ current: () => null,
      bootstrap: async () => { ++boots; throw new Error('partial initialization'); }, createView: async () => { ++views; return {}; } });
    await expect(owner.open()).rejects.toThrow('partial initialization');
    await expect(owner.open()).rejects.toThrow('partial initialization');
    expect(boots).toBe(1); expect(views).toBe(0);
  });
});
