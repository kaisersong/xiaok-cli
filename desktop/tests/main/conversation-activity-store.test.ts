import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';

describe('durable conversation activity', () => {
  let root: string;
  let store: ConversationActivityStore;
  let now = 1000;
  const origin = { profileId: 'profile', threadId: 'thread', workspaceId: 'workspace', actorId: 'user' };
  const event = (sequence: number, kind = 'progress') => ({ schemaVersion: 1, eventId: `event-${sequence}`,
    source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '',
    transportGeneration: 1, sourceSequence: sequence, kind, occurredAt: now, receivedAt: now,
    summary: `phase ${sequence}`, evidenceRefs: [] });
  const bind = () => {
    store.prepareAssociation({ operationId: 'operation', creationIdempotencyKey: 'creation', origin });
    return store.bindWork({ operationId: 'operation', watchId: 'watch', source: 'task_host',
      logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '' });
  };
  beforeEach(() => { now = 1000; root = mkdtempSync(join(tmpdir(), 'xiaok-activity-')); store = new ConversationActivityStore(join(root, 'activity.sqlite'), { now: () => now }); });
  afterEach(() => { store.close(); rmSync(root, { recursive: true, force: true }); });

  it('does not invent an unread activity or move the read cursor on heartbeat/freshness-only updates', () => {
    bind(); store.ingest('watch', event(1, 'started'));
    const through = store.listActivities('profile', 'thread').at(-1)!.localSeq; store.markRead('profile', 'thread', through);
    for (let index=2; index<20; index++) { now++; store.ingest('watch', event(index, 'heartbeat')); store.setFreshness('watch','fresh'); }
    expect(store.unreadThreads('profile')).toEqual([]);
    expect(Math.max(...store.listActivities('profile','thread').map(row=>row.localSeq))).toBe(through);
  });

  it('binds the trusted original conversation and atomically deduplicates a replay across connection generations', () => {
    bind(); store.ingest('watch', event(1));
    store.ingest('watch', { ...event(1), receivedAt: now + 100, transportGeneration: 5 });
    expect(store.getProjection('watch')?.sourceSequence).toBe(1);
    expect(store.listActivities('profile', 'thread')).toHaveLength(2); // creation plus progress
    expect(store.listActivities('other-profile', 'thread')).toEqual([]);
    expect(store.getAssociation('operation')?.origin.threadId).toBe('thread');
  });

  it('projects a shared source fact separately into two authorized conversations', () => {
    bind();
    store.prepareAssociation({ operationId: 'second', creationIdempotencyKey: 'second-creation', origin: { ...origin, threadId: 'second-thread' } });
    store.bindWork({ operationId: 'second', watchId: 'second-watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '' });
    store.ingest('watch', event(1, 'started'));
    store.ingest('second-watch', event(1, 'started'));
    expect(store.getProjection('second-watch')?.sourceSequence).toBe(1);
    expect(store.getProjection('second-watch')?.executionState).toBe('running');
  });

  it('retains terminal state when late progress arrives and quarantines an unknown schema', () => {
    bind(); store.ingest('watch', event(1, 'completed'));
    store.ingest('watch', event(2));
    store.ingest('watch', { ...event(3), schemaVersion: 99 });
    expect(store.getProjection('watch')?.executionState).toBe('completed');
    expect(store.getProjection('watch')?.sourceSequence).toBe(3);
    expect(store.getDiagnostics().quarantined).toBe(1);
  });

  it('rejects a different work/source scope and a conflicting event identity', () => {
    bind(); store.ingest('watch', event(1));
    expect(() => store.ingest('watch', { ...event(2), workId: 'someone-else' })).toThrow('activity_source_mismatch');
    expect(() => store.ingest('watch', { ...event(1), summary: 'changed' })).toThrow('activity_event_conflict');
    expect(store.getProjection('watch')?.sourceSequence).toBe(1);
  });

  it('folds missed reporting slots into one durable report and resumes its next due time after restart', () => {
    bind(); now += 20 * 60_000;
    store.reportDue();
    expect(store.listActivities('profile', 'thread').filter(item => item.kind === 'report')).toHaveLength(1);
    store.close(); store = new ConversationActivityStore(join(root, 'activity.sqlite'), { now: () => now });
    store.reportDue();
    expect(store.listActivities('profile', 'thread').filter(item => item.kind === 'report')).toHaveLength(1);
  });

  it('rejects a second owner, preserves tombstones and never notifies a deleted conversation', () => {
    bind();
    expect(() => new ConversationActivityStore(join(root, 'activity.sqlite'))).toThrow('conversation_activity_owner_held');
    store.deleteThread('profile', 'thread', 'deletion');
    store.ingest('watch', event(1, 'completed'));
    expect(store.listActivities('profile', 'thread')).toEqual([]);
    expect(store.getWatch('watch')?.status).toBe('stopped');
  });

  it('uses policy CAS, does not cancel work when observing stops, and rejects invalid paging', () => {
    bind();
    store.updateReporting('profile', 'watch', 'critical_only', 0);
    expect(() => store.updateReporting('profile', 'watch', 'quiet', 0)).toThrow('activity_policy_conflict');
    store.stopWatch('profile', 'watch', 1);
    expect(store.getProjection('watch')?.executionState).toBe('accepted');
    expect(() => store.listActivities('profile', 'thread', { limit: 999 })).toThrow('invalid_activity_page');
  });
  it('keeps critical activity and unread facts when reporting preference is quiet', () => {
    bind(); store.updateReporting('profile', 'watch', 'quiet', 0);
    store.ingest('watch', event(1, 'input_required'));
    expect(store.listActivities('profile', 'thread').filter(row => row.kind === 'input_required')).toHaveLength(1);
    expect(store.unreadThreads('profile')).toEqual([{ threadId: 'thread', count: 1 }]);
    now += 20 * 60_000; store.reportDue();
    expect(store.listActivities('profile', 'thread').filter(row => row.kind === 'report')).toEqual([]);
  });
  it('keeps confirmed result references through later progress and terminal records', () => {
    bind(); store.ingest('watch', { ...event(1, 'artifact_available'), evidenceRefs: ['artifact'], summary: 'Confirmed output' });
    store.ingest('watch', { ...event(2), summary: undefined });
    store.ingest('watch', { ...event(3, 'completed'), summary: undefined });
    expect(store.getProjection('watch')).toMatchObject({ summary: 'Confirmed output', evidenceRefs: ['artifact'], executionState: 'completed' });
  });
  it('updates heartbeat independently from business progress and never creates a progress fact for it', () => {
    bind(); now += 1000; store.ingest('watch', event(1, 'heartbeat'));
    expect(store.getProjection('watch')).toMatchObject({ lastHeartbeatAt: now, lastProgressAt: null, executionState: 'accepted' });
    expect(store.listActivities('profile', 'thread')).toHaveLength(1);
  });
  it('consumes retained critical facts and proven gaps atomically through the page boundary', () => {
    bind();
    store.ingestRetainedPage('watch', { sourceDataEpoch: 'epoch', coveredThrough: 4,
      gapRanges: [{ from: 1, through: 2, reason: 'progress_compacted' }], events: [event(3, 'input_required'), event(4, 'completed')] });
    expect(store.getProjection('watch')?.sourceSequence).toBe(4);
    expect(store.listActivities('profile', 'thread').filter(row => row.kind === 'input_required')).toHaveLength(1);
    expect(store.getProjection('watch')?.executionState).toBe('completed');
    expect(() => store.ingestRetainedPage('watch', { sourceDataEpoch: 'epoch', coveredThrough: 7,
      gapRanges: [], events: [event(5, 'failed'), event(7)] })).toThrow('activity_source_gap');
    expect(store.getProjection('watch')?.sourceSequence).toBe(4);
    expect(store.getDiagnostics().sourceEvents).toBe(2);
  });

  it('bounds a 10000-progress storm while retaining the critical terminal and replay cursor', () => {
    bind();
    for (let sequence = 1; sequence <= 10_000; sequence++) store.ingest('watch', event(sequence));
    store.ingest('watch', event(10_001, 'completed'));
    expect(store.getDiagnostics().sourceEvents).toBeLessThanOrEqual(257);
    expect(store.listActivities('profile', 'thread')).toHaveLength(3);
    store.close(); store = new ConversationActivityStore(join(root, 'activity.sqlite'), { now: () => now });
    expect(store.ingest('watch', event(1))).toMatchObject({ duplicate: true });
    expect(store.getProjection('watch')?.sourceSequence).toBe(10_001);
    expect(store.getProjection('watch')?.executionState).toBe('completed');
  });

  it('rejects saturated critical capacity without acknowledging or advancing the source cursor', () => {
    store.close(); store = new ConversationActivityStore(join(root, 'activity.sqlite'), { now: () => now, maxSourceEvents: 3 });
    bind();
    for (let sequence = 1; sequence <= 3; sequence++) store.ingest('watch', event(sequence, 'input_required'));
    expect(() => store.ingest('watch', event(4, 'completed'))).toThrow('activity_capacity_exceeded');
    expect(store.getProjection('watch')?.sourceSequence).toBe(3);
    expect(store.getProjection('watch')?.executionState).toBe('input_required');
  });
  it('rolls back events, visible activity and cursor when the final cursor write fails', () => {
    bind();
    const fault = new DatabaseSync(join(root, 'activity.sqlite'));
    fault.exec("CREATE TRIGGER reject_cursor BEFORE INSERT ON source_cursors BEGIN SELECT RAISE(ABORT,'cursor commit fault'); END");
    try {
      expect(() => store.ingest('watch', event(1, 'completed'))).toThrow('cursor commit fault');
      expect(store.getProjection('watch')?.sourceSequence).toBe(0);
      expect(store.getDiagnostics().sourceEvents).toBe(0);
      expect(store.listActivities('profile', 'thread')).toHaveLength(1);
    } finally { fault.exec('DROP TRIGGER reject_cursor'); fault.close(); }
    store.ingest('watch', event(1, 'completed'));
    expect(store.getProjection('watch')?.executionState).toBe('completed');
  });
  it('preserves unresolved requests during retention and refuses unknown future schemas', () => {
    bind(); store.ingest('watch', event(1)); store.ingest('watch', event(2, 'input_required'));
    now += 100 * 86400_000; store.pruneRetention();
    expect(store.getDiagnostics().sourceEvents).toBe(1);
    expect(store.listActivities('profile', 'thread').some(row => row.kind === 'input_required')).toBe(true);
    store.close();
    const future = new DatabaseSync(join(root, 'activity.sqlite')); future.exec('PRAGMA user_version=999'); future.close();
    expect(() => new ConversationActivityStore(join(root, 'activity.sqlite'))).toThrow('conversation_activity_schema_unsupported');
    const stillFuture = new DatabaseSync(join(root, 'activity.sqlite'));
    expect(stillFuture.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 999 }); stillFuture.close();
  });
});
