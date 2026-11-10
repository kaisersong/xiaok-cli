// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopContextContinuity } from '../../electron/context-continuity/runtime.js';
import type { TaskSnapshot } from '../../shared/task-types.js';
let root: string, runtime: DesktopContextContinuity;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'continuity-runtime-')); runtime = new DesktopContextContinuity(root); });
afterEach(async () => { await runtime.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
it('does not admit native context work when parent turn completion cannot prove descendant/tool closure',()=>{
  expect(()=>runtime.assertNativeExecutionAvailable()).toThrow('native_execution_gate_unavailable');
  runtime.port();expect(()=>runtime.assertNativeExecutionAvailable()).toThrow('native_execution_gate_unavailable');
  expect(()=>runtime.acquireNativeContext('task_native',[])).toThrow('native_execution_gate_unavailable');
});
it('assembles mandatory main-owned full public history without Goal transport wrappers or renderer omission and blocks unknown execution', async () => {
  const { service, actor } = runtime.port(), c = service.createConversation(actor, { operationId: 'new' });
  const snapshot = { taskId: 'task_user', sessionId: 'session_user', prompt: 'INTERNAL_TRANSPORT_WRAPPER', status: 'completed', events: [{ type: 'result', result: { summary: 'public answer', artifacts: [] } }], context: { threadId: c.id } } as TaskSnapshot;
  await runtime.bindPrepared({ prompt: snapshot.prompt, context: snapshot.context } as never, snapshot.taskId, async () => snapshot, { prompt: 'original public constraint', includeUser: true });
  expect(() => runtime.assembleOwnedHistory('consumer', { threadId: c.id, taskIds: [] })).toThrow('blocked_unsettled');
  runtime.registerGuardedSnapshot(snapshot); runtime.capture(snapshot, { physicallySettled: true });
  expect(runtime.assembleOwnedHistory('consumer', { threadId: c.id, taskIds: [] })).toEqual({ history: [{ role: 'user', content: 'original public constraint' }, { role: 'assistant', content: 'public answer' }], audit: { threadId: c.id, taskIds: ['task_user'], loadedTaskIds: ['task_user'], skipped: [] } });
  const continuation = { ...snapshot, taskId: 'task_continuation', sessionId: 'session_continuation', prompt: 'GOAL_CONTINUATION_WRAPPER', events: [{ type: 'result', result: { summary: 'continuation output', artifacts: [] } }] } as TaskSnapshot;
  await runtime.bindPrepared({ prompt: continuation.prompt, context: continuation.context } as never, continuation.taskId, async () => continuation, { prompt: 'SYNTHETIC_USER_FORBIDDEN', includeUser: false }); runtime.registerGuardedSnapshot(continuation); runtime.capture(continuation, { physicallySettled: true });
  const history = runtime.assembleOwnedHistory('next', { threadId: c.id })!;
  expect(history.history.at(-1)).toEqual({ role: 'assistant', content: 'continuation output' });
  expect(JSON.stringify(history)).not.toMatch(/WRAPPER|SYNTHETIC_USER/);
  expect(() => runtime.assembleOwnedHistory('next', { threadId: c.id, taskIds: ['task_foreign'] })).toThrow('not_readable');
});
it('catches up a bound durable source after restart without executing or recovering the task owner', async () => {
  const p = runtime.port(); const c = p.service.createConversation(p.actor, { operationId: 'new' });
  const prepared = { taskId: 'task_test', sessionId: 'session_test', prompt: 'original', status: 'prepared', events: [], context: { threadId: c.id } } as unknown as TaskSnapshot;
  await runtime.bindPrepared({ prompt: 'original', context: { threadId: c.id } } as never, 'task_test', async () => prepared);
  const id = p.service.listMessages(p.actor, c.id)[0].messageId;
  await runtime.close();
  const inspect = vi.fn(async () => ({ ...prepared, status: 'completed', events: [{ type: 'result', result: { summary: 'durable answer', artifacts: [] } }, { type: 'task_terminal', status: 'completed' }] }) as TaskSnapshot);
  runtime = new DesktopContextContinuity(root, inspect);
  await runtime.reconcile();
  const next = runtime.port(); const messages = next.service.listMessages(next.actor, c.id);
  expect(inspect).toHaveBeenCalledWith('task_test');
  expect(messages.map(m => m.text)).toEqual(['original', 'durable answer']);
  expect(messages[0].messageId).toBe(id);
  expect(messages.every(m => m.executionState === 'unknown')).toBe(true); // crash cannot invent a physical receipt
});
it('isolates projection failure, records retry state and clears it after read-only reconciliation', async () => {
  const p = runtime.port(); const c = p.service.createConversation(p.actor, { operationId: 'new' });
  const snapshot = { taskId: 'task_test', sessionId: 'session_test', prompt: 'original', status: 'running', events: [], context: { threadId: c.id } } as unknown as TaskSnapshot;
  await runtime.bindPrepared({ prompt: 'original', context: { threadId: c.id } } as never, 'task_test', async () => snapshot);
  const record = vi.spyOn(p.service, 'recordMessage').mockImplementationOnce(() => { throw new Error('temporary failure'); });
  expect(() => runtime.capture(snapshot)).not.toThrow();
  expect(p.service.store.db.prepare('SELECT task_id FROM projection_failures').get()?.task_id).toBe('task_test');
  record.mockRestore();
  await runtime.reconcile(async () => snapshot);
  expect(p.service.store.db.prepare('SELECT task_id FROM projection_failures').get()).toBeUndefined();
});

it('quarantines a corrupt optional store without preventing the rest of Desktop startup or replacing the data', async () => {
  await runtime.close(); writeFileSync(join(root, 'continuity.sqlite'), 'corrupt canary');
  expect(() => { runtime = new DesktopContextContinuity(root); }).not.toThrow();
  expect(() => runtime.port()).toThrow('continuity_unavailable');
});

it('never creates a replacement profile identity for an existing continuity database', async () => {
  runtime.port(); await runtime.close(); rmSync(join(root, 'continuity-profile.json'));
  runtime = new DesktopContextContinuity(root);
  expect(() => runtime.port()).toThrow('continuity_unavailable');
  expect(existsSync(join(root, 'continuity-profile.json'))).toBe(false);
});
