// @vitest-environment node
// Actual TS/CJS -> real registrar + original consumer source. Native attachment/refresh ALWAYS THROW.
import { readFileSync } from 'node:fs';
import { compileFunction, runInNewContext } from 'node:vm';
import * as os from 'node:os';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/goal-task-source-register', getLocale: () => 'en' }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {} }, clipboard: {}, dialog: {}, shell: {} }));
import { createPreloadApi, type DesktopApi, type DesktopGoalProjection } from '../../electron/preload-api.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { METHODS, NativePromise, REQUEST_ID, fixture, payload, publicReply, turn, type Method, type Reply, type Producer } from '../support/goal-task-mutation-fixture.js';
const cleanup: Array<() => Promise<void>> = [];
beforeEach(resetIpcSchemaRegistryForTests); afterEach(async () => { const failures: unknown[] = []; for (const fn of cleanup.splice(0)) { try { await fn(); } catch (error) { failures.push(error); } } if (failures.length) throw new AggregateError(failures, 'ordinary_fixture_cleanup_failed'); });
async function wired(form: 'TS' | 'CJS', override: Partial<Record<Method, Producer>> = {}) {
  const f = await fixture(override); cleanup.push(f.close); const calls: Array<{ channel: string; args: unknown[] }> = [];
  const ipc = { invoke(channel: string, ...args: unknown[]) { calls.push({ channel, args: structuredClone(args) }); const method = channel.slice('desktop:goal:'.length); if (!METHODS.includes(method as Method)) throw Error('OUT_OF_SCOPE_CHANNEL'); return f.invoke(method as Method, structuredClone(args)); }, on() {}, off() {}, removeListener() {}, send() { throw Error('UNEXPECTED_SEND'); } };
  let api: DesktopApi;
  if (form === 'TS') api = createPreloadApi(ipc);
  else { let value: DesktopApi | undefined; runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), { require(name: string) {
    if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_name: string, current: DesktopApi) { value = current; } } };
    if (name === 'os') return os; throw Error('unexpected_preload_dependency');
  } }); if (!value) throw Error('actual_preload_api_missing'); api = value; }
  return { f, api, calls };
}
function publicCall(api: DesktopApi, method: Method): Promise<Reply> {
  const input = payload(method); if (method === 'create') return api.createGoal(input as Parameters<DesktopApi['createGoal']>[0]);
  if (method === 'replace') return api.replaceGoal(input as Parameters<DesktopApi['replaceGoal']>[0]); return api.resumeGoal(input);
}
for (const form of ['TS', 'CJS'] as const) it.each(METHODS)(`${form} %s original object tuple/full public DTO/reject identity`, async method => {
  const { f, api, calls } = await wired(form); const result = await publicCall(api, method);
  expect(calls).toEqual([{ channel: 'desktop:goal:' + method, args: [payload(method)] }]); expect(result.preparedTask.attachmentSource).toEqual({ kind: 'request', requestId: REQUEST_ID }); expect(result.goal.state.sessionId).toBe('thread'); expect(f.gate.outstanding).toBe(0);
  const failure = Error('ordinary-preload-reject'), next = await wired(form, { [method]: () => NativePromise.reject(failure) }); await expect(publicCall(next.api, method)).rejects.toBe(failure);
});
function sourceConsumer(api: DesktopApi, method: Method) {
  const source = readFileSync(new URL('../../renderer/src/components/ChatShell.tsx', import.meta.url), 'utf8'), ast = ts.createSourceFile('ChatShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['applyGoal', 'currentAttempt', 'runGoalAttempt', 'validPrepared', 'acceptGoalReply', 'handleGoalCreate', 'handleGoalResume', 'handleGoalReplace'];
  const arrows = new Map<string, ts.ArrowFunction>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast)) && node.initializer) {
      const init = node.initializer, arrow = ts.isArrowFunction(init) ? init : ts.isCallExpression(init) && init.arguments[0] && ts.isArrowFunction(init.arguments[0]) ? init.arguments[0] : undefined;
      if (arrow) { expect(arrows.has(node.name.getText(ast))).toBe(false); arrows.set(node.name.getText(ast), arrow); }
    } ts.forEachChild(node, visit);
  }; visit(ast); expect(arrows.size).toBe(names.length);
  const expressions = names.map(name => `const ${name}=(${arrows.get(name)!.getText(ast)});`).join('\n');
  const callback = method === 'create' ? 'handleGoalCreate' : method === 'replace' ? 'handleGoalReplace' : 'handleGoalResume';
  const js = ts.transpileModule(expressions + `\nreturn ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const scope = {}, attempt = { scope, requestId: REQUEST_ID }, liveRenderScope = { current: scope }, goalAttemptRef: { current: typeof attempt | null } = { current: attempt };
  const last = publicReply(method).goal; let goal: DesktopGoalProjection | null = last, loading = false, error: unknown = null, attachments = 0, refreshes = 0, messages = 0;
  const attachmentError = Error('FORBIDDEN_NATIVE_ATTACHMENT'), refreshError = Error('FORBIDDEN_NATIVE_REFRESH');
  const fn = compileFunction(js, ['getDesktopApi', 'taskId', 'beginGoalAttempt', 'liveRenderScope', 'goalAttemptRef', 'setGoal', 'setGoalLoading', 'setGoalError', 'sanitizeUserFacingErrorMessage', 't', 'setMessages', 'attachGoalTask', 'refreshGoalNative'])(
    () => api, 'thread', () => attempt, liveRenderScope, goalAttemptRef,
    (update: (previous: DesktopGoalProjection | null) => DesktopGoalProjection | null) => { goal = update(goal); },
    (value: boolean) => { loading = value; }, (value: unknown) => { error = value; }, (value: unknown) => value,
    { chatShell: { taskCreateFailed: 'ordinary-ui-error' } }, () => { messages++; },
    () => { attachments++; throw attachmentError; }, () => { refreshes++; throw refreshError; },
  ) as (input?: unknown) => Promise<void>;
  const run = () => fn(method === 'resume' ? 3 : { objective: 'Original input', completionCriterion: 'Answer', expectedEvidenceKinds: ['answer'], turnLimit: 3 });
  return { run, stale() { goalAttemptRef.current = null; }, snapshot: () => ({ goal, loading, error, attachments, refreshes, messages }), last, attachmentError, refreshError };
}
it.each(METHODS)('%s actual source callback reaches valid DATA correlation then THROWING attachment only, never native success', async method => {
  const { api, f } = await wired('TS'); const consumer = sourceConsumer(api, method);
  const result = consumer.run(); if (method === 'resume') await expect(result).resolves.toBeUndefined(); else await expect(result).rejects.toBe(consumer.refreshError);
  expect(consumer.snapshot()).toMatchObject({ loading: false, error: consumer.attachmentError, attachments: 1, refreshes: method === 'resume' ? 0 : 1 }); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('%s held raw reply after attempt retirement cannot apply old Goal or attach a task', async method => {
  let release!: (reply: Reply) => void; const raw = new NativePromise<Reply>(resolve => { release = resolve; }); const { api, f } = await wired('TS', { [method]: () => raw }); const consumer = sourceConsumer(api, method);
  const pending = consumer.run(); const observed = pending.then(value => ({ value }), error => ({ error }));
  try { await turn(); consumer.stale(); } finally { release(publicReply(method)); await observed; }
  expect(consumer.snapshot().goal).toBe(consumer.last); expect(consumer.snapshot().attachments).toBe(0); expect(consumer.snapshot().messages).toBe(0); expect(f.calls).toHaveLength(1); expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('%s original root rejection keeps last-good Goal/no attachment and records actual attempt error', async method => {
  const failure = Error('original-root-domain-failure'), { api, f } = await wired('TS', { [method]: () => NativePromise.reject(failure) }); const consumer = sourceConsumer(api, method);
  const pending = consumer.run(); if (method === 'resume') await expect(pending).resolves.toBeUndefined(); else await expect(pending).rejects.toBe(consumer.refreshError);
  expect(consumer.snapshot()).toMatchObject({ goal: consumer.last, error: failure, loading: false, attachments: 0, messages: 0 }); expect(f.gate.outstanding).toBe(0);
});
it.each(METHODS)('%s current consumer rejects automatic/mismatched reply correlation before attachment; DATA is not a grant', async method => {
  const dto = publicReply(method); dto.preparedTask.attachmentSource = { kind: 'automatic', predecessorTaskId: 'transport-data-only' };
  const { api, f } = await wired('TS', { [method]: () => NativePromise.resolve(dto) }); const consumer = sourceConsumer(api, method);
  const pending = consumer.run(); if (method === 'resume') await expect(pending).resolves.toBeUndefined(); else await expect(pending).rejects.toBe(consumer.refreshError);
  expect(consumer.snapshot().attachments).toBe(0); expect(consumer.snapshot().goal).toBe(consumer.last); expect(consumer.snapshot().error).toMatchObject({ message: 'invalid_goal_attachment_reply' }); expect(f.gate.outstanding).toBe(0);
});
