// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { isStrictKimiK3Adapter } from '../../../src/ai/runtime/provider-private-projection.js';
import { authorizationFixture, authorizationRequest, deferred, failNextApprovalCommit } from '../fixtures/multi-agent-authorization.js';
import type { MultiAgentGroupSnapshot } from '../../shared/multi-agent-types.js';
import type { MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import { DesktopMultiAgentWorktrees } from '../../electron/desktop-multi-agent-worktrees.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// Source-mode Vitest has no fixed .js artifact. Only resolve that URL to the
// compiled production entry; native execution, timeout and exit remain real.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('compiled production Worker is not ready');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => {
  try { expect(nativeWorker.exits).toBe(nativeWorker.starts); }
  finally { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); }
});

type Approval = { approvalId: string; agentId: string; turnId: string; status: string; persistenceState: string; canDecide: boolean };
type Snapshot = MultiAgentGroupSnapshot & { pendingApprovals?: Approval[]; pendingApprovalCount?: number;
  approvalFailure?: { groupId: string; bootId: string; code: string } };

describe('BDD AP1/AP5/AP9/AP10: actual Desktop factory tool prompt and durable decision', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  async function startPrompt(actor: 'root' | 'child' = 'root') {
    const f = await authorizationFixture(cleanup);
    const effect = join(f.root, 'approved-effect.txt');
    const proposed = deferred(), release = deferred(); cleanup.push(() => release.resolve());
    const references: Array<Record<string, unknown>> = [];
    const originalExecute = ToolRegistry.prototype.executeTool;
    vi.spyOn(ToolRegistry.prototype, 'executeTool').mockImplementation(function(this: ToolRegistry, name, input, context) {
      if (name === 'write') references.push(input);
      return originalExecute.call(this, name, input, context);
    });
    let requests = 0, rootRequests = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (this: OpenAIAdapter, _messages, _tools, system) {
      // This fixture exercises the actual strict, frozen context projection;
      // a plain adapter test alone cannot catch mutating that projected object.
      expect(isStrictKimiK3Adapter(this)).toBe(true);
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (actor === 'child' && !system?.includes('Assigned Desktop agent:')) {
        if (++rootRequests === 1) yield { type: 'tool_use', id: 'spawn-approval-child', name: 'spawn_agent', input: { task_name: 'approval_child', message: 'Request one file write.', fork_context: false } };
        else { await release.promise; yield { type: 'text', delta: 'Root finished.' }; }
        return;
      }
      if (++requests === 1) {
        yield { type: 'tool_use', id: 'write-with-approval', name: 'write', input: { file_path: effect, content: 'APPROVAL_PRIVATE_INPUT' } };
        proposed.resolve();
      } else { await release.promise; yield { type: 'text', delta: 'Finished.' }; }
    });
    const task = await f.services.createTask({ prompt: 'Write the requested file after user permission.', permissionMode: 'default', materials: [], context: { threadId: 'approval-thread' } });
    await proposed.promise;
    const snapshot = () => f.invoke<Snapshot>('getMultiAgentSnapshot', { threadId: 'approval-thread' });
    await vi.waitFor(async () => expect(requests >= 2 || (await snapshot()).pendingApprovals?.length === 1).toBe(true));
    const visible = await snapshot();
    expect(existsSync(effect)).toBe(false);
    expect(visible.pendingApprovals, 'the default production runner must wait in a real main-owned approval, not silently deny and request another model turn').toHaveLength(1);
    const pending = visible.pendingApprovals![0];
    const context = f.contexts.find(candidate => (candidate.agentId === `root_${candidate.groupId}`) === (actor === 'root'))!;
    expect(pending).toMatchObject({ agentId: context.agentId, turnId: context.turnId, status: 'pending', persistenceState: 'confirmed', canDecide: true });
    expect(visible.pendingApprovalCount).toBe(1);
    expect(requests).toBe(1);
    return { ...f, effect, pending, context, visible, snapshot, release, task, references, requests: () => requests };
  }

  it.each(['approve', 'deny'] as const)('AP1/AP5 Given a real root write prompt, When user chooses %s, Then one durable decision changes the counter once and only approve performs the original effect', async decision => {
    const f = await startPrompt();
    const scope = { threadId: 'approval-thread', groupId: f.visible.group!.groupId, approvalId: f.pending.approvalId };
    const requestKey = `approval-request:${f.pending.approvalId}`;
    const operationBefore = f.store.getOperation(scope.groupId, requestKey)!;
    expect(operationBefore).toMatchObject({ command: 'approval_request', result: { approval: { status: 'pending' } } });
    expect(JSON.stringify(operationBefore)).not.toContain('APPROVAL_PRIVATE_INPUT');
    const input = { ...scope, operationId: `decision-${decision}`, decision };
    const result = await f.invoke('decideMultiAgentApproval', input);
    await vi.waitFor(() => expect(f.requests()).toBe(2));
    const after = await f.snapshot();
    expect(after.pendingApprovalCount).toBe(0);
    expect(after.threadRevision).toBe(f.visible.threadRevision + 1);
    expect(f.store.getOperation(scope.groupId, requestKey)).toMatchObject({ result: { approval: { status: decision === 'approve' ? 'approved' : 'denied', persistenceState: 'confirmed' } } });
    const durableBeforeRetry = f.db.prepare("SELECT data_json FROM events WHERE group_id=? AND json_extract(data_json,'$.kind')='approval' ORDER BY seq").all(scope.groupId);
    expect(await f.invoke('decideMultiAgentApproval', input)).toEqual(result);
    expect(f.db.prepare("SELECT data_json FROM events WHERE group_id=? AND json_extract(data_json,'$.kind')='approval' ORDER BY seq").all(scope.groupId)).toEqual(durableBeforeRetry);
    expect(existsSync(f.effect)).toBe(decision === 'approve');
    if (decision === 'approve') expect(readFileSync(f.effect, 'utf8')).toBe('APPROVAL_PRIVATE_INPUT');
    f.release.resolve();
    await vi.waitFor(async () => expect((await f.services.recoverTask(f.task.taskId)).snapshot.status).toBe('completed'));
  });

  it.each(['before', 'after'] as const)('AP10 Given a native %s-COMMIT finalize failure, Then reload cannot turn a raw DB row back into a decidable pending or repeat the tool', async position => {
    const f = await startPrompt();
    const scope = { threadId: 'approval-thread', groupId: f.visible.group!.groupId, approvalId: f.pending.approvalId };
    const fault = failNextApprovalCommit(f.db, position); cleanup.push(fault.restore);
    const result = await f.invoke('decideMultiAgentApproval', { ...scope, operationId: 'failed-finalize', decision: 'approve' });
    expect(fault.faults()).toBe(1); expect(result).toMatchObject({ state: 'unknown' });
    expect(existsSync(f.effect)).toBe(false); expect(f.contexts[0].signal.aborted).toBe(true);
    const raw = f.store.getOperation(scope.groupId, `approval-request:${f.pending.approvalId}`)!;
    expect(raw).toMatchObject({ result: { approval: { status: position === 'before' ? 'pending' : 'approved' } } });
    f.reload(); // Discard the failure notification; read main state from a new authenticated view.
    expect(await f.invoke('getMultiAgentApproval', scope)).toMatchObject({ persistenceState: 'unknown', canDecide: false });
    expect(await f.snapshot()).toMatchObject({ pendingApprovalCount: 0,
      approvalFailure: { groupId: scope.groupId, bootId: f.store.bootId, code: 'multi_agent_approval_persistence_failed' } });
    await expect(f.invoke('decideMultiAgentApproval', { ...scope, operationId: 'late-approve', decision: 'approve' })).rejects.toThrow(/approval_persistence_unknown|invalidated/);
    expect(existsSync(f.effect)).toBe(false);
    expect(f.requests()).toBe(1);
  });

  it('AP1/AP8 Given a real child inherited the parent prompt policy, Then the pending approval and its execution use the child actor instead of the captured root', async () => {
    const f = await startPrompt('child');
    expect(f.context.agentId).not.toBe(`root_${f.context.groupId}`);
    const parent = f.store.getAgent(f.context.groupId, f.context.agentId)!.parentId;
    expect(parent).toBe(`root_${f.context.groupId}`);
    await f.invoke('decideMultiAgentApproval', { threadId: 'approval-thread', groupId: f.context.groupId,
      approvalId: f.pending.approvalId, operationId: 'approve-actual-child', decision: 'approve' });
    await vi.waitFor(() => expect(existsSync(f.effect)).toBe(true));
    expect(readFileSync(f.effect, 'utf8')).toBe('APPROVAL_PRIVATE_INPUT');
    expect(f.store.getOperation(f.context.groupId, `approval-request:${f.pending.approvalId}`)).toMatchObject({ result: { approval: { agentId: f.context.agentId, turnId: f.context.turnId } } });
  });

  it.each([299_000, 301_000, 599_000])('AP3/AP8 Given a real child approval at idle age %sms and its timer has not fired, Then reads never renew the original deadline and late decisions cannot request another model turn', async idleAge => {
    const f = await startPrompt('child');
    const scope = { threadId: 'approval-thread', groupId: f.context.groupId, approvalId: f.pending.approvalId };
    const deadline = f.boundary.service.getApprovalDeadline(f.context.actor);
    const before = (await f.snapshot()).agents.find(agent => agent.id === f.context.agentId)!;
    expect(before.lastActivityAt).toBeTypeOf('number');
    expect(deadline).toBe(Math.min(f.context.effectiveDeadline, before.lastActivityAt! + 300_000));
    const ticketDeadline = f.context.memberTicket.deadlineAt;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(before.lastActivityAt! + idleAge);
    try {
      // Only Date.now changes: actual timer callbacks cannot win this race for us.
      for (let count = 0; count < 3; count++) {
        await f.invoke('getMultiAgentApproval', scope);
        await f.invoke('getMultiAgentOperation', { threadId: scope.threadId, groupId: scope.groupId,
          operationId: `approval-request:${scope.approvalId}` });
      }
      const afterReads = (await f.snapshot()).agents.find(agent => agent.id === f.context.agentId)!;
      expect(afterReads.lastActivityAt).toBe(before.lastActivityAt);
      expect(f.context.memberTicket.deadlineAt).toBe(ticketDeadline);
      expect(existsSync(f.effect)).toBe(false);
      await f.invoke('decideMultiAgentApproval', { ...scope, operationId: `at-idle-${idleAge}`, decision: 'approve' }).catch(() => undefined);
      if (idleAge < 300_000) {
        await vi.waitFor(() => expect(existsSync(f.effect)).toBe(true));
        expect(readFileSync(f.effect, 'utf8')).toBe('APPROVAL_PRIVATE_INPUT');
      } else {
        await vi.waitFor(() => expect(f.store.getAgent(scope.groupId, f.context.agentId)?.executionActive).toBe(false));
        expect(existsSync(f.effect)).toBe(false);
        expect(f.requests(), 'an expired idle owner must terminate, not use the denial to generate a fresh model activity').toBe(1);
      }
    } finally { clock.mockRestore(); }
  });

  it.each(['before-decision', 'after-approved-journal'] as const)('AP2 Given a retained actual Registry input reference changes %s, Then the real factory never executes its changed content', async boundary => {
    const f = await startPrompt();
    expect(f.references).toHaveLength(1);
    const retained = f.references[0];
    expect(retained.content).toBe('APPROVAL_PRIVATE_INPUT');
    let mutations = 0;
    const mutate = () => { retained.content = 'UNAPPROVED_RETAINED_MUTATION'; mutations++; };
    if (boundary === 'before-decision') mutate();
    else {
      const journal = DesktopMultiAgentWorktrees.prototype.beforeOpaqueInvocation;
      vi.spyOn(DesktopMultiAgentWorktrees.prototype, 'beforeOpaqueInvocation').mockImplementation(function(this: DesktopMultiAgentWorktrees, ...args) {
        journal.apply(this, args);
        if (args[1] === f.context.agentId) queueMicrotask(mutate);
        // This remains a void synchronous journal. The actual Catalog await of
        // that journal is the existing scheduling boundary; no fake async IO.
      });
    }
    await f.invoke('decideMultiAgentApproval', { threadId: 'approval-thread', groupId: f.context.groupId,
      approvalId: f.pending.approvalId, operationId: `mutated-${boundary}`, decision: 'approve' });
    await vi.waitFor(() => expect(f.requests()).toBe(2));
    expect(mutations).toBe(1);
    if (boundary === 'before-decision') expect(existsSync(f.effect)).toBe(false);
    else {
      expect(existsSync(f.effect)).toBe(true);
      expect(readFileSync(f.effect, 'utf8')).toBe('APPROVAL_PRIVATE_INPUT');
    }
    expect(JSON.stringify(f.store.getOperation(f.context.groupId, `approval-request:${f.pending.approvalId}`))).not.toContain('UNAPPROVED_RETAINED_MUTATION');
  });

  it.each(['root-cancel', 'child-interrupt', 'child-close', 'thread-delete', 'workspace-revoke', 'scope-dispose', 'descriptor-refresh'] as const)('AP4 Given the actual pending tool and %s wins, Then a late approval cannot create an effect', async action => {
    const f = await startPrompt(action.startsWith('child-') ? 'child' : 'root');
    const scope = { threadId: 'approval-thread', groupId: f.context.groupId, approvalId: f.pending.approvalId };
    if (action === 'root-cancel') await f.services.cancelTask(f.task.taskId);
    if (action === 'child-interrupt' || action === 'child-close') await f.invoke(action === 'child-interrupt' ? 'interruptAgent' : 'closeAgent', {
      threadId: scope.threadId, groupId: scope.groupId, agentId: f.context.agentId, expectedTurn: f.context.turn, operationId: action,
    });
    if (action === 'thread-delete') await f.invoke('deleteMultiAgentThread', {
      threadId: scope.threadId, expectedThreadRevision: f.store.getThread(scope.threadId)!.threadRevision,
      operationId: `delete:${f.store.getThread(scope.threadId)!.threadRevision}:awaiting-approval`, confirmTerminate: true,
    });
    if (action === 'workspace-revoke') await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'revoke-pending-tool'));
    if (action === 'scope-dispose') f.scopes.find(item => item.handle.authority.agentId === f.context.agentId)!.handle.dispose();
    if (action === 'descriptor-refresh') {
      const catalog = f.scopes.find(item => item.handle.authority.agentId === f.context.agentId)!.catalog;
      const descriptor = catalog.snapshotDescriptors().find(item => item.canonicalName === 'write')!;
      const next = catalog.publish({ requestSource: 'scheduler', ownerId: descriptor.ownerId, slotId: descriptor.slotId, entry: descriptor });
      catalog.authorize({ requestSource: 'user', capabilityId: next.capabilityId });
    }
    const decision = await f.invoke('decideMultiAgentApproval', { ...scope, operationId: 'too-late', decision: 'approve' }).catch(error => ({ error: String(error) }));
    expect(JSON.stringify(decision)).toMatch(/invalid|expired|cancel|already|unknown|deleted|not.found|revok|closed|unavailable/i);
    expect(existsSync(f.effect)).toBe(false);
    f.release.resolve();
    await vi.waitFor(async () => expect(['completed', 'failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(f.task.taskId)).snapshot.status));
    expect(existsSync(f.effect)).toBe(false);
  });

  it('AP5/AP6 Given a real pending record, Then forged ownership, extra authority fields and opposite/changed decisions cannot alter the original approval', async () => {
    const f = await startPrompt(); const scope = { threadId: 'approval-thread', groupId: f.context.groupId, approvalId: f.pending.approvalId };
    const input = { ...scope, operationId: 'single-user-decision', decision: 'deny' };
    await expect(f.invoke('decideMultiAgentApproval', input, { ...f.caller(), senderFrame: {} })).rejects.toThrow(/unauthorized/);
    for (const extra of [{ requestSource: 'agent' }, { actor: {} }, { toolName: 'bash' }, { deadlineAt: Date.now() + 99_999 }, { input: { content: 'replacement' } }, { workspaceId: 'other' }]) {
      await expect(f.invoke('decideMultiAgentApproval', { ...input, ...extra })).rejects.toThrow(/argument/);
    }
    await expect(f.invoke('getMultiAgentApproval', { ...scope, threadId: 'wrong-thread' })).rejects.toThrow(/scope|owner|unknown/);
    expect(await f.invoke('getMultiAgentApproval', scope)).toMatchObject({ status: 'pending', canDecide: true });
    const first = await f.invoke('decideMultiAgentApproval', input);
    expect(await f.invoke('decideMultiAgentApproval', input)).toEqual(first);
    await expect(f.invoke('decideMultiAgentApproval', { ...input, decision: 'approve' })).rejects.toThrow(/conflict/);
    const opposite = await f.invoke('decideMultiAgentApproval', { ...input, operationId: 'opposite-decision', decision: 'approve' }).catch(error => ({ error: String(error) }));
    expect(JSON.stringify(opposite)).toMatch(/already_decided|invalidated|denied/);
    expect(existsSync(f.effect)).toBe(false);
  });

  it.each(['deadline', 'descriptor-refresh', 'scope-dispose'] as const)('AP9 Given the real request is enqueued, When %s invalidates it before the original synchronous queue callback, Then no ghost pending/count/event commits', async invalidation => {
    const f = await authorizationFixture(cleanup), toolGate = deferred(), release = deferred();
    cleanup.push(() => release.resolve());
    const effect = join(f.root, 'expired-reservation.txt');
    let requests = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      requests++;
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (requests === 1) { toolGate.resolve(); await release.promise; yield { type: 'tool_use', id: 'queued-prompt', name: 'write', input: { file_path: effect, content: 'never' } }; }
      else yield { type: 'text', delta: 'No pending was created.' };
    });
    const task = await f.services.createTask({ prompt: 'Request a write.', permissionMode: 'default', materials: [], context: { threadId: 'queued-approval' } });
    await toolGate.promise;
    const context = f.contexts[0];
    const group = (f.boundary.service as unknown as { groups: Map<string, { commands: MultiAgentCommandSequencer }> }).groups.get(context.groupId)!;
    const commands = group.commands as unknown as { flush(): void; run: MultiAgentCommandSequencer['run'] };
    const originalFlush = commands.flush.bind(commands), originalRun = commands.run.bind(commands);
    let paused = false, observedRequest = false;
    const flush = vi.spyOn(commands, 'flush').mockImplementation(() => { if (!paused) originalFlush(); });
    const run = vi.spyOn(commands, 'run').mockImplementation(action => {
      // Observe the production approval caller, not a fake createApproval API.
      const owner = (new Error().stack ?? '').split('\n').some(line => /[/\\]electron[/\\].*approval/i.test(line));
      if (owner) { paused = true; observedRequest = true; }
      return originalRun(action);
    });
    cleanup.push(() => { paused = false; originalFlush(); run.mockRestore(); flush.mockRestore(); });
    release.resolve();
    await vi.waitFor(() => expect(observedRequest || requests > 1).toBe(true));
    expect(observedRequest, 'the production request must really reach its group sequencer before this deadline race is testable').toBe(true);
    const clock = invalidation === 'deadline' ? vi.spyOn(Date, 'now').mockReturnValue(context.effectiveDeadline + 1) : undefined;
    const scope = f.scopes.find(item => item.handle.authority.agentId === context.agentId)!;
    expect(scope).toBeDefined();
    if (invalidation === 'scope-dispose') scope.handle.dispose();
    if (invalidation === 'descriptor-refresh') {
      const descriptor = scope.catalog.snapshotDescriptors().find(item => item.canonicalName === 'write')!;
      const next = scope.catalog.publish({ requestSource: 'scheduler', ownerId: descriptor.ownerId, slotId: descriptor.slotId, entry: descriptor });
      scope.catalog.authorize({ requestSource: 'user', capabilityId: next.capabilityId });
    }
    try { paused = false; originalFlush();
      await vi.waitFor(async () => expect(['completed', 'failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(task.taskId)).snapshot.status));
      expect(f.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE group_id=? AND json_extract(data_json,'$.command')='approval_request'").get(context.groupId)).toMatchObject({ n: 0 });
      expect(f.db.prepare("SELECT COUNT(*) AS n FROM events WHERE group_id=? AND json_extract(data_json,'$.kind')='approval'").get(context.groupId)).toMatchObject({ n: 0 });
      expect(f.db.prepare('SELECT pending_approval_count FROM thread_bindings WHERE thread_id=?').get('queued-approval')).toMatchObject({ pending_approval_count: 0 });
      expect(existsSync(effect)).toBe(false);
      if (invalidation === 'deadline') expect(requests).toBe(1);
    } finally { clock?.mockRestore(); }
  });

  it('AP9 FIFO control Given the real turn seal commits before the tool proposal, Then the stale invocation cannot create a pending approval or effect', async () => {
    const f = await authorizationFixture(cleanup), entered = deferred(), release = deferred();
    cleanup.push(() => release.resolve());
    const effect = join(f.root, 'sealed-proposal.txt'); let requests = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      requests++;
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      entered.resolve(); await release.promise;
      yield { type: 'tool_use', id: 'after-real-seal', name: 'write', input: { file_path: effect, content: 'never approved' } };
    });
    const task = await f.services.createTask({ prompt: 'Prepare a bounded write.', permissionMode: 'default', materials: [], context: { threadId: 'sealed-before-prompt' } });
    await entered.promise;
    const context = f.contexts[0];
    expect(await context.mailbox.trySealTurn({ outcome: 'completed' })).toMatchObject({ kind: 'sealed' });
    expect(() => f.boundary.service.assertInvocation(context.actor)).toThrow(/seal|stale|inactive|invalid|current/i);
    release.resolve();
    await vi.waitFor(async () => expect(['completed', 'failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(task.taskId)).snapshot.status));
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE group_id=? AND json_extract(data_json,'$.command')='approval_request'").get(context.groupId)).toMatchObject({ n: 0 });
    expect(existsSync(effect)).toBe(false);
    expect(requests).toBe(1);
  });
});
