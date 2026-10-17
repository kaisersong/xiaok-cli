// @vitest-environment node
// Install at desktop/tests/main/task7-controls.test.ts. Worker did not run it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/task7', getLocale: () => 'en' }, clipboard: {}, dialog: {}, shell: {} }));
import { registerDesktopIpc } from '../../electron/ipc.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
const NativePromise = Promise;
const methods = ['createTask', 'createTaskWithFiles', 'cancelTask', 'recoverTask', 'answerQuestion', 'getActiveTask', 'subscribeTask'] as const;
let roots: string[] = [], cleanup: Array<() => void> = [];
beforeEach(resetIpcSchemaRegistryForTests);
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.restoreAllMocks(); });
const turn = () => new NativePromise<void>(resolve => setImmediate(resolve));
const snapshot = (taskId = 'task') => ({ taskId, sessionId: 'thread', status: 'completed', prompt: 'old', materials: [], events: [{ type: 'progress', eventId: 'e', message: 'done' }], createdAt: 1, updatedAt: 2 });
function productionAuthority(main: unknown, recorder: unknown, services: unknown) {
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const coarse = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  let finer: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'registerDesktopIpc') {
      const options = node.arguments[3];
      if (ts.isObjectLiteralExpression(options)) finer = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'multiAgentAuthorize');
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  expect(coarse).toBeDefined(); expect(finer && ts.isPropertyAssignment(finer)).toBe(true);
  const expression = (finer as ts.PropertyAssignment).initializer.getText(ast);
  const js = ts.transpileModule(`let mainWindow = main; let meetingRecorderController = recorder;\n${coarse!.getText(ast)}\nreturn { coarse: authorizeDesktopInvoke, finer: ${expression} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const dirname = resolve('dist/main/desktop/electron'), rendererFile = join(dirname, '../../../renderer/index.html');
  return compileFunction(js, ['main', 'recorder', 'services', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'rendererFile', 'devServer', 'process'])(main, recorder, services, isTrustedDesktopRendererUrl, join, dirname, rendererFile, undefined, process);
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'task7-')); roots.push(root);
  const file = join(root, 'material.txt'); writeFileSync(file, 'material');
  const frame = { url: pathToFileURL(resolve('dist/renderer/index.html')).href };
  const target = Object.assign(new EventEmitter(), { id: 71, mainFrame: frame, isDestroyed: () => false, send: vi.fn() });
  const recorder = Object.assign(new EventEmitter(), { id: 72, mainFrame: frame, isDestroyed: () => false, send: vi.fn() });
  const window = { webContents: target, isDestroyed: () => false };
  const services = { multiAgent: undefined, getDataRoot: () => root,
    authorizeTaskRead: vi.fn(async (_id: string, _actor?: unknown) => {}), createTask: vi.fn(async (_input: unknown, _actor?: unknown) => ({ taskId: 'task' })), createTaskWithFiles: vi.fn(async (_input: unknown, _actor?: unknown) => ({ taskId: 'task' })),
    cancelTask: vi.fn(async (_id: string, _actor?: unknown) => {}), answerQuestion: vi.fn(async (_input: unknown, _actor?: unknown) => {}), recoverTask: vi.fn(async (_id: string, _prompt?: string) => ({ snapshot: snapshot(), recoveredFromTaskId: 'task' })),
    getActiveTask: vi.fn(async () => ({ taskId: 'task' })), subscribeTask: vi.fn((_id: string, _options: { signal: AbortSignal }) => (async function* () { yield { type: 'progress', eventId: 'e', message: 'live' }; })()),
  };
  const authority = productionAuthority(window, { ownsWebContents: (sender: unknown) => sender === recorder }, services);
  const handlers = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const registrar = new ShutdownAwareIpcMain({ handle: (channel, handler) => handlers.set(channel, handler) }, gate, authority.coarse);
  await registerDesktopIpc(registrar, window as never, services as never, { multiAgentAuthorize: authority.finer, registerLifetimeDisposer: fn => cleanup.push(fn) });
  const event = { sender: target, senderFrame: frame };
  const payloads = { createTask: [{ prompt: 'new', materials: [], context: { threadId: 'thread', taskIds: ['old'] } }], createTaskWithFiles: [{ prompt: 'new', filePaths: [file], context: { threadId: 'thread', taskIds: ['old'] } }],
    cancelTask: [{ taskId: 'task' }], answerQuestion: [{ taskId: 'task', answer: { type: 'choice', questionId: 'q', choiceId: 'yes' } }], recoverTask: [{ taskId: 'task', legacyPrompt: 'old' }], getActiveTask: [], subscribeTask: [{ taskId: 'task', sinceIndex: 0, subscriptionId: 's' }] };
  const invoke = (method: typeof methods[number], args: unknown[] = payloads[method], source = event) => handlers.get('desktop:' + method)!(source as never, ...args) as Promise<unknown>;
  return { services, gate, target, recorder, frame, event, invoke, payloads, handlers, file };
}
it('freezes all seven actual registerDesktopIpc tuple entries and normal DTO population', async () => {
  const f = await fixture();
  for (const method of methods) {
    const entry = IPC_SCHEMA_REGISTRY.get('desktop:' + method); expect(entry?.payloadMode, method).toBe('tuple'); expect(entry?.sourceFile).toBe('desktop/electron/task7-typed-ipc.ts');
    const result = await f.invoke(method); expect(result).toEqual(method.startsWith('create') || method === 'getActiveTask' ? { taskId: 'task' } : method === 'recoverTask' ? { snapshot: snapshot(), recoveredFromTaskId: 'task' } : undefined);
  }
  await turn(); expect(f.target.send).toHaveBeenCalledWith('desktop:taskEvent:task', { type: 'progress', eventId: 'e', message: 'live' }); expect(f.gate.outstanding).toBe(0);
  expect(f.services.createTaskWithFiles).toHaveBeenCalledExactlyOnceWith({ prompt: 'new', filePaths: [f.file], context: { threadId: 'thread', taskIds: ['old'] } }, { actorId: 'desktop-user:unavailable', requestSource: 'user' });
});
it.each(methods)('%s rejects missing/extra tuple, accessor, proxy, and finer recorder before service effects', async method => {
  const f = await fixture(); let reads = 0;
  const hostile = Object.defineProperty({}, 'taskId', { enumerable: true, get() { reads++; return 'task'; } });
  const cases = [method === 'getActiveTask' ? [undefined] : [], [...f.payloads[method], {}], [hostile], [new Proxy({}, { ownKeys() { reads++; return []; } })]];
  for (const args of cases) await expect(f.invoke(method, args)).rejects.toThrow();
  await expect(f.invoke(method, f.payloads[method], { sender: f.recorder as typeof f.target, senderFrame: f.frame })).rejects.toThrow('task_actor_forbidden');
  expect(reads).toBe(0); for (const name of ['authorizeTaskRead', ...methods]) expect(f.services[name as keyof typeof f.services]).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
});
it.each(['createTask', 'createTaskWithFiles'] as const)('%s keeps production sanitizer, strips all authority fields, and does not mutate caller data', async method => {
  const f = await fixture(); const raw = f.payloads[method][0]!;
  const data = { ...raw, source: 'agent', requestSource: 'scheduler', principal: { id: 'other' }, grants: ['all'], managed: true, observer: { capture: true }, authority: {}, control: {}, permissionMode: 'auto', executionScope: { kind: 'goal_turn' }, watchdogMs: 1, maxToolLoopIterations: 99 };
  await f.invoke(method, [data]); const [clean, actor] = f.services[method].mock.calls[0] as unknown as [Record<string, unknown>, unknown];
  expect(Object.keys(clean).sort()).toEqual((method === 'createTask' ? ['prompt', 'materials', 'context'] : ['prompt', 'filePaths', 'context']).sort());
  expect(clean.context).toEqual({ threadId: 'thread', taskIds: ['old'] }); expect(actor).toEqual({ actorId: 'desktop-user:unavailable', requestSource: 'user' }); expect(data.requestSource).toBe('scheduler');
});
it.each(methods.flatMap(method => [false, true].map(rejecting => ({ method, rejecting }))))('$method refuses global species before entering async producer, with no orphan rejection (rejecting=$rejecting)', async ({ method, rejecting }) => {
  const f = await fixture(), descriptor = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)!;
  if (rejecting) {
    // A producer would create a REAL rejecting inner service Promise if admitted.
    // No promise is created until this function is called.
    for (const name of ['authorizeTaskRead', ...methods]) (f.services[name as keyof typeof f.services] as ReturnType<typeof vi.fn>).mockImplementation(() => NativePromise.reject(Error('unstarted-inner-task')));
  }
  let reads = 0; const orphans: unknown[] = [], observe = (value: unknown) => orphans.push(value); process.on('unhandledRejection', observe);
  try {
    for (const variant of ['getter', 'value']) {
      let pending!: Promise<unknown>;
      try { Object.defineProperty(NativePromise, Symbol.species, variant === 'getter' ? { configurable: true, get() { reads++; return NativePromise; } } : { configurable: true, value: NativePromise }); pending = f.invoke(method); }
      finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); }
      await expect(pending).rejects.toThrow('task_projection_unavailable'); await turn(); await turn();
    }
    expect(reads).toBe(0); for (const name of ['authorizeTaskRead', ...methods]) expect(f.services[name as keyof typeof f.services]).not.toHaveBeenCalled(); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { Object.defineProperty(NativePromise, Symbol.species, descriptor); process.removeListener('unhandledRejection', observe); }
});
it('rejects service Promise own constructor getter before async assimilation, and output getter before recover authorization/log', async () => {
  const f = await fixture(); let reads = 0;
  const promise = NativePromise.resolve({ taskId: 'task' }); Object.defineProperty(promise, 'constructor', { get() { reads++; return NativePromise; } });
  let producerCalls = 0;
  f.services.createTask = (() => { producerCalls++; return promise; }) as unknown as typeof f.services.createTask;
  await expect(f.invoke('createTask')).rejects.toThrow('task_projection_unavailable'); expect(reads).toBe(0); expect(producerCalls).toBe(1);
  const raw = { snapshot: Object.defineProperty({}, 'taskId', { enumerable: true, get() { reads++; return 'secret'; } }) };
  f.services.recoverTask.mockResolvedValueOnce(raw as never); f.services.authorizeTaskRead.mockClear();
  await expect(f.invoke('recoverTask')).rejects.toThrow('task_projection_unavailable'); expect(reads).toBe(0); expect(f.services.authorizeTaskRead).toHaveBeenCalledTimes(1);
});
it('retains actual snapshot task ownership after legacy fallback; snapshot data grants no cancel authority', async () => {
  const f = await fixture(); f.services.recoverTask.mockResolvedValueOnce({ snapshot: snapshot('foreign'), recoveredFromTaskId: 'foreign' });
  f.services.authorizeTaskRead.mockImplementation(async (id: string) => { if (id === 'foreign') throw Error('task_actor_forbidden'); });
  await expect(f.invoke('recoverTask')).rejects.toThrow('task_actor_forbidden');
  await expect(f.invoke('cancelTask', [{ taskId: 'task', authority: {}, control: {}, grants: ['all'] }])).rejects.toThrow('task_input_invalid'); expect(f.services.cancelTask).not.toHaveBeenCalled();
});
it('subscription replacement, stale unsubscribe, destroyed/dispose and authorization barrier own exact physical cleanup', async () => {
  const f = await fixture(); const signals: AbortSignal[] = []; let returned = 0;
  f.services.subscribeTask.mockImplementation((_id, options) => (async function* () {
    signals.push(options.signal);
    try { await new NativePromise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true })); }
    finally { returned++; }
  })());
  await f.invoke('subscribeTask'); await f.invoke('subscribeTask', [{ taskId: 'task', subscriptionId: 'new' }]); await turn();
  expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
  await f.handlers.get('desktop:unsubscribeTask')!(f.event as never, { taskId: 'task', subscriptionId: 's' }); expect(signals[1].aborted).toBe(false);
  f.target.emit('destroyed'); await turn(); expect(signals[1].aborted).toBe(true); expect(returned).toBe(2); expect(f.target.listenerCount('destroyed')).toBe(0);
  expect(f.gate.outstanding).toBe(0);
});
it('dispose during per-event authorization await prevents late send and runs iterator finally', async () => {
  const f = await fixture(); let release!: () => void, calls = 0, returned = 0;
  f.services.authorizeTaskRead.mockImplementation(() => ++calls === 2 ? new NativePromise<void>(resolve => { release = resolve; }) : NativePromise.resolve());
  f.services.subscribeTask.mockImplementation(() => (async function* () { try { yield { type: 'progress', eventId: 'e', message: 'late' }; } finally { returned++; } })());
  await f.invoke('subscribeTask'); await turn(); expect(release).toBeTypeOf('function'); cleanup.forEach(fn => fn()); release(); await turn();
  expect(f.target.send).not.toHaveBeenCalled(); expect(returned).toBe(1); expect(f.target.listenerCount('destroyed')).toBe(0);
});
it.each(methods)('%s respects the existing shutdown gate before callback/effect', async method => {
  const f = await fixture(); f.gate.close(); await expect(f.invoke(method)).rejects.toThrow('shutting_down');
  for (const name of ['authorizeTaskRead', ...methods]) expect(f.services[name as keyof typeof f.services]).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
});
it.each(['createTask', 'createTaskWithFiles', 'cancelTask', 'recoverTask', 'answerQuestion', 'getActiveTask'] as const)('%s rejects malformed service DTO before success log or followup effect', async method => {
  const f = await fixture(); (f.services[method] as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ unexpected: 'private-result' });
  await expect(f.invoke(method)).rejects.toThrow('task_projection_unavailable'); expect(f.gate.outstanding).toBe(0);
  if (method === 'recoverTask') expect(f.services.authorizeTaskRead).toHaveBeenCalledTimes(1);
});
it.each(['createTask', 'createTaskWithFiles', 'cancelTask', 'recoverTask', 'answerQuestion', 'getActiveTask'] as const)('%s observes normal rejecting service Promise with no orphan and releases its gate token', async method => {
  const f = await fixture(), failure = Error('owned-task-domain-failure');
  (f.services[method] as ReturnType<typeof vi.fn>).mockImplementationOnce(() => NativePromise.reject(failure));
  const orphans: unknown[] = [], observe = (reason: unknown) => { orphans.push(reason); }; process.on('unhandledRejection', observe);
  try { await expect(f.invoke(method)).rejects.toBe(failure); await turn(); await turn(); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0); }
  finally { process.removeListener('unhandledRejection', observe); }
});
it('invalid subscription event getter is rejected before send and iterator cleanup remains owned', async () => {
  const f = await fixture(); let reads = 0, returned = 0;
  const event = Object.defineProperty({ type: 'progress', eventId: 'e' }, 'message', { enumerable: true, get() { reads++; return 'secret'; } });
  f.services.subscribeTask.mockImplementation(() => (async function* () { try { yield event as never; } finally { returned++; } })());
  await f.invoke('subscribeTask'); await turn(); expect(reads).toBe(0); expect(f.target.send).not.toHaveBeenCalled(); expect(returned).toBe(1); expect(f.target.listenerCount('destroyed')).toBe(0);
});
it.each(['answerQuestion', 'cancelTask'] as const)('%s rechecks actual Main finer permission after authorization barrier before mutation', async method => {
  const f = await fixture(); let release!: () => void;
  f.services.authorizeTaskRead.mockImplementationOnce(() => new NativePromise<void>(resolve => { release = resolve; }));
  const pending = f.invoke(method); await turn(); expect(release).toBeTypeOf('function'); f.frame.url = 'https://foreign.invalid/'; release();
  await expect(pending).rejects.toThrow('task_actor_forbidden'); expect(f.services[method]).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
});
