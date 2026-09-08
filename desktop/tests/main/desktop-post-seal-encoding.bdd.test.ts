// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DesktopMultiAgentStore, encodeMultiAgentRow } from '../../electron/desktop-multi-agent-store.js';

describe('R4 actual canonical encoder/control-event conservative bounds', () => {
  const uuid = '00000000-0000-4000-8000-000000000000';
  const bytes = (value: unknown) => Buffer.byteLength(encodeMultiAgentRow(value));
  const source = { sourceTaskId: `task_${uuid}`, groupId: uuid, rootTurnId: uuid, rootEpoch: Number.MAX_SAFE_INTEGER, preparationId: uuid, bootId: uuid };
  // Fieldwise conservative shape from the approved sizing probe. This is NOT
  // a valid state transition or a padding extension admitted by the protocol.
  const record = { version: 1, revision: Number.MAX_SAFE_INTEGER, status: 'checking', stage: 'snapshot', verification: 'pending',
    hostSettlement: 'committed', readerCleanup: 'pending', storeCleanup: 'pending',
    startedAt: 999999999999999900000, deadlineAt: 999999999999999900000, decisionAt: 999999999999999900000, finishedAt: 999999999999999900000,
    hostTerminalStatus: 'completed', guardFailure: { code: 'artifact_evidence_failed', stage: 'snapshot', needsExplicitFollowup: true } };
  it.each([[200, 3610], [256, 3946]])('D13 thread %i UTF-16 units has full binding record-cap bound %i bytes', (count, expected) => {
    const base = { ...source, threadId: '\0'.repeat(count), phase: 'preparing', status: 'interrupted' };
    const fieldOverhead = bytes({ ...base, delivery: null }) - bytes(base) - bytes(null);
    expect(bytes(base) + fieldOverhead + 2048).toBe(expected);
    expect(expected).toBeLessThan(4096);
    expect(bytes(record)).toBe(456);
  });
  it('D9/D13 real SQLite event envelope remains 2689B at the entire 2048B record allowance', () => {
    const store = new DesktopMultiAgentStore(':memory:');
    try {
      store.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: process.cwd() });
      const group = store.createGroup('thread'); const bound = { ...source, groupId: group.groupId };
      const actual = store.appendEvent(group.groupId, { kind: 'delivery' as never, agentId: `root_${group.groupId}`, turnId: uuid,
        payload: { source: bound, delivery: record } });
      const envelope = { ...actual, seq: Number.MAX_SAFE_INTEGER, timestamp: 999999999999999900000 };
      expect(bytes(envelope) - bytes(record) + 2048).toBe(2689);
      expect(bytes({ source: bound, delivery: record }) - bytes(record) + 2048).toBe(2364);
      expect(store.readEvents(group.groupId)).toEqual([actual]);
    } finally { store.close(); }
  });
});
