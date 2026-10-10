import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureConversationActivityOwner } from '../../../src/runtime/conversation-activity/owner-launcher.js';
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
    if (successAt && ++calls >= successAt) return { profileId: config.profileId, configDigest: activityOwnerConfigDigest(config), ready: true } as any;
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
