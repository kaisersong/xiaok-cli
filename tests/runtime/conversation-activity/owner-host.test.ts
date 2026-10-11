import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationActivityOwnerHost } from '../../../src/runtime/conversation-activity/owner-host.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';

describe('real authenticated owner socket and single writer', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
  async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'activity-host-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const options = { dataRoot: root, profileId: 'profile', actorId: 'user', getThread: (threadId: string) => threadId === 'thread' ? { threadId, profileId: 'profile', workspaceId: 'workspace', deleteState: 'none' as const } : null,
      canObserveWork: () => true, authorizeProducer: (threadId: string) => threadId === 'thread' };
    const host = new ConversationActivityOwnerHost(options); await host.start(); cleanup.push(() => host.stop());
    const producer = new ConversationActivityOwnerClient(root, 'producer'), user = new ConversationActivityOwnerClient(root, 'user');
    cleanup.push(() => producer.dispose(), () => user.dispose());
    return { root, options, host, producer, user };
  }
  it('rejects another writer without unlinking the live socket and attaches two read clients to one activity', async () => {
    const f = await fixture();
    expect(() => new ConversationActivityOwnerHost(f.options)).toThrow('conversation_activity_owner_held');
    expect(existsSync(f.host.address.socketPath)).toBe(true);
    await f.producer.request('prepare', { threadId: 'thread', operationId: 'op', creationIdempotencyKey: 'op' });
    await f.producer.request('bind', { operationId: 'op', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task' });
    await expect(f.user.request('ingest', { watchId: 'watch', event: {} })).rejects.toThrow('activity_method_forbidden');
    await f.producer.request('ingest', { watchId: 'watch', event: { schemaVersion: 1, eventId: 'done', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '', sourceSequence: 1, transportGeneration: 0, kind: 'completed', receivedAt: Date.now(), evidenceRefs: [] } });
    const one = await f.user.request<any[]>('list', { threadId: 'thread' });
    const second = new ConversationActivityOwnerClient(f.root, 'user'); cleanup.push(() => second.dispose());
    expect(await second.request('list', { threadId: 'thread' })).toEqual(one);
    expect(one.filter(row => row.kind === 'completed')).toHaveLength(1);
    f.user.dispose(); expect(await second.request('status')).toMatchObject({ ownerEpoch: f.host.ownerEpoch });
  });
  it('rejects cross-thread producer association before allocating any intent', async () => {
    const f = await fixture();
    await expect(f.producer.request('prepare', { threadId: 'foreign', operationId: 'foreign', creationIdempotencyKey: 'foreign' })).rejects.toThrow('activity_producer_forbidden');
    expect(f.host.store.getAssociation('foreign')).toBeNull();
  });
});
