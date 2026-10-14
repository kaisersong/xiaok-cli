// Candidate fixture only: original registrar + extracted Main/Services source, never cold Services.
import { EventEmitter } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import type { IpcMainInvokeEvent } from 'electron';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
import type { DesktopGoalCoordinator, DesktopGoalProjection } from '../../electron/desktop-goal-coordinator.js';
import type { GoalState } from '../../../src/runtime/goal/types.js';

export function goalState(): GoalState {
  return { goalId: 'goal', revision: 1, epoch: 1, sessionId: 'thread',
    objective: 'Existing goal', expectedEvidenceKinds: ['answer'], status: 'active',
    turnsUsed: 0, tokensUsed: 0, activeWallClockMs: 0, budgetLimits: { turnLimit: 20 },
    consecutiveBlockedTurns: 0, createdAt: 1000, updatedAt: 1000 };
}
export function projection(): DesktopGoalProjection {
  return { state: goalState(), activation: 'disarmed', currentCompletion: { kind: 'ordinary' } };
}
export function originalServiceDelegate(coordinator: Pick<DesktopGoalCoordinator, 'getGoal'>): DesktopGoalCoordinator['getGoal'] {
  const raw = readFileSync(new URL('../../electron/desktop-services.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('desktop-services.ts', raw, ts.ScriptTarget.Latest, true);
  const matches: ts.PropertyAssignment[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(ast) === 'getGoal') matches.push(n);
    ts.forEachChild(n, visit);
  }; visit(ast);
  if (matches.length !== 1) throw Error('actual_goal_get_delegate_population_changed');
  const js = ts.transpileModule(`return (${matches[0]!.initializer.getText(ast)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return compileFunction(js, ['goalCoordinator'])(coordinator) as DesktopGoalCoordinator['getGoal'];
}
function mainAuthority(main: unknown, recorder: unknown, services: unknown) {
  const raw = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', raw, ts.ScriptTarget.Latest, true);
  const coarse = ast.statements.find((n): n is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(n) && n.name?.text === 'authorizeDesktopInvoke');
  const finer: ts.PropertyAssignment[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === 'registerDesktopIpc') {
      const options = n.arguments[3];
      if (options && ts.isObjectLiteralExpression(options)) for (const property of options.properties) {
        if (ts.isPropertyAssignment(property) && property.name.getText(ast) === 'multiAgentAuthorize') finer.push(property);
      }
    }
    ts.forEachChild(n, visit);
  }; visit(ast);
  if (!coarse || finer.length !== 1) throw Error('actual_goal_get_main_authorizer_missing');
  const js = ts.transpileModule(`let mainWindow=main;let meetingRecorderController=recorder;
${coarse.getText(ast)}
return {coarse:authorizeDesktopInvoke,finer:${finer[0]!.initializer.getText(ast)}};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const dirname = resolve('dist/main/desktop/electron');
  const rendererFile = join(dirname, '../../../renderer/index.html');
  // Both original functions see the SAME controlled file-mode config. No ambient env split.
  return compileFunction(js, ['main', 'recorder', 'services', 'isTrustedDesktopRendererUrl',
    'join', '__dirname', 'rendererFile', 'devServer', 'process'])(
      main, recorder, services, isTrustedDesktopRendererUrl, join, dirname,
      rendererFile, undefined, { env: { XIAOK_DESKTOP_DEV_SERVER: undefined } },
    ) as {
      coarse(event: IpcMainInvokeEvent): void;
      finer: NonNullable<NonNullable<Parameters<typeof registerDesktopIpc>[3]>['multiAgentAuthorize']>;
    };
}
/** Explicit ordinary transport port, not a native SDK/owner/TaskHost producer qualification. */
export async function goalGetFixture(read: DesktopGoalCoordinator['getGoal'] = async function () { return projection(); }, finerEnabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'goal-get-transport-'));
  const frame = { url: pathToFileURL(resolve('dist/renderer/index.html')).href };
  let destroyed = false;
  const target = Object.assign(new EventEmitter(), { id: 31, mainFrame: frame, isDestroyed: () => destroyed });
  const recorder = Object.assign(new EventEmitter(), { id: 32, mainFrame: frame, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), { webContents: target, isDestroyed: () => false });
  const calls: string[] = [];
  const producer = { async getGoal(threadId: string) { calls.push(threadId); return read(threadId); } };
  // Complete original Services property expression, with an explicit bounded port receiver.
  const services = { getGoal: originalServiceDelegate(producer), getDataRoot: () => root, multiAgent: undefined };
  const authority = mainAuthority(window, { ownsWebContents: (sender: unknown) => sender === recorder }, services);
  const gate = new DesktopShutdownGate(), listeners = new Map<string, IpcHandlerListener>(), disposers: Array<() => void> = [];
  const ipc = new ShutdownAwareIpcMain({ handle: (channel, listener) => listeners.set(channel, listener) }, gate, authority.coarse);
  try {
    await registerDesktopIpc(ipc, window as Parameters<typeof registerDesktopIpc>[1],
      services as Parameters<typeof registerDesktopIpc>[2], {
        ...(finerEnabled ? { multiAgentAuthorize: authority.finer } : {}),
        registerLifetimeDisposer: dispose => disposers.push(dispose),
      });
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  const event = { sender: target, senderFrame: frame };
  const invoke = (args: unknown[] = [{ threadId: 'thread' }], source: unknown = event) =>
    Reflect.apply(listeners.get('desktop:goal:get')!, undefined, [source, ...args]) as Promise<unknown>;
  const close = async () => {
    gate.close();
    if (!await gate.drain(1500)) throw Error('goal_get_transport_drain_incomplete');
    for (const dispose of disposers) dispose();
    rmSync(root, { recursive: true, force: true });
  };
  return { invoke, calls, services, gate, frame, target, recorder, event, close, destroy: () => { destroyed = true; } };
}

