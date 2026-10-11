import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ConversationActivityService } from '../../../src/runtime/conversation-activity/service.js';

describe('conversation activity authority', () => {
  let root: string, store: ConversationActivityStore, service: ConversationActivityService;
  let deleted = false, allowed = true, now = 100;
  const actor = { requestSource: 'user' as const, actorId: 'user' };
  const event = { schemaVersion: 1, eventId: 'done', source: 'task_host', logicalSourceId: 'host',
    sourceDataEpoch: 'epoch', workId: 'task', runId: '', transportGeneration: 1,
    sourceSequence: 1, kind: 'completed', occurredAt: 100, receivedAt: 100, evidenceRefs: [] };
  beforeEach(() => {
    deleted = false; allowed = true; now = 100; root = mkdtempSync(join(tmpdir(), 'xiaok-activity-authority-'));
    store = new ConversationActivityStore(join(root, 'activity.sqlite'), { now: () => now });
    service = new ConversationActivityService({ store, profileId: 'profile', actorId: 'user',
      getThread: id => id === 'thread' ? { profileId: 'profile', threadId: id, workspaceId: 'workspace', deleteState: deleted ? 'delete_pending' : 'none' } : null,
      canObserveWork: async () => allowed });
  });
  afterEach(() => { service.dispose(); store.close(); rmSync(root, { recursive: true, force: true }); });
  async function bind() {
    await service.prepareAssociation({ threadId: 'thread', operationId: 'operation', creationIdempotencyKey: 'creation' }, actor);
    await service.bindWork({ operationId: 'operation', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '' });
  }
  it('rejects a spoofed actor, unknown thread, and agent changes even with known IDs', async () => {
    await expect(service.prepareAssociation({ threadId: 'thread', operationId: 'op', creationIdempotencyKey: 'key' }, { ...actor, actorId: 'evil' })).rejects.toThrow('activity_actor_forbidden');
    await expect(service.prepareAssociation({ threadId: 'someone-else', operationId: 'op', creationIdempotencyKey: 'key' }, actor)).rejects.toThrow('activity_thread_forbidden');
    await bind();
    await expect(service.stopWatch('watch', 0, { requestSource: 'agent', actorId: 'user' })).rejects.toThrow('activity_actor_forbidden');
  });
  it('fans out a committed result without trusting user-controlled routing fields', async () => {
    await bind();
    const updates: string[] = [];
    const stop = service.subscribe('thread', actor, value => updates.push(value.threadId));
    await service.acceptEvent('watch', { ...event, threadId: 'wrong' });
    expect(updates).toContain('thread');
    expect((await service.listActivities('thread', actor)).at(-1)?.projection.executionState).toBe('completed');
    stop();
  });
  it('checks deletion and current source read permission again before delivery', async () => {
    await bind(); allowed = false;
    await expect(service.acceptEvent('watch', event)).rejects.toThrow('activity_source_forbidden');
    const warning = await service.listActivities('thread', actor);
    expect(warning).toHaveLength(1); expect(warning[0]).toMatchObject({ kind: 'diagnostic', projection: { summary: undefined, evidenceRefs: [], errorCode: 'activity_source_forbidden', freshness: 'unavailable' } });
    allowed = true; deleted = true;
    await expect(service.acceptEvent('watch', event)).rejects.toThrow('activity_thread_deleted');
    expect(store.getProjection('watch')?.executionState).toBe('accepted');
  });
  it('does not create a periodic report after source access has been revoked', async () => {
    await bind(); allowed = false; now += 5 * 60_000;
    await service.reportDue();
    expect(store.listActivities('profile', 'thread').filter(row => row.kind === 'report')).toEqual([]);
    expect(store.getProjection('watch')?.lastReportAt).toBeNull();
  });
  it('attempts a critical notification once across replay and process-owner restart', async () => {
    const notifications: string[] = [];
    const makeService = () => new ConversationActivityService({ store, profileId: 'profile', actorId: 'user',
      getThread: threadId => ({ profileId: 'profile', threadId, workspaceId: 'workspace', deleteState: 'none' }),
      canObserveWork: () => allowed, notify: async activity => { notifications.push(activity.activityId); return 'shown'; } });
    service.dispose(); service = makeService(); await bind();
    await service.acceptEvent('watch', event);
    expect(notifications).toHaveLength(1);
    service.dispose(); store.close(); store = new ConversationActivityStore(join(root, 'activity.sqlite'));
    service = makeService(); await service.acceptEvent('watch', event);
    expect(notifications).toHaveLength(1);
  });
  it('does not reveal an unread count or accept a read acknowledgement outside current source access', async () => {
    await bind(); await service.acceptEvent('watch', event);
    const through = store.listActivities('profile', 'thread').at(-1)!.localSeq;
    allowed = false;
    expect(await service.unreadThreads(actor)).toEqual([]);
    await expect(service.markRead('thread', through, actor)).rejects.toThrow('activity_read_cursor_forbidden');
    expect(store.unreadThreads('profile')[0]?.count).toBe(1);
  });
  it('coalesces progress presentation while delivering an intervention immediately', async () => {
    await bind(); vi.useFakeTimers();
    try {
      const changed = vi.fn(); service.subscribe('thread', actor, changed);
      for (let sequence = 1; sequence <= 100; sequence++) await service.acceptEvent('watch', { ...event, eventId: `p${sequence}`, sourceSequence: sequence, kind: 'progress' });
      expect(changed).not.toHaveBeenCalled();
      await service.acceptEvent('watch', { ...event, eventId: 'input', sourceSequence: 101, kind: 'input_required' });
      expect(changed).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1000); expect(changed).toHaveBeenCalledOnce();
      expect(store.getProjection('watch')?.sourceSequence).toBe(101);
    } finally { vi.useRealTimers(); }
  });
});
