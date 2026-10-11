// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';

describe('native durable observation run producer', () => {
  const stores: DesktopMultiAgentStore[] = [], roots: string[] = [];
  afterEach(() => { for (const store of stores) store.close(); for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 5 }); stores.length = 0; roots.length = 0; });
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-agent-run-')); roots.push(root);
    const file = join(root, 'native.sqlite'); const store = new DesktopMultiAgentStore(file, { bootId: 'boot' }); stores.push(store);
    store.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const group = store.createGroup('thread');
    return { store, file, groupId: group.groupId };
  }
  it('does not finalize after root confirmation while an accepted member is still queued', () => {
    const { store, groupId } = fixture();
    store.createActivityRun({ runId: 'root:task', groupId, kind: 'root', originId: 'task', rootTaskId: 'task' });
    store.putActivityMember({ groupId, runId: 'root:task', memberId: 'root', operationId: 'root', agentId: `root_${groupId}`, state: 'settled', physicalSettled: true, outcome: 'completed' });
    store.putActivityMember({ groupId, runId: 'root:task', memberId: 'queued', operationId: 'queued', agentId: 'child', state: 'accepted', physicalSettled: false });
    store.confirmActivityRootTerminal('root:task', { taskId: 'task', sessionId: 'session', eventIndex: 4, outcome: 'completed' });
    expect(store.finalizeActivityRun('root:task')?.state).toBe('accepted');
    store.putActivityMember({ groupId, runId: 'root:task', memberId: 'queued', operationId: 'queued', agentId: 'child', state: 'settled', physicalSettled: true, outcome: 'completed' });
    const first = store.finalizeActivityRun('root:task')!;
    expect(first.state).toBe('completed'); expect(first.terminalEventId).toBeTruthy();
    expect(store.finalizeActivityRun('root:task')?.terminalEventId).toBe(first.terminalEventId);
  });
  it('preserves per-run history and applies outcome priority independently of arrival order', () => {
    const { store, groupId, file } = fixture();
    store.createActivityRun({ runId: 'user:one', groupId, kind: 'user_followup', originId: 'op-one' });
    for (const [memberId, outcome] of [['one','cancelled'],['two','failed']] as const) store.putActivityMember({ groupId, runId: 'user:one', memberId, agentId: 'child', operationId: memberId, state: 'settled', physicalSettled: true, outcome });
    expect(store.finalizeActivityRun('user:one')?.state).toBe('failed');
    const eventId = store.getActivityRun('user:one')?.terminalEventId;
    store.createActivityRun({ runId: 'user:two', groupId, kind: 'user_followup', originId: 'op-two' });
    store.putActivityMember({ groupId, runId: 'user:two', memberId: 'three', agentId: 'child', operationId: 'three', state: 'running', physicalSettled: false });
    store.close();
    const reopened = new DesktopMultiAgentStore(file, { bootId: 'next' }); stores.push(reopened);
    expect(reopened.getActivityRun('user:one')?.terminalEventId).toBe(eventId);
    expect(reopened.getActivityMembers('user:one')).toHaveLength(2);
    expect(reopened.finalizeActivityRun('user:two')?.state).toBe('running');
  });
});
