// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import type { DesktopApprovalOwner } from '../../electron/desktop-multi-agent-approval-transport.js';
import type { MultiAgentEnvelope, MultiAgentGroupSnapshot } from '../../shared/multi-agent-types.js';
import { authorizationFixture, deferred } from '../fixtures/multi-agent-authorization.js';

describe('BDD AP10: approval failure notification survives persistent native SQLite READ denial', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  async function fixture() {
    // Observe the real factory's unique bind. Copying its diagnostic fields is
    // not authorization, and the fixture never constructs a replacement owner.
    const owners = new WeakMap<DesktopMultiAgentService, DesktopApprovalOwner>();
    const bind = DesktopMultiAgentService.prototype.bindApprovalTransport;
    vi.spyOn(DesktopMultiAgentService.prototype, 'bindApprovalTransport').mockImplementation(function (this: DesktopMultiAgentService, transport) {
      const owner = bind.call(this, transport); owners.set(this, owner); return owner;
    });
    const f = await authorizationFixture(cleanup), service = f.boundary.service;
    const threadId = 'approval-read-failure', foreignThread = 'other-approval-thread';
    for (const id of [threadId, foreignThread]) service.registerThread({ threadId: id, profileId: f.boundary.profileId,
      workspaceId: f.boundary.workspaceId, cwd: f.root });
    const history = f.store.createGroup(threadId);
    f.store.putGroup({ ...history, historicalOnly: true }, true); f.store.clearActiveGroup(threadId, history.groupId);
    const release = deferred(), proposed = deferred(), effect = join(f.root, 'must-not-approve-after-read-failure.txt');
    cleanup.push(() => release.resolve());
    let requests = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      requests++;
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (requests === 1) {
        yield { type: 'tool_use', id: 'native-read-failure-write', name: 'write', input: { file_path: effect, content: 'PRIVATE_APPROVAL_INPUT' } };
        proposed.resolve();
      } else { await release.promise; yield { type: 'text', delta: 'Finished.' }; }
    });
    const task = await f.services.createTask({ prompt: 'Write one file after approval.', materials: [], permissionMode: 'default', context: { threadId } });
    await proposed.promise;
    let snapshot!: MultiAgentGroupSnapshot;
    await vi.waitFor(async () => {
      snapshot = await f.invoke<MultiAgentGroupSnapshot>('getMultiAgentSnapshot', { threadId });
      expect(snapshot.pendingApprovals).toHaveLength(1);
    });
    const context = f.contexts.find(item => item.groupId === snapshot.group!.groupId)!;
    const pending = snapshot.pendingApprovals![0]!;
    expect(context).toBeDefined(); expect(pending.canDecide).toBe(true); expect(requests).toBe(1);
    const owner = owners.get(service)!; expect(owner).toBeDefined();
    await f.invoke('subscribeMultiAgents', { threadId, groupId: context.groupId, subscriptionId: 'current-viewer' });
    await f.invoke('subscribeMultiAgents', { threadId, groupId: history.groupId, subscriptionId: 'history-viewer' });
    await f.invoke('subscribeMultiAgents', { threadId: foreignThread, subscriptionId: 'foreign-viewer' });
    await f.invoke('subscribeMultiAgents', { threadId, groupId: context.groupId, subscriptionId: 'retired-viewer' });
    await f.invoke('unsubscribeMultiAgents', { subscriptionId: 'retired-viewer' });
    const access = service.createUserAccess({ requestSource: 'user', actorId: `desktop-user:${f.boundary.profileId}`,
      threadId, profileId: f.boundary.profileId, workspaceId: f.boundary.workspaceId });
    const retired = vi.fn(); service.subscribe(access, retired)();
    expect(() => service.subscribe({ ...access }, vi.fn())).toThrow();
    const sentBefore = f.sent.length;
    return { ...f, owner, context, pending, task, threadId, foreignThread, history, release, effect, retired, sentBefore, requests: () => requests };
  }

  it.each(['native-finalize-commit', 'owner-freeze-while-unreadable'] as const)(
    'AP10 %s still sends only the main-signed unknown union to live same-thread current/history viewers', async kind => {
      const f = await fixture();
      let commitFaults = 0, readFaults = 0, approvalTouched = false, unreadable = kind === 'owner-freeze-while-unreadable';
      // Native COMMIT denial leaves the real pending row, then every READ fails.
      // The sibling only denies thread reads so freezeGroup's group wake can
      // finish and independently expose publish's redundant authorization read.
      // No async mock replaces SQLite transactions.
      f.db.setAuthorizer((action, table) => {
        if ((action === 18 || action === 23) && table === 'operations') approvalTouched = true;
        if (kind === 'native-finalize-commit' && action === 22 && table === 'COMMIT' && approvalTouched && !commitFaults) {
          commitFaults++; unreadable = true; return 1;
        }
        if (unreadable && action === 20 && (kind === 'native-finalize-commit' || table === 'thread_bindings')) { readFaults++; return 1; }
        return 0;
      });
      cleanup.push(() => f.db.setAuthorizer(null));
      if (kind === 'native-finalize-commit') {
        const decision = await f.invoke('decideMultiAgentApproval', { threadId: f.threadId, groupId: f.context.groupId,
          approvalId: f.pending.approvalId, operationId: 'read-failure-decision', decision: 'approve' })
          .then(receipt => ({ receipt }), error => ({ error: String(error) }));
        expect.soft(decision).toMatchObject({ receipt: { state: 'unknown' } }); expect(commitFaults).toBe(1);
      } else {
        let error: unknown;
        try { f.boundary.service.freezeApprovalPersistence(f.owner, f.context.groupId); } catch (caught) { error = caught; }
        expect.soft(error).toBeUndefined();
        expect(commitFaults).toBe(0);
      }
      expect(readFaults).toBeGreaterThan(0);
      expect(f.context.signal.aborted).toBe(true);
      expect(existsSync(f.effect)).toBe(false); expect(f.requests()).toBe(1);
      expect(f.boundary.service.getApprovalPersistenceFailure(f.owner, f.context.groupId)).toEqual({
        groupId: f.context.groupId, bootId: f.store.bootId, code: 'multi_agent_approval_persistence_failed',
      });
      const failures = f.sent.slice(f.sentBefore).filter(item => item.channel === 'desktop:multiAgentEvent')
        .map(item => item.data as { subscriptionId: string; envelope: MultiAgentEnvelope })
        .filter(item => item.envelope.channel === 'runtime_error' && item.envelope.code === 'multi_agent_approval_persistence_failed');
      expect(failures.filter(item => ['foreign-viewer', 'retired-viewer'].includes(item.subscriptionId))).toEqual([]);
      expect(f.retired).not.toHaveBeenCalled();
      for (const subscriptionId of ['current-viewer', 'history-viewer']) expect.soft(failures).toContainEqual({
        subscriptionId, envelope: { channel: 'runtime_error', groupId: f.context.groupId, threadId: f.threadId,
          bootId: f.store.bootId, code: 'multi_agent_approval_persistence_failed', approvalPersistenceState: 'unknown' },
      });
      // Do not turn the exception for this exact main-signed union into a
      // no-SQL general publisher. The original group access gate remains closed.
      const beforeOrdinary = f.sent.length;
      (f.boundary.service as unknown as { publish(event: MultiAgentEnvelope): void }).publish({
        channel: 'runtime_error', groupId: f.context.groupId, code: 'runtime_blocked',
      });
      expect(f.sent).toHaveLength(beforeOrdinary);
      f.db.setAuthorizer(null);
      expect(f.store.getOperation(f.context.groupId, `approval-request:${f.pending.approvalId}`)).toMatchObject({ result: { approval: { status: 'pending' } } });
      f.release.resolve();
      await vi.waitFor(async () => expect(['failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(f.task.taskId)).snapshot.status));
      expect(existsSync(f.effect)).toBe(false); expect(f.requests()).toBe(1);
    });
});
