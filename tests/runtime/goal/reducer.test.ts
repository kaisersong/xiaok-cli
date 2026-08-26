import { describe, expect, it } from 'vitest';
import {
  createGoalState,
  reduceGoal,
  type GoalState,
} from '../../../src/runtime/goal/index.js';

function createActiveGoal(): GoalState {
  return createGoalState({
    sessionId: 'sess_1',
    objective: '修复并验证测试',
    completionCriterion: 'npm test 退出码为 0',
    expectedEvidenceKinds: ['file_artifact', 'command_action'],
    turnLimit: 20,
    now: 100,
  });
}

describe('goal reducer', () => {
  it('creates a bounded active goal with an independent evidence epoch', () => {
    const goal = createActiveGoal();
    expect(goal.status).toBe('active');
    expect(goal.revision).toBe(1);
    expect(goal.epoch).toBe(1);
    expect(goal.budgetLimits.turnLimit).toBe(20);
    expect(goal.expectedEvidenceKinds).toEqual(['file_artifact', 'command_action']);
  });

  it('keeps epoch stable across pause/resume and increments it when objective changes', () => {
    const active = createActiveGoal();
    const paused = reduceGoal(active, { type: 'pause', reason: 'user', now: 110 });
    const resumed = reduceGoal(paused, { type: 'resume', now: 120 });
    const replaced = reduceGoal(resumed, {
      type: 'replace',
      objective: '新的目标',
      completionCriterion: '给出答案',
      expectedEvidenceKinds: ['answer'],
      turnLimit: 5,
      now: 130,
    });

    expect(paused.epoch).toBe(1);
    expect(resumed.epoch).toBe(1);
    expect(replaced.epoch).toBe(2);
    expect(replaced.revision).toBe(4);
  });

  it('rejects illegal transitions and host ceiling overflow', () => {
    const active = createActiveGoal();
    expect(() => reduceGoal(active, { type: 'resume', now: 110 })).toThrow(/active/i);
    expect(() => createGoalState({
      sessionId: 'sess_1',
      objective: 'x',
      expectedEvidenceKinds: ['answer'],
      turnLimit: 51,
      now: 100,
    })).toThrow(/50/);
  });

  it('counts admitted turns and blocks at the turn budget', () => {
    let goal = createActiveGoal();
    for (let index = 0; index < 20; index += 1) {
      goal = reduceGoal(goal, {
        type: 'record_turn',
        turnId: `turn_${index}`,
        tokensUsed: 10,
        activeWallClockMs: 5,
        now: 101 + index,
      });
    }
    expect(goal.turnsUsed).toBe(20);
    expect(goal.status).toBe('blocked');
    expect(goal.terminalReason).toBe('turn_budget_exhausted');
  });

  it('settles the last admitted turn once and lets verified completion beat budget exhaustion', () => {
    const nearlyExhausted = {
      ...createActiveGoal(),
      turnsUsed: 19,
      tokensUsed: 90,
      activeWallClockMs: 900,
    };

    const settled = reduceGoal(nearlyExhausted, {
      type: 'settle_turn',
      turnId: 'turn_20',
      tokensUsed: 10,
      activeWallClockMs: 100,
      terminalDecision: { kind: 'complete', reason: 'verified evidence' },
      now: 200,
    });

    expect(settled).toMatchObject({
      status: 'complete',
      terminalReason: 'verified evidence',
      turnsUsed: 20,
      tokensUsed: 100,
      activeWallClockMs: 1000,
      revision: nearlyExhausted.revision + 1,
    });
  });

  it('requires an explicit larger budget to resume a budget-blocked goal without resetting usage', () => {
    const blocked = reduceGoal({ ...createActiveGoal(), turnsUsed: 19 }, {
      type: 'settle_turn',
      turnId: 'turn_20',
      tokensUsed: 7,
      activeWallClockMs: 9,
      terminalDecision: { kind: 'none' },
      now: 200,
    });

    expect(() => reduceGoal(blocked, { type: 'resume', now: 210 })).toThrow(/turn limit/i);
    expect(() => reduceGoal(blocked, { type: 'resume', turnLimit: 20, now: 210 })).toThrow(/larger/i);
    expect(() => reduceGoal(blocked, { type: 'resume', turnLimit: 51, now: 210 })).toThrow(/50/i);

    const resumed = reduceGoal(blocked, { type: 'resume', turnLimit: 25, now: 210 });
    expect(resumed).toMatchObject({
      status: 'active',
      turnsUsed: 20,
      tokensUsed: 7,
      activeWallClockMs: 9,
      budgetLimits: { turnLimit: 25 },
    });
  });

  it('records repeated blocker claims atomically and blocks only at the threshold', () => {
    let state = createActiveGoal();
    for (let turn = 1; turn <= 2; turn += 1) {
      state = reduceGoal(state, {
        type: 'settle_turn', turnId: `turn_${turn}`, tokensUsed: 1,
        activeWallClockMs: 1, now: 200 + turn,
        terminalDecision: { kind: 'blocker', reason: 'same blocker', fingerprint: 'same' },
      });
      expect(state.status).toBe('active');
      expect(state.consecutiveBlockedTurns).toBe(turn);
    }
    state = reduceGoal(state, {
      type: 'settle_turn', turnId: 'turn_3', tokensUsed: 1,
      activeWallClockMs: 1, now: 203,
      terminalDecision: { kind: 'blocker', reason: 'same blocker', fingerprint: 'same' },
    });
    expect(state).toMatchObject({
      status: 'blocked', consecutiveBlockedTurns: 3,
      blockerFingerprint: 'same', terminalReason: 'same blocker', turnsUsed: 3,
    });
  });

  it('settles an abnormal runtime turn as paused without claiming a blocker', () => {
    const paused = reduceGoal(createActiveGoal(), {
      type: 'settle_turn', turnId: 'turn_1', tokensUsed: 2,
      activeWallClockMs: 3, now: 200,
      terminalDecision: { kind: 'paused', reason: 'runtime_error' },
    });
    expect(paused).toMatchObject({
      status: 'paused', terminalReason: 'runtime_error', turnsUsed: 1,
      consecutiveBlockedTurns: 0,
    });
  });

  it('blocks on the hard turn budget instead of leaving the final failed turn resumable', () => {
    const finalTurn = reduceGoal({ ...createActiveGoal(), turnsUsed: 19 }, {
      type: 'settle_turn', turnId: 'turn_20', tokensUsed: 2,
      activeWallClockMs: 3, now: 200,
      terminalDecision: { kind: 'paused', reason: 'runtime_error' },
    });
    expect(finalTurn).toMatchObject({
      status: 'blocked', terminalReason: 'turn_budget_exhausted', turnsUsed: 20,
    });
  });
});
