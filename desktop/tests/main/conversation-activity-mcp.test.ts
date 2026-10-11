// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ConversationActivityService } from '../../../src/runtime/conversation-activity/service.js';
import { ConversationMcpActivities } from '../../../src/runtime/conversation-activity/mcp.js';
import type { McpClientConnection } from '../../../src/platform/mcp/transport.js';

describe('MCP durable conversation origin and recovery', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const stop of cleanup.splice(0).reverse()) stop(); });
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-mcp-activity-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const store = new ConversationActivityStore(join(root, 'activity.sqlite')); cleanup.push(() => store.close());
    let mcp!: ConversationMcpActivities;
    const service = new ConversationActivityService({ store, profileId: 'profile', actorId: 'user',
      getThread: threadId => ({ threadId, profileId: 'profile', workspaceId: 'workspace', deleteState: 'none' }), canObserveWork: watch => mcp.canObserve(watch) });
    cleanup.push(() => service.dispose());
    mcp = new ConversationMcpActivities({ store, service, actorId: 'user', originThread: async taskId => taskId === 'authorized-task' ? 'origin' : null });
    cleanup.push(() => mcp.dispose());
    const raw = { taskId: 'remote-task', status: 'completed', createdAt: '2026-10-09T00:00:00Z', lastUpdatedAt: '2026-10-09T00:00:01Z', ttlMs: 1000,
      result: { resultType: 'complete', content: [], isError: true } };
    const update = vi.fn(async () => {}), cancel = vi.fn(async () => {});
    const connection = { client: {}, tasks: { endpointId: 'server-one', capabilities: { execution: true }, cancelTask: cancel, task: () => ({ updateJson: update, snapshot: async () => ({ ...raw, raw, retentionMs: 1000, ttl: 1000, extensions: {} }) }) } } as unknown as McpClientConnection;
    mcp.register(connection);
    return { store, service, mcp, connection, raw, update, cancel };
  }
  const reference = { endpointId: 'server-one', generation: 'v2' as const, taskId: 'remote-task', originalOperation: 'tools/call' as const };
  it('persists the handle with the original conversation and deduplicates notification/query outcomes without equating isError with success', async () => {
    const f = fixture();
    expect(await f.mcp.observer('foreign-task', 'other', f.connection)).toBeUndefined();
    const observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference);
    for (let i = 0; i < 10; i++) await observer.event(reference, { type: 'task', task: {} as never });
    expect(f.store.getMcpReference('mcp:invocation')).toEqual(reference);
    expect(f.store.getWatch('mcp:invocation')?.origin.threadId).toBe('origin');
    expect(f.store.getProjection('mcp:invocation')).toMatchObject({ executionState: 'completed', businessOutcome: 'error' });
    expect(f.store.getDiagnostics().sourceEvents).toBe(1);
  });
  it('rolls back binding when a reference belongs to a different endpoint', async () => {
    const f = fixture();
    await f.service.prepareAssociation({ threadId: 'origin', operationId: 'operation', creationIdempotencyKey: 'operation' }, { requestSource: 'user', actorId: 'user' });
    await expect(f.service.bindWork({ operationId: 'operation', watchId: 'watch', source: 'mcp', logicalSourceId: 'server-one', sourceDataEpoch: 'epoch', workId: 'remote-task' }, { ...reference, endpointId: 'server-two' })).rejects.toThrow('invalid_activity_mcp_reference');
    expect(f.store.getWatch('watch')).toBeNull();
  });
  it('fences a late old connection response and refuses a stopped watch', async () => {
    const f = fixture(), observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference);
    await f.service.stopWatch('mcp:invocation', 0, { requestSource: 'user', actorId: 'user' });
    await observer.event(reference, { type: 'task', task: {} as never });
    expect(f.store.getDiagnostics().sourceEvents).toBe(0);
    expect(f.store.getProjection('mcp:invocation')?.executionState).toBe('accepted');
  });
  it('requires the current actor and exact pending-input fingerprint before responding', async () => {
    const f = fixture(), observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference);
    Object.assign(f.raw, { status: 'input_required', inputRequests: { question: { method: 'elicitation/create', params: { message: '选择格式', mode: 'form', requestedSchema: {
      type: 'object', properties: { format: { type: 'string', enum: ['html', 'pdf'] } }, required: ['format'],
    } } } } });
    const actor = { requestSource: 'user' as const, actorId: 'user' };
    const [form] = await f.mcp.inputs('mcp:invocation', actor);
    expect(form.fields[0]).toMatchObject({ key: 'format', type: 'choice', options: ['html', 'pdf'] });
    await expect(f.mcp.answerInput('mcp:invocation', { inputId: 'question', expectedDigest: 'stale', action: 'accept', content: { format: 'html' } }, actor)).rejects.toThrow('activity_mcp_input_stale');
    await expect(f.mcp.answerInput('mcp:invocation', { inputId: 'question', expectedDigest: form.expectedDigest, action: 'accept', content: { format: 'exe' } }, actor)).rejects.toThrow('activity_mcp_input_invalid');
    await expect(f.mcp.answerInput('mcp:invocation', { inputId: 'question', expectedDigest: form.expectedDigest, action: 'accept', content: { format: 'html' } }, { requestSource: 'agent', actorId: 'user' })).rejects.toThrow('activity_actor_forbidden');
    expect(f.update).not.toHaveBeenCalled();
    await f.mcp.answerInput('mcp:invocation', { inputId: 'question', expectedDigest: form.expectedDigest, action: 'accept', content: { format: 'html' } }, actor);
    expect(f.update).toHaveBeenCalledWith({ question: { action: 'accept', content: { format: 'html' } } });
  });
  it('returns a cancel request receipt while source status is still working', async () => {
    const f = fixture(), observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference); Object.assign(f.raw, { status: 'working', result: undefined });
    await expect(f.mcp.cancel('mcp:invocation', { requestSource: 'user', actorId: 'user' })).resolves.toEqual({ requested: true });
    expect(f.store.getProjection('mcp:invocation')?.executionState).toBe('running');
    expect(f.cancel).toHaveBeenCalledOnce();
  });
});
