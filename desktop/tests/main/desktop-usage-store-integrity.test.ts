// @vitest-environment node
import { expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';

function fixture() {
  const store = new DesktopMultiAgentStore(':memory:');
  store.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: process.cwd() });
  const group = store.createGroup('thread'), agentId = `root_${group.groupId}`;
  return { store, group, agentId, db: Reflect.get(store, 'db') as DatabaseSync };
}
function caught(action: () => unknown): { error: unknown } {
  try { action(); } catch (error) { return { error }; }
  throw Error('expected original integrity rejection');
}
it('validated identities preserve ordinary usage facts and the original native connection can close', () => {
  const f = fixture();
  try {
    const actual = f.store.readUsageIdentity(f.group.groupId, f.agentId, 'thread');
    expect(actual.group).toEqual(f.store.requireGroup(f.group.groupId));
    expect(actual.agent).toEqual(f.store.getAgent(f.group.groupId, f.agentId));
    expect(f.store.hasUsageIdentityFailure()).toBe(false);
    f.store.putAgent(f.group.groupId, { ...actual.agent, usage: { inputTokens: 1, outputTokens: 2 } });
    expect(f.store.readUsageIdentity(f.group.groupId, f.agentId, 'thread').agent.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  } finally { f.store.close(); expect(f.db.isOpen).toBe(false); }
});
it('an actual identity mismatch stays sticky through swallowed nested callbacks and rolls back all earlier writes', () => {
  const f = fixture(), id = f.group.groupId;
  const put = (operationId: string) => ({ groupId: id, operationId, command: 'usage', requestHash: operationId,
    applyState: 'applied' as const, result: { state: 'completed' } });
  let failure: { error: unknown } | undefined;
  try {
    const original = f.db.prepare('SELECT data_json FROM agents WHERE group_id=? AND agent_id=?').get(id, f.agentId) as { data_json: string };
    const outer = caught(() => f.store.transaction(port => {
      port.putOperation(put('before'));
      const nested = caught(() => port.transaction(inner => {
        inner.putOperation(put('nested-before'));
        f.db.prepare('UPDATE agents SET created_at=created_at+1 WHERE group_id=? AND agent_id=?').run(id, f.agentId);
        failure = caught(() => f.store.readUsageIdentity(id, f.agentId, 'thread'));
        expect(caught(() => inner.putOperation(put('nested-after'))).error).toBe(failure.error);
        // Return normally after swallowing the original identity error.
      }));
      expect(nested.error).toBe(failure!.error);
      expect(caught(() => port.putGroup({ ...f.group, mutationBlockedReason: 'control' }, true)).error).toBe(failure!.error);
      // Swallow nested rejection too. The original outer COMMIT must reject.
    }));
    expect(failure).toBeDefined(); expect(outer.error).toBe(failure!.error);
    expect(f.store.hasUsageIdentityFailure()).toBe(true);
    expect(f.db.prepare('SELECT operation_id FROM operations WHERE group_id=?').all(id)).toEqual([]);
    expect(f.db.prepare('SELECT data_json FROM agents WHERE group_id=? AND agent_id=?').get(id, f.agentId)).toEqual(original);
    expect(caught(() => f.store.putOperation(put('after-rollback'))).error).toBe(failure!.error);
    expect(caught(() => f.store.readUsageGroupIdentity(id, 'thread')).error).toBe(failure!.error);
    // Ordinary readers remain available for evidence after rollback/quarantine.
    expect(f.store.getAgent(id, f.agentId)?.id).toBe(f.agentId);
  } finally { f.store.close(); expect(f.db.isOpen).toBe(false); }
});
