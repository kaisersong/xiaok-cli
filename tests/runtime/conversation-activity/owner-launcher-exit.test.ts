import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureConversationActivityOwner } from '../../../src/runtime/conversation-activity/owner-launcher.js';
import { ACTIVITY_OWNER_GENERATION } from '../../../src/runtime/conversation-activity/owner-protocol.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';
import { activityOwnerConfigDigest, type ActivityOwnerConfig } from '../../../src/runtime/conversation-activity/owner-runtime.js';
// Launcher tests do not boot the SQLite-backed owner runtime.
vi.mock('../../../src/runtime/conversation-activity/owner-entry.js', () => ({}));
vi.mock('../../../src/runtime/conversation-activity/owner-runtime.js', () => ({
  activityOwnerConfigDigest: (config: ActivityOwnerConfig) => JSON.stringify(config),
}));
let root: string;
beforeEach(() => { vi.useFakeTimers(); root = mkdtempSync(join(tmpdir(), 'owner-exit-')); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });
function launch(event: 'exit' | 'error' = 'exit', successAt?: number) {
  const config: ActivityOwnerConfig = { schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } };
  let calls = 0;
  vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockImplementation(async () => {
    if (successAt && ++calls >= successAt) return { generation: ACTIVITY_OWNER_GENERATION, profileId: config.profileId, configDigest: activityOwnerConfigDigest(config), ready: true } as any;
    throw new Error('not_ready');
  });
  const error = new Error('spawn_failed');
  const child = Object.assign(new EventEmitter(), { pid: 123, unref: vi.fn() });
  const fakeSpawn = vi.fn(() => { queueMicrotask(() => child.emit(event, event === 'exit' ? 1 : error)); return child; });
  return { promise: ensureConversationActivityOwner(config, { spawn: fakeSpawn as unknown as typeof spawn }), error };
}
it('rejects after the exit grace rather than the 30 second timeout', async () => {
  const { promise } = launch();
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  const rejection = expect(promise).rejects.toThrow('activity_owner_exited');
  await vi.advanceTimersByTimeAsync(499);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(51);
  await rejection;
});
it('attaches to a competing owner during exit grace', async () => {
  const { promise } = launch('exit', 4);
  await vi.advanceTimersByTimeAsync(200);
  const client = await promise;
  expect(client).toBeInstanceOf(ConversationActivityOwnerClient);
  client.dispose();
});
it('preserves the original spawn error', async () => {
  const { promise, error } = launch('error');
  const rejection = expect(promise).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(50);
  await rejection;
});
it.each([undefined, 1, 2, '2'])('retires outdated generation %s (2 = built by #23, before the digest change) before validating digest', async generation => {
  const config: ActivityOwnerConfig = { schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } };
  vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockResolvedValueOnce({ profileId: 'fake', generation, configDigest: 'old' } as any)
    .mockResolvedValue({ profileId: 'fake', generation: ACTIVITY_OWNER_GENERATION, configDigest: activityOwnerConfigDigest(config) } as any);
  const retire = vi.fn(async () => 'retired' as const);
  const fakeSpawn = vi.fn(() => Object.assign(new EventEmitter(), { unref: vi.fn() }));
  const client = await ensureConversationActivityOwner(config, { retire, spawn: fakeSpawn as unknown as typeof spawn });
  expect(retire).toHaveBeenCalledTimes(1); expect(fakeSpawn).toHaveBeenCalledTimes(1); client.dispose();
});
it.each([undefined, ACTIVITY_OWNER_GENERATION, ACTIVITY_OWNER_GENERATION + 1])('reuses owner when retirement fails or generation is current/future: %s', async generation => {
  const config: ActivityOwnerConfig = { schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } };
  vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockResolvedValue({ profileId: 'fake', generation, configDigest: generation ? activityOwnerConfigDigest(config) : 'old' } as any);
  const retire = vi.fn(async () => 'kept_unverified' as const), fakeSpawn = vi.fn();
  const client = await ensureConversationActivityOwner(config, { retire, spawn: fakeSpawn as unknown as typeof spawn });
  expect(retire).toHaveBeenCalledTimes(generation ? 0 : 1); expect(fakeSpawn).not.toHaveBeenCalled(); client.dispose();
});
it('rejects foreign profile without retirement', async () => {
  const config: ActivityOwnerConfig = { schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } };
  vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockResolvedValue({ profileId: 'foreign' } as any);
  const retire = vi.fn(async () => 'retired' as const);
  await expect(ensureConversationActivityOwner(config, { retire })).rejects.toThrow('activity_owner_profile_mismatch'); expect(retire).not.toHaveBeenCalled();
});
it('concurrent retirement spawns one winner and attaches loser during exit grace', async () => {
  const config: ActivityOwnerConfig = { schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } };
  let calls = 0, winner = false, effectiveOwners = 0;
  vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockImplementation(async () => {
    if (++calls <= 2) return { profileId: 'fake' } as any;
    if (!winner) throw new Error('not_ready');
    return { profileId: 'fake', generation: ACTIVITY_OWNER_GENERATION, pid: 123, configDigest: activityOwnerConfigDigest(config) } as any;
  });
  const fakeSpawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    if (fakeSpawn.mock.calls.length === 1) { effectiveOwners++; setTimeout(() => { winner = true; }, 150); }
    else queueMicrotask(() => child.emit('exit', 1));
    return child;
  });
  const retire = vi.fn(async () => 'retired' as const);
  const pending = Promise.all([ensureConversationActivityOwner(config, { retire, spawn: fakeSpawn as unknown as typeof spawn }), ensureConversationActivityOwner(config, { retire, spawn: fakeSpawn as unknown as typeof spawn })]);
  await vi.advanceTimersByTimeAsync(200);
  const clients = await pending; expect(effectiveOwners).toBe(1); expect(fakeSpawn).toHaveBeenCalledTimes(2); expect(retire).toHaveBeenCalledTimes(2);
  for (const client of clients) { expect(await client.request('status')).toMatchObject({ pid: 123 }); client.dispose(); }
});
it.each([ACTIVITY_OWNER_GENERATION, ACTIVITY_OWNER_GENERATION + 1])('keeps config digest validation for generation %s', async generation => {
  const config: ActivityOwnerConfig = { schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } };
  vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockResolvedValue({ profileId: 'fake', generation, configDigest: 'foreign' } as any);
  const retire = vi.fn(async () => 'retired' as const);
  await expect(ensureConversationActivityOwner(config, { retire })).rejects.toThrow('activity_owner_config_mismatch'); expect(retire).not.toHaveBeenCalled();
});

it.each(['kept_pending', 'kept_unknown', 'retired'] as const)('reports legacy outcome %s', async outcome => {
  const config: ActivityOwnerConfig = { schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } };
  vi.spyOn(ConversationActivityOwnerClient.prototype, 'request').mockResolvedValueOnce({ profileId: 'fake' } as any).mockResolvedValue({ profileId: 'fake', generation: ACTIVITY_OWNER_GENERATION, configDigest: activityOwnerConfigDigest(config) } as any);
  const onLegacyOwner = vi.fn(), fakeSpawn = vi.fn(() => Object.assign(new EventEmitter(), { unref: vi.fn() }));
  const client = await ensureConversationActivityOwner(config, { retire: async () => outcome, onLegacyOwner, spawn: fakeSpawn as unknown as typeof spawn });
  expect(fakeSpawn).toHaveBeenCalledTimes(outcome === 'retired' ? 1 : 0);
  expect(onLegacyOwner.mock.calls).toEqual(outcome === 'kept_unknown' ? [] : [[outcome === 'retired' ? 'replaced' : 'reused_pending']]); client.dispose();
});
