// @vitest-environment node
import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopMultiAgentRuntime} from '../../electron/desktop-multi-agent-runtime.js';
import {DesktopMultiAgentService} from '../../electron/desktop-multi-agent-service.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {DesktopOwnedToolRegistry, DesktopToolCatalogBridge} from '../../electron/desktop-multi-agent-catalog-bridge.js';
import {createDesktopModelRunnerWithRegistry} from '../../electron/desktop-services.js';
import {createProjectAgentModel} from '../../electron/project-agent-model.js';
import {ModelStreamPhysicalOwner} from '../../../src/ai/runtime/model-stream-physical-owner.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {InProcessTaskRuntimeHost, type TaskRunnerInput} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import type {ModelAdapter, StreamChunk} from '../../../src/types.js';

const control = vi.hoisted(() => ({checkpointFailure: undefined as {error: unknown} | undefined}));
// Only a negative injection at the actual checkpoint; successful calls always
// enter the original guard. This mock cannot mint a Native/Source permission.
vi.mock('../../../src/runtime/task-host/workflow-restriction-checkpoint.js', async original => {
  const actual = await original<typeof import('../../../src/runtime/task-host/workflow-restriction-checkpoint.js')>();
  return {...actual, assertNativeRegistryCheckpointCurrent: (...args: Parameters<typeof actual.assertNativeRegistryCheckpointCurrent>) => {
    if (control.checkpointFailure) throw control.checkpointFailure.error;
    return actual.assertNativeRegistryCheckpointCurrent(...args);
  }};
});
const cfg = vi.hoisted(() => ({schemaVersion: 2, defaultProvider: 'local', defaultModelId: 'model',
  providers: {local: {type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://127.0.0.1:1/v1'}},
  models: {model: {provider: 'local', model: 'model', label: 'Fixture', capabilities: ['tools']}}}));
vi.mock('../../../src/utils/config.js', async original => ({...await original<object>(), loadConfig: async () => cfg}));
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  control.checkpointFailure = undefined;
  const errors: unknown[] = [];
  for (const action of cleanup.splice(0).reverse()) {
    try { await action(); } catch (error) { errors.push(error); }
  }
  vi.restoreAllMocks();
  if (errors.length) throw new AggregateError(errors, 'fixture_cleanup_failed');
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, release};
}
function adapterFixture(options: {returned?: () => Promise<void>; failStream?: boolean} = {}) {
  const returned = vi.fn(options.returned ?? (async () => {}));
  const stream = vi.fn(() => {
    const source = (async function* (): AsyncGenerator<StreamChunk> {
      if (options.failStream) throw new Error('actual_stream_failure');
      yield {type: 'text', delta: 'LEASED_ROOT'};
      yield {type: 'done'};
    })();
    return {next: () => source.next(), async return() { await returned(); return source.return(undefined); },
      [Symbol.asyncIterator]() { return this; }};
  });
  return {adapter: {stream, getModelName: () => 'original root fixture'} as unknown as ModelAdapter, stream, returned};
}
function setup(select: (input: TaskRunnerInput) => Promise<ModelAdapter>) {
  const root = mkdtempSync(join(tmpdir(), 'desktop-invocation-'));
  cleanup.push(() => rmSync(root, {recursive: true, force: true, maxRetries: 3}));
  const registry = new ToolRegistry({autoMode: true}, []), materials = new MaterialRegistry({workspaceRoot: join(root, 'materials')});
  cleanup.push(() => registry.dispose());
  let current!: TaskRunnerInput;
  const selected = vi.fn(async () => createProjectAgentModel({loadConfig: async () => cfg as never,
    createAdapter: () => { throw Error('selection_not_ready'); }}));
  // The production model selection port carries an ordinary adapter, never an
  // invocation lease or permission DTO. Its stream still uses the real owner.
  selected.mockImplementation(async () => {
    const adapter = await select(current);
    return createProjectAgentModel({loadConfig: async () => cfg as never, createAdapter: () => adapter});
  });
  const runner = createDesktopModelRunnerWithRegistry(registry, [], root,
    {request: async () => new Response('{}')} as never, materials, {},
    {restrictedArtifactGeneration: true, getProjectModel: selected});
  const settled = vi.fn();
  const host = new InProcessTaskRuntimeHost({runner: input => { current = input; return runner(input); },
    materialRegistry: materials, snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), acquireExecutionToken: () => ({release: settled})});
  cleanup.push(() => host.drain());
  return {host, settled, registry, selected};
}
it('the original root runner retains its physical provider through the original return before receipt and settlement', async () => {
  const held = gate(), provider = adapterFixture({returned: () => held.promise});
  const select = vi.fn(async (_input: TaskRunnerInput) => provider.adapter), f = setup(select);
  try {
    const task = await f.host.createTask({prompt: 'run', materials: []});
    await vi.waitFor(() => expect(provider.returned).toHaveBeenCalledOnce());
    expect(select.mock.calls[0][0].taskId).toBe(task.taskId);
    expect(provider.stream).toHaveBeenCalledOnce();
    expect(f.settled).not.toHaveBeenCalled();
  } finally { held.release(); await f.host.drain(); }
  expect(provider.returned).toHaveBeenCalledOnce();
  expect(f.settled).toHaveBeenCalledOnce();
});
it.each(['before-stream', 'stream'] as const)('root %s failure retires only original resources that actually entered', async phase => {
  const provider = adapterFixture({failStream: true}), f = setup(async () => provider.adapter);
  if (phase === 'before-stream') vi.spyOn(f.registry, 'getToolDefinitions').mockImplementation(() => { throw Error('actual_registry_failure'); });
  await f.host.createTask({prompt: 'run', materials: []});
  await f.host.drain();
  expect(f.selected).toHaveBeenCalledOnce();
  expect(provider.stream).toHaveBeenCalledTimes(phase === 'stream' ? 1 : 0);
  expect(provider.returned).toHaveBeenCalledTimes(phase === 'stream' ? 1 : 0);
  expect(f.settled).toHaveBeenCalledOnce();
});
it('cancelling while actual root model selection awaits cannot start the late provider', async () => {
  const ready = gate(), allocated = gate(), provider = adapterFixture();
  let originalSignal: AbortSignal | undefined;
  const f = setup(async input => { originalSignal = input.signal; ready.release(); await allocated.promise; return provider.adapter; });
  try {
    const task = await f.host.createTask({prompt: 'run', materials: []});
    await ready.promise;
    const cancel = f.host.cancelTask(task.taskId, 'user_cancelled');
    await vi.waitFor(() => expect(originalSignal?.aborted).toBe(true));
    allocated.release(); await cancel; await f.host.drain();
    expect(provider.stream).not.toHaveBeenCalled();
    expect(provider.returned).not.toHaveBeenCalled();
  } finally { allocated.release(); }
});
it('the original physical owner publishes one completion before synchronous abort reentry', async () => {
  const owner = new ModelStreamPhysicalOwner(), held = gate(), claim = owner.admit();
  claim.observeReturn(held.promise); claim.finish();
  let inside: Promise<void> | undefined, aborts = 0, settled = false;
  owner.signal.addEventListener('abort', () => { aborts++; inside = owner.waitForStopped(); }, {once: true});
  owner.stop();
  const outside = owner.waitForStopped();
  void outside.then(() => { settled = true; });
  expect(inside).toBe(outside);
  await Promise.resolve(); expect(settled).toBe(false);
  held.release(); await outside;
  expect(aborts).toBe(1);
  expect(owner.waitForStopped()).toBe(outside);
});
it('a checkpoint failure after actual root registry binding disposes that original scope without starting a provider', async () => {
  const root = mkdtempSync(join(tmpdir(), 'root-scope-invocation-'));
  cleanup.push(() => rmSync(root, {recursive: true, force: true, maxRetries: 3}));
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
  const coordinator = new DesktopExecutionCoordinator();
  let runtime!: DesktopMultiAgentRuntime;
  const service = new DesktopMultiAgentService({store, coordinator, createSession: input => runtime.createSession(input)});
  cleanup.push(() => service.dispose()); runtime = new DesktopMultiAgentRuntime({service});
  service.registerThread({threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root});
  const registry = new DesktopOwnedToolRegistry({autoMode: true}, []), catalog = new DesktopToolCatalogBridge({registry, workspaceId: 'workspace'});
  cleanup.push(() => { catalog.dispose(); registry.dispose(); });
  const materials = new MaterialRegistry({workspaceRoot: join(root, 'materials')}), provider = adapterFixture();
  let dispose: ReturnType<typeof vi.fn> | undefined;
  const bind = runtime.bindRoot.bind(runtime);
  vi.spyOn(runtime, 'bindRoot').mockImplementation((...args) => {
    const scope = bind(...args); dispose = vi.spyOn(scope, 'dispose'); return scope;
  });
  const projectModel = await createProjectAgentModel({loadConfig: async () => cfg as never, createAdapter: () => provider.adapter});
  const runner = createDesktopModelRunnerWithRegistry(registry, [], root, {request: async () => new Response('{}')} as never, materials, {},
    {restrictedArtifactGeneration: true, multiAgent: {runtime, service, catalog, workspaceId: 'workspace', cwd: root}, getProjectModel: async () => projectModel});
  const host = new InProcessTaskRuntimeHost({groupObservationSource: service, materialRegistry: materials, snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
    authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker),
    assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot), runner: input => service.runRoot(input, context => runner(input, context))});
  cleanup.push(() => host.drain());
  await service.initialize(host);
  control.checkpointFailure = {error: new Error('checkpoint_failed')};
  const task = await service.prepareRoot(host, 'thread', {prompt: 'run', materials: []});
  await host.startTask(task.taskId); await host.drain();
  expect(dispose).toHaveBeenCalledOnce();
  expect(provider.stream).not.toHaveBeenCalled();
  expect(provider.returned).not.toHaveBeenCalled();
});
it('the original sealed actor retains its same physical result scope while new mutations remain closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sealed-result-owner-'));
  cleanup.push(() => rmSync(root, {recursive: true, force: true, maxRetries: 3}));
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
  const service = new DesktopMultiAgentService({store, coordinator: new DesktopExecutionCoordinator(),
    createSession: async () => { throw Error('unused'); }});
  cleanup.push(() => service.dispose());
  service.registerThread({threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root});
  let original: Parameters<typeof service.captureRootModelPhysicalScope>[0] | undefined;
  let originalScope: ReturnType<typeof service.captureRootModelPhysicalScope> | undefined;
  const errors: unknown[] = [];
  const host = new InProcessTaskRuntimeHost({groupObservationSource: service,
    materialRegistry: new MaterialRegistry({workspaceRoot: join(root, 'materials')}),
    snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
    authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker),
    assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
    runner: input => service.runRoot(input, async context => {
      original = context;
      try {
        service.assertInvocation(context.actor, context);
        originalScope = service.captureRootModelPhysicalScope(context);
        await context.mailbox.trySealTurn({outcome: 'completed', limitReached: true});
        expect(() => service.assertInvocation(context.actor, context)).toThrow();
        expect(service.captureRootModelPhysicalScope(context)).toBe(originalScope);
        expect(() => service.captureRootModelPhysicalScope({...context})).toThrow();
        await expect(service.spawn({requestSource: 'agent', actor: context.actor,
          operationId: 'sealed-spawn', taskName: 'forbidden', message: 'no'})).rejects.toThrow();
      } catch (error) { errors.push(error); throw error; }
    }),
  });
  cleanup.push(() => host.drain());
  await service.initialize(host);
  const task = await service.prepareRoot(host, 'thread', {prompt: 'run', materials: []});
  await host.startTask(task.taskId); await host.drain();
  expect(errors).toEqual([]);
  expect(original).toBeDefined();
  expect(originalScope).toBeDefined();
  expect(() => service.captureRootModelPhysicalScope(original!)).toThrow();
});
