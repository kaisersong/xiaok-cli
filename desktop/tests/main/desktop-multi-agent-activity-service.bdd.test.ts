// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { constants } from 'node:sqlite';
import { invokeRecord, nativeAuthorizer, parkedActivityFixture, rootRequest, serviceSite, siblingActivityFixture, sqliteFault, tick, type Cleanup, type ActivityFixture } from '../fixtures/multi-agent-activity-failure.js';
import type { DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';

const recordMethods = ['recordActivity', 'recordRunStarted', 'recordToolFinished', 'recordRuntimeEvent', 'recordUsage'] as const;
function control(f: ActivityFixture, method: string, context: DesktopAgentExecutionContext, target = 'main') {
  const request = rootRequest(context, `control-${method}`);
  switch (method) {
    case 'spawn': return f.service.spawn({ ...request, taskName: 'bounded', message: 'bounded' });
    case 'send': return f.service.send({ ...request, target, message: 'bounded' });
    case 'interrupt': return f.service.interrupt({ ...request, target });
    case 'followup': return f.service.followup({ ...request, target, message: 'bounded' });
    case 'wait': return f.service.wait({ actor: context.actor, requestSource: 'agent', targets: [target], timeoutMs: 1 });
    case 'list': return f.service.list({ actor: context.actor, requestSource: 'agent' });
    default: return f.service.close({ ...request, target });
  }
}
async function caught(action: () => unknown) { try { return { value: await action() }; } catch (error) { return { error }; } }

describe.runIf(nativeAuthorizer)('R6 AF real service trusted IO and ordinary refusals', () => {
  const cleanup: Cleanup = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each(['spawn', 'send', 'interrupt', 'followup', 'wait', 'list', 'close'].flatMap(method => ['groups', 'thread_bindings'].map(table => ({ method, table }))))('AF6 $method shared $table read failure freezes only the trusted running group', async ({ method, table }) => {
    const f = await parkedActivityFixture(cleanup);
    const fault = sqliteFault(f, { table, column: table === 'groups' ? 'data_json' : 'thread_id', site: 'assertWritable' });
    const outcome = await caught(() => control(f, method, f.context));
    expect(outcome).toHaveProperty('error'); expect(fault.traces).toHaveLength(1);
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.context.signal.aborted).toBe(true);
    f.release.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(false);
  });

  it.each([
    ['list-page', 'agents', 'DesktopMultiAgentStore.listAgents'],
    ['target', 'agents', 'resolveTarget'],
    ['ancestor', 'agents', 'assertDescendant'],
    ['operation', 'operations', 'DesktopMultiAgentService.mutate'],
    ['wait-message', 'messages', 'unreadMessageIds'],
    ['approval-deadline', 'agents', 'getApprovalDeadline'],
  ] as const)('AF6 post-admission %s real query cannot bypass the trusted IO boundary', async (stage, table, site) => {
    const f = await siblingActivityFixture(cleanup, stage === 'ancestor');
    // An absent optional activity cache is a production-supported fallback, not
    // a fabricated durable agent. The fallback still reads the real child row.
    if (stage === 'approval-deadline') f.live().activities.delete(f.child.agentId);
    const fault = sqliteFault(f, { table, site, column: table === 'messages' ? undefined : 'data_json' });
    const outcome = await caught(() => stage === 'approval-deadline' ? f.service.getApprovalDeadline(f.child.actor)
      : stage === 'list-page' ? f.service.list({ actor: f.context.actor, requestSource: 'agent' })
      : stage === 'wait-message' ? f.service.wait({ actor: f.context.actor, requestSource: 'agent', targets: [f.child.agentId], timeoutMs: 1 })
      : stage === 'ancestor' ? f.service.interrupt({ ...rootRequest(f.child), target: f.store.listAgents(f.context.groupId).items.find(agent => agent.taskName === 'cousin')!.id })
      : f.service.send({ ...rootRequest(f.context), target: f.child.agentId, message: 'bounded' }));
    expect(outcome).toHaveProperty('error'); expect(fault.traces).toHaveLength(1);
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.child.signal.aborted).toBe(true);
    f.release.release(); f.childRelease.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(false);
  });

  it.each(recordMethods.flatMap(method => ['unregistered', 'copied', 'sealed', 'retired'].map(kind => ({ method, kind }))))('AF4 $method rejects $kind context before any SQLite read without freezing either group', async ({ method, kind }) => {
    const f = await parkedActivityFixture(cleanup);
    const owner = f.store.getThread('activity-thread')!;
    // The factory now has one fixed execution domain; the foreign identity for
    // this actor/context test is another thread/group inside that same domain.
    f.service.registerThread({ threadId: 'foreign-thread', profileId: owner.profileId, workspaceId: owner.workspaceId, cwd: owner.cwd });
    const foreign = f.store.createGroup('foreign-thread');
    let context = f.context;
    if (kind === 'unregistered') context = { ...context, actor: { ...context.actor } };
    if (kind === 'copied') context = { ...context, groupId: foreign.groupId, agentId: `root_${foreign.groupId}` };
    if (kind === 'sealed') await context.mailbox.trySealTurn();
    if (kind === 'retired') { f.release.release(); await f.settled(f.taskId); }
    let reads = 0;
    f.db.setAuthorizer(action => { if (action === constants.SQLITE_READ) reads++; return constants.SQLITE_OK; });
    const outcome = await caught(() => invokeRecord(f.service, method, context));
    f.db.setAuthorizer(null);
    expect.soft(outcome).toHaveProperty('error'); expect.soft(reads).toBe(0);
    expect(f.live().frozen).toBeUndefined(); expect(f.store.requireGroup(foreign.groupId).mutationBlockedReason ?? undefined).toBeUndefined();
  });

  it('AF4 actual non-descendant control rejects without freezing either active sibling', async () => {
    const f = await siblingActivityFixture(cleanup, true);
    const cousin = f.store.listAgents(f.context.groupId).items.find(agent => agent.taskName === 'cousin')!;
    await expect(f.service.interrupt({ ...rootRequest(f.child), target: cousin.id })).rejects.toThrow('non-descendant');
    expect(f.live().frozen).toBeUndefined(); expect(f.context.signal.aborted).toBe(false); expect(f.child.signal.aborted).toBe(false);
    f.release.release(); f.childRelease.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(true);
  });

  it.each([
    ['snapshot-thread', 'thread_bindings', 'requireUserAccess'],
    ['snapshot-group', 'groups', 'requireUserAccess'],
    ['history-list', 'groups', 'DesktopMultiAgentStore.listGroups'],
    ['subscribe', 'thread_bindings', 'requireUserAccess'],
  ] as const)('AF6 read-only %s SQLite failure rejects its own request without freezing the running group', async (stage, table, site) => {
    const f = await parkedActivityFixture(cleanup), access = f.access();
    const fault = sqliteFault(f, { table, site, column: table === 'groups' ? 'data_json' : 'thread_id' });
    const outcome = await caught(() => stage === 'subscribe' ? f.service.subscribe(access, () => {})
      : stage === 'history-list' ? f.service.listGroups({ access }) : f.service.getSnapshot({ access, groupId: f.context.groupId }));
    expect(outcome).toHaveProperty('error'); expect(fault.traces).toHaveLength(1);
    expect(f.live().frozen).toBeUndefined(); expect(f.context.signal.aborted).toBe(false);
    f.release.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(true);
  });

  it.each(['duplicate-run', 'usage-conflict', 'tool-conflict', 'bad-cursor', 'unknown-target', 'wrong-source', 'queue-full'] as const)('AF4 ordinary %s refusal is not a persistence failure and preserves prior statistics', async kind => {
    const f = await parkedActivityFixture(cleanup);
    await f.service.recordRunStarted(f.context, 'begin');
    await f.service.recordUsage(f.context, { usageId: 'once', inputTokens: 2, outputTokens: 3 });
    await f.service.recordToolFinished(f.context, { executionEventId: 'once', toolName: 'write', ok: true });
    const before = f.store.getAgent(f.context.groupId, f.context.agentId)!;
    const pending: Promise<unknown>[] = [];
    if (kind === 'queue-full') for (let i = 0; i < 10_000; i++) pending.push(f.live().commands.run(() => undefined));
    const outcome = await caught(() => kind === 'duplicate-run' ? f.service.recordRunStarted(f.context, 'again')
      : kind === 'usage-conflict' ? f.service.recordUsage(f.context, { usageId: 'once', inputTokens: 9, outputTokens: 3 })
      : kind === 'tool-conflict' ? f.service.recordToolFinished(f.context, { executionEventId: 'once', toolName: 'write', ok: false })
      : kind === 'bad-cursor' ? f.service.list({ actor: f.context.actor, requestSource: 'agent', cursor: 'invalid-cursor' })
      : kind === 'unknown-target' ? f.service.send({ ...rootRequest(f.context), target: 'missing-agent', message: 'bounded' })
      : kind === 'wrong-source' ? f.service.list({ actor: f.context.actor, requestSource: 'user' })
      : f.service.recordActivity(f.context, { phase: 'model' }));
    await Promise.all(pending);
    expect(outcome).toHaveProperty('error'); expect(f.live().frozen).toBeUndefined(); expect(f.context.signal.aborted).toBe(false);
    const after = f.store.getAgent(f.context.groupId, f.context.agentId)!;
    expect(after.usage).toEqual(before.usage); expect(after.toolsCompleted).toBe(before.toolsCompleted);
  });

  it('AF3b immediate checkpoint actual write failure freezes despite successful admission reads', async () => {
    const f = await parkedActivityFixture(cleanup);
    await f.service.recordActivity(f.context, { phase: 'model' });
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 5001);
    const fault = sqliteFault(f, { table: 'agents', site: 'checkpointActivity', action: constants.SQLITE_INSERT });
    const outcome = await caught(() => f.service.recordActivity(f.context, { phase: 'tool', toolName: 'write' }));
    clock.mockRestore();
    expect(outcome).toHaveProperty('error'); expect(fault.traces).toHaveLength(1);
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.context.signal.aborted).toBe(true);
    f.release.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(false);
  });

  it.each([
    ['run-start', 'agents', 'multi_agent_presentation_persistence_failed'],
    ['run-start', 'events', 'multi_agent_presentation_persistence_failed'],
    ['run-start', 'operations', 'multi_agent_presentation_persistence_failed'],
    ['tool-finished', 'agents', 'multi_agent_tool_settlement_persistence_failed'],
    ['tool-finished', 'events', 'multi_agent_tool_settlement_persistence_failed'],
    ['tool-finished', 'operations', 'multi_agent_tool_settlement_persistence_failed'],
    ['usage', 'agents', 'multi_agent_usage_persistence_failed'],
    ['usage', 'events', 'multi_agent_usage_persistence_failed'],
    ['usage', 'operations', 'multi_agent_usage_persistence_failed'],
    ['artifact', 'events', 'multi_agent_output_persistence_failed'],
    ['flush', 'events', 'multi_agent_output_persistence_failed'],
    ['send', 'operations', 'multi_agent_persistence_failed'],
    ['spawn', 'operations', 'multi_agent_persistence_failed'],
  ] as const)('AF3b existing %s/%s write catch retains rollback and stable failure reason', async (stage, table, reason) => {
    const f = await parkedActivityFixture(cleanup);
    if (stage === 'tool-finished') await f.service.recordRunStarted(f.context, 'begin');
    const before = f.store.getAgent(f.context.groupId, f.context.agentId)!;
    const receiptsBefore = f.db.prepare('SELECT operation_id FROM operations WHERE group_id=? ORDER BY operation_id').all(f.context.groupId);
    const site = stage === 'run-start' ? 'recordRunStarted' : stage === 'tool-finished' ? 'recordToolFinished' : stage === 'usage' ? 'recordUsage'
      : stage === 'artifact' || stage === 'flush' ? 'recordRuntimeEvent' : stage === 'send' ? 'DesktopMultiAgentService.mutate' : 'DesktopMultiAgentService.spawn';
    const fault = sqliteFault(f, { table, action: constants.SQLITE_INSERT, site: stage === 'run-start' ? serviceSite('async recordRunStarted(', 'store.transaction(')
      : stage === 'tool-finished' ? serviceSite('async recordToolFinished(', 'store.transaction(')
      : stage === 'usage' ? serviceSite('async recordUsage(', 'store.transaction(')
      : stage === 'artifact' ? serviceSite('async recordRuntimeEvent(', "{ kind: 'artifact'")
      : stage === 'flush' ? 'flushOutput'
      : stage === 'spawn' ? serviceSite('async spawn(', 'this.options.store.putOperation(') : site });
    const outcome = await caught(() => stage === 'run-start' ? f.service.recordRunStarted(f.context, 'begin')
      : stage === 'tool-finished' ? f.service.recordToolFinished(f.context, { executionEventId: 'fault', toolName: 'write', ok: true })
      : stage === 'usage' ? f.service.recordUsage(f.context, { usageId: 'fault', inputTokens: 4, outputTokens: 2 })
      : stage === 'artifact' ? f.service.recordRuntimeEvent(f.context, { type: 'artifact_recorded', sessionId: f.context.agentId, turnId: f.context.turnId,
        intentId: 'bounded-intent', stageId: 'bounded-stage', artifactId: 'bounded-artifact', label: 'bounded', kind: 'file', path: f.effect, mimeType: 'text/plain' })
      : stage === 'flush' ? f.service.recordRuntimeEvent(f.context, { type: 'assistant_delta', sessionId: f.context.agentId, turnId: f.context.turnId,
        intentId: 'bounded-intent', stepId: 'bounded-step', delta: 'x'.repeat(8193) })
      : control(f, stage, f.context));
    expect(fault.traces).toHaveLength(1); expect(outcome).toHaveProperty('error');
    expect(f.live().frozen).toBe(reason); expect(f.context.signal.aborted).toBe(true);
    const after = f.store.getAgent(f.context.groupId, f.context.agentId)!;
    expect(after.toolsCompleted).toBe(before.toolsCompleted); expect(after.usage).toEqual(before.usage);
    expect(f.db.prepare('SELECT operation_id FROM operations WHERE group_id=? ORDER BY operation_id').all(f.context.groupId)).toEqual(receiptsBefore);
    f.release.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(false);
  });

  it('AF5 synchronous SQLite audit failure still aborts and does not fake a settled owner', async () => {
    const f = await parkedActivityFixture(cleanup);
    const fault = sqliteFault(f, { table: 'groups', column: 'data_json', site: 'desktop-multi-agent-service', persistent: true });
    const outcome = await caught(() => f.service.recordActivity(f.context, { phase: 'model' }));
    expect(outcome).toHaveProperty('error');
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.context.signal.aborted).toBe(true);
    const traces = [...fault.traces]; fault.clear();
    expect.soft(traces.some(stack => stack.includes('freezeGroup'))).toBe(true);
    expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.resourcesReleased).toBe(false);
    f.release.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(false);
  });
});
