// @vitest-environment node
// UNAPPLIED R30 compatibility controls: actual TS and sandbox CJS preload + actual ChatShell AST.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import ts from 'typescript';
import { expect, expectTypeOf, it } from 'vitest';
import type { createDesktopServices } from '../../electron/desktop-services.js';
type DesktopServices = ReturnType<typeof createDesktopServices>;
import type { DesktopApi } from '../../electron/preload-api.js';
import { createPreloadApi } from '../../electron/preload-api.js';
const NativePromise = Promise, CHANNEL = 'desktop:goal:setUserQueuePending';
function port() {
  const calls: unknown[][] = [];
  let producer: () => Promise<unknown> = () => NativePromise.resolve();
  return { calls, setProducer(next: () => Promise<unknown>) { producer = next; },
    invoke(channel: string, ...args: unknown[]): Promise<unknown> { calls.push([channel, ...args]); return producer(); },
    on() {}, removeListener() {}, off() {}, send() {},
  };
}
function actualApi(kind: 'TS' | 'CJS', ipc: ReturnType<typeof port>): ReturnType<typeof createPreloadApi> {
  if (kind === 'TS') return createPreloadApi(ipc);
  let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), { require(name: string) {
    if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_name: string, value: typeof api) { api = value; } } };
    if (name === 'os') return os; throw Error('unexpected preload dependency:' + name);
  } });
  return api;
}
it.each(['TS', 'CJS'] as const)('actual %s preload forwards BOTH original Boolean tuples and preserves raw void/reject ABI', async kind => {
  const ipc = port(), api = actualApi(kind, ipc);
  for (const pending of [true, false]) {
    const input = { threadId: 'thread', pending }, raw = NativePromise.resolve(); ipc.calls.length = 0; ipc.setProducer(() => raw);
    const result: Promise<void> = api.setGoalUserQueuePending(input);
    expect(result).toBe(raw); await expect(result).resolves.toBeUndefined(); expect(ipc.calls).toEqual([[CHANNEL, input]]);
    const failure = Error('queue-preload-owned-failure'); ipc.setProducer(() => NativePromise.reject(failure)); await expect(api.setGoalUserQueuePending(input)).rejects.toBe(failure);
  }
});
it('actual ChatShell retains true enqueue and false cancel consumers, void fire-and-forget calls and thread identity', () => {
  const source = readFileSync(new URL('../../renderer/src/components/ChatShell.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('ChatShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rows: Array<{ pending: string; thread: string; voided: boolean }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setGoalUserQueuePending') {
      expect(node.arguments).toHaveLength(1); const input = node.arguments[0]; expect(ts.isObjectLiteralExpression(input)).toBe(true);
      if (!ts.isObjectLiteralExpression(input)) throw Error('queue_consumer_not_literal');
      const thread = input.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'threadId');
      const pending = input.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'pending');
      expect(thread).toBeDefined(); expect(pending).toBeDefined();
      rows.push({ pending: pending!.initializer.getText(ast), thread: thread!.initializer.getText(ast), voided: ts.isVoidExpression(node.parent) });
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  expect(rows).toEqual([{ pending: 'true', thread: 'taskId', voided: true }, { pending: 'false', thread: 'taskId', voided: true }]);
});
it('original Services delegator and coordinator boolean method stay byte-identical and no new TaskHost factory is introduced', () => {
  const read = (name: string) => readFileSync(new URL('../../electron/' + name, import.meta.url), 'utf8');
  const service = ts.createSourceFile('desktop-services.ts', read('desktop-services.ts'), ts.ScriptTarget.Latest, true);
  let delegate: ts.PropertyAssignment | undefined;
  const walk = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(service) === 'setGoalUserQueuePending') delegate = node; ts.forEachChild(node, walk); }; walk(service);
  expect(delegate!.initializer.getText(service)).toBe(EXPECTED_SERVICES_INITIALIZER);
  const coordinator = ts.createSourceFile('desktop-goal-coordinator.ts', read('desktop-goal-coordinator.ts'), ts.ScriptTarget.Latest, true);
  let method: ts.MethodDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isMethodDeclaration(node) && node.name.getText(coordinator) === 'setUserQueuePending') method = node; ts.forEachChild(node, visit); }; visit(coordinator);
  expect(method!.getText(coordinator)).toBe(EXPECTED_COORDINATOR_METHOD);
});

const EXPECTED_SERVICES_INITIALIZER = "(input: { threadId: string; pending: boolean }) => (\n      goalCoordinator.setUserQueuePending(input)\n    )";
const EXPECTED_COORDINATOR_METHOD = "async setUserQueuePending(input: { threadId: string; pending: boolean }): Promise<void> {\n    return this.withOperation(async () => {\n      await this.withThread(input.threadId, async () => {\n        if (!input.pending) {\n          this.userQueuePending.delete(input.threadId);\n          return;\n        }\n        this.userQueuePending.add(input.threadId);\n        await this.cancelPending(input.threadId, 'superseded_by_user');\n        const running = this.runningByThread.get(input.threadId);\n        const binding = running ? this.options.store.getTaskBinding(running) : null;\n        if (running && binding?.origin === 'continuation') {\n          await this.options.taskHost.cancelTask(running, 'superseded_by_user');\n        }\n      });\n      });\n  }";

it('public Services and preload full Boolean request/Promise<void> ABI agree without SDK casts', () => {
  expectTypeOf<Parameters<DesktopServices['setGoalUserQueuePending']>[0]>().toEqualTypeOf<{ threadId: string; pending: boolean }>();
  expectTypeOf<ReturnType<DesktopServices['setGoalUserQueuePending']>>().toEqualTypeOf<Promise<void>>();
  expectTypeOf<Parameters<DesktopApi['setGoalUserQueuePending']>[0]>().toEqualTypeOf<{ threadId: string; pending: boolean }>();
  expectTypeOf<ReturnType<DesktopApi['setGoalUserQueuePending']>>().toEqualTypeOf<Promise<void>>();
});
it('applied new typed module preserves literal original IPC service delegation bytes', () => {
  const ipcSource = readFileSync(new URL('../../electron/ipc.ts', import.meta.url), 'utf8');
  expect(ipcSource).toContain("import { registerGoalQueuePendingIpc } from './goal-queuepending-typed-ipc.js';");
  // SOURCE-before fails the real missing import assertion, never a missing-file fixture error.
  const source = readFileSync(new URL('../../electron/goal-queuepending-typed-ipc.ts', import.meta.url), 'utf8');
  expect(source).toContain(EXPECTED_IPC_SERVICE_DELEGATION);
});

const EXPECTED_IPC_SERVICE_DELEGATION = "    return services.setGoalUserQueuePending({\n      threadId: parseGoalThreadId(input.threadId), pending: input.pending,\n    });";
