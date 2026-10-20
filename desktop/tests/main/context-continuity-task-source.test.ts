// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { TaskContinuitySource } from '../../electron/context-continuity/task-source.js';
import type { TaskSnapshot } from '../../shared/task-types.js';
import { digest } from '../../electron/context-continuity/store.js';
const actor = { requestSource: 'user' as const, profileId: 'a', actorId: 'desktop-user:a' };
let root: string, service: ContinuityService;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'task-continuity-')); service = new ContinuityService({ dbPath: join(root, 'store.sqlite'), profileId: 'a' }); });
afterEach(() => { service.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
function snapshot(threadId: string, events: unknown[], status = 'completed'): TaskSnapshot {
  return { taskId: 'task_test', sessionId: 'session_test', prompt: 'wire wrapper', status, events, context: { threadId }, createdAt: 1, updatedAt: 2, materials: [] } as TaskSnapshot;
}
describe('main-owned task source bindings and append-only cursors (A11/R01)', () => {
  it('does not derive ownership from a snapshot context echo', () => {
    const c = service.createConversation(actor, { operationId: 'new' });
    const source = new TaskContinuitySource(service, actor);
    expect(source.capture(snapshot(c.id, []))).toBe(false);
    expect(service.listMessages(actor, c.id)).toEqual([]);
  });
  it('uses accepted original text rather than the provider transport wrapper', async () => {
    const c = service.createConversation(actor, { operationId: 'new' }); const source = new TaskContinuitySource(service, actor);
    await source.bindPrepared({ conversationId: c.id, taskId: 'task_test', publicPrompt: 'original input' }, vi.fn().mockResolvedValue(snapshot(c.id, [], 'running')));
    expect(service.listMessages(actor, c.id).map(m => m.text)).toEqual(['original input']);
    source.capture(snapshot(c.id, [{ type: 'assistant_delta', delta: 'answer' }, { type: 'result', result: { summary: 'answer', artifacts: [] } }]));
    expect(service.listMessages(actor, c.id).map(m => m.text)).toEqual(['original input', 'answer']);
  });
  it('shares one anchor path for live capture and repeated older snapshots/backfill', async () => {
    const c = service.createConversation(actor, { operationId: 'new' }); const source = new TaskContinuitySource(service, actor);
    const old = snapshot(c.id, [{ type: 'assistant_delta', delta: 'answer' }], 'running');
    await source.bindPrepared({ conversationId: c.id, taskId: 'task_test', publicPrompt: 'original' }, async () => old);
    const completed = snapshot(c.id, [...old.events, { type: 'result', result: { summary: 'answer', artifacts: [] } }]);
    source.capture(completed); const before = service.listMessages(actor, c.id);
    source.capture(old); source.capture(completed);
    expect(service.listMessages(actor, c.id)).toEqual(before);
    expect(before.every(m => m.executionState === 'unknown')).toBe(true);
  });
  it('rejects rewrites of committed source events without changing the prior projection', async () => {
    const c = service.createConversation(actor, { operationId: 'new' }); const source = new TaskContinuitySource(service, actor);
    const first = snapshot(c.id, [{ type: 'assistant_delta', delta: 'first' }, { type: 'result', result: { summary: 'first', artifacts: [] } }]);
    await source.bindPrepared({ conversationId: c.id, taskId: 'task_test', publicPrompt: 'original' }, async () => first);
    expect(() => source.capture(snapshot(c.id, [{ type: 'assistant_delta', delta: 'rewritten' }, first.events[1]]))).toThrow('blocked_reconciliation');
    expect(service.listMessages(actor, c.id).map(m => m.text)).toEqual(['original', 'first']);
  });
  it('preserves tombstones while advancing the rest of an authoritative source', async () => {
    const c = service.createConversation(actor, { operationId: 'new' }); const source = new TaskContinuitySource(service, actor);
    await source.bindPrepared({ conversationId: c.id, taskId: 'task_test', publicPrompt: 'original' }, async () => snapshot(c.id, [], 'running'));
    service.deleteMessage(actor, { conversationId: c.id, messageId: service.listMessages(actor, c.id)[0].messageId });
    const final = snapshot(c.id, [{ type: 'result', result: { summary: 'actual result', artifacts: [] } }, { type: 'task_terminal', status: 'completed' }]);
    expect(() => source.capture(final, { physicallySettled: true })).not.toThrow();
    // Capture must advance without resurrection; outputs of this contaminated task stay unreadable.
    expect(service.listMessages(actor, c.id)).toEqual([]);
    expect(service.store.db.prepare('SELECT source_message_id,deleted FROM message_anchors ORDER BY sequence').all()).toEqual([
      { source_message_id: 'user', deleted: 1 }, { source_message_id: 'assistant:event:0', deleted: 0 },
    ]);
    source.capture(final);
    expect(service.listMessages(actor, c.id)).toEqual([]);
    expect(service.store.db.prepare('SELECT event_count FROM source_cursors').get()?.event_count).toBe(2);
  });
  it('requires the owner physical settlement receipt, not logical cancellation or a terminal string', async () => {
    const c = service.createConversation(actor, { operationId: 'new' }); const source = new TaskContinuitySource(service, actor);
    await source.bindPrepared({ conversationId: c.id, taskId: 'task_test', publicPrompt: 'original' }, async () => snapshot(c.id, [], 'running'));
    const cancelled = snapshot(c.id, [{ type: 'task_cancelled', reason: 'cancelled' }], 'cancelled');
    source.capture(cancelled);
    expect(service.listMessages(actor, c.id)[0].executionState).toBe('unknown');
    expect(() => source.capture(snapshot(c.id, [], 'running'), { physicallySettled: true })).toThrow('settlement_receipt_missing');
    const final = snapshot(c.id, [...cancelled.events, { type: 'task_terminal', status: 'cancelled' }], 'cancelled');
    source.capture(final, { physicallySettled: true });
    expect(service.listMessages(actor, c.id)[0].executionState).toBe('settled');
    source.capture(final);
    expect(service.listMessages(actor, c.id)[0].executionState).toBe('settled');
  });
  it('never extends a physical proof to public messages appended after its watermark', async () => {
    const c = service.createConversation(actor, { operationId: 'new' }); const source = new TaskContinuitySource(service, actor);
    const first = snapshot(c.id, [{ type: 'result', result: { summary: 'first', artifacts: [] } }]);
    await source.bindPrepared({ conversationId: c.id, taskId: 'task_test', publicPrompt: 'original' }, async () => first);
    source.capture(first, { physicallySettled: true });
    source.capture(snapshot(c.id, [...first.events, { type: 'result', result: { summary: 'later', artifacts: [] } }]));
    expect(service.listMessages(actor, c.id).map(m => [m.text, m.executionState])).toEqual([['original', 'settled'], ['first', 'settled'], ['later', 'unknown']]);
  });
  it('records real continuation results without adding a synthetic user prompt', async () => {
    const c = service.createConversation(actor, { operationId: 'new' }); const source = new TaskContinuitySource(service, actor);
    await source.bindPrepared({ conversationId: c.id, taskId: 'task_test', publicPrompt: 'objective', includeUser: false },
      async () => snapshot(c.id, [{ type: 'result', result: { summary: 'actual result', artifacts: [] } }]));
    expect(service.listMessages(actor, c.id).map(m => [m.role, m.text])).toEqual([['assistant', 'actual result']]);
  });
  it('requires the exact owner epoch and prefix hash for a bounded receipt', async () => {
    const c = service.createConversation(actor, { operationId: 'new' }); const source = new TaskContinuitySource(service, actor);
    const first = snapshot(c.id, [{ type: 'result', result: { summary: 'first', artifacts: [] } }]);
    await source.bindPrepared({ conversationId: c.id, taskId: 'task_test', publicPrompt: 'original' }, async () => first);
    const later = snapshot(c.id, [...first.events, { type: 'result', result: { summary: 'later', artifacts: [] } }]);
    const receipt = { physicallySettled: true, sourceEpoch: first.sessionId, eventCount: 1, prefixHash: digest(first.events) };
    expect(() => source.capture(later, { ...receipt, sourceEpoch: 'other' })).toThrow('settlement_receipt_missing');
    expect(() => source.capture(later, { ...receipt, prefixHash: digest([]) })).toThrow('settlement_receipt_missing');
    expect(() => source.capture(later, { ...receipt, eventCount: 3 })).toThrow('settlement_receipt_missing');
    source.capture(later, receipt);
    expect(service.listMessages(actor, c.id).map(m => [m.text, m.executionState])).toEqual([['original', 'settled'], ['first', 'settled'], ['later', 'unknown']]);
  });
});
