import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ConversationActivityService } from '../../../src/runtime/conversation-activity/service.js';
import { ConversationActivitySources, type ProjectActivityPage } from '../../../src/runtime/conversation-activity/sources.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

describe('activity source lifecycle', () => {
  let root: string, store: ConversationActivityStore, service: ConversationActivityService, sources: ConversationActivitySources;
  let allowed = true;
  const actor = { requestSource: 'user' as const, actorId: 'user' };
  const page: ProjectActivityPage = { ok: true, sourceDataEpoch: 'epoch', headSeq: 1, nextCursor: 1, gap: false,
    snapshot: { status: 'created' }, events: [{ schemaVersion: 1, eventId: 'p#1', source: 'kswarm',
      sourceDataEpoch: 'epoch', workId: 'p', sourceSequence: 1, kind: 'accepted', occurredAt: 100, evidenceRefs: [] }] };
  beforeEach(async () => {
    allowed = true; root = mkdtempSync(join(tmpdir(), 'xiaok-source-life-')); store = new ConversationActivityStore(join(root, 'activity.sqlite'));
    service = new ConversationActivityService({ store, profileId: 'profile', actorId: 'user',
      getThread: threadId => ({ threadId, profileId: 'profile', workspaceId: 'workspace', deleteState: 'none' }), canObserveWork: () => allowed });
    await service.prepareAssociation({ threadId: 'thread', operationId: 'op', creationIdempotencyKey: 'key' }, actor);
    await service.bindWork({ operationId: 'op', watchId: 'watch', source: 'kswarm', logicalSourceId: 'server', sourceDataEpoch: 'epoch', workId: 'p' });
  });
  afterEach(() => { sources?.dispose(); service.dispose(); store.close(); rmSync(root, { recursive: true, force: true }); });
  it('coalesces concurrent refreshes and only delivers a stable source identity once', async () => {
    let resolve!: (page: ProjectActivityPage) => void;
    const read = vi.fn(() => new Promise<ProjectActivityPage>(done => { resolve = done; }));
    sources = new ConversationActivitySources({ store, service, taskHost: () => { throw new Error('not used'); }, readProject: read });
    const first = sources.refreshProject('p'), second = sources.refreshProject('p');
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    resolve(page); await Promise.all([first, second]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.getProjection('watch')?.sourceSequence).toBe(1);
  });
  it('drops an in-flight page after a watch has stopped without cancelling the source work', async () => {
    let resolve!: (page: ProjectActivityPage) => void;
    sources = new ConversationActivitySources({ store, service, taskHost: () => { throw new Error('not used'); },
      readProject: () => new Promise<ProjectActivityPage>(done => { resolve = done; }) });
    const pending = sources.refreshProject('p');
    await vi.waitFor(() => expect(typeof resolve).toBe('function'));
    await service.stopWatch('watch', 0, actor);
    resolve(page); await pending;
    expect(store.getProjection('watch')?.sourceSequence).toBe(0);
  });
  it('does not bypass source read permission when reconciling a retained-history gap', async () => {
    allowed = false;
    const read = vi.fn(async () => ({ ...page, gap: true, snapshot: { status: 'closed' } }));
    sources = new ConversationActivitySources({ store, service, taskHost: () => { throw new Error('not used'); }, readProject: read });
    await sources.refreshProject('p');
    expect(store.getProjection('watch')?.executionState).toBe('accepted');
    expect(store.getProjection('watch')?.freshness).toBe('unavailable');
    expect(read).not.toHaveBeenCalled();
  });
  it('does not report the group complete merely because its root turn ended, and owns one replay query', async () => {
    await service.prepareAssociation({ threadId: 'thread', operationId: 'group-op', creationIdempotencyKey: 'group-key' }, actor);
    await service.bindWork({ operationId: 'group-op', watchId: 'group-watch', source: 'agent_group', logicalSourceId: 'local', sourceDataEpoch: 'group', workId: 'group' });
    const events = [{ eventId: 'root-start', seq: 1, timestamp: 100, kind: 'status', payload: { agent: { parentId: null, status: 'running' } } },
      { eventId: 'root-end', seq: 2, timestamp: 101, kind: 'status', payload: { agent: { parentId: null, status: 'completed' } } }];
    const read = vi.fn((_id: string, after: number) => events.filter(event => event.seq > after));
    sources = new ConversationActivitySources({ store, service, taskHost: () => { throw new Error('not used'); }, readProject: async () => page, readGroup: read });
    await Promise.all([sources.refreshGroup('group'), sources.refreshGroup('group')]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.getProjection('group-watch')?.executionState).not.toBe('completed');
  });
  it('uses only the matching durable run terminal and leaves a subsequent run independent', async () => {
    for (const runId of ['one', 'two']) {
      await service.prepareAssociation({ threadId: 'thread', operationId: runId, creationIdempotencyKey: runId }, actor);
      await service.bindWork({ operationId: runId, watchId: runId, source: 'agent_group', logicalSourceId: 'local', sourceDataEpoch: 'group', workId: 'group', runId });
    }
    const events = [
      { eventId: 'result', seq: 1, timestamp: 100, kind: 'result', agentId: 'child', turnId: 'turn-one', payload: { resultContentId: 'artifact-one' } },
      { eventId: 'done', seq: 2, timestamp: 101, kind: 'activity_run', payload: { run: { runId: 'one', state: 'completed' } } },
      { eventId: 'start-two', seq: 3, timestamp: 102, kind: 'activity_run', payload: { run: { runId: 'two', state: 'running' } } },
    ];
    sources = new ConversationActivitySources({ store, service, taskHost: () => { throw new Error('not used'); }, readProject: async () => page,
      readGroup: (_id, after) => events.filter(event => event.seq > after),
      groupMembers: runId => [{ groupId: 'group', runId, memberId: runId, operationId: runId, agentId: 'child', turnId: `turn-${runId}`, state: 'running', physicalSettled: false }] });
    await sources.refreshGroup('group');
    expect(store.getProjection('one')).toMatchObject({ executionState: 'completed', evidenceRefs: ['artifact-one'], sourceSequence: 3 });
    expect(store.getProjection('two')).toMatchObject({ executionState: 'running', evidenceRefs: [], sourceSequence: 3 });
  });

  it('replays after a stream reconnect using the same project query owner', async () => {
    const read = vi.fn(async () => page);
    sources = new ConversationActivitySources({ store, service, taskHost: () => { throw new Error('not used'); }, readProject: read });
    await sources.startWatch('watch');
    await sources.projectConnectionChanged('disconnected');
    expect(store.getProjection('watch')?.freshness).toBe('reconnecting');
    await sources.projectConnectionChanged('connected');
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.getProjection('watch')?.sourceSequence).toBe(1);
    expect(store.getProjection('watch')?.freshness).toBe('fresh');
  });
  it.each([['delivered', 'completed'], ['closed', 'cancelled']])('maps a %s project snapshot to %s after a history gap', async (status, expected) => {
    sources = new ConversationActivitySources({ store, service, taskHost: () => { throw new Error('not used'); },
      readProject: async () => ({ ...page, gap: true, snapshot: { status } }) });
    await sources.refreshProject('p');
    expect(store.getProjection('watch')?.executionState).toBe(expected);
    expect(store.getProjection('watch')?.businessOutcome).toBe(expected === 'completed' ? 'success' : 'cancelled');
  });
  it('does not skip retained critical facts or a second page when ordinary progress was compacted', async () => {
    const read = vi.fn(async (_id: string, after: number) => after < 3 ? {
      ...page, headSeq: 5, nextCursor: 3, coveredThrough: 3, gap: true,
      gapRanges: [{ from: 1, through: 2, reason: 'progress_compacted' }], snapshot: { status: 'delivered' },
      events: [{ ...page.events[0], eventId: 'approval', sourceSequence: 3, kind: 'input_required' as const }],
    } : { ...page, headSeq: 5, nextCursor: 5, coveredThrough: 5, gap: false, gapRanges: [], snapshot: { status: 'delivered' },
      events: [{ ...page.events[0], eventId: 'progress', sourceSequence: 4, kind: 'progress' as const },
        { ...page.events[0], eventId: 'done', sourceSequence: 5, kind: 'completed' as const }] });
    sources = new ConversationActivitySources({ store, service, taskHost: () => { throw new Error('not used'); }, readProject: read });
    await sources.refreshProject('p');
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.listActivities('profile', 'thread').some(row => row.kind === 'input_required')).toBe(true);
    expect(store.getDiagnostics().sourceEvents).toBe(3);
    expect(store.getProjection('watch')?.sourceSequence).toBe(5);
    expect(store.getProjection('watch')?.executionState).toBe('completed');
  });
  it('automatically reattaches to the real native records stream after one transient source read failure', async () => {
    const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
    const host = new InProcessTaskRuntimeHost({ snapshotStore: snapshots, materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'workspace'), maxBytes: 1024 }), runner: async () => {} });
    const task = await host.prepareTask({ prompt: 'Task stream reconnect', materials: [] });
    const snapshot = (await host.recoverTask(task.taskId)).snapshot;
    await service.prepareAssociation({ threadId: 'thread', operationId: 'task-op', creationIdempotencyKey: 'task-key' }, actor);
    await service.bindWork({ operationId: 'task-op', watchId: 'task-watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: snapshot.sessionId, workId: task.taskId });
    const reads = vi.spyOn(snapshots, 'recoverTask').mockRejectedValueOnce(new Error('transient read fault'));
    sources = new ConversationActivitySources({ store, service, taskHost: () => host, readProject: async () => page });
    await sources.startWatch('task-watch');
    await vi.waitFor(() => expect(store.getProjection('task-watch')?.freshness).toBe('unavailable'));
    await host.startTask(task.taskId); await host.drain();
    await vi.waitFor(() => expect(store.getProjection('task-watch')?.executionState).toBe('completed'), { timeout: 3000 });
    expect(store.getProjection('task-watch')?.sourceSequence).toBe((await host.recoverTask(task.taskId)).snapshot.events.length);
    reads.mockRestore();
  });
});
