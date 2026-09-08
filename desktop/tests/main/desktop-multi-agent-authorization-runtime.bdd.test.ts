// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { ToolExecutionContext } from '../../../src/types.js';
import type { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { authorizationFixture, authorizationRequest, deferred } from '../fixtures/multi-agent-authorization.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// Source-mode fixture only: map the production's fixed JS URL to an actual
// compiled CPU Worker. Native message/error/exit and host settlement stay real.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
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

describe('BDD W1–W6/W11: real root and child execution authority siblings', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  async function pair() {
    const f = await authorizationFixture(cleanup), rootEntered = deferred(), childEntered = deferred(), release = deferred();
    cleanup.push(() => release.resolve());
    const rootEffect = join(f.root, 'root-after-gate.txt'), childEffect = join(f.root, 'child-after-gate.txt');
    const captured: Array<{ name: string; registry: ToolRegistry; context?: ToolExecutionContext }> = [];
    const execute = ToolRegistry.prototype.executeTool;
    vi.spyOn(ToolRegistry.prototype, 'executeTool').mockImplementation(function(this: ToolRegistry, name, input, context) {
      if (name === 'spawn_agent' || name === 'send_message') captured.push({ name, registry: this, context });
      return execute.call(this, name, input, context);
    });
    let rootRequests = 0, childRequests = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (_messages, _tools, system) {
      const child = Boolean(system?.includes('Assigned Desktop agent:'));
      const count = child ? ++childRequests : ++rootRequests;
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (count === 1) yield child
        ? { type: 'tool_use', id: 'child-message', name: 'send_message', input: { target: 'main', message: 'REAL_CHILD_READY' } }
        : { type: 'tool_use', id: 'real-spawn', name: 'spawn_agent', input: { task_name: 'auth_child', message: 'Send main one message then wait.', fork_context: false } };
      else if (count === 2) {
        (child ? childEntered : rootEntered).resolve(); await release.promise;
        yield { type: 'tool_use', id: child ? 'child-after' : 'root-after', name: 'write', input: { file_path: child ? childEffect : rootEffect, content: 'after controlled adapter wait' } };
      } else yield { type: 'text', delta: child ? 'Child finished.' : 'Root finished.' };
    });
    const created = await f.services.createTask({ prompt: 'Delegate one bounded child, wait and finish.', permissionMode: 'auto', materials: [], context: { threadId: 'runtime-auth' } });
    await Promise.all([rootEntered.promise, childEntered.promise]);
    const root = f.contexts.find(context => context.agentId === `root_${context.groupId}`)!;
    const child = f.contexts.find(context => context.agentId !== `root_${context.groupId}`)!;
    expect(root).toBeDefined(); expect(child).toBeDefined(); expect(child.groupId).toBe(root.groupId);
    expect(f.store.listMessages(root.groupId, root.agentId).some(message => message.preview === 'REAL_CHILD_READY')).toBe(true);
    const rootScope = captured.find(item => item.name === 'spawn_agent')!;
    expect(rootScope.registry.getToolDefinitions().map(tool => tool.name)).toContain('close_agent');
    const settled = async () => {
      await vi.waitFor(async () => expect(['completed', 'failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(created.taskId)).snapshot.status));
      await vi.waitFor(() => expect(f.store.getAgent(root.groupId, child.agentId)?.executionActive).toBe(false));
    };
    return { ...f, rootContext: root, childContext: child, rootScope, release, rootEffect, childEffect, settled,
      requests: () => ({ root: rootRequests, child: childRequests }) };
  }

  it('W1/W5 Given actual root+child adapters are already waiting and ignore abort, Then revoke stops next effects but never reports those pending executions as released', async () => {
    const f = await pair(), prior = await f.getAuthorization();
    const receipt = await f.setAuthorization(authorizationRequest(prior, false, 'revoke-live-pair'));
    expect(receipt).toMatchObject({ state: 'applied', executionAllowed: false });
    expect(f.rootContext.signal.aborted).toBe(true); expect(f.childContext.signal.aborted).toBe(true);
    expect(f.store.getAgent(f.rootContext.groupId, f.childContext.agentId)).toMatchObject({ resourcesReleased: false, executionActive: true });
    expect(f.requests()).toEqual({ root: 2, child: 2 });
    expect(existsSync(f.rootEffect)).toBe(false); expect(existsSync(f.childEffect)).toBe(false);
    f.release.resolve(); await f.settled();
    expect(existsSync(f.rootEffect)).toBe(false); expect(existsSync(f.childEffect)).toBe(false);
    expect(f.requests()).toEqual({ root: 2, child: 2 });
    expect(f.store.requireGroup(f.rootContext.groupId)).toMatchObject({ mutationBlockedReason: 'permission_revoked' });
  });

  it.each(['spawn_agent', 'send_message', 'interrupt_agent', 'followup_task', 'wait_agent', 'list_agents', 'close_agent'])('W3 Given the registered root %s tool and a revoked group, Then actual registry admission cannot bypass the workspace owner', async name => {
    const f = await pair();
    expect(f.rootScope.registry.getToolDefinitions().map(tool => tool.name)).toContain(name);
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, `tool-${name}`));
    const count = f.store.allAgents(f.rootContext.groupId).length;
    const inputs: Record<string, Record<string, unknown>> = {
      spawn_agent: { task_name: 'forbidden', message: 'Must not start.' }, send_message: { target: f.childContext.agentId, message: 'must not enqueue' },
      interrupt_agent: { target: f.childContext.agentId }, followup_task: { target: f.childContext.agentId, message: 'must not queue' },
      wait_agent: { targets: [f.childContext.agentId], timeout_ms: 1 }, list_agents: {}, close_agent: { target: f.childContext.agentId },
    };
    const result = await f.rootScope.registry.executeTool(name, inputs[name], f.rootScope.context).catch(error => String(error));
    expect(String(result)).toMatch(/abort|revok|stale|invalid|not found|unknown|no longer|disposed/i);
    expect(f.store.allAgents(f.rootContext.groupId)).toHaveLength(count);
    expect(f.store.listMessages(f.rootContext.groupId, f.childContext.agentId).some(message => message.preview === 'must not enqueue')).toBe(false);
    f.release.resolve(); await f.settled(); expect(f.requests()).toEqual({ root: 2, child: 2 });
  });

  it.each(['read', 'write', 'edit', 'bash'])('W2/W6 Given the real scoped %s and revoke followed by grant, Then the old scope cannot regain authority', async name => {
    const f = await pair();
    expect(f.rootScope.registry.getToolDefinitions().map(tool => tool.name)).toContain(name);
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'deny-old-scope'));
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), true, 'grant-new-intent'));
    const args: Record<string, Record<string, unknown>> = {
      read: { file_path: f.rootEffect }, write: { file_path: f.rootEffect, content: 'forbidden' },
      edit: { file_path: f.rootEffect, old_string: 'old', new_string: 'new' }, bash: { command: 'echo forbidden', workdir: f.root },
    };
    const result = await f.rootScope.registry.executeTool(name, args[name], f.rootScope.context).catch(error => String(error));
    expect(String(result)).toMatch(/abort|revok|stale|invalid|not found|unknown|no longer|disposed/i);
    expect(f.rootContext.signal.aborted).toBe(true); expect(f.childContext.signal.aborted).toBe(true);
    expect(() => f.boundary.service.assertInvocation(f.rootContext.actor)).toThrow();
    expect(() => f.boundary.service.assertInvocation(f.childContext.actor)).toThrow();
    f.release.resolve(); await f.settled();
    expect(existsSync(f.rootEffect)).toBe(false); expect(existsSync(f.childEffect)).toBe(false);
  });

  it('W11 Given the existing viewer subscription, When its sender navigates/closes, Then actual root+child continue and the new viewer reads their progress', async () => {
    const f = await pair();
    await f.invoke('subscribeMultiAgents', { threadId: 'runtime-auth', subscriptionId: 'viewer-only' });
    const old = f.reload(), oldCount = f.sent.filter(item => item.senderId === old.sender.id).length;
    expect(f.rootContext.signal.aborted).toBe(false); expect(f.childContext.signal.aborted).toBe(false);
    f.release.resolve(); await f.settled();
    expect(existsSync(f.rootEffect)).toBe(true); expect(existsSync(f.childEffect)).toBe(true);
    expect(f.sent.filter(item => item.senderId === old.sender.id)).toHaveLength(oldCount);
    expect(await f.invoke('getMultiAgentSnapshot', { threadId: 'runtime-auth' })).toMatchObject({ agents: expect.arrayContaining([expect.objectContaining({ id: f.childContext.agentId, status: 'completed' })]) });
  });

  it('W4 Given an ordinary external FIFO owner and a queued prepared root, Then revoke cancels only the local queue and releasing the external ticket never starts it', async () => {
    const f = await authorizationFixture(cleanup);
    const coordinator = (f.boundary.service as unknown as { options: { coordinator: DesktopExecutionCoordinator } }).options.coordinator;
    const external = await coordinator.acquireLease({ policy: 'ordinary' }); cleanup.push(() => external.release());
    const model = vi.spyOn(OpenAIAdapter.prototype, 'stream');
    const created = await f.services.createTask({ prompt: 'Queued root must not start.', permissionMode: 'auto', materials: [], context: { threadId: 'queued-root' } });
    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ active: 1, waiting: 1 }));
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'cancel-local-fifo'));
    expect(external.released).toBe(false); expect(coordinator.snapshot()).toMatchObject({ active: 1, waiting: 0 });
    external.release();
    await vi.waitFor(async () => expect(['failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(created.taskId)).snapshot.status));
    expect(model).not.toHaveBeenCalled(); expect(coordinator.snapshot()).toMatchObject({ active: 0, waiting: 0 });
  });

  it('W4 Given both user and agent busy followups in the real child queue, Then revoke cancels both receipts and late old completion cannot start the next turn', async () => {
    const f = await pair(), groupId = f.rootContext.groupId, child = f.store.getAgent(groupId, f.childContext.agentId)!;
    const user = await f.invoke<{ expectedTurn: number }>('followupAgent', { threadId: 'runtime-auth', groupId, agentId: child.id,
      operationId: 'user-busy-next', expectedTurn: child.turn, message: 'user queued turn must not run' });
    expect(user).toMatchObject({ state: 'queued_next_admission', expectedTurn: child.turn + 1 });
    const agent = JSON.parse(await f.rootScope.registry.executeTool('followup_task', { target: child.id, message: 'agent queued turn must not run' },
      { ...f.rootScope.context!, toolInvocationId: 'agent-busy-next' })) as { operationId: string; expectedTurn: number };
    expect(agent).toMatchObject({ state: 'queued_next_admission', expectedTurn: child.turn + 2 });
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'cancel-both-followups'));
    f.release.resolve(); await f.settled();
    expect(f.store.getAgent(groupId, child.id)?.turn).toBe(child.turn);
    for (const id of ['user-busy-next', agent.operationId]) expect(f.store.getOperation(groupId, id)?.result).toMatchObject({ outcome: 'cancelled' });
    expect(f.requests()).toEqual({ root: 2, child: 2 });
  });

  it('W6/W7/W15 Given reset is cleanup_pending, Then revoke/regrant and late cleanup never create a group until another explicit user reset', async () => {
    const f = await pair(), groupId = f.rootContext.groupId;
    const originalRevision = (f.store.requireGroup(groupId) as unknown as { permissionRevision: number }).permissionRevision;
    expect(Number.isSafeInteger(originalRevision), 'the immutable group revision must exist, not compare undefined with itself').toBe(true);
    expect(await f.invoke('resetMultiAgentGroup', { threadId: 'runtime-auth', expectedGroupId: groupId, confirmTerminate: true, operationId: 'old-pending-reset' }))
      .toMatchObject({ state: 'cleanup_pending' });
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'revoke-pending-reset'));
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), true, 'new-grant-no-resume'));
    f.release.resolve(); await f.settled();
    await vi.waitFor(() => expect(f.store.getAgent(groupId, f.childContext.agentId)?.resourcesReleased).toBe(true));
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM groups').get()).toMatchObject({ n: 1 });
    expect(f.store.requireGroup(groupId)).toMatchObject({ permissionRevision: originalRevision, mutationBlockedReason: 'permission_revoked' });
    await f.invoke('resetMultiAgentGroup', { threadId: 'runtime-auth', expectedGroupId: f.store.activeGroup('runtime-auth')?.groupId ?? null,
      confirmTerminate: true, operationId: 'explicit-new-group' });
    await vi.waitFor(() => expect(f.store.activeGroup('runtime-auth')?.groupId).not.toBe(groupId));
    const current = f.store.activeGroup('runtime-auth')!;
    expect(current).toMatchObject({ permissionRevision: (await f.getAuthorization()).permissionRevision });
    const fresh = await f.services.createTask({ prompt: 'New explicit root in reset group.', permissionMode: 'auto', materials: [], context: { threadId: 'runtime-auth' } });
    await vi.waitFor(async () => expect((await f.services.recoverTask(fresh.taskId)).snapshot.status).toBe('completed'));
    expect(f.requests().root).toBe(3);
    expect(f.store.requireGroup(groupId)).toMatchObject({ permissionRevision: originalRevision, mutationBlockedReason: 'permission_revoked' });
  });

  it('AP1 actual population Given Goal has its existing auto mode, Then its real default runner writes without manufacturing a default-mode approval UI', async () => {
    const f = await authorizationFixture(cleanup), effect = join(f.root, 'goal-auto.txt'); let calls = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (++calls === 1) yield { type: 'tool_use', id: 'goal-write', name: 'write', input: { file_path: effect, content: 'GOAL_AUTO_EFFECT' } };
      else if (calls === 2) yield { type: 'tool_use', id: 'goal-complete', name: 'goal_request_complete', input: { summary: 'The requested answer and file are ready.' } };
      else yield { type: 'text', delta: 'The requested answer is complete.' };
    });
    const created = await f.services.createGoal({ threadId: 'goal-auto', objective: 'Answer and write one temporary file.', expectedEvidenceKinds: ['answer'], turnLimit: 3 });
    await f.services.ackGoalTaskAttached({ threadId: 'goal-auto', attachmentId: created.preparedTask.attachmentId });
    await vi.waitFor(async () => expect((await f.services.recoverTask(created.preparedTask.taskId)).snapshot.status).toBe('completed'));
    expect(existsSync(effect)).toBe(true);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE json_extract(data_json,'$.command')='approval_request'").get()).toMatchObject({ n: 0 });
  });

  it.each(['prepared', 'running'] as const)('W1/W8 Given a real Goal is %s, Then revoke disarms without deleting its state and regrant cannot replay its old attachment', async phase => {
    const f = await authorizationFixture(cleanup), entered = deferred(), release = deferred(); cleanup.push(() => release.resolve());
    const effect = join(f.root, 'goal-after-revoke.txt'); let calls = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      calls++;
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      entered.resolve(); await release.promise;
      yield { type: 'tool_use', id: 'goal-forbidden', name: 'write', input: { file_path: effect, content: 'must not dispatch' } };
    });
    const goal = await f.services.createGoal({ threadId: 'goal-revoke', objective: 'Wait for the user and write.', expectedEvidenceKinds: ['answer'], turnLimit: 3 });
    if (phase === 'running') {
      await f.services.ackGoalTaskAttached({ threadId: 'goal-revoke', attachmentId: goal.preparedTask.attachmentId }); await entered.promise;
    }
    expect(calls).toBe(phase === 'running' ? 1 : 0);
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, `goal-${phase}`));
    expect(await f.services.getGoal('goal-revoke')).toMatchObject({ activation: 'disarmed', state: { goalId: goal.goal.state.goalId } });
    if (phase === 'running') expect(f.contexts[0].signal.aborted).toBe(true);
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), true, 'grant-does-not-arm'));
    await f.services.ackGoalTaskAttached({ threadId: 'goal-revoke', attachmentId: goal.preparedTask.attachmentId }).catch(() => undefined);
    release.resolve();
    await vi.waitFor(async () => expect((await f.services.getGoal('goal-revoke'))?.activation).toBe('disarmed'));
    await vi.waitFor(async () => expect(['failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(goal.preparedTask.taskId)).snapshot.status));
    expect(calls).toBe(phase === 'running' ? 1 : 0); expect(existsSync(effect)).toBe(false);
  });
});
