// Install at desktop/tests/main/task7-factory-fixture.ts. Existing production only.
// @vitest-environment node
import { readFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { afterEach, beforeEach, expect, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/task7-factory', getLocale: () => 'en' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: (sender: unknown) => ({ webContents: sender, isDestroyed: () => false }) },
  clipboard: {}, dialog: {}, shell: {} }));
import { registerDesktopIpc } from '../../electron/ipc.js';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
const NativePromise = Promise;
export const TASK7_FACTORY_METHODS = ['createTask', 'createTaskWithFiles', 'cancelTask', 'recoverTask', 'answerQuestion', 'getActiveTask', 'subscribeTask'] as const;
export const factoryTurn = () => new NativePromise<void>(resolve => setImmediate(resolve));
const cleanup: Array<() => void | Promise<void>> = [];
beforeEach(resetIpcSchemaRegistryForTests);
afterEach(async () => {
  try { for (const action of cleanup.splice(0).reverse()) await action(); }
  finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); }
});
function mainAuthority(service: ReturnType<typeof createDesktopServices>, sender: unknown, recorder: unknown) {
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const coarse = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  const finer: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'registerDesktopIpc') {
      const options = node.arguments[3];
      if (options && ts.isObjectLiteralExpression(options)) for (const property of options.properties)
        if (ts.isPropertyAssignment(property) && property.name.getText(ast) === 'multiAgentAuthorize' && ts.isArrowFunction(property.initializer)) finer.push(property.initializer);
    }
    ts.forEachChild(node, visit);
  }; visit(ast); expect(coarse).toBeDefined(); expect(finer).toHaveLength(1);
  const dirname = resolve('dist/main/desktop/electron'), rendererFile = join(dirname, '../../../renderer/index.html');
  const code = ts.transpileModule(`let mainWindow=initialMain, meetingRecorderController=initialRecorder;\n${coarse!.getText(ast)}\nconst finer=${finer[0]!.getText(ast)};\nreturn {coarse:authorizeDesktopInvoke,finer,setMain(value){mainWindow=value;}};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  // Both predicates are the actual Main functions, verbatim; no local sender rule.
  return compileFunction(code, ['initialMain', 'initialRecorder', 'services', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'rendererFile', 'devServer', 'process'])(
    { webContents: sender, isDestroyed: () => false }, { ownsWebContents: (value: unknown) => value === recorder }, service, isTrustedDesktopRendererUrl, join, dirname, rendererFile, undefined, { env: {} });
}
export async function task7FactoryFixture(seedFields: Record<string, unknown> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'task7-factory-')));
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
  const dataRoot = join(root, 'data'); mkdirSync(dataRoot, { recursive: true });
  const file = join(root, 'ordinary.txt'); writeFileSync(file, 'ordinary task input');
  const hostCalls = { prepare: vi.spyOn(InProcessTaskRuntimeHost.prototype, 'prepareTask'), start: vi.spyOn(InProcessTaskRuntimeHost.prototype, 'startTask'),
    answer: vi.spyOn(InProcessTaskRuntimeHost.prototype, 'answerQuestion'), cancel: vi.spyOn(InProcessTaskRuntimeHost.prototype, 'cancelTask'),
    recover: vi.spyOn(InProcessTaskRuntimeHost.prototype, 'recoverTask'), subscribe: vi.spyOn(InProcessTaskRuntimeHost.prototype, 'subscribeTask') };
  // Substitute only the external model network stream, retaining the default
  // factory/runner/host/multiAgent service, ownership and source-writer guards.
  const modelCalls: Array<{ signal: AbortSignal | undefined }> = [];
  const stream = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (_messages, _tools, _system, options?: StreamOptions) {
    modelCalls.push({ signal: options?.signal });
    yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
    const signal = options?.signal;
    if (!signal) throw Error('factory_fixture_signal_required');
    if (!signal.aborted) await new NativePromise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    throw signal.reason ?? Error('factory_fixture_aborted');
  });
  const sdk = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), restart: vi.fn(async () => {}),
    getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }), onStatusChange: () => () => {},
    getDesktopMutationToken: () => 'ordinary-test', request: vi.fn(async () => new Response('{}', { status: 503 })) };
  const service = createDesktopServices({ dataRoot, workspaceRoot: root, knowledgeDbPath: join(root, 'knowledge.sqlite'), pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService: sdk as never });
  // Capture actual public methods BEFORE installing spies; binding a spy and
  // then changing its implementation would recursively reenter that spy.
  const originals = { getActiveTask: service.getActiveTask.bind(service),
    authorizeTaskRead: service.authorizeTaskRead.bind(service), cancelTask: service.cancelTask.bind(service) };
  let coldStoreForCleanup: FileTaskSnapshotStore | undefined;
  let senderForCleanup: EventEmitter | undefined;
  const lifetime: Array<() => void> = [];
  cleanup.push(async () => {
    lifetime.forEach(dispose => dispose());
    const reader = new FileTaskSnapshotStore(join(dataRoot, 'tasks'));
    try {
      const hosts = new Set<InProcessTaskRuntimeHost>();
      const collectHosts = () => {
        for (const call of Object.values(hostCalls)) for (const receiver of call.mock.contexts)
          if (receiver instanceof InProcessTaskRuntimeHost) hosts.add(receiver);
      };
      collectHosts();
      // Only this fixture's unique dataRoot index and actual Host receivers are
      // inspected. Negative source-before cases can legitimately create tasks
      // before their assertion fails; these owned effects must be stopped.
      const ownedIds = new Set((await reader.getActiveTasks()).map(ref => ref.taskId));
      for (const host of hosts) for (const taskId of host.inFlightTaskIds()) ownedIds.add(taskId);
      const actor = { requestSource: 'user' as const, actorId: `desktop-user:${service.multiAgent!.profileId}` };
      for (const taskId of ownedIds) {
        const snapshot = await reader.recoverTask(taskId);
        if (!snapshot || snapshot.taskId !== taskId) throw Error('fixture_owned_task_missing');
        // Original public service retains its existing ownership/host policy.
        // No grant, native purpose or permission override is issued here.
        await originals.cancelTask(taskId, actor);
      }
      collectHosts();
      for (const host of hosts) await host.drain();
      await vi.waitFor(() => {
        expect(senderForCleanup?.listenerCount('destroyed') ?? 0).toBe(0);
        for (const host of hosts) expect((host as unknown as { subscribers: Map<string, unknown> }).subscribers.size).toBe(0);
      }, { timeout: 1500, interval: 10 });
    } finally { await reader.closeAndDrain(); }
    // Metadata close seals and waits; it does NOT cancel a live model stream.
    // Reach it only after real owned cancellation and iterator/Host drain.
    await service.closeTaskSourceWritersForMigration();
    await service.closeMaterialRegistryAndArtifactFileManagerInstances();
    await service.disposeMultiAgent();
    await coldStoreForCleanup?.closeAndDrain();
  });
  expect(service.multiAgent).not.toBeNull(); await service.multiAgent!.ready;
  await service.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture-no-network' }, undefined, 'user');
  await factoryTurn();
  const frame = { url: pathToFileURL(resolve('dist/renderer/index.html')).href }, recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  let destroyed = false;
  const sender = Object.assign(new EventEmitter(), { id: 81, mainFrame: frame, isDestroyed: () => destroyed, send: vi.fn(), destroy() { destroyed = true; sender.emit('destroyed'); } });
  senderForCleanup = sender;
  const recorder = Object.assign(new EventEmitter(), { id: 82, mainFrame: recorderFrame, isDestroyed: () => false, send: vi.fn() });
  const authority = mainAuthority(service, sender, recorder);
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const ipc = new ShutdownAwareIpcMain({ handle(channel, handler) { expect(listeners.has(channel)).toBe(false); listeners.set(channel, handler); } }, gate, authority.coarse);
  await registerDesktopIpc(ipc, { webContents: sender, isDestroyed: () => destroyed } as never, service,
    { multiAgentAuthorize: authority.finer, registerLifetimeDisposer: dispose => lifetime.push(dispose) });
  // Cold historical input is committed through the existing production store;
  // no task creation, DTO projection, ownership or cancellation logic is reimplemented.
  const coldStore = new FileTaskSnapshotStore(join(dataRoot, 'tasks'));
  const seed: TaskSnapshot = { taskId: 'task_existing', sessionId: 'existing-session', status: 'waiting_user', prompt: 'historical ordinary request', materials: [],
    events: [{ type: 'needs_user', question: { taskId: 'task_existing', questionId: 'question_existing', kind: 'freeform', prompt: 'actual historical question', choices: [{ id: 'yes', label: 'yes' }] } }],
    createdAt: 1, updatedAt: 2, ...seedFields };
  await coldStore.save(seed);
  coldStoreForCleanup = coldStore;
  await service.recoverTask(seed.taskId); // Actual Host rehydrates the actual correlator.
  const calls = { createTask: vi.spyOn(service, 'createTask'), createTaskWithFiles: vi.spyOn(service, 'createTaskWithFiles'), answerQuestion: vi.spyOn(service, 'answerQuestion'),
    cancelTask: vi.spyOn(service, 'cancelTask'), recoverTask: vi.spyOn(service, 'recoverTask'), getActiveTask: vi.spyOn(service, 'getActiveTask'),
    subscribeTask: vi.spyOn(service, 'subscribeTask'), authorizeTaskRead: vi.spyOn(service, 'authorizeTaskRead') };
  const resetObservations = () => { for (const call of Object.values(calls)) call.mockClear(); for (const call of Object.values(hostCalls)) call.mockClear(); stream.mockClear(); sdk.request.mockClear(); sender.send.mockClear(); };
  resetObservations();
  const event = { sender, senderFrame: frame };
  const payloads = { createTask: [{ prompt: 'ordinary boundary request', materials: [], context: { threadId: 'ordinary-thread' } }],
    createTaskWithFiles: [{ prompt: 'ordinary boundary request', filePaths: [file], context: { threadId: 'ordinary-thread' } }],
    cancelTask: [{ taskId: seed.taskId }], recoverTask: [{ taskId: seed.taskId }], answerQuestion: [{ taskId: seed.taskId, answer: { type: 'choice', questionId: 'question_existing', choiceId: 'yes' } }],
    getActiveTask: [], subscribeTask: [{ taskId: seed.taskId, sinceIndex: 0, subscriptionId: 'factory-sub' }] };
  const invoke = (method: typeof TASK7_FACTORY_METHODS[number], args: unknown[] = payloads[method], caller: unknown = event) =>
    Reflect.apply(listeners.get('desktop:' + method)!, undefined, [caller, ...args]) as Promise<unknown>;
  const readCold = async (taskId: string) => {
    // A new reader observes physical bytes; the seed writer's cached snapshot
    // cannot see another store instance's subsequent cancellation write.
    const reader = new FileTaskSnapshotStore(join(dataRoot, 'tasks'));
    try { return await reader.recoverTask(taskId); } finally { await reader.closeAndDrain(); }
  };
  return { root, dataRoot, service, originals, readCold, coldStore, seed, sdk, stream, modelCalls, file, sender, recorder, frame, recorderFrame, authority, gate, listeners, ipc, event, payloads, calls, hostCalls, invoke, resetObservations, lifetime };
}
