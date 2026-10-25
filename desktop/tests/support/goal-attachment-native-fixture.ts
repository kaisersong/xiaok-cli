// Finite transport fixture; original Services expressions/recovery barrier/Main/registrar.
// These ordinary data ports do not execute or qualify native/controller/TaskHost actions.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { registerDesktopIpc } from '../../electron/ipc.js';
import type { createDesktopServices } from '../../electron/desktop-services.js';
import type { DesktopApi, DesktopGoalTaskPrepared } from '../../electron/preload-api.js';
import { ShutdownAwareIpcMain, DesktopShutdownGate, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { actualQueryAuthorizers } from './goal-native-query-fixture.js';
import { projection } from './goal-get-fixture.js';

export const specs = [
  { method: 'ackTaskAttached', api: 'ackGoalTaskAttached', input: { threadId: 'thread', attachmentId: 'attachment' } },
  { method: 'recoverNativeMutation', api: 'recoverGoalNativeMutation', input: { threadId: 'thread' } },
  { method: 'continueNativeMutation', api: 'continueGoalNativeMutation', input: { threadId: 'thread', requestId: '12345678-1234-4234-8234-123456789abc' } },
  { method: 'cancelNativeMutation', api: 'cancelGoalNativeMutation', input: { threadId: 'thread' } },
] as const;
export type Spec = typeof specs[number];
type ApiName = Spec['api'];
export type OriginalServices = Pick<ReturnType<typeof createDesktopServices>, ApiName>;
export const mutation = () => ({ id: 'mutation', kind: 'create' as const, status: 'ready' as const, objective: 'Goal' });
export const prepared = (): DesktopGoalTaskPrepared => ({
  attachmentId: 'attachment', attachmentSource: { kind: 'request', requestId: specs[2].input.requestId },
  threadId: 'thread', taskId: 'task', executionScope: { kind: 'goal_turn', origin: 'user', goalId: 'goal', epoch: 1, goalTurnId: 'turn', threadId: 'thread' },
  goalRef: { goalId: 'goal', revision: 1 }, expiresAt: 1000,
});
export function output(spec: Spec): unknown {
  switch (spec.method) {
    case 'ackTaskAttached': return undefined;
    case 'recoverNativeMutation': return { mutation: mutation(), goal: projection() };
    case 'continueNativeMutation': return { goal: projection(), preparedTask: prepared() };
    case 'cancelNativeMutation': return mutation();
  }
}
/** Entire original Services property initializers + afterLocalRecovery, not handwritten delegation. */
export function originalDelegates(coordinator: unknown, ready: boolean, recovery: Promise<void>): OriginalServices {
  const source = readFileSync(new URL('../../electron/desktop-services.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('desktop-services.ts', source, ts.ScriptTarget.Latest, true);
  const properties = new Map<string, ts.PropertyAssignment[]>();
  let barrier: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && specs.some(s => s.api === n.name.getText(ast))) {
      const key = n.name.getText(ast); properties.set(key, [...(properties.get(key) ?? []), n]);
    }
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'afterLocalRecovery') {
      if (barrier) throw Error('original_recovery_barrier_population_changed'); barrier = n;
    }
    ts.forEachChild(n, visit);
  }; visit(ast);
  if (!barrier?.initializer || specs.some(s => properties.get(s.api)?.length !== 1)) throw Error('original_goal_attachment_services_source_changed');
  const body = `const multiAgentStartupReady=ready,multiAgentReady=recovery;
const afterLocalRecovery=${barrier.initializer.getText(ast)};
return {${specs.map(s => properties.get(s.api)![0]!.getText(ast)).join(',')}};`;
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return compileFunction(js, ['goalCoordinator', 'ready', 'recovery'])(coordinator, ready, recovery) as OriginalServices;
}
export async function fixture(
  producer: (spec: Spec, input: unknown) => Promise<unknown> = async function (spec) { return output(spec); },
  ready = true, recovery: Promise<void> = Promise.resolve(), finer = true,
) {
  let root: string | undefined;
  let gate: DesktopShutdownGate | undefined;
  const disposers: Array<() => void> = [];
  const close = async () => {
    const failures: unknown[] = [];
    // No gate means setup never registered an IPC listener or accepted an invocation.
    let drained = gate === undefined;
    try {
      if (gate) {
        try { gate.close(); } catch (error) { failures.push(error); }
        try { drained = await gate.drain(1500); } catch (error) { failures.push(error); drained = false; }
        if (gate.isOpen) drained = false;
      }
    } finally {
      // Each ordinary lifetime disposer is attempted even when drain/another disposer fails.
      for (const dispose of disposers.splice(0)) {
        try { await dispose(); } catch (error) { failures.push(error); }
      }
    }
    if (root !== undefined) {
      if (drained && failures.length === 0) {
        try { rmSync(root, { recursive: true, force: true }); } catch (error) { failures.push(error); }
      } else {
        let outstanding: string[] | undefined;
        try { outstanding = gate?.describeOutstanding(); } catch (error) { failures.push(error); }
        failures.push(Object.assign(Error(drained ? 'goal_attachment_fixture_cleanup_incomplete' : 'goal_attachment_transport_not_drained'), { ownRoot: root, outstanding }));
        // Preserve active/failure evidence. Never force-release/cancel an accepted producer.
      }
    }
    if (failures.length) throw new AggregateError(failures, 'goal_attachment_fixture_cleanup_failed: ' + (root ?? 'root_not_created'));
  };
  try {
    root = mkdtempSync(join(tmpdir(), 'goal-attachment-transport-'));
  const frame = { url: process.env['XIAOK_DESKTOP_DEV_SERVER'] ?? pathToFileURL(resolve('dist/renderer/index.html')).href };
  let destroyed = false;
  const target = Object.assign(new EventEmitter(), { id: 36, mainFrame: frame, isDestroyed: () => destroyed });
  const recorder = Object.assign(new EventEmitter(), { id: 37, mainFrame: frame, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), { webContents: target, isDestroyed: () => false });
  const calls: Array<{ api: ApiName; input: unknown }> = [];
  const coordinator = Object.fromEntries(specs.map(spec => [spec.api, async function (input: unknown) {
    calls.push({ api: spec.api, input }); return producer(spec, input);
  }]));
  const delegates = originalDelegates(coordinator, ready, recovery);
  const services = { ...delegates, getDataRoot: () => root!, multiAgent: undefined };
  const authority = actualQueryAuthorizers(window, { ownsWebContents: (sender: unknown) => sender === recorder }, services);
  const listeners = new Map<string, IpcHandlerListener>();
  gate = new DesktopShutdownGate();
  const ipc = new ShutdownAwareIpcMain({ handle: (channel, listener) => listeners.set(channel, listener) }, gate, authority.coarse);
    await registerDesktopIpc(ipc, window as Parameters<typeof registerDesktopIpc>[1], services as Parameters<typeof registerDesktopIpc>[2],
      { ...(finer ? { multiAgentAuthorize: authority.finer } : {}), registerLifetimeDisposer: fn => disposers.push(fn) });
  const event = { sender: target, senderFrame: frame };
  const invoke = (spec: Spec, args: unknown[] = [spec.input], source: unknown = event) =>
    Reflect.apply(listeners.get('desktop:goal:' + spec.method)!, undefined, [source, ...args]) as Promise<unknown>;
  return { invoke, calls, delegates, gate, event, target, recorder, frame, close, destroy: () => { destroyed = true; } };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'goal_attachment_fixture_setup_failed', { cause: error }); }
    throw error;
  }
}
export type PublicInputs = { [K in ApiName]: Parameters<DesktopApi[K]>[0] };

