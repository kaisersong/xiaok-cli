import type { DesktopGoalMutationResult, DesktopGoalProjection, DesktopGoalTaskPrepared } from '../../electron/preload-api';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types';

export const taskA = 'U11-A';
export const taskB = 'U11-B';
export const installationFailure = 'U11_local_subscription_installation_failed';

// Fixed dependency data, not a replacement implementation of service/host.
// The real main population and original attachment timeout have separate M1–M5.
export function prepared(threadId: string, requestId: string | null = null): DesktopGoalTaskPrepared {
  return { attachmentId: 'U11-attachment-B', threadId, taskId: taskB, expiresAt: Date.now() + 60_000,
    attachmentSource: { kind: 'request', requestId },
    goalRef: { goalId: 'U11-goal', revision: 1 }, executionScope: { kind: 'goal_turn', origin: 'user',
      threadId, goalId: 'U11-goal', epoch: 1, goalTurnId: 'U11-goal-turn' } };
}
export function goal(threadId: string): DesktopGoalProjection {
  return { activation: 'disarmed', state: { goalId: 'U11-goal', sessionId: threadId, revision: 1, epoch: 1,
    objective: 'U11 new goal', expectedEvidenceKinds: ['answer'], status: 'active', turnsUsed: 0, tokensUsed: 0,
    activeWallClockMs: 0, budgetLimits: { turnLimit: 2 }, consecutiveBlockedTurns: 0, createdAt: 1, updatedAt: 1 } };
}
export function mutation(threadId: string, requestId: string): DesktopGoalMutationResult {
  return { goal: goal(threadId), preparedTask: prepared(threadId, requestId) };
}
export function snapshot(threadId: string, taskId: string, attached: boolean): TaskSnapshot {
  return { taskId, sessionId: threadId, status: taskId === taskA || attached ? 'running' : 'understanding',
    prompt: taskId === taskA ? 'U11 saved A prompt' : 'U11 saved B prepared prompt', materials: [],
    events: taskId === taskA ? [{ type: 'result', result: { summary: 'U11 saved A answer', artifacts: [] } }] : [],
    createdAt: 1, updatedAt: 1,
    multiAgentPreparation: { groupId: 'U11-group', rootEpoch: 1, rootTurnId: `U11-root-${taskId}`,
      preparationId: `U11-preparation-${taskId}`, bootId: 'U11-boot' },
    ...(taskId === taskA ? { hostDelivery: { version: 1, revision: 1, status: 'checking', stage: 'verify',
      verification: 'pending', hostSettlement: 'pending', readerCleanup: 'pending', storeCleanup: 'none',
      startedAt: 1, deadlineAt: 30_001 } as const } : { executionScope: prepared(threadId).executionScope }) };
}
