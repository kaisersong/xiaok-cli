// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
const channels = ['desktop:kswarm:start', 'desktop:kswarm:stop', 'desktop:kswarm:restart', 'desktop:kswarm:resumeWorkflowRun'] as const;
async function fixture() {
  resetIpcSchemaRegistryForTests();
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const declarations: string[] = [], registrations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (['mainWindow', 'meetingRecorderController', 'shutdownAwareIpc'].includes(declaration.name.getText(ast)) && ast.statements.includes(node)) declarations.push(node.getText(ast));
        if (['runtimeActions', 'runtimeActionProducers'].includes(declaration.name.getText(ast))) registrations.push(node.getText(ast));
      }
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (call.expression.getText(ast) === 'registerRuntimeActionIpc' || call.expression.getText(ast) === 'shutdownAwareIpc.handle' && channels.some(channel => call.arguments[0]?.getText(ast) === `'${channel}'`)) registrations.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  const admission = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeDesktopInvoke');
  expect(declarations).toHaveLength(3); expect(admission).toBeDefined(); expect(registrations.length).toBeGreaterThan(0);
  let createControl: unknown, register: unknown;
  if (source.includes('createDesktopRuntimeActionService')) createControl = (await import('../../electron/runtime-action-service.js')).createDesktopRuntimeActionService;
  if (source.includes('registerRuntimeActionIpc')) register = (await import('../../electron/runtime-action-typed-ipc.js')).registerRuntimeActionIpc;
  const dirname = resolve('dist/main/desktop/electron'), frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href };
  const recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const sender = { mainFrame: frame, isDestroyed: () => false }, recorder = { mainFrame: recorderFrame, isDestroyed: () => false };
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const sdk = { start: vi.fn(async (): Promise<unknown> => undefined), stop: vi.fn(async (): Promise<unknown> => undefined), restart: vi.fn(async (): Promise<unknown> => undefined) };
  const resume = vi.fn(async (_sdk: unknown, _projectId: unknown, _workflowRunId: unknown): Promise<unknown> => ({ restored: false, reason: 'no_script_source', future: { kept: true } }));
  const js = ts.transpileModule([...declarations, admission!.getText(ast), 'mainWindow = initialMain; meetingRecorderController = initialRecorder;', ...registrations,
    `return { setWindows(main, controller) { mainWindow = main; meetingRecorderController = controller; }, facade: ${createControl ? 'runtimeActions' : 'undefined'} };`,
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const main = compileFunction(js, ['ipcMain', 'desktopShutdownGate', 'ShutdownAwareIpcMain', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process', 'initialMain', 'initialRecorder', 'kswarmService', 'createDesktopRuntimeActionService', 'registerRuntimeActionIpc', 'resumeOneScriptWorkflow'])(
    { handle: (channel: string, listener: IpcHandlerListener) => listeners.set(channel, listener) }, gate, ShutdownAwareIpcMain, isTrustedDesktopRendererUrl, join, dirname, { env: {} }, { webContents: sender, isDestroyed: () => false }, { ownsWebContents: (candidate: unknown) => candidate === recorder }, sdk, createControl, register, resume,
  );
  expect([...listeners.keys()].sort()).toEqual([...channels].sort());
  const invoke = (channel: string, ...args: unknown[]) => Reflect.apply(listeners.get(channel)!, undefined, [{ sender, senderFrame: frame }, ...args]);
  return { main, gate, sdk, resume, sender, recorder, frame, recorderFrame, listeners, invoke };
}

const args = (channel: string): unknown[] => channel.endsWith('resumeWorkflowRun') ? [{ projectId: 'owned', workflowRunId: 'owned-run' }] : [];
it('registers precisely the original four Main action tuple contracts', async () => {
  await fixture(); expect([...IPC_SCHEMA_REGISTRY.keys()].sort()).toEqual([...channels].sort());
  for (const entry of IPC_SCHEMA_REGISTRY.values()) expect(entry).toMatchObject({ rolloutRound: 35, payloadMode: 'tuple', inputStage: 'beforeHandler' });
});
it.each(channels)('%s rejects surplus input before actual Main producer', async channel => {
  const f = await fixture(); await expect(async () => f.invoke(channel, ...args(channel), {})).rejects.toThrow('runtime_action_input_invalid');
  expect(f.sdk.start).not.toHaveBeenCalled(); expect(f.sdk.stop).not.toHaveBeenCalled(); expect(f.sdk.restart).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
});
it('captures resume input before actual Main optional chaining reads accessors', async () => {
  const f = await fixture(); let reads = 0; const input = Object.defineProperty({ workflowRunId: 'owned-run' }, 'projectId', { enumerable: true, get() { reads++; return 'owned'; } });
  await expect(async () => f.invoke(channels[3], input)).rejects.toThrow('runtime_action_input_invalid'); expect(reads).toBe(0); expect(f.resume).not.toHaveBeenCalled();
});
it.each(channels.flatMap(channel => ['unknown', 'old-main', 'subframe', 'bad-url', 'retired-recorder'].map(kind => ({ channel, kind }))))('$channel denies $kind before payload or SDK', async ({ channel, kind }) => {
  const f = await fixture(); let reads = 0;
  if (kind === 'old-main') f.main.setWindows({ webContents: { mainFrame: f.frame, isDestroyed: () => false }, isDestroyed: () => false }, { ownsWebContents: (sender: unknown) => sender === f.recorder });
  if (kind === 'bad-url') f.frame.url = 'file:///never-owned/index.html';
  if (kind === 'retired-recorder') f.main.setWindows({ webContents: f.sender, isDestroyed: () => false }, { ownsWebContents: () => false });
  const sender = kind === 'unknown' ? { mainFrame: f.frame, isDestroyed: () => false } : kind === 'retired-recorder' ? f.recorder : f.sender;
  const frame = kind === 'subframe' ? { url: f.frame.url } : sender.mainFrame;
  const payload = Object.defineProperty({}, 'projectId', { enumerable: true, get() { reads++; return 'owned'; } });
  await expect(async () => Reflect.apply(f.listeners.get(channel)!, undefined, [{ sender, senderFrame: frame }, payload])).rejects.toThrow('desktop_user_sender_forbidden');
  expect(reads).toBe(0); expect(f.sdk.start).not.toHaveBeenCalled(); expect(f.sdk.stop).not.toHaveBeenCalled(); expect(f.sdk.restart).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
});
it.each(['start', 'stop', 'restart'] as const)('%s rejects output error envelopes instead of void ACK', async method => {
  const f = await fixture(); f.sdk[method].mockResolvedValueOnce({ ok: false, error: 'owned' });
  await expect(async () => f.invoke('desktop:kswarm:' + method)).rejects.toThrow('runtime_action_projection_unavailable'); expect(f.sdk[method]).toHaveBeenCalledTimes(1); expect(f.gate.outstanding).toBe(0);
});
it.each(['main', 'recorder'])('preserves complete resume false DTO and void actions for %s', async role => {
  const f = await fixture(), sender = role === 'main' ? f.sender : f.recorder;
  for (const channel of channels) {
    const reply = await Reflect.apply(f.listeners.get(channel)!, undefined, [{ sender, senderFrame: sender.mainFrame }, ...args(channel)]);
    expect(reply).toEqual(channel === channels[3] ? { restored: false, reason: 'no_script_source', future: { kept: true } } : undefined);
  }
  expect(f.gate.outstanding).toBe(0);
});
it('holds original physical shutdown token until start promise settles', async () => {
  const f = await fixture(); let finish!: () => void; const held = new Promise<void>(resolve => { finish = resolve; }); f.sdk.start.mockImplementationOnce(() => held);
  const pending = f.invoke(channels[0]); expect(f.gate.outstanding).toBe(1); finish(); await pending; expect(f.gate.outstanding).toBe(0);
});
