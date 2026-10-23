// @vitest-environment node
// UNAPPLIED R30. Real registrar/Main authority; partial Services characterize transport only.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { createDesktopServices } from '../../electron/desktop-services.js';
type DesktopServices = ReturnType<typeof createDesktopServices>;
import { registerDesktopIpc } from '../../electron/ipc.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';

const CHANNEL = 'desktop:goal:setUserQueuePending';
const NativePromise = Promise;
type Input = { threadId: string; pending: boolean };
type Producer = DesktopServices['setGoalUserQueuePending'];
const roots: string[] = [], disposers: Array<() => void> = [];
const turn = () => new NativePromise<void>(resolve => setImmediate(resolve));
beforeEach(() => resetIpcSchemaRegistryForTests());
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function productionAuthority(main: unknown, recorder: unknown, services: unknown, processSnapshot: { env: NodeJS.ProcessEnv }) {
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const coarse = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  let finer: ts.PropertyAssignment | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'registerDesktopIpc') {
      const options = node.arguments[3];
      if (ts.isObjectLiteralExpression(options)) finer = options.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'multiAgentAuthorize');
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); expect(coarse).toBeDefined(); expect(finer).toBeDefined();
  const js = ts.transpileModule(`let mainWindow = main; let meetingRecorderController = recorder;\n${coarse!.getText(ast)}\nreturn { coarse: authorizeDesktopInvoke, finer: ${finer!.initializer.getText(ast)} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const dirname = resolve('dist/main/desktop/electron'), rendererFile = join(dirname, '../../../renderer/index.html');
  const devServer = processSnapshot.env['XIAOK_DESKTOP_DEV_SERVER'];
  return compileFunction(js, ['main', 'recorder', 'services', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'rendererFile', 'devServer', 'process'])(main, recorder, services, isTrustedDesktopRendererUrl, join, dirname, rendererFile, devServer, processSnapshot);
}

async function fixture(produce: Producer = () => NativePromise.resolve(), omitFiner = false) {
  const root = mkdtempSync(join(tmpdir(), 'goal-queue-source-')); roots.push(root);
  // Same immutable real config snapshot feeds BOTH original source authorizers and frame.
  const processSnapshot = Object.freeze({ env: Object.freeze({ ...process.env }) });
  const frame = { url: processSnapshot.env['XIAOK_DESKTOP_DEV_SERVER'] || pathToFileURL(resolve('dist/renderer/index.html')).href };
  const target = Object.assign(new EventEmitter(), { id: 81, mainFrame: frame, destroyed: false, isDestroyed() { return this.destroyed; }, send() { throw Error('queue transport must not send an event'); } });
  const recorder = Object.assign(new EventEmitter(), { id: 82, mainFrame: frame, isDestroyed: () => false, send() { throw Error('unexpected recorder send'); } });
  const window = { webContents: target, destroyed: false, isDestroyed() { return this.destroyed; } };
  const calls: Input[] = [], receivers: unknown[] = [];
  // Plain port intentionally avoids vi.fn(async) Promise observer/species interference.
  // No SDK identity, receipt, owner brand or successful native action is represented here.
  const services = { multiAgent: undefined, getDataRoot: () => root,
    setGoalUserQueuePending(input: Input) { calls.push(input); receivers.push(this); return produce(input); },
  };
  const authority = productionAuthority(window, { ownsWebContents: (sender: unknown) => sender === recorder }, services, processSnapshot);
  const handlers = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const registrar = new ShutdownAwareIpcMain({ handle: (channel, handler) => handlers.set(channel, handler) }, gate, authority.coarse);
  // Same public partial-Services test boundary as Task7, never a private SDK brand.
  await registerDesktopIpc(registrar, window as never, services as never, { multiAgentAuthorize: omitFiner ? undefined : authority.finer, registerLifetimeDisposer: fn => disposers.push(fn) });
  const event = { sender: target, senderFrame: frame };
  const invoke = (args: unknown[] = [{ threadId: 'thread', pending: true }], source: unknown = event) => handlers.get(CHANNEL)!(source as never, ...args) as Promise<unknown>;
  return { invoke, calls, receivers, services, gate, registrar, target, recorder, window, frame, event };
}

it('uses exactly the actual single-channel typed tuple/void registry binding', async () => {
  const f = await fixture();
  expect(f.registrar.registeredChannels().filter(c => c === CHANNEL)).toEqual([CHANNEL]);
  expect(IPC_SCHEMA_REGISTRY.get(CHANNEL)).toMatchObject({ payloadMode: 'tuple', sourceFile: 'desktop/electron/goal-queuepending-typed-ipc.ts', riskTags: ['internal-mutation'] });
});
it.each([true, false])('complete original pending=%s input reaches original semantic service once, ACK stays void', async pending => {
  const f = await fixture(); const input = { threadId: '  thread  ', pending };
  await expect(f.invoke([input])).resolves.toBeUndefined();
  expect(f.calls).toEqual([{ threadId: 'thread', pending }]); expect(f.receivers).toEqual([f.services]);
  expect(input).toEqual({ threadId: '  thread  ', pending }); expect(f.gate.outstanding).toBe(0);
});
it.each(['中文线程', 'x'.repeat(200)])('keeps original legal threadId normalization %s', async threadId => {
  const f = await fixture(); await expect(f.invoke([{ threadId, pending: false }])).resolves.toBeUndefined(); expect(f.calls).toEqual([{ threadId, pending: false }]);
});
it.each([true, false])('extra own DATA source/authority fields never create a grant for pending=%s', async pending => {
  const f = await fixture(); const input = { threadId: 'thread', pending, requestSource: 'scheduler', source: 'agent', actorId: 'other', authority: {}, principal: { id: 'other' }, grants: ['all'], control: {}, managed: true };
  await expect(f.invoke([input])).resolves.toBeUndefined(); expect(f.calls).toEqual([{ threadId: 'thread', pending }]); expect(input.grants).toEqual(['all']);
});
const badTuples: Array<[string, unknown[]]> = [
  ['missing', []], ['undefined', [undefined]], ['null', [null]], ['array', [[]]], ['primitive', [true]],
  ['extra tuple arg', [{ threadId: 'thread', pending: true }, {}]], ['missing pending', [{ threadId: 'thread' }]],
  ['null pending', [{ threadId: 'thread', pending: null }]], ['number pending', [{ threadId: 'thread', pending: 1 }]], ['string pending', [{ threadId: 'thread', pending: 'true' }]],
];
it.each(badTuples)('rejects %s tuple before delegation', async (_name, args) => {
  const f = await fixture(); await expect(f.invoke(args)).rejects.toThrow('invalid_goal_queue_state'); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each([undefined, null, '', '  ', 42, 'x'.repeat(201)])('keeps original invalid_goal_thread_id for %s', async threadId => {
  const f = await fixture(); await expect(f.invoke([{ threadId, pending: false }])).rejects.toThrow('invalid_goal_thread_id'); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each(['threadId', 'pending', 'ignoredAuthority'])('never reads hostile input accessor %s', async field => {
  const f = await fixture(); let reads = 0; const input = Object.defineProperty({ threadId: 'thread', pending: true }, field, { enumerable: true, get() { reads++; throw Error('secret'); } });
  await expect(f.invoke([input])).rejects.toThrow('invalid_goal_queue_state'); expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it('rejects proxy payload and sparse tuple without touching traps/delegate', async () => {
  const f = await fixture(); let reads = 0;
  await expect(f.invoke([new Proxy({}, { ownKeys() { reads++; return []; } })])).rejects.toThrow('invalid_goal_queue_state');
  await expect(f.invoke(new Array(1))).rejects.toThrow('invalid_goal_queue_state'); expect(reads).toBe(0); expect(f.calls).toEqual([]);
});
it.each(['recorder', 'foreignSender', 'wrongFrame', 'untrustedURL', 'destroyedSender', 'destroyedWindow'])('real Main source-domain denies %s before any input read/effect', async variant => {
  const f = await fixture(); let reads = 0; const input = Object.defineProperty({}, 'pending', { enumerable: true, get() { reads++; return true; } });
  let event: unknown = f.event;
  if (variant === 'recorder') event = { sender: f.recorder, senderFrame: f.frame };
  if (variant === 'foreignSender') event = { sender: Object.assign(new EventEmitter(), { mainFrame: f.frame, isDestroyed: () => false }), senderFrame: f.frame };
  if (variant === 'wrongFrame') event = { sender: f.target, senderFrame: { ...f.frame } };
  if (variant === 'untrustedURL') f.frame.url = 'https://foreign.invalid/';
  if (variant === 'destroyedSender') f.target.destroyed = true;
  if (variant === 'destroyedWindow') f.window.destroyed = true;
  await expect(f.invoke([input], event)).rejects.toThrow(); expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each([null, false, 0, '', {}, []])('rejects non-void service ACK %j, never calls an extra producer', async value => {
  // Public malformed transport port only; never a SDK-native success fixture.
  const f = await fixture(() => NativePromise.resolve(value) as unknown as Promise<void>);
  await expect(f.invoke()).rejects.toThrow('goal_queue_projection_unavailable'); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it('captures malformed output DATA before reading its getter', async () => {
  let reads = 0; const value = Object.defineProperty({}, 'privateResult', { enumerable: true, get() { reads++; throw Error('secret'); } });
  const f = await fixture(() => NativePromise.resolve(value) as unknown as Promise<void>);
  await expect(f.invoke()).rejects.toThrow('goal_queue_projection_unavailable'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
it('rejects raw thenable before assimilation or then getter', async () => {
  let reads = 0; const raw = Object.defineProperty({}, 'then', { get() { reads++; throw Error('secret'); } });
  const f = await fixture(() => raw as Promise<void>);
  await expect(f.invoke()).rejects.toThrow('goal_queue_projection_unavailable'); expect(reads).toBe(0); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it('rejects raw service Promise own constructor getter before assimilation', async () => {
  let reads = 0; const raw = NativePromise.resolve(); Object.defineProperty(raw, 'constructor', { get() { reads++; return NativePromise; } });
  const f = await fixture(() => raw);
  await expect(f.invoke()).rejects.toThrow('goal_queue_projection_unavailable'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
it.each([true, false])('global species witness rejects BEFORE a %s producer can be entered', async rejecting => {
  const f = await fixture(() => rejecting ? NativePromise.reject(Error('unstarted-inner-queue')) : NativePromise.resolve());
  const original = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)!; let reads = 0;
  const orphans: unknown[] = [], observe = (error: unknown) => { orphans.push(error); }; process.on('unhandledRejection', observe);
  try {
    for (const variant of ['getter', 'value']) {
      let pending!: Promise<unknown>;
      try { Object.defineProperty(NativePromise, Symbol.species, variant === 'getter' ? { configurable: true, get() { reads++; return NativePromise; } } : { configurable: true, value: NativePromise }); pending = f.invoke(); }
      finally { Object.defineProperty(NativePromise, Symbol.species, original); }
      await expect(pending).rejects.toThrow('goal_queue_projection_unavailable'); await turn(); await turn();
    }
    expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { Object.defineProperty(NativePromise, Symbol.species, original); process.removeListener('unhandledRejection', observe); }
});
it('synchronous original service throw preserves exact identity and releases token', async () => {
  const failure = Error('queue-sync-failure'), f = await fixture(() => { throw failure; });
  await expect(f.invoke()).rejects.toBe(failure); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it.each([true, false])('normal rejecting raw service Promise for pending=%s retains error identity/no orphan', async pending => {
  const failure = Error('queue-owned-rejection'), f = await fixture(() => NativePromise.reject(failure));
  const orphans: unknown[] = [], observe = (error: unknown) => { orphans.push(error); }; process.on('unhandledRejection', observe);
  try { await expect(f.invoke([{ threadId: 'thread', pending }])).rejects.toBe(failure); await turn(); await turn(); expect(orphans).toEqual([]); expect(f.gate.outstanding).toBe(0); }
  finally { process.removeListener('unhandledRejection', observe); }
});
it.each([true, false])('held raw pending=%s keeps exact original IPC token until settled; shutdown refuses new work', async pending => {
  let release!: () => void; const raw = new NativePromise<void>(resolve => { release = resolve; });
  const f = await fixture(() => raw), result = f.invoke([{ threadId: 'thread', pending }]); await turn();
  expect(f.calls).toHaveLength(1); expect(f.gate.outstandingByKind()).toEqual({ ipc: 1 }); expect(f.gate.describeOutstanding()).toEqual(['ipc:' + CHANNEL]);
  f.gate.close(); const drain = f.gate.drain(1500);
  try { await expect(f.invoke()).rejects.toThrow('shutting_down'); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(1); }
  finally { release(); }
  await expect(result).resolves.toBeUndefined(); await expect(drain).resolves.toBe(true); expect(f.gate.outstanding).toBe(0);
}, 10000);
it.each(['untrustedURL', 'destroyedSender'])('held producer completion rechecks Main finer authority on %s before ACK', async variant => {
  let release!: () => void; const f = await fixture(() => new NativePromise<void>(resolve => { release = resolve; })); const result = f.invoke(); await turn();
  expect(f.gate.outstanding).toBe(1); if (variant === 'untrustedURL') f.frame.url = 'https://foreign.invalid/'; else f.target.destroyed = true;
  release(); await expect(result).rejects.toThrow('goal_queue_sender_forbidden'); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it('closed gate rejects before original service and input getters', async () => {
  const f = await fixture(); let reads = 0; const input = Object.defineProperty({}, 'pending', { get() { reads++; return true; } }); f.gate.close();
  await expect(f.invoke([input])).rejects.toThrow('shutting_down'); expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});

function originalServicesDelegate(coordinator: DesktopGoalCoordinator): Producer {
  const source = readFileSync(new URL('../../electron/desktop-services.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('desktop-services.ts', source, ts.ScriptTarget.Latest, true);
  let found: ts.PropertyAssignment | undefined;
  const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'setGoalUserQueuePending') { expect(found).toBeUndefined(); found = node; } ts.forEachChild(node, visit); }; visit(ast);
  expect(found).toBeDefined();
  // Compile only this existing public delegator; no createDesktopServices/factory/cold startup.
  const js = ts.transpileModule(`return (${found!.initializer.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return compileFunction(js, ['goalCoordinator'])(coordinator) as Producer;
}
it('real existing Services delegator -> real ordinary coordinator handles true/false with NO TaskHost operations', async () => {
  // Original ordinary route is not mocked. Real in-memory store; no profile replacement/issuer.
  // On a nonordinary host its original constructor rejects: never fake an ordinary profile.
  const store = new SqliteGoalStore(':memory:');
  const forbidden: string[] = [];
  const sentinel = (name: string): never => { forbidden.push(name); throw Error('FORBIDDEN_TASKHOST_' + name); };
  const coordinator = new DesktopGoalCoordinator({ store, instanceId: 'source-queue-no-task', taskHost: {
    prepareTask: () => sentinel('prepare'), startTask: () => sentinel('start'), cancelTask: () => sentinel('cancel'),
  } });
  const original = originalServicesDelegate(coordinator);
  try {
    const f = await fixture(original);
    for (const pending of [true, false, true, false]) await expect(f.invoke([{ threadId: 'ordinary-no-task', pending }])).resolves.toBeUndefined();
    expect(f.calls).toEqual([true, false, true, false].map(pending => ({ threadId: 'ordinary-no-task', pending }))); expect(forbidden).toEqual([]); expect(f.gate.outstanding).toBe(0);
    coordinator.stopAccepting();
    for (const pending of [true, false]) await expect(f.invoke([{ threadId: 'ordinary-no-task', pending }])).rejects.toThrow('goal_coordinator_closed');
    await expect(coordinator.drainShutdown(1500)).resolves.toBe(true); expect(forbidden).toEqual([]); expect(f.gate.outstanding).toBe(0);
  } finally { coordinator.stopAccepting(); await coordinator.drainShutdown(1500); store.close(); }
}, 10000);

it('missing Main finer callback defaults deny before descriptor capture or original service', async () => {
  const f = await fixture(undefined, true); let reads = 0;
  const input = Object.defineProperty({}, 'pending', { get() { reads++; return true; } });
  await expect(f.invoke([input])).rejects.toThrow('goal_queue_sender_forbidden'); expect(reads).toBe(0); expect(f.calls).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it.each(['thenGetter', 'thenData', 'subclass', 'proxy'] as const)('raw Promise %s uses the approved intrinsic/standard guard without getter reads', async variant => {
  let reads = 0;
  const raw = variant === 'subclass' ? new (class extends NativePromise<void> {})(resolve => resolve())
    : variant === 'proxy' ? new Proxy(NativePromise.resolve(), {}) : NativePromise.resolve();
  if (variant === 'thenGetter') Object.defineProperty(raw, 'then', { get() { reads++; return NativePromise.prototype.then; } });
  if (variant === 'thenData') Object.defineProperty(raw, 'then', { value: NativePromise.prototype.then });
  const f = await fixture(() => raw);
  if (variant === 'thenGetter' || variant === 'thenData') await expect(f.invoke()).resolves.toBeUndefined();
  else await expect(f.invoke()).rejects.toThrow('goal_queue_projection_unavailable');
  expect(reads).toBe(0); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});

it('approved standard Promise with own DATA native constructor remains legal, no fake brand minted', async () => {
  const raw = NativePromise.resolve(); Object.defineProperty(raw, 'constructor', { value: NativePromise });
  const f = await fixture(() => raw); await expect(f.invoke()).resolves.toBeUndefined(); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
