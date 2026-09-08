// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { bounded, createPostSealHarness, type PostSealHarness } from '../fixtures/desktop-post-seal-harness.js';

describe('R4 D15 disposal observes actual late host drain before boot quiescence', () => {
  const fixtures: PostSealHarness[] = [];
  afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
  it('keeps a pending raw reader owned, then quiesces exactly once and revokes the live report handle after true drain', async () => {
    const f = await createPostSealHarness({ spawnChild: false, readOrdinal: 1, prompt: 'Hello' }); fixtures.push(f);
    const db = new DatabaseSync(join(f.root, 'groups.sqlite'));
    const state = () => (db.prepare('SELECT state FROM boot_owners WHERE boot_id=?').get(f.store.bootId) as { state: string }).state;
    const settle = vi.spyOn(f.store, 'settleBootOwnership');
    try {
      const taskId = await f.start(); await bounded(f.readEntered.promise);
      await bounded(f.service.dispose());
      expect(state()).toBe('active'); expect(settle).not.toHaveBeenCalled();
      expect(f.host.inFlightTaskIds()).toContain(taskId); expect(f.tokenReleases).toBe(0);
      f.readRelease.resolve(); await bounded(f.host.drain());
      await vi.waitFor(() => expect(state()).toBe('quiesced'));
      expect(settle).toHaveBeenCalledTimes(1); expect(f.tokenReleases).toBe(1);
      const last = structuredClone(f.reports.at(-1)!);
      await expect(f.service.recordHostDelivery({ requestSource: 'scheduler', authority: f.authority!, report: last as never })).rejects.toThrow(/owner/);
      await f.service.dispose(); expect(settle).toHaveBeenCalledTimes(1);
    } finally { db.close(); }
  });
});
