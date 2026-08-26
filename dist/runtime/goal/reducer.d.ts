import { type GoalInput, type GoalState } from './types.js';
export type GoalAction = {
    type: 'pause';
    reason: string;
    now: number;
} | {
    type: 'resume';
    turnLimit?: number;
    now: number;
} | {
    type: 'cancel';
    reason: string;
    now: number;
} | {
    type: 'complete';
    reason: string;
    now: number;
} | {
    type: 'block';
    reason: string;
    fingerprint?: string;
    now: number;
} | {
    type: 'note_blocker';
    reason: string;
    fingerprint: string;
    threshold?: number;
    now: number;
} | ({
    type: 'replace';
    now: number;
} & GoalInput) | {
    type: 'record_turn';
    turnId: string;
    tokensUsed: number;
    activeWallClockMs: number;
    now: number;
} | {
    type: 'settle_turn';
    turnId: string;
    tokensUsed: number;
    activeWallClockMs: number;
    terminalDecision: {
        kind: 'none';
    } | {
        kind: 'complete';
        reason: string;
    } | {
        kind: 'blocked';
        reason: string;
        fingerprint?: string;
    } | {
        kind: 'blocker';
        reason: string;
        fingerprint: string;
        threshold?: number;
    } | {
        kind: 'paused';
        reason: string;
    };
    now: number;
};
export declare function createGoalState(input: GoalInput & {
    sessionId: string;
    now: number;
    goalId?: string;
    forkedFromGoalId?: string;
}): GoalState;
export declare function reduceGoal(state: GoalState, action: GoalAction): GoalState;
