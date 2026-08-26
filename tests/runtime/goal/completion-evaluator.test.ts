import { describe, expect, it } from 'vitest';
import {
  GoalCompletionEvaluator,
  createGoalState,
  type GoalEvidenceEnvelope,
} from '../../../src/runtime/goal/index.js';

function envelope(
  goalId: string,
  epoch: number,
  kind: GoalEvidenceEnvelope['record']['kind'],
  metadata: Record<string, unknown>,
): GoalEvidenceEnvelope {
  return {
    goalId, epoch, goalTurnId: 'turn_1', evidenceId: `ev_${kind}`, recordedAt: 1,
    record: { ownerKind: 'goal', ownerId: goalId, kind, summary: kind, metadata },
  };
}

describe('GoalCompletionEvaluator', () => {
  it('requires every frozen expected kind and current epoch evidence', () => {
    const goal = createGoalState({
      sessionId: 'sess_1', objective: 'change and test',
      expectedEvidenceKinds: ['file_artifact', 'command_action'], now: 1,
    });
    const evaluator = new GoalCompletionEvaluator();
    const command = envelope(goal.goalId, goal.epoch, 'command_action', {
      commands: [{ command: 'npm test', summary: 'ok', exitCode: 0 }],
    });
    expect(evaluator.evaluate(goal, [command]).ok).toBe(false);
    const file = envelope(goal.goalId, goal.epoch, 'file_artifact', {
      paths: ['/tmp/result.txt'],
    });
    expect(evaluator.evaluate(goal, [command, file]).ok).toBe(true);
    expect(evaluator.evaluate(goal, [{ ...file, epoch: goal.epoch - 1 }, command]).ok).toBe(false);
  });

  it('rejects non-zero command records even though the shared validator accepts their shape', () => {
    const goal = createGoalState({
      sessionId: 'sess_1', objective: 'test', expectedEvidenceKinds: ['command_action'], now: 1,
    });
    const failed = envelope(goal.goalId, goal.epoch, 'command_action', {
      commands: [{ command: 'npm test', summary: 'failed', exitCode: 1 }],
    });
    expect(new GoalCompletionEvaluator().evaluate(goal, [failed])).toMatchObject({
      ok: false,
      missingKinds: ['command_action'],
    });
  });

  it('does not allow answer evidence to replace file or command evidence', () => {
    const goal = createGoalState({
      sessionId: 'sess_1', objective: 'write file', expectedEvidenceKinds: ['file_artifact'], now: 1,
    });
    const answer = envelope(goal.goalId, goal.epoch, 'answer', { responseId: 'r1' });
    expect(new GoalCompletionEvaluator().evaluate(goal, [answer]).ok).toBe(false);
  });
});
