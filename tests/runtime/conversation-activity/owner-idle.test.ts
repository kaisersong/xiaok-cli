import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConversationActivityOwnerHost, activityOwnerTimeout, ACTIVITY_OWNER_IDLE_MS } from '../../../src/runtime/conversation-activity/owner-host.js';
it('validates environment overrides', () => {
  expect(activityOwnerTimeout('1500', ACTIVITY_OWNER_IDLE_MS)).toBe(1500);
  for (const value of ['0','-1','fake','1.5','Infinity']) expect(activityOwnerTimeout(value, ACTIVITY_OWNER_IDLE_MS)).toBe(ACTIVITY_OWNER_IDLE_MS);
});
it('waits twenty minutes, preserves unfinished watches until the unattended cap', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-idle-')); let now = 0;
  const idle = vi.fn();
  const host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'fake', actorId: 'fake', getThread: () => null, canObserveWork: () => true, authorizeProducer: () => true, now: () => now, idle });
  try {
    now = 19 * 60_000; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    now = 20 * 60_000; host.checkIdle(); expect(idle).toHaveBeenCalledTimes(1);
  } finally { await host.stop(); rmSync(root, { recursive: true, force: true }); }
});
it('keeps active watches until 24 hours and resets idle after authentication', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-watch-idle-')); let now = 0;
  const idle = vi.fn();
  const host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'fake', actorId: 'fake', getThread: () => null, canObserveWork: () => true, authorizeProducer: () => true, now: () => now, idle });
  try {
    host.store.prepareAssociation({ operationId: 'fake', creationIdempotencyKey: 'fake', origin: { profileId: 'fake', threadId: 'fake', workspaceId: 'fake', actorId: 'fake' } });
    host.store.bindWork({ operationId: 'fake', watchId: 'fake', source: 'task_host', logicalSourceId: 'fake', sourceDataEpoch: 'fake', workId: 'fake' });
    host.checkIdle(); now = 20 * 60_000; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    now = 24 * 60 * 60_000; host.checkIdle(); expect(idle).toHaveBeenCalledOnce();
  } finally { await host.stop(); rmSync(root, { recursive: true, force: true }); }
});
it('authenticated clients prevent idle and disconnect starts a new grace period', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-client-idle-')); let now = 0;
  const idle = vi.fn();
  const host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'fake', actorId: 'fake', getThread: () => null, canObserveWork: () => true, authorizeProducer: () => true, now: () => now, idle });
  const { ConversationActivityOwnerClient } = await import('../../../src/runtime/conversation-activity/owner-client.js');
  let client: InstanceType<typeof ConversationActivityOwnerClient> | undefined;
  try {
    await host.start(); now = 19 * 60_000;
    client = new ConversationActivityOwnerClient(root, 'user'); await client.request('status');
    now = 21 * 60_000; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    client.dispose(); await new Promise(resolve => setTimeout(resolve, 30));
    now += 19 * 60_000; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    now += 60_000; host.checkIdle(); expect(idle).toHaveBeenCalledOnce();
  } finally { client?.dispose(); await host.stop(); rmSync(root, { recursive: true, force: true }); }
});
it.each([['1500', 1500], ['fake', ACTIVITY_OWNER_IDLE_MS]])('uses configured idle threshold %s', async (value, threshold) => {
  const root = mkdtempSync(join(tmpdir(), 'activity-idle-env-')); let now = 0;
  const idle = vi.fn();
  const host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'fake', actorId: 'fake', getThread: () => null, canObserveWork: () => true, authorizeProducer: () => true, now: () => now, idle, env: { XIAOK_ACTIVITY_OWNER_IDLE_MS: value } });
  try {
    now = threshold - 1; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    now++; host.checkIdle(); expect(idle).toHaveBeenCalledOnce();
  } finally { await host.stop(); rmSync(root, { recursive: true, force: true }); }
});
it('authenticated connections and unfinished requests cancel idle evaluation with a fake clock', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-idle-busy-')); let now = 0;
  const idle = vi.fn();
  const host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'fake', actorId: 'fake', getThread: () => null, canObserveWork: () => true, authorizeProducer: () => true, now: () => now, idle });
  // Feed transport state into the production idle predicate without opening a socket.
  const transport = host as unknown as { clients: Set<{ active: boolean; role?: string }>; pending: number };
  const client = { active: true, role: 'user' };
  try {
    now = 19 * 60_000; transport.clients.add(client);
    now = 21 * 60_000; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    transport.clients.delete(client); now += 20 * 60_000; transport.pending = 1;
    host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    transport.pending = 0; host.checkIdle(); expect(idle).toHaveBeenCalledOnce();
  } finally { transport.clients.clear(); await host.stop(); rmSync(root, { recursive: true, force: true }); }
});
it('watch completion resets idle grace and unattended override remains bounded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-idle-change-')); let now = 0;
  const idle = vi.fn();
  const host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'fake', actorId: 'fake', getThread: () => null, canObserveWork: () => true, authorizeProducer: () => true, now: () => now, idle, env: { XIAOK_ACTIVITY_OWNER_IDLE_MS: '100', XIAOK_ACTIVITY_OWNER_MAX_UNATTENDED_MS: '500' } });
  try {
    host.store.prepareAssociation({ operationId: 'fake', creationIdempotencyKey: 'fake', origin: { profileId: 'fake', threadId: 'fake', workspaceId: 'fake', actorId: 'fake' } });
    host.store.bindWork({ operationId: 'fake', watchId: 'fake', source: 'task_host', logicalSourceId: 'fake', sourceDataEpoch: 'fake', workId: 'fake' });
    host.checkIdle(); now = 100; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    host.store.reconcileSnapshot('fake', 'fake', 1, 'completed'); host.checkIdle();
    now = 199; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    now = 200; host.checkIdle(); expect(idle).toHaveBeenCalledOnce();
  } finally { await host.stop(); rmSync(root, { recursive: true, force: true }); }
});
it('honors a short maximum unattended override with an unfinished watch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-idle-cap-')); let now = 0;
  const idle = vi.fn();
  const host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'fake', actorId: 'fake', getThread: () => null, canObserveWork: () => true, authorizeProducer: () => true, now: () => now, idle, env: { XIAOK_ACTIVITY_OWNER_MAX_UNATTENDED_MS: '500' } });
  try {
    host.store.prepareAssociation({ operationId: 'fake', creationIdempotencyKey: 'fake', origin: { profileId: 'fake', threadId: 'fake', workspaceId: 'fake', actorId: 'fake' } });
    host.store.bindWork({ operationId: 'fake', watchId: 'fake', source: 'task_host', logicalSourceId: 'fake', sourceDataEpoch: 'fake', workId: 'fake' });
    host.checkIdle(); now = 499; host.checkIdle(); expect(idle).not.toHaveBeenCalled();
    now++; host.checkIdle(); expect(idle).toHaveBeenCalledOnce();
  } finally { await host.stop(); rmSync(root, { recursive: true, force: true }); }
});
