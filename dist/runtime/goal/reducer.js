import { randomUUID } from 'node:crypto';
import { DEFAULT_GOAL_TURN_LIMIT, MAX_GOAL_TURN_LIMIT, } from './types.js';
export function createGoalState(input) {
    const normalized = normalizeInput(input);
    return {
        goalId: input.goalId ?? `goal_${randomUUID()}`,
        revision: 1,
        epoch: 1,
        sessionId: input.sessionId,
        forkedFromGoalId: input.forkedFromGoalId,
        objective: normalized.objective,
        completionCriterion: normalized.completionCriterion,
        expectedEvidenceKinds: normalized.expectedEvidenceKinds,
        status: 'active',
        turnsUsed: 0,
        tokensUsed: 0,
        activeWallClockMs: 0,
        budgetLimits: { turnLimit: normalized.turnLimit },
        consecutiveBlockedTurns: 0,
        createdAt: input.now,
        updatedAt: input.now,
    };
}
export function reduceGoal(state, action) {
    switch (action.type) {
        case 'pause':
            assertStatus(state, ['active'], 'pause');
            return mutate(state, action.now, { status: 'paused', terminalReason: action.reason });
        case 'resume':
            assertStatus(state, ['paused', 'blocked'], 'resume');
            if (state.status === 'blocked' && state.terminalReason === 'turn_budget_exhausted') {
                if (action.turnLimit === undefined) {
                    throw new Error('A larger turn limit is required to resume a budget-blocked Goal');
                }
                validateTurnLimit(action.turnLimit);
                if (action.turnLimit <= state.budgetLimits.turnLimit || action.turnLimit <= state.turnsUsed) {
                    throw new Error('Goal resume turn limit must be larger than the previous limit and turns used');
                }
            }
            else if (action.turnLimit !== undefined) {
                validateTurnLimit(action.turnLimit);
                if (action.turnLimit < state.turnsUsed) {
                    throw new Error('Goal resume turn limit cannot be lower than turns used');
                }
            }
            return mutate(state, action.now, {
                status: 'active', terminalReason: undefined, blockerFingerprint: undefined,
                consecutiveBlockedTurns: 0,
                budgetLimits: action.turnLimit === undefined
                    ? state.budgetLimits
                    : { ...state.budgetLimits, turnLimit: action.turnLimit },
            });
        case 'cancel':
            assertStatus(state, ['active', 'paused', 'blocked'], 'cancel');
            return mutate(state, action.now, { status: 'cancelled', terminalReason: action.reason });
        case 'complete':
            assertStatus(state, ['active'], 'complete');
            return mutate(state, action.now, { status: 'complete', terminalReason: action.reason });
        case 'block': {
            assertStatus(state, ['active'], 'block');
            const consecutive = action.fingerprint && action.fingerprint === state.blockerFingerprint
                ? state.consecutiveBlockedTurns + 1
                : 1;
            return mutate(state, action.now, {
                status: 'blocked', terminalReason: action.reason,
                blockerFingerprint: action.fingerprint,
                consecutiveBlockedTurns: consecutive,
            });
        }
        case 'note_blocker': {
            assertStatus(state, ['active'], 'note blocker');
            const consecutive = action.fingerprint === state.blockerFingerprint
                ? state.consecutiveBlockedTurns + 1
                : 1;
            const blocked = consecutive >= (action.threshold ?? 3);
            return mutate(state, action.now, {
                status: blocked ? 'blocked' : 'active',
                terminalReason: blocked ? action.reason : undefined,
                blockerFingerprint: action.fingerprint,
                consecutiveBlockedTurns: consecutive,
            });
        }
        case 'replace': {
            assertStatus(state, ['active', 'paused', 'blocked', 'complete', 'cancelled'], 'replace');
            const input = normalizeInput(action);
            return {
                ...state,
                revision: state.revision + 1,
                epoch: state.epoch + 1,
                objective: input.objective,
                completionCriterion: input.completionCriterion,
                expectedEvidenceKinds: input.expectedEvidenceKinds,
                budgetLimits: { turnLimit: input.turnLimit },
                status: 'active',
                turnsUsed: 0,
                tokensUsed: 0,
                activeWallClockMs: 0,
                terminalReason: undefined,
                blockerFingerprint: undefined,
                consecutiveBlockedTurns: 0,
                updatedAt: action.now,
            };
        }
        case 'record_turn': {
            assertStatus(state, ['active'], 'record turn');
            const turnsUsed = state.turnsUsed + 1;
            const budgetReached = turnsUsed >= state.budgetLimits.turnLimit;
            return mutate(state, action.now, {
                turnsUsed,
                tokensUsed: state.tokensUsed + nonNegative(action.tokensUsed, 'tokensUsed'),
                activeWallClockMs: state.activeWallClockMs
                    + nonNegative(action.activeWallClockMs, 'activeWallClockMs'),
                status: budgetReached ? 'blocked' : state.status,
                terminalReason: budgetReached ? 'turn_budget_exhausted' : state.terminalReason,
            });
        }
        case 'settle_turn': {
            assertStatus(state, ['active'], 'settle turn');
            const turnsUsed = state.turnsUsed + 1;
            const tokensUsed = state.tokensUsed + nonNegative(action.tokensUsed, 'tokensUsed');
            const activeWallClockMs = state.activeWallClockMs
                + nonNegative(action.activeWallClockMs, 'activeWallClockMs');
            if (action.terminalDecision.kind === 'complete') {
                return mutate(state, action.now, {
                    turnsUsed, tokensUsed, activeWallClockMs,
                    status: 'complete', terminalReason: action.terminalDecision.reason,
                });
            }
            if (action.terminalDecision.kind === 'blocked') {
                return mutate(state, action.now, {
                    turnsUsed, tokensUsed, activeWallClockMs,
                    status: 'blocked', terminalReason: action.terminalDecision.reason,
                    blockerFingerprint: action.terminalDecision.fingerprint,
                });
            }
            const budgetReached = turnsUsed >= state.budgetLimits.turnLimit;
            if (action.terminalDecision.kind === 'blocker') {
                const consecutive = action.terminalDecision.fingerprint === state.blockerFingerprint
                    ? state.consecutiveBlockedTurns + 1
                    : 1;
                const blocked = consecutive >= (action.terminalDecision.threshold ?? 3);
                return mutate(state, action.now, {
                    turnsUsed, tokensUsed, activeWallClockMs,
                    status: blocked || budgetReached ? 'blocked' : 'active',
                    terminalReason: blocked
                        ? action.terminalDecision.reason
                        : budgetReached ? 'turn_budget_exhausted' : undefined,
                    blockerFingerprint: action.terminalDecision.fingerprint,
                    consecutiveBlockedTurns: consecutive,
                });
            }
            if (budgetReached) {
                return mutate(state, action.now, {
                    turnsUsed, tokensUsed, activeWallClockMs,
                    status: 'blocked', terminalReason: 'turn_budget_exhausted',
                });
            }
            if (action.terminalDecision.kind === 'paused') {
                return mutate(state, action.now, {
                    turnsUsed, tokensUsed, activeWallClockMs,
                    status: 'paused', terminalReason: action.terminalDecision.reason,
                });
            }
            return mutate(state, action.now, {
                turnsUsed, tokensUsed, activeWallClockMs,
                status: 'active', terminalReason: undefined,
            });
        }
    }
}
function normalizeInput(input) {
    const objective = input.objective.trim();
    if (!objective || objective.length > 4_000) {
        throw new Error('Goal objective must contain 1..4000 characters');
    }
    const completionCriterion = input.completionCriterion?.trim() || undefined;
    if (completionCriterion && completionCriterion.length > 4_000) {
        throw new Error('Goal completion criterion must be at most 4000 characters');
    }
    const expectedEvidenceKinds = [...new Set(input.expectedEvidenceKinds)];
    if (expectedEvidenceKinds.length === 0) {
        throw new Error('Goal requires at least one expected evidence kind');
    }
    const turnLimit = input.turnLimit ?? DEFAULT_GOAL_TURN_LIMIT;
    validateTurnLimit(turnLimit);
    return { objective, completionCriterion, expectedEvidenceKinds, turnLimit };
}
function validateTurnLimit(turnLimit) {
    if (!Number.isSafeInteger(turnLimit) || turnLimit < 1 || turnLimit > MAX_GOAL_TURN_LIMIT) {
        throw new Error(`Goal turn limit must be an integer between 1 and ${MAX_GOAL_TURN_LIMIT}`);
    }
}
function assertStatus(state, allowed, action) {
    if (!allowed.includes(state.status)) {
        throw new Error(`Cannot ${action} goal while status is ${state.status}`);
    }
}
function mutate(state, now, patch) {
    return { ...state, ...patch, revision: state.revision + 1, updatedAt: now };
}
function nonNegative(value, label) {
    if (!Number.isFinite(value) || value < 0)
        throw new Error(`${label} must be non-negative`);
    return value;
}
