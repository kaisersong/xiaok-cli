import type { MultiAgentControlResult, MultiAgentThreadDeletionSnapshot } from '../shared/multi-agent-types.js';

const states = new Set(['applied', 'queued_next_admission', 'cleanup_pending', 'completed', 'unknown']);
const errors = new Set(['unknown_target', 'stale_expected_turn', 'target_closed', 'agent_not_resumable',
  'multi_agent_followup_queue_full', 'multi_agent_followup_user_barrier', 'approval_invalidated',
  'permission_revoked', 'grant_not_applied', 'multi_agent_control_failed']);

/** Negative control remains available without disclosing durable debug/errors. */
export function projectMultiAgentControl(value: unknown): MultiAgentControlResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid multi-agent control receipt');
  const row = value as Record<string, unknown>;
  if (typeof row.operationId !== 'string' || typeof row.state !== 'string' || !states.has(row.state)) throw new Error('invalid multi-agent control receipt');
  const result: Record<string, unknown> = { operationId: row.operationId, state: row.state };
  for (const key of ['targetAgentId', 'messageId', 'groupId']) {
    if (row[key] !== undefined) {
      if (typeof row[key] !== 'string') throw new Error('invalid multi-agent control receipt');
      result[key] = row[key];
    }
  }
  if (row.expectedTurn !== undefined) {
    if (!Number.isSafeInteger(row.expectedTurn) || (row.expectedTurn as number) < 0) throw new Error('invalid multi-agent control receipt');
    result.expectedTurn = row.expectedTurn;
  }
  for (const key of ['resourcesReleased', 'cleanupPending']) {
    if (row[key] !== undefined) {
      if (typeof row[key] !== 'boolean') throw new Error('invalid multi-agent control receipt');
      result[key] = row[key];
    }
  }
  if (row.outcome !== undefined) {
    if (row.outcome !== 'cancelled' && row.outcome !== 'rejected') throw new Error('invalid multi-agent control receipt');
    result.outcome = row.outcome;
  }
  if (row.error !== undefined) result.error = errors.has(row.error as string) ? row.error : 'multi_agent_control_failed';
  return result as unknown as MultiAgentControlResult;
}

export function projectMultiAgentDeletion(value: unknown): MultiAgentThreadDeletionSnapshot {
  const row = value as MultiAgentThreadDeletionSnapshot;
  if (!row || typeof row.threadId !== 'string' || !Number.isSafeInteger(row.threadRevision)
    || !['none', 'delete_pending', 'deleted'].includes(row.deleteState)) throw new Error('invalid multi-agent deletion receipt');
  return { threadId: row.threadId, threadRevision: row.threadRevision, deleteState: row.deleteState,
    operation: row.operation === null ? null : projectMultiAgentControl(row.operation) };
}
