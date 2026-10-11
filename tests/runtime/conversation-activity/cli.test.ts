import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliConversationActivities } from '../../../src/runtime/conversation-activity/cli.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';

describe('CLI activity presentation boundaries', () => {
  const owners: CliConversationActivities[] = [], roots: string[] = [];
  afterEach(() => { for (const owner of owners) owner.dispose(); for (const root of roots) rmSync(root, { recursive: true, force: true }); owners.length = 0; roots.length = 0; });
  function fixture(root = mkdtempSync(join(tmpdir(), 'xiaok-cli-activity-'))) {
    if (!roots.includes(root)) roots.push(root);
    const connection = { client: {}, tasks: { endpointId: 'endpoint', capabilities: { execution: false }, task: () => ({ snapshot: async () => ({ status: 'completed', taskId: 'task', raw: { taskId: 'task', status: 'completed' }, extensions: {} }) }) } };
    const platform = { setMcpActivityHooks: (hooks: any) => hooks.connected(connection) } as PlatformRuntimeContext;
    const owner = new CliConversationActivities({ cwd: root, sessionId: 'session', platform, changed: () => {} }); owners.push(owner);
    return { root, owner };
  }
  async function complete(owner: CliConversationActivities) {
    await owner.service.prepareAssociation({ threadId: 'session', operationId: 'operation', creationIdempotencyKey: 'operation' }, { requestSource: 'user', actorId: 'cli-user' });
    await owner.service.bindWork({ operationId: 'operation', watchId: 'watch', source: 'mcp', logicalSourceId: 'endpoint', sourceDataEpoch: 'epoch', workId: 'task' },
      { endpointId: 'endpoint', generation: 'v2', taskId: 'task', originalOperation: 'tools/call' });
    await owner.service.acceptEvent('watch', { schemaVersion: 1, eventId: 'done', source: 'mcp', logicalSourceId: 'endpoint', sourceDataEpoch: 'epoch', workId: 'task', runId: '',
      transportGeneration: 0, kind: 'completed', receivedAt: Date.now(), evidenceRefs: [], summary: '报告完成\x1b[2J\x1b]52;c;clipboard\x07' });
    await vi.waitFor(() => expect(owner.hasPending).toBe(true));
  }
  it('queues while busy/modal and paints only at an idle boundary, stripping terminal controls', async () => {
    const { owner } = fixture(); await complete(owner);
    const write = vi.fn(); owner.flush(false, write); expect(write).not.toHaveBeenCalled();
    owner.flush(true, write); expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toContain('报告完成'); expect(write.mock.calls[0][0]).not.toMatch(/[\x1b\x07]/);
    expect(await owner.service.unreadThreads({ requestSource: 'user', actorId: 'cli-user' })).toHaveLength(1);
    owner.flush(true, write); expect(write).toHaveBeenCalledOnce();
  });
  it('resumes its presentation cursor without repeating a painted notice or invoking the tool again', async () => {
    const first = fixture(); await complete(first.owner); first.owner.flush(true, () => {}); first.owner.dispose();
    const reopened = fixture(first.root); await reopened.owner.refresh();
    const write = vi.fn(); reopened.owner.flush(true, write); expect(write).not.toHaveBeenCalled();
    expect(reopened.owner.store.getMcpReference('watch')?.taskId).toBe('task');
  });
});
