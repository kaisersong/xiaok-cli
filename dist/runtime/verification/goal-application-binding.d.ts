export declare const GOAL_APPLICATION_EVIDENCE_KINDS: readonly ["answer", "file_artifact", "command_action", "project_update"];
export interface GoalApplicationBinding {
    version: 1;
    kind: 'goal';
    sessionId: string;
    goalId: string;
    epoch: number;
    objective: string;
    completionCriterion: string | null;
    expectedEvidenceKinds: readonly (typeof GOAL_APPLICATION_EVIDENCE_KINDS)[number][];
}
/** Pure immutable business value. This parser never issues native or projection authority. */
export declare function parseGoalApplicationBinding(raw: unknown): Readonly<GoalApplicationBinding>;
export declare function goalApplicationBindingHash(raw: unknown): string;
export interface ActiveGoalApplicationBinding {
    binding: Readonly<GoalApplicationBinding>;
    bindingHash: string;
    revision: number;
}
export declare function parseActiveGoalApplicationBinding(raw: unknown): Readonly<ActiveGoalApplicationBinding>;
/** Current controller observation; never a native approval or local store write capability. */
export interface GoalApplicationObservation {
    state: 'unbound' | 'pending' | 'active';
    current: Readonly<ActiveGoalApplicationBinding> | null;
    pendingTransitionId: string | null;
}
