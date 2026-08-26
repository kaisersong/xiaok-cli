import { type GoalInput, type GoalState } from '../runtime/goal/index.js';
export type GoalSlashCommand = {
    kind: 'help';
} | {
    kind: 'status';
} | {
    kind: 'pause';
} | {
    kind: 'resume';
    turnLimit?: number;
} | {
    kind: 'cancel';
} | {
    kind: 'create';
    objective: string;
} | {
    kind: 'replace';
    objective: string;
} | {
    kind: 'invalid';
    message: string;
};
export declare function parseGoalSlashCommand(input: string): GoalSlashCommand | null;
export declare function inferGoalInput(objective: string): GoalInput;
export declare function isUnsupportedSingleShotGoalInput(input: string): boolean;
export declare function formatGoalPreview(input: GoalInput, replacing?: boolean): string;
export declare function formatGoalStatus(goal: GoalState): string;
export declare function formatGoalSummaryLine(goal: GoalState | null): string;
export declare function buildGoalContinuationInput(goal: GoalState): {
    systemTrigger: 'goal_continuation';
    prompt: string;
};
export declare const GOAL_COMMAND_HELP: string;
