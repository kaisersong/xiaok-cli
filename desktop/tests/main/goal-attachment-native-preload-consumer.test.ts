// @vitest-environment node
import { readFileSync } from 'node:fs';
import { compileFunction, runInNewContext } from 'node:vm';
import * as os from 'node:os';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/goal-attachment-wire', getLocale: () => 'en' }, BrowserWindow: { getAllWindows: () => [] }, clipboard: {}, dialog: {}, shell: {} }));
import { createPreloadApi, type DesktopApi, type DesktopGoalMutationResult } from '../../electron/preload-api.js';
import { attachPreparedGoalTask } from '../../renderer/src/lib/goal-task-attachment.js';
import { fixture, specs, output, type Spec } from '../support/goal-attachment-native-fixture.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
function actualApi(f: Awaited<ReturnType<typeof fixture>>, variant: 'TS' | 'CJS'): DesktopApi {
  const ipc = {
    async invoke(channel: string, ...args: unknown[]) {
      const spec = specs.find(s => channel === 'desktop:goal:' + s.method);
      if (!spec) throw Error('unexpected_native_transport_channel');
      // Own explicit data-only IPC wire surrogate, not actual Electron/native qualification.
      return f.invoke(spec, structuredClone(args));
    },
    on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn(),
  };
  if (variant === 'TS') return createPreloadApi(ipc);
  let exposed: DesktopApi | undefined;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_name: string, value: DesktopApi) { exposed = value; } } };
      if (name === 'os') return os; throw Error('unexpected_dependency');
    },
  });
  if (!exposed) throw Error('original_CJS_api_missing'); return exposed;
}
it.each(specs.flatMap(spec => (['TS', 'CJS'] as const).map(variant => ({ spec, variant }))))('$spec.method original $variant preload retains original payload/public result/rejection', async ({ spec, variant }) => {
  resetIpcSchemaRegistryForTests(); let rejecting = false; const error = Error('original-native-wire-rejection');
  const f = await fixture(async function (method) { if (rejecting) throw error; return output(method); });
  try {
    const api = actualApi(f, variant);
    expect(await Reflect.apply(api[spec.api], api, [spec.input])).toEqual(output(spec));
    rejecting = true; await expect(Reflect.apply(api[spec.api], api, [spec.input])).rejects.toBe(error);
    expect(f.calls).toHaveLength(2); expect(f.gate.outstanding).toBe(0);
  } finally { await f.close(); }
});
it.each([false, true])('original attachPreparedGoalTask keeps update -> subscribe -> ACK and confirmed/unknown semantics (rejecting=%s)', async rejecting => {
  resetIpcSchemaRegistryForTests(); const sequence: string[] = [], error = Error('ack-original-rejection');
  const f = await fixture(async function () { sequence.push('ack'); if (rejecting) throw error; return undefined; });
  try {
    const api = actualApi(f, 'TS');
    const result = await attachPreparedGoalTask({
      prepared: { threadId: 'thread', taskId: 'task', attachmentId: 'attachment' },
      currentThreadId: 'thread', isCurrent: () => true, isCandidateCurrent: () => true,
      async updateThreadTaskId(threadId, taskId) { expect([threadId, taskId]).toEqual(['thread', 'task']); sequence.push('update'); },
      subscribeTask(taskId) { expect(taskId).toBe('task'); sequence.push('subscribe'); return () => sequence.push('unsubscribe'); },
      onEvent: () => { throw Error('unexpected_event'); }, onSubscribed: () => { sequence.push('retained'); },
      ackGoalTaskAttached: input => api.ackGoalTaskAttached(input),
    });
    expect(sequence).toEqual(['update', 'subscribe', 'retained', 'ack']);
    expect(result).toEqual(rejecting ? { kind: 'unknown', error } : { kind: 'confirmed' });
    expect(f.calls).toEqual([{ api: 'ackGoalTaskAttached', input: { threadId: 'thread', attachmentId: 'attachment' } }]);
  } finally { await f.close(); }
});
it.each(['continue', 'recover', 'cancel'] as const)('original Chat native action %s consumes only public result through original TS -> registrar', async action => {
  resetIpcSchemaRegistryForTests(); const f = await fixture();
  try {
    const api = actualApi(f, 'TS'), source = readFileSync(new URL('../../renderer/src/components/ChatShell.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('ChatShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const expressions = new Map<string, ts.ArrowFunction>();
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ['acceptGoalReply', 'handleGoalNativeAction', 'validPrepared'].includes(node.name.getText(ast)) && node.initializer) {
        const first = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
        if (first && ts.isArrowFunction(first)) expressions.set(node.name.getText(ast), first);
      }
      ts.forEachChild(node, visit);
    }; visit(ast);
    if (expressions.size !== 3) throw Error('actual_goal_native_chat_consumer_source_missing');
    const js = (name: string) => ts.transpileModule(`return (${expressions.get(name)!.getText(ast)});`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const applied: unknown[] = [], mutations: unknown[] = [], attached: unknown[] = [];
    const attempt = { requestId: specs[2].input.requestId };
    const current = (candidate: unknown) => candidate === attempt;
    const valid = compileFunction(js('validPrepared'), ['taskId'])('thread') as (candidate: unknown) => boolean;
    const accept = compileFunction(js('acceptGoalReply'), ['currentAttempt', 'validPrepared', 'applyGoal', 'attachGoalTask', 'setMessages'])
      (current, valid, (row: unknown) => applied.push(row), async (row: unknown) => { attached.push(row); }, () => { throw Error('unexpected_objective_message'); }) as (candidate: unknown, reply: DesktopGoalMutationResult) => Promise<void>;
    let refreshed = 0;
    const handle = compileFunction(js('handleGoalNativeAction'), ['getDesktopApi', 'taskId', 'beginGoalAttempt', 'runGoalAttempt', 'acceptGoalReply',
      'currentAttempt', 'setGoalNativeMutation', 'applyGoal', 'refreshGoalNative'])(
        () => api, 'thread', () => attempt, async (_attempt: unknown, run: () => Promise<void>) => { await run(); },
        accept, current, (row: unknown) => mutations.push(row), (row: unknown) => applied.push(row), async () => { refreshed++; },
      ) as (value: 'continue' | 'recover' | 'cancel') => Promise<void>;
    await handle(action);
    const spec: Spec = action === 'continue' ? specs[2] : action === 'recover' ? specs[1] : specs[3];
    expect(f.calls).toHaveLength(1); expect(f.calls[0]!.api).toBe(spec.api); expect(refreshed).toBe(1);
    if (action === 'continue') { expect(attached).toHaveLength(1); expect(applied).toHaveLength(1); }
    if (action === 'recover') { expect(applied).toHaveLength(1); expect(mutations).toHaveLength(1); }
    if (action === 'cancel') { expect(applied).toEqual([]); expect(mutations).toHaveLength(1); }
    // UI ports are explicit and do not start task/restore controllers; not mounted whole Chat proof.
  } finally { await f.close(); }
});

