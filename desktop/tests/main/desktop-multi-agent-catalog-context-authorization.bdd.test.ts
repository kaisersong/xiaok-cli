// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModelAdapter, ToolExecutionContext } from '../../../src/types.js';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopOwnedToolRegistry, DesktopToolCatalogBridge } from '../../electron/desktop-multi-agent-catalog-bridge.js';
import { DesktopMultiAgentRuntime, type DesktopAgentRuntimeBinding } from '../../electron/desktop-multi-agent-runtime.js';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };

describe('BDD W12: actual service contexts authorize bridge and runtime scopes', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });

  async function setup() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-catalog-context-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    const entered = deferred<DesktopAgentExecutionContext>(), release = deferred<void>(), childEntered = deferred<DesktopAgentExecutionContext>();
    const childModelEntered = deferred<void>(), childRelease = deferred<void>();
    let runtime!: DesktopMultiAgentRuntime;
    let childSession: Awaited<ReturnType<DesktopMultiAgentRuntime['createSession']>> | undefined;
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: async input => {
      const session = await runtime.createSession(input);
      childSession = session;
      return { ...session, run: async message => { childEntered.resolve(input.getTurnContext()); return session.run(message); },
        dispose: () => session.dispose() };
    } });
    runtime = new DesktopMultiAgentRuntime({ service });
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const registry = new DesktopOwnedToolRegistry({ autoMode: true }, []);
    const effect = vi.fn(async () => 'real-bound-effect');
    registry.registerOwnedTool({ permission: 'safe', definition: { name: 'probe', description: 'actual invocation probe', inputSchema: { type: 'object', properties: {} } }, execute: effect },
      { ownerId: 'probe-owner', slotKey: 'probe', binding: 'independent' });
    // Passing the prospective option to the existing constructor is intentional:
    // before the repair it ignores this owner and authorizes arbitrary contexts.
    const bridgeOptions = { registry, workspaceId: 'workspace', getService: () => service };
    const bridge = new DesktopToolCatalogBridge(bridgeOptions);
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 * 1024 }),
      authorizePreparation: (taskId, marker) => service.assertHostPreparation(taskId, marker),
      assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      runner: input => service.runRoot(input, async context => { entered.resolve(context); await release.promise; throw new Error('fixture root released'); }),
    });
    await service.initialize(host);
    const prepared = await service.prepareRoot(host, 'thread', { prompt: 'fixture', materials: [] });
    await host.startTask(prepared.taskId);
    const context = await entered.promise;
    cleanup.push(async () => {
      await host.cancelTask(prepared.taskId); release.resolve(); childRelease.resolve(); await host.drain(); await service.dispose(); bridge.dispose(); registry.dispose();
    });
    const authorize = (candidate?: DesktopAgentExecutionContext) => {
      (bridge.authorizeRoot as (context?: DesktopAgentExecutionContext) => void).call(bridge, candidate);
    };
    const binding = (permissionRevision = context.permissionRevision): DesktopAgentRuntimeBinding => ({
      adapter: { async *stream() { childModelEntered.resolve(); await childRelease.promise; yield { type: 'text', delta: 'child done' }; } } satisfies Pick<ModelAdapter, 'stream'>,
      catalog: bridge.catalog, policy: bridge.catalog.snapshotPolicy(), workspaceId: 'workspace', materialIds: [], permissionRevision,
      registryOptions: { autoMode: true }, materials: [], skillCatalog: createSkillCatalog(undefined, root), dataRoot: root,
      agents: [], systemPrompt: 'test', emitRuntimeEvent: async () => {},
    });
    return { root, store, service, runtime, bridge, context, authorize, binding, effect, childEntered, childModelEntered,
      childSession: () => childSession!, host, taskId: prepared.taskId };
  }

  it.each(['missing', 'copy', 'actor-copy', 'foreign-fields'] as const)('W12 bridge rejects %s context before issuing any slot authorization', async kind => {
    const f = await setup();
    const candidate = kind === 'missing' ? undefined : kind === 'actor-copy' ? { ...f.context, actor: { ...f.context.actor } }
      : kind === 'foreign-fields' ? { ...f.context, groupId: 'foreign', permissionRevision: f.context.permissionRevision + 1 } : { ...f.context };
    expect(() => f.authorize(candidate)).toThrow(); expect(f.effect).not.toHaveBeenCalled();
    const scope = f.bridge.catalog.createScopedRegistry(f.bridge.catalog.snapshotPolicy(), { ...f.context,
      workspaceId: 'workspace', materialIds: [], deadlineAt: f.context.effectiveDeadline }, { autoMode: true });
    try { await scope.registry.executeTool('probe', {}); expect(f.effect).not.toHaveBeenCalled(); } finally { scope.dispose(); }
  });

  it('W12 a real root authorizes actual slots and a retained stopped root cannot authorize a replacement', async () => {
    const f = await setup(); f.authorize(f.context);
    const scope = f.runtime.bindRoot(f.context, f.binding());
    try { expect(await scope.registry.executeTool('probe', {})).toBe('real-bound-effect'); }
    finally { scope.dispose(); }
    await f.host.cancelTask(f.taskId);
    expect(() => f.authorize(f.context)).toThrow(); expect(f.effect).toHaveBeenCalledTimes(1);
  });

  it('W12 root and child scopes read their actual context revision, never the inherited legacy binding revision', async () => {
    const f = await setup(); f.authorize(f.context);
    const actualCreate = f.bridge.catalog.createScopedRegistry.bind(f.bridge.catalog);
    const revisions: Array<{ agentId: string; revision: number }> = [];
    vi.spyOn(f.bridge.catalog, 'createScopedRegistry').mockImplementation((policy, authority, options) => {
      revisions.push({ agentId: authority.agentId, revision: authority.permissionRevision }); return actualCreate(policy, authority, options);
    });
    const scope = f.runtime.bindRoot(f.context, f.binding(f.context.permissionRevision + 17));
    try {
      expect(await scope.registry.executeTool('probe', {})).toBe('real-bound-effect');
      const spawned = await scope.registry.executeTool('spawn_agent', { task_name: 'revision_child', message: 'finish', fork_context: false },
        { toolInvocationId: 'actual-child', messages: [] } as unknown as ToolExecutionContext);
      expect(JSON.parse(spawned)).toMatchObject({ targetAgentId: expect.any(String) });
      const child = await f.childEntered.promise;
      await f.childModelEntered.promise;
      await vi.waitFor(() => expect(revisions.some(item => item.agentId === child.agentId)).toBe(true));
      expect(revisions).toEqual([{ agentId: f.context.agentId, revision: f.context.permissionRevision }, { agentId: child.agentId, revision: child.permissionRevision }]);
      f.service.assertInvocation(child.actor, child);
      expect(() => f.authorize(child)).toThrow(/root/);
    } finally { scope.dispose(); }
  });

  it('W12 runtime rejects a copied root before binding its actor and still accepts that actor with its original context', async () => {
    const f = await setup(); f.authorize(f.context);
    expect(() => f.runtime.bindRoot({ ...f.context }, f.binding())).toThrow(/context/);
    expect(f.effect).not.toHaveBeenCalled();
    const scope = f.runtime.bindRoot(f.context, f.binding());
    try { expect(await scope.registry.executeTool('probe', {})).toBe('real-bound-effect'); }
    finally { scope.dispose(); }
  });

  it('W12 original child identity does not drop the session lifetime signal for a retained control Tool', async () => {
    const f = await setup(); f.authorize(f.context);
    const actualCreate = f.bridge.catalog.createScopedRegistry.bind(f.bridge.catalog);
    const scopes: ReturnType<typeof actualCreate>[] = [];
    vi.spyOn(f.bridge.catalog, 'createScopedRegistry').mockImplementation((...args) => {
      const scope = actualCreate(...args); scopes.push(scope); return scope;
    });
    const rootScope = f.runtime.bindRoot(f.context, f.binding());
    try {
      const receipt = await rootScope.registry.executeTool('spawn_agent', { task_name: 'signal_child', message: 'wait', fork_context: false });
      expect(JSON.parse(receipt)).toMatchObject({ targetAgentId: expect.any(String) });
      const child = await f.childEntered.promise; await f.childModelEntered.promise;
      const childScope = scopes.find(scope => scope.authority.agentId === child.agentId)!;
      const retained = childScope.registry.getRegisteredTool('send_message')!;
      const retainedControls = ['spawn_agent', 'send_message', 'followup_task', 'wait_agent', 'list_agents', 'interrupt_agent', 'close_agent']
        .map(name => childScope.registry.getRegisteredTool(name)!);
      expect(retainedControls.every(Boolean)).toBe(true);
      expect(retained).toBeDefined();
      await f.childSession().deactivate();
      expect(child.signal.aborted).toBe(false); f.service.assertInvocation(child.actor, child);
      expect(childScope.authority.signal.aborted).toBe(true);
      const before = f.store.listMessages(child.groupId, f.context.agentId).length;
      await retained.execute({ target: 'main', message: 'must not send after session lifetime ends' }).catch(() => undefined);
      expect(f.store.listMessages(child.groupId, f.context.agentId)).toHaveLength(before);
      for (const tool of retainedControls) await expect(tool.execute({})).rejects.toBe(childScope.authority.signal.reason);
    } finally { rootScope.dispose(); }
  });
});
