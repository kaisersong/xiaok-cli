// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { constants } from 'node:sqlite';
import { siblingActivityFixture, tick, nativeAuthorizer, type Cleanup } from '../fixtures/multi-agent-activity-failure.js';

const stoppers = ['workspace', 'agent-interrupt', 'agent-close', 'user-interrupt', 'user-close'] as const;
type Stopper = typeof stoppers[number];
type Fixture = Awaited<ReturnType<typeof siblingActivityFixture>>;

async function enqueue(f: Fixture, source: 'user' | 'agent', operationId: string) {
  const child = f.store.getAgent(f.context.groupId, f.child.agentId)!;
  const result = source === 'user'
    ? await f.service.userFollowup({ access: f.access(), requestSource: 'user', groupId: f.context.groupId,
      agentId: child.id, operationId, expectedTurn: child.turn, message: 'bounded queued followup' })
    : await f.service.followup({ actor: f.context.actor, requestSource: 'agent', operationId,
      target: child.id, message: 'bounded queued followup' });
  expect(result.state).toBe('queued_next_admission');
}

function stop(f: Fixture, action: Stopper) {
  const child = f.store.getAgent(f.context.groupId, f.child.agentId)!;
  if (action === 'workspace') {
    const boundary = f.services.multiAgent!, prior = f.service.getExecutionAuthorization();
    const access = f.service.createWorkspaceUserAccess({ requestSource: 'user', actorId: `desktop-user:${boundary.profileId}`,
      profileId: boundary.profileId, workspaceId: boundary.workspaceId });
    return f.service.setExecutionAuthorization({ requestSource: 'user', access, confirm: true,
      executionAllowed: false, operationId: `exec-auth:${prior.bootId}:${prior.permissionRevision}:cancel-receipts`,
      expectedPermissionRevision: prior.permissionRevision });
  }
  if (action === 'agent-interrupt' || action === 'agent-close') return f.service[action === 'agent-close' ? 'close' : 'interrupt']({
    actor: f.context.actor, requestSource: 'agent', operationId: 'stop-queued', target: child.id,
  });
  return f.service[action === 'user-close' ? 'userClose' : 'userInterrupt']({
    access: f.access(), requestSource: 'user', groupId: f.context.groupId, agentId: child.id,
    operationId: 'stop-queued', expectedTurn: child.turn,
  });
}

describe.runIf(nativeAuthorizer)('BDD W4: actual queued cancellation receipts survive audit failures', () => {
  const cleanup: Cleanup = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each(stoppers.flatMap(action => (['user', 'agent'] as const).map(source => ({ action, source }))))(
    '$action marks each failed $source queued receipt unknown and still cancels its sibling', async ({ action, source }) => {
      const f = await siblingActivityFixture(cleanup), turn = f.child.turn;
      await enqueue(f, source, 'failed-first');
      await enqueue(f, source === 'user' ? 'agent' : 'user', 'successful-second');
      let faults = 0;
      f.db.setAuthorizer((code, table) => {
        if (!faults && code === constants.SQLITE_INSERT && table === 'operations' && new Error().stack?.includes('cancelFollowups')) {
          faults++; return constants.SQLITE_DENY;
        }
        return constants.SQLITE_OK;
      });
      const stopped = stop(f, action);
      await tick(); await tick();
      f.db.setAuthorizer(null);
      expect(faults).toBe(1); expect(f.child.signal.aborted).toBe(true);
      const failed = f.service.readOperation({ access: f.access(), groupId: f.context.groupId, operationId: 'failed-first' });
      const sibling = f.store.getOperation(f.context.groupId, 'successful-second');
      expect.soft(failed).toMatchObject({ applyState: 'unknown', result: { state: 'unknown' } });
      expect.soft(sibling).toMatchObject({ applyState: 'applied', result: { outcome: 'cancelled' } });
      f.release.release(); f.childRelease.release(); await stopped; await f.settled(f.taskId);
      expect(f.store.getAgent(f.context.groupId, f.child.agentId)?.turn).toBe(turn);
      expect(f.calls.filter(call => call.child)).toHaveLength(1);
    });

  it.each(['user', 'agent'] as const)('workspace %s cancellation retains main unknown even when its fallback durable write also fails', async source => {
    const f = await siblingActivityFixture(cleanup);
    await enqueue(f, source, 'persistent-failure');
    let failures = 0;
    f.db.setAuthorizer((code, table) => {
      if (code === constants.SQLITE_INSERT && table === 'operations'
        && /cancelFollowups|markOperationUnknown/.test(new Error().stack ?? '')) {
        failures++; return constants.SQLITE_DENY;
      }
      return constants.SQLITE_OK;
    });
    const stopped = stop(f, 'workspace'); await tick(); await tick();
    f.db.setAuthorizer(null);
    expect(failures).toBeGreaterThanOrEqual(1); expect(f.child.signal.aborted).toBe(true);
    // This is honestly an in-memory unknown projection, not a claim that a
    // denied SQLite write magically became durable or recoverable after crash.
    expect(f.store.getOperation(f.context.groupId, 'persistent-failure')).toMatchObject({ applyState: 'applied', result: { state: 'queued_next_admission' } });
    const before = f.db.prepare('SELECT data_json FROM operations WHERE group_id=? ORDER BY operation_id').all(f.context.groupId);
    expect.soft(f.service.readOperation({ access: f.access(), groupId: f.context.groupId, operationId: 'persistent-failure' }))
      .toMatchObject({ applyState: 'unknown', result: { state: 'unknown' } });
    expect(f.db.prepare('SELECT data_json FROM operations WHERE group_id=? ORDER BY operation_id').all(f.context.groupId)).toEqual(before);
    f.release.release(); f.childRelease.release(); await stopped; await f.settled(f.taskId);
  });

  it.each(stoppers)('%s with healthy SQLite keeps both original cancellation receipts confirmed', async action => {
    const f = await siblingActivityFixture(cleanup);
    await enqueue(f, 'user', 'healthy-user'); await enqueue(f, 'agent', 'healthy-agent');
    const stopped = stop(f, action); await tick(); await tick();
    for (const operationId of ['healthy-user', 'healthy-agent']) {
      expect(f.service.readOperation({ access: f.access(), groupId: f.context.groupId, operationId }))
        .toMatchObject({ applyState: 'applied', result: { outcome: 'cancelled' } });
    }
    f.release.release(); f.childRelease.release(); await stopped; await f.settled(f.taskId);
  });
});
