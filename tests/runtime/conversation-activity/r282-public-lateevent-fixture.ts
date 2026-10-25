import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { createMcpClientConnection } from '../../../src/platform/mcp/transport.js';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ConversationActivityService, type ActivityThreadIdentity } from '../../../src/runtime/conversation-activity/service.js';
import { ConversationMcpActivities } from '../../../src/runtime/conversation-activity/mcp.js';
import type { WorkWatch } from '../../../src/runtime/conversation-activity/types.js';
import type { McpTaskObserver } from '../../../src/platform/mcp/tasks.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';
export function gate<T>() { let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export const checkpoint = () => new Promise<void>(yes => setTimeout(yes, 100));
export async function resultOf(promise: Promise<unknown>) { const [value] = await Promise.allSettled([promise]); return value; }
const Stats = z.object({ gets: z.number().int().nonnegative(), created: z.number().int().nonnegative(), toolLists: z.number().int().nonnegative(), active: z.number().int().nonnegative() });
const Ready = z.object({ type: z.literal('ready'), pid: z.number().int().positive(), nonce: z.string(), port: z.number().int().positive() });
const Reply = z.object({ type: z.literal('reply'), id: z.string(), data: z.unknown().optional(), error: z.string().optional() });
export async function realLateFixture() {
  const root = mkdtempSync(join(tmpdir(), 'r282-late-public-')), nonce = randomUUID();
  const releases: Array<() => void> = [], pending: Promise<unknown>[] = [];
  const hooks: { authorize?: (watch: WorkWatch) => boolean | Promise<boolean>; endpointReady?: () => Promise<void> } = {};
  const counters = { endpoint: 0, origin: 0, authorize: 0 };
  const callbackErrors: unknown[] = [];
  let child: ChildProcess | undefined, childClosed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  let connection: Awaited<ReturnType<typeof createMcpClientConnection>> | undefined;
  let store: ConversationActivityStore | undefined, service: ConversationActivityService | undefined, activities: ConversationMcpActivities | undefined;
  let taskExecution: Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof createMcpClientConnection>>['tasks']>['callTool']>> | undefined;
  let reference: SerializedTaskReference | undefined, expectedCloseError: unknown, cleanupPromise: Promise<void> | undefined;
  const calls = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  const readyGate = gate<z.infer<typeof Ready>>();
  async function rpc(command: string): Promise<unknown> {
    const target = child;
    if (!target?.connected) throw Error('actual_own_ipc_disconnected');
    const id = randomUUID();
    return new Promise<unknown>((yes, no) => {
      const timer = setTimeout(() => { calls.delete(id); no(Error('own_ipc_deadline')); }, 5000);
      calls.set(id, { resolve: yes, reject: no, timer });
      target.send({ id, nonce, command }, error => { if (!error) return; const call = calls.get(id); if (call) { clearTimeout(call.timer); calls.delete(id); call.reject(error); } });
    });
  }
  async function attemptAll(steps: Array<() => unknown | Promise<unknown>>) {
    return (await Promise.allSettled(steps.map(step => { try { return Promise.resolve(step()); } catch (error) { return Promise.reject(error); } }))).flatMap(value => value.status === 'rejected' ? [value.reason] : []);
  }
  function cleanup(): Promise<void> {
    return cleanupPromise ??= (async () => {
      const failures: unknown[] = []; for (const release of releases) { try { release(); } catch (error) { failures.push(error); } }
      if (child?.connected) failures.push(...await attemptAll([() => rpc('finish')]));
      await Promise.allSettled(pending);
      failures.push(...(await attemptAll([() => activities?.close()])).filter(error => error !== expectedCloseError));
      // The actual own producer finishes normally. No cancel/suspend/kill path.
      if (taskExecution) { failures.push(...await attemptAll([async () => { const outcome = await taskExecution!.result(); if (outcome.status !== 'completed') throw Error('own_task_not_completed'); }])); failures.push(...await attemptAll([() => taskExecution!.detach()])); }
      failures.push(...await attemptAll([() => connection?.close(), () => service?.close()]));
      if (child?.connected) failures.push(...await attemptAll([() => rpc('shutdown')]));
      if (childClosed) {
        const result = await resultOf(childClosed);
        if (result.status === 'rejected') failures.push(result.reason);
        else { const value = z.object({ code: z.literal(0), signal: z.null() }).safeParse(result.value); if (!value.success) failures.push(Error('actual_child_not_natural_exit0')); }
      }
      if (!child?.pid || !store) failures.push(Error('actual_owned_setup_or_pid_unconfirmed'));
      else {
        try {
          const exited = z.object({ pid: z.number(), nonce: z.string(), code: z.literal(0) }).parse(JSON.parse(readFileSync(join(root, 'exited.json'), 'utf8')));
          if (exited.pid !== child.pid || exited.nonce !== nonce) throw Error('own_exit_receipt_mismatch');
          let absent: unknown; try { process.kill(child.pid, 0); } catch (error) { absent = error; }
          if (!absent || typeof absent !== 'object' || !('code' in absent) || absent.code !== 'ESRCH') throw Error('actual_owned_child_still_live_or_unknown');
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'R282 actual own cleanup unconfirmed; root retained');
      store!.close();
      if (expectedCloseError !== undefined) writeFileSync(join(root, 'expected-observation-rejection.json'), JSON.stringify({ expected: true, rootReleaseClaimed: false }), { mode: 0o600 });
      else rmSync(root, { recursive: true });
    })();
  }
  try {
    child = spawn(process.execPath, [resolve('tests/support/r282-owned-mcp-task-http.mjs')], { cwd: process.cwd(), env: { ...process.env, R282_ROOT: root, R282_NONCE: nonce }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
    childClosed = new Promise((yes, no) => { child!.once('error', no); child!.once('close', (code, signal) => yes({ code, signal })); }); void Promise.allSettled([childClosed]);
    child.on('message', raw => {
      const ready = Ready.safeParse(raw); if (ready.success) { readyGate.resolve(ready.data); return; }
      const reply = Reply.safeParse(raw); if (!reply.success) return;
      const call = calls.get(reply.data.id); if (!call) return; calls.delete(reply.data.id); clearTimeout(call.timer);
      if (reply.data.error) call.reject(Error(reply.data.error)); else call.resolve(reply.data.data);
    });
    child.once('error', error => readyGate.reject(error));
    const timer = setTimeout(() => readyGate.reject(Error('own_node_start_deadline')), 5000);
    let ready: z.infer<typeof Ready>; try { ready = await readyGate.promise; } finally { clearTimeout(timer); }
    if (ready.pid !== child.pid || ready.nonce !== nonce) throw Error('own_node_identity_mismatch');
    const actualConnection = connection = await createMcpClientConnection('r282-owned-task', { type: 'http', url: `http://127.0.0.1:${ready.port}/mcp`, protocol: { mode: 'modern', version: '2026-07-28' }, timeout: { startup: 5000 } });
    if (!actualConnection.tasks?.capabilities.execution) throw Error('actual_public_sdk_tasks_missing');
    const actualExecution = taskExecution = await actualConnection.tasks.callTool('r282-owned-task', {}, { task: { preference: 'require' }, requestTimeoutMs: 5000 });
    if (actualExecution.kind !== 'task') throw Error('actual_sdk_task_execution_required');
    const actualReference = reference = actualExecution.serializeReference();
    const iterator = actualExecution.updates()[Symbol.asyncIterator](); const first = await iterator.next();
    if (first.done || !first.value) throw Error('actual_sdk_initial_event_required');
    const actualEvent = first.value; await iterator.return?.(undefined);
    const callerId = randomUUID(), thread: ActivityThreadIdentity = { profileId: randomUUID(), threadId: randomUUID(), workspaceId: root, deleteState: 'none' };
    const actorId = randomUUID(); const actualStore = store = new ConversationActivityStore(join(root, 'activity.sqlite'));
    const actualService = service = new ConversationActivityService({ store: actualStore, profileId: thread.profileId, actorId,
      getThread(id) { return id === thread.threadId ? thread : null; },
      canObserveWork(watch) { counters.authorize++; const owned = watch.source === 'mcp' && watch.logicalSourceId === actualConnection.tasks!.endpointId && watch.workId === actualReference.taskId;
        if (!owned) return false; return hooks.authorize ? hooks.authorize(watch) : true; } });
    const actualActivities = activities = new ConversationMcpActivities({ store: actualStore, service: actualService, actorId,
      onError(error) { callbackErrors.push(error); },
      async endpointReady(connection) { counters.endpoint++; const tools = await connection.client.listTools(); if (!tools.tools.some(tool => tool.name === 'r282-owned-task')) throw Error('actual_sdk_catalog_mismatch'); await hooks.endpointReady?.(); },
      async originThread(taskId) { counters.origin++; return taskId === callerId ? thread.threadId : null; } });
    actualActivities.register(actualConnection);
    const maybeObserver = await actualActivities.observer(callerId, randomUUID(), actualConnection); if (!maybeObserver) throw Error('actual_observer_required');
    const observer: McpTaskObserver = maybeObserver; await observer.handle(actualReference);
    const watch = actualStore.listWatches().find(value => value.workId === actualReference.taskId); if (!watch) throw Error('real_public_bind_missing');
    return { root, callerId, connection: actualConnection, execution: actualExecution, reference: actualReference, event: actualEvent, observer, activities: actualActivities,
      store: actualStore, service: actualService, watch, hooks, counters, callbackErrors,
      async stats() { return Stats.parse(await rpc('stats')); },
      own(promise: Promise<unknown>) { pending.push(promise); void Promise.allSettled([promise]); }, release(action: () => void) { releases.push(action); },
      expectCloseError(error: unknown) { expectedCloseError = error; }, cleanup };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'R282 fixture construction/cleanup failed'); }
    throw error;
  }
}
export async function withRealLateFixture(body: (fixture: Awaited<ReturnType<typeof realLateFixture>>) => Promise<void>): Promise<void> {
  const fixture = await realLateFixture(); let failed = false; let originalFailure: unknown;
  try { await body(fixture); } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    try { await fixture.cleanup(); } catch (cleanupError) { throw new AggregateError([...(failed ? [originalFailure] : []), cleanupError], 'R282 body and actual cleanup evidence retained'); }
  }
}
