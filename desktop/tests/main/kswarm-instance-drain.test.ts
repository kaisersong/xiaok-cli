import ts from 'typescript';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn as actualSpawn, type ChildProcess, type spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as lifetimeComposition from '../../electron/kswarm-service-lifetime.js';
import { registerKSwarmInstanceLifetime } from '../../electron/kswarm-service-lifetime.js';
import { registerDesktopBeforeQuit, disposeDesktopLifetimeSteps } from '../../electron/desktop-before-quit.js';
import { UpdaterHandoffStateMachine } from '../../electron/updater-handoff.js';
import { DesktopShutdownCoordinator } from '../../electron/desktop-shutdown-coordinator.js';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import * as production from '../../electron/kswarm-service.js';

const roots: string[] = [];
function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
class ControlledChild extends EventEmitter {
  pid = 99_000;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdout = new EventEmitter(); stderr = new EventEmitter();
  kill = vi.fn((signal?: NodeJS.Signals) => { queueMicrotask(() => { this.exitCode = 0; this.emit('exit', 0, signal ?? null); }); return true; });
}
function fixture(ownedBroker = false) {
  const root = mkdtempSync(join(tmpdir(), 'kswarm-instance-close-')); roots.push(root);
  for (const component of ['kswarm', 'intent-broker']) {
    const dir = join(root, component); mkdirSync(dir);
    writeFileSync(join(dir, 'server.js'), '');
    writeFileSync(join(dir, 'room-workspace-protocol.json'), JSON.stringify({ component, protocols: { room_workspace_v1: { contextVersion: 1, resultVersion: 1, releaseVersion: 1 } } }));
  }
  vi.stubEnv('KSWARM_SERVER_PATH', join(root, 'kswarm', 'server.js'));
  if (ownedBroker) vi.stubEnv('BROKER_SERVER_PATH', join(root, 'intent-broker', 'server.js'));
  const children: Array<{ kind: 'server' | 'broker'; child: ControlledChild }> = [];
  const spawnProcess = vi.fn((_command: string, args: string[]) => {
    const child = new ControlledChild(); child.pid += children.length;
    children.push({ kind: args.some(arg => arg.includes('intent-broker')) ? 'broker' : 'server', child });
    return child as unknown as ChildProcess;
  });
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(':4318/health')) return new Response('{}', { status: !ownedBroker || children.some(c => c.kind === 'broker') ? 200 : 503 });
    if (url.includes(':4400/health')) return new Response('{}', { status: children.some(c => c.kind === 'server') ? 200 : 503 });
    if (url.endsWith('/agents')) return new Response('{"agents":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  const findPortOwner = vi.fn(async (): Promise<number | null> => null);
  const killStalePortOwner = vi.fn(async () => true);
  const logRoot = production.resolveKSwarmServiceLogRoot();
  const offsets = new Map(['server', 'broker'].map(kind => { try { return [kind, readFileSync(join(logRoot, `${kind}.log`)).length] as const; } catch { return [kind, 0] as const; } }));
  const readLog = (kind: string) => readFileSync(join(logRoot, `${kind}.log`)).subarray(offsets.get(kind) ?? 0).toString('utf8');
  const service = production.createKSwarmService({ spawnProcess: spawnProcess as unknown as typeof spawn, findPortOwner, killStalePortOwner });
  return { service, readLog, fetcher, spawnProcess, children, findPortOwner, killStalePortOwner };
}
// Refer to the real missing production entry, preserving an executable RED before implementation.
const close = (service: production.KSwarmService): Promise<void> => (production as unknown as { sealAndDrainKSwarmServiceInstance: (service: production.KSwarmService) => Promise<void> }).sealAndDrainKSwarmServiceInstance(service);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('actual KSwarm service instance permanent drain', () => {
  it('seals every network/lifecycle entrance and token read before dependencies', async () => {
    const f = fixture();
    const savedStart = f.service.start;
    const closing = close(f.service);
    await expect(savedStart()).rejects.toThrow(/closed/);
    const unsub = f.service.onStatusChange(() => {}); unsub();
    expect(f.service.getStatus().running).toBe(false);
    expect(close(f.service)).toBe(closing);
    const calls: Array<() => Promise<unknown>> = [() => f.service.start(), () => f.service.stop(), () => f.service.restart(), () => f.service.restartRelatedService('kswarm'), () => f.service.restartRelatedService('intent-broker'), () => f.service.restartRelatedService('runtime-bridge'), () => f.service.request('/projects', { method: 'POST' }), () => f.service.getServiceStatus(), () => f.service.getHealthDiagnosticInput()];
    for (const call of calls) await expect(Promise.resolve().then(call)).rejects.toThrow(/closed/);
    expect(() => f.service.getDesktopMutationToken()).toThrow(/closed/);
    expect(() => f.service.getIntentBrokerRoomToken()).toThrow(/closed/);
    expect(() => close({ ...f.service })).toThrow(/instance/);
    await closing;
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.spawnProcess).not.toHaveBeenCalled();
    expect(f.findPortOwner).not.toHaveBeenCalled(); expect(f.killStalePortOwner).not.toHaveBeenCalled();
  });

  it('drains a start already admitted before seal, then waits its actual child close', async () => {
    const f = fixture(); const hold = barrier(); const entered = barrier();
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementationOnce(async input => { entered.release(); await hold.promise; return original(input); });
    const starting = f.service.start(); await entered.promise;
    const closing = close(f.service); let settled = false; void closing.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    hold.release(); await starting;
    await vi.waitFor(() => expect(f.children[0].child.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(f.service.getStatus().pid).toBe(null); // original exit handler already clears it
    expect(settled).toBe(false);
    f.children[0].child.stdout.emit('data', Buffer.from('late output before observed close'));
    expect(f.readLog('server')).toContain('late output before observed close');
    f.children[0].child.emit('close', 0, null);
    await closing;
    expect(f.children).toHaveLength(1); expect(f.service.getStatus().running).toBe(false);
    expect(f.children[0].kind).toBe('server'); expect(f.killStalePortOwner).not.toHaveBeenCalled();
  });

  it('keeps tracking a child after ordinary stop cleared the original pointer', async () => {
    const f = fixture(); await f.service.start(); await f.service.stop();
    expect(f.service.getStatus().pid).toBe(null);
    const closing = close(f.service); let settled = false; void closing.then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    f.children[0].child.emit('close', 0, null); await closing;
  });

  it('waits both actual broker and server close', async () => {
    const f = fixture(true); await f.service.start();
    expect(f.children.map(c => c.kind)).toEqual(['broker', 'server']);
    const closing = close(f.service); let settled = false; void closing.then(() => { settled = true; });
    await vi.waitFor(() => expect(f.children.every(c => c.child.kill.mock.calls.length > 0)).toBe(true));
    f.children.find(c => c.kind === 'server')!.child.emit('close', 0, null);
    await Promise.resolve(); expect(settled).toBe(false);
    f.children.find(c => c.kind === 'broker')!.child.emit('close', 0, null); await closing;
  });

  it('drains an already running health tick and prevents future timer work', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.service.start();
    const hold = barrier(); const entered = barrier();
    f.fetcher.mockImplementationOnce(async () => { entered.release(); await hold.promise; return new Response('{}'); });
    await vi.advanceTimersByTimeAsync(10_000); await entered.promise;
    const closing = close(f.service); let settled = false; void closing.then(() => { settled = true; });
    await Promise.resolve(); expect(f.children[0].child.kill).not.toHaveBeenCalled();
    hold.release(); await vi.advanceTimersByTimeAsync(0);
    expect(f.children[0].child.kill).toHaveBeenCalledWith('SIGTERM');
    f.children[0].child.emit('close', 0, null); await closing;
    const fetchCount = f.fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.fetcher).toHaveBeenCalledTimes(fetchCount); expect(f.children).toHaveLength(1);
  });

  it('drains an automatic restart already inside its network await', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.service.start();
    f.children[0].child.emit('exit', 1, null);
    f.children[0].child.emit('close', 1, null);
    const hold = barrier(); const entered = barrier();
    f.fetcher.mockImplementationOnce(async () => { entered.release(); await hold.promise; return new Response('{}', { status: 503 }); });
    await vi.advanceTimersByTimeAsync(2_000); await entered.promise;
    const closing = close(f.service); let settled = false; void closing.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    hold.release(); await vi.advanceTimersByTimeAsync(0);
    for (const entry of f.children) entry.child.emit('close', 0, null);
    await closing;
    const count = f.spawnProcess.mock.calls.length; await vi.advanceTimersByTimeAsync(60_000);
    expect(f.spawnProcess).toHaveBeenCalledTimes(count);
  });

  it('does not kill an external port owner discovered by an admitted restart after seal', async () => {
    const f = fixture(); await f.service.start(); await f.service.stop();
    f.children[0].child.emit('close', 0, null);
    // Restart sees an external unhealthy listener after awaiting port discovery.
    f.fetcher.mockImplementation(async input => new Response('{}', { status: String(input).includes(':4400/health') ? 503 : 200 }));
    const hold = barrier(); const entered = barrier();
    f.findPortOwner.mockImplementation(async () => { entered.release(); await hold.promise; return 55_555; });
    const restarting = f.service.restart(); await entered.promise;
    const closing = close(f.service); hold.release(); await restarting; await closing;
    expect(f.killStalePortOwner).not.toHaveBeenCalled(); expect(f.children).toHaveLength(1);
  });

  it('allows ordinary stop/start and restart before the permanent close', async () => {
    const f = fixture(); await f.service.start(); await f.service.stop();
    // Remove historical healthy signal in the network fixture, retaining child observation.
    f.fetcher.mockImplementation(async input => {
      const url = String(input);
      if (url.includes(':4400/health')) return new Response('{}', { status: f.children.some(c => c.child.exitCode === null) ? 200 : 503 });
      return new Response(url.endsWith('/agents') ? '{"agents":[]}' : '{}');
    });
    await f.service.start(); await f.service.restart(); expect(f.children).toHaveLength(3);
    const closing = close(f.service);
    await vi.waitFor(() => expect(f.children[2].child.kill).toHaveBeenCalled());
    for (const entry of f.children) entry.child.emit('close', 0, null);
    await closing;
  });

  it('connects actual service close to the actual once-only shutdown coordinator', async () => {
    const f = fixture(); await f.service.start(); const continuation = vi.fn();
    const steps: Array<{ name: string; run: () => Promise<void> }> = []; registerKSwarmInstanceLifetime(f.service, steps);
    const app = new EventEmitter();
    const coordinator = new DesktopShutdownCoordinator({
      gate: new DesktopShutdownGate(),
      providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => ({ cleanupFailed: [] }) },
      ingressOwners: [], durableStores: [], destroyWindows() {}, releaseMainSourcePin: async () => {},
      disposeLifetimeResources: () => disposeDesktopLifetimeSteps(steps, (name, error) => { throw error; }), continuation,
    });
    registerDesktopBeforeQuit(app, coordinator, new UpdaterHandoffStateMachine({ platformClass: 'base', invokeWrapper() {} }), () => {});
    const prevent = vi.fn(); app.emit('before-quit', { preventDefault: prevent }); expect(prevent).toHaveBeenCalledTimes(1);
    const first = coordinator.onBeforeQuit(); const second = coordinator.onBeforeQuit();
    expect(first.shutdown).toBe(second.shutdown);
    await vi.waitFor(() => expect(f.children[0].child.kill).toHaveBeenCalled());
    expect(continuation).not.toHaveBeenCalled();
    f.children[0].child.emit('close', 0, null); await first.shutdown;
    expect(continuation).toHaveBeenCalledTimes(1); expect(coordinator.onBeforeQuit().preventDefault).toBe(false);
  });

  it('registers the actual service close immediately in Main and retains ordinary stop IPC', () => {
    const source = readFileSync(join(import.meta.dirname, '../../electron/main.ts'), 'utf8');
    expect(source).toMatch(/const kswarmService = createDesktopKSwarmService\(desktopShutdownCoordinator, desktopFinalLifetimeSteps, \{ activityOwnerPending: process\.env\.XIAOK_CONVERSATION_ACTIVITY !== '0' \}\);\s*if \(!kswarmService\) return window;/);
    const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
    const declarations: ts.VariableDeclaration[] = [];
    const collect = (node: ts.Node): void => { if (ts.isVariableDeclaration(node)) declarations.push(node); ts.forEachChild(node, collect); };
    collect(ast);
    const facade = declarations.find(node => node.name.getText(ast) === 'runtimeActions')!.initializer as ts.CallExpression;
    expect(facade.expression.getText(ast)).toBe('createDesktopRuntimeActionService');
    const ops = facade.arguments[0] as ts.ObjectLiteralExpression;
    const stop = ops.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(ast) === 'stop') as ts.PropertyAssignment;
    expect((stop.initializer as ts.ArrowFunction).body.getText(ast)).toBe('kswarmService.stop()');
    const producers = declarations.find(node => node.name.getText(ast) === 'runtimeActionProducers')!.initializer as ts.NewExpression;
    const rows = producers.arguments![0] as ts.ArrayLiteralExpression;
    const entry = rows.elements.find(node => ts.isArrayLiteralExpression(node) && ts.isStringLiteral(node.elements[0]!) && node.elements[0]!.text === 'desktop:kswarm:stop') as ts.ArrayLiteralExpression;
    const invoke = (entry.elements[1] as ts.ArrowFunction).body as ts.CallExpression;
    expect(invoke.expression.getText(ast)).toBe('runtimeActions.stop');
    expect(invoke.arguments.map(node => node.getText(ast))).toEqual(["'user'"]);
    expect(source).toContain('registerRuntimeActionIpc(shutdownAwareIpc, runtimeActionProducers)');
    expect(source).not.toContain('await kswarmService.stop().catch');
    expect(source.match(/\bcreateDesktopKSwarmService\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\bcreateKSwarmService\(/);
  });

  it('bounds final quit while original seed Response body remains pending, without marking close confirmed', async () => {
    vi.useFakeTimers(); const f = fixture(); const body = barrier(); const entered = barrier();
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async input => {
      if (String(input).endsWith('/agents')) {
        const response = new Response('{}');
        response.json = async () => { entered.release(); await body.promise; return { agents: [] }; };
        return response;
      }
      return original(input);
    });
    const starting = f.service.start(); await entered.promise;
    const steps: Array<{ name: string; run: () => Promise<void> }> = [];
    registerKSwarmInstanceLifetime(f.service, steps);
    const reports: unknown[] = [];
    const continuation = vi.fn();
    const coordinator = new DesktopShutdownCoordinator({ gate: new DesktopShutdownGate(), providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => ({ cleanupFailed: [] }) }, ingressOwners: [], durableStores: [], destroyWindows() {}, releaseMainSourcePin: async () => {}, disposeLifetimeResources: () => disposeDesktopLifetimeSteps(steps, (_name, error) => reports.push(error)), continuation });
    const app = new EventEmitter(); registerDesktopBeforeQuit(app, coordinator, new UpdaterHandoffStateMachine({ platformClass: 'base', invokeWrapper() {} }), () => {}); app.emit('before-quit', { preventDefault() {} });
    await vi.advanceTimersByTimeAsync(35_000); const report = await coordinator.onBeforeQuit().shutdown;
    expect(report.cleanupFailed).toContain('lifetime_resources');
    expect(report.cleanupFailed.join(' ')).toContain('kswarm_service_shutdown_deadline_unconfirmed');
    expect(continuation).toHaveBeenCalledTimes(1); expect(f.children[0].child.kill).not.toHaveBeenCalled();
    expect(reports).toHaveLength(1); expect(String(reports[0])).toContain('unconfirmed');
    let actualClosed = false; const actual = close(f.service); void actual.then(() => { actualClosed = true; });
    expect(actualClosed).toBe(false);
    body.release(); await starting; await vi.advanceTimersByTimeAsync(0);
    f.children[0].child.emit('close', 0, null); await actual;
  });

  it('preserves close Promise identity when abort notification synchronously reenters', async () => {
    const f = fixture(); const entered = barrier(); const done = barrier(); let reentered: Promise<void> | undefined;
    f.findPortOwner.mockResolvedValue(55_001);
    f.service.getStatus();
    f.killStalePortOwner.mockImplementation(async (...args: unknown[]) => {
      const context = args[1] as { signal: AbortSignal };
      context.signal.addEventListener('abort', () => { reentered = close(f.service); }, { once: true });
      entered.release(); await done.promise; return false;
    });
    const starting = f.service.start(); await entered.promise;
    const closing = close(f.service); expect(reentered).toBe(closing);
    done.release(); await starting; await closing;
  });

  it('owns only the broker when the server was adopted externally', async () => {
    const f = fixture(true); const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async input => {
      if (String(input).includes(':4400/health')) return new Response(JSON.stringify({ features: ['dynamic_workflows'], workflowCapabilities: { schemaVersion: 'kswarm_workflow_patterns_v1', compiledContract: true, patternPublicView: true }, service: { entryPath: process.env.KSWARM_SERVER_PATH } }));
      return original(input);
    });
    await f.service.start(); expect(f.children.map(c => c.kind)).toEqual(['broker']);
    const closing = close(f.service); await vi.waitFor(() => expect(f.children[0].child.kill).toHaveBeenCalled());
    f.children[0].child.emit('exit', 0, null);
    f.children[0].child.stderr.emit('data', Buffer.from('broker tail before observed close')); expect(f.readLog('broker')).toContain('broker tail before observed close'); f.children[0].child.emit('close', 0, null);
    await closing; expect(f.killStalePortOwner).not.toHaveBeenCalled();
  });


  it.each(['restart', 'seal'] as const)('preserves external broker rejecting rooms authentication during %s', async mode => {
    const f = fixture(true); const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async input => {
      const url = String(input);
      if (url.includes(':4318/health')) return new Response('{}');
      if (url.includes(':4318/rooms')) return new Response('{}', { status: 401 });
      return original(input);
    });
    await f.service.start();
    expect(f.fetcher.mock.calls.some(([url]) => String(url).includes(':4318/rooms'))).toBe(true);
    if (mode === 'restart') await f.service.restart();
    const closing = close(f.service);
    await vi.waitFor(() => expect(f.children.every(entry => entry.child.kill.mock.calls.length > 0)).toBe(true));
    for (const entry of f.children) entry.child.emit('close', 0, null);
    await closing;
    expect(f.children.every(entry => entry.kind === 'server')).toBe(true);
    expect(f.killStalePortOwner).not.toHaveBeenCalled();
  });

  it.each(['broker', 'server'] as const)('does not confuse %s error with close', async kind => {
    const f = fixture(true); await f.service.start(); const failed = f.children.find(c => c.kind === kind)!.child;
    const closing = close(f.service); let settled = false; void closing.then(() => { settled = true; });
    expect(() => failed.emit('error', Error('actual child failure'))).not.toThrow();
    for (const child of f.children) if (child.kind !== kind) child.child.emit('close', 0, null);
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    failed.emit('close', null, null); await closing;
  });

  it('returns a rejected Promise for a late async call before reading its input', async () => {
    const f = fixture(); await close(f.service); const getter = vi.fn(() => { throw Error('read input'); });
    const input = new Proxy({}, { get: getter }); let pending!: Promise<Response>;
    expect(() => { pending = f.service.request('/projects', input); }).not.toThrow();
    await expect(pending).rejects.toThrow(/closed/); expect(getter).not.toHaveBeenCalled();
  });

  it('does not construct a new instance when startup resumes after final disposal', async () => {
    const finalSteps: Array<{ name: string; run: () => Promise<void> }> = [];
    const coordinator = new DesktopShutdownCoordinator({ gate: new DesktopShutdownGate(), providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => ({ cleanupFailed: [] }) }, ingressOwners: [], durableStores: [], destroyWindows() {}, releaseMainSourcePin: async () => {}, disposeLifetimeResources: () => disposeDesktopLifetimeSteps(finalSteps, () => {}), continuation() {} });
    const hold = barrier(); const read = vi.fn(() => { throw Error('options read after quit'); });
    const lateStart = hold.promise.then(() => (lifetimeComposition as unknown as { createDesktopKSwarmService: (coordinator: DesktopShutdownCoordinator, steps: typeof finalSteps, options: production.CreateKSwarmServiceOptions) => production.KSwarmService | undefined }).createDesktopKSwarmService(coordinator, finalSteps, new Proxy({}, { get: read })));
    await coordinator.onBeforeQuit().shutdown; hold.release(); expect(await lateStart).toBeUndefined();
    expect(read).not.toHaveBeenCalled(); expect(finalSteps).toHaveLength(0);
  });

  it('drains owned children even when an admitted public operation rejects and caches rejection', async () => {
    const f = fixture(true); await f.service.start(); const hold = barrier(); const entered = barrier();
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async input => { if (String(input).includes('/fail')) { entered.release(); await hold.promise; throw Error('request failed'); } return original(input); });
    const request = f.service.request('/fail', { method: 'POST' }); const requestFailure = expect(request).rejects.toThrow('request failed'); await entered.promise;
    const closing = close(f.service); const failure = expect(closing).rejects.toThrow(/unconfirmed/); hold.release(); await requestFailure;
    await vi.waitFor(() => expect(f.children.every(c => c.child.kill.mock.calls.length > 0)).toBe(true));
    for (const child of f.children) child.child.emit('close', 0, null);
    await failure; expect(close(f.service)).toBe(closing); await expect(close(f.service)).rejects.toThrow(/unconfirmed/);
  });

  it('does not kill an adopted server that becomes unhealthy while restart is admitted', async () => {
    const f = fixture(); const original = f.fetcher.getMockImplementation()!;
    let healthy = true;
    f.fetcher.mockImplementation(async input => {
      if (String(input).includes(':4400/health')) return new Response(JSON.stringify({ features: ['dynamic_workflows'], workflowCapabilities: { schemaVersion: 'kswarm_workflow_patterns_v1', compiledContract: true, patternPublicView: true }, service: { entryPath: process.env.KSWARM_SERVER_PATH } }), { status: healthy ? 200 : 503 });
      return original(input);
    });
    await f.service.start(); expect(f.service.getStatus()).toMatchObject({ running: true, pid: null }); expect(f.children).toHaveLength(0);
    healthy = false; const hold = barrier(); const entered = barrier();
    f.findPortOwner.mockImplementation(async () => { entered.release(); await hold.promise; return 55_555; });
    const restarting = f.service.restart(); await entered.promise; const closing = close(f.service); hold.release();
    await restarting; await closing; expect(f.killStalePortOwner).not.toHaveBeenCalled(); expect(f.children).toHaveLength(0);
  });

  it('drains actual Node server and broker through the original service spawn and log paths', async () => {
    const f = fixture(true); const ready: Promise<unknown>[] = []; const closed = new Set<ChildProcess>();
    for (const [kind, entry] of [['server', process.env.KSWARM_SERVER_PATH!], ['broker', process.env.BROKER_SERVER_PATH!]]) {
      writeFileSync(entry!, `process.on('SIGTERM',()=>{process.stdout.write('actual-${kind}-tail\\n');process.exit(0)});process.stdout.write('actual-${kind}-ready\\n');setInterval(()=>{},1000);`);
    }
    f.spawnProcess.mockImplementation((command, args) => {
      const child = actualSpawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      child.once('close', () => { closed.add(child); }); ready.push(once(child.stdout!, 'data'));
      f.children.push({ kind: args.some(arg => arg.includes('intent-broker')) ? 'broker' : 'server', child: child as unknown as ControlledChild });
      return child;
    });
    try {
      await f.service.start(); await Promise.all(ready); expect(f.children).toHaveLength(2);
      await close(f.service); expect(closed.size).toBe(2);
      if (process.platform !== 'win32') {
        for (const kind of ['server', 'broker']) expect(f.readLog(kind)).toContain(`actual-${kind}-tail`);
      }
    } finally {
      for (const entry of f.children) { const child = entry.child as unknown as ChildProcess; if (!closed.has(child)) child.kill('SIGKILL'); }
      await close(f.service).catch(() => {});
    }
  }, 15_000);

  it.each(['provider', 'store', 'pin'])('still closes actual owned service after coordinator %s failure', async stage => {
    const f = fixture(); await f.service.start(); const steps: Array<{ name: string; run: () => Promise<void> }> = []; registerKSwarmInstanceLifetime(f.service, steps);
    const continuation = vi.fn();
    const coordinator = new DesktopShutdownCoordinator({ gate: new DesktopShutdownGate(), providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => { if (stage === 'provider') throw Error('provider fail'); return { cleanupFailed: [] }; } }, ingressOwners: [], durableStores: [{ name: 'db', close: async () => { if (stage === 'store') throw Error('store fail'); } }], destroyWindows() {}, releaseMainSourcePin: async () => { if (stage === 'pin') throw Error('pin fail'); }, disposeLifetimeResources: () => disposeDesktopLifetimeSteps(steps, () => {}), continuation });
    const pending = coordinator.onBeforeQuit().shutdown;
    await vi.waitFor(() => expect(f.children[0].child.kill).toHaveBeenCalled()); expect(continuation).not.toHaveBeenCalled();
    f.children[0].child.emit('close', 0, null); const report = await pending;
    expect(continuation).toHaveBeenCalledTimes(1); expect(report.storesClosed).toBe(false); expect(report.cleanupFailed.length).toBeGreaterThan(0);
  });

  it.each(['identity', 'workflow'])('does not signal a healthy %s replacement once sealed', async reason => {
    const f = fixture(); const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async input => {
      if (String(input).includes(':4400/health')) return new Response(JSON.stringify({ service: { entryPath: reason === 'identity' ? '/different/server.js' : process.env.KSWARM_SERVER_PATH }, features: [] }));
      return original(input);
    });
    const hold = barrier(); const entered = barrier();
    f.findPortOwner.mockImplementation(async () => { entered.release(); await hold.promise; return 55_555; });
    const starting = f.service.start(); await entered.promise; const closing = close(f.service); hold.release(); await starting; await closing;
    expect(f.killStalePortOwner).not.toHaveBeenCalled(); expect(f.children).toHaveLength(0);
  });

  it('drains both children after an in-flight background health operation rejects', async () => {
    vi.useFakeTimers(); const f = fixture(true); const starting = f.service.start(); await vi.advanceTimersByTimeAsync(300); await starting;
    const original = f.fetcher.getMockImplementation()!; const hold = barrier(); const entered = barrier(); let healthChecks = 0;
    f.fetcher.mockImplementation(async input => {
      if (String(input).includes(':4400/health')) { healthChecks++; if (healthChecks === 5) { entered.release(); await hold.promise; } return new Response('{}', { status: 503 }); }
      return original(input);
    });
    const server = f.children.find(c => c.kind === 'server')!.child; const backgroundFailure = Error('owned background health rejection');
    server.kill.mockImplementationOnce(() => {
      // The current SDK catches an ordinary stop error. Make the same SDK
      // catch encounter an opaque message accessor failure so its admitted
      // background work genuinely rejects, retaining the original failure path.
      throw Object.defineProperty(Error('health stop failed'), 'message', { get() { throw backgroundFailure; } });
    });
    await vi.advanceTimersByTimeAsync(30_000); await entered.promise;
    const closing = close(f.service); const failed = expect(closing).rejects.toThrow(/unconfirmed/); hold.release();
    await vi.advanceTimersByTimeAsync(0); expect(f.children.every(c => c.child.kill.mock.calls.length > 0)).toBe(true);
    for (const entry of f.children) entry.child.emit('close', 0, null); await failed; expect(close(f.service)).toBe(closing);
  });

  it('clears ordinary stop timers before successful permanent close', async () => {
    vi.useFakeTimers(); const f = fixture(true); const starting = f.service.start(); await vi.advanceTimersByTimeAsync(300); await starting;
    const stopping = f.service.stop(); await vi.advanceTimersByTimeAsync(0); await stopping;
    for (const entry of f.children) entry.child.emit('close', 0, null); await close(f.service);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears broker token fetch rejection timers before permanent close', async () => {
    vi.useFakeTimers(); const f = fixture(true); const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async input => {
      if (String(input).includes(':4318/health')) return new Response('{}');
      if (String(input).endsWith('/rooms')) throw Error('token endpoint unavailable');
      return original(input);
    });
    await f.service.start(); const closing = close(f.service); await vi.advanceTimersByTimeAsync(0);
    for (const entry of f.children) entry.child.emit('close', 0, null); await closing;
    expect(vi.getTimerCount()).toBe(0);
  });

});
