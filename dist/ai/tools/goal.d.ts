import type { Tool, ToolExecutionContext } from '../../types.js';
export interface GoalToolHost {
    getGoal(context?: ToolExecutionContext): Promise<unknown> | unknown;
    requestComplete(summary: string, context?: ToolExecutionContext): Promise<{
        accepted: boolean;
        reason?: string;
    }>;
    requestBlocked(input: {
        reason: string;
        fingerprint: string;
    }, context?: ToolExecutionContext): Promise<{
        accepted: boolean;
        reason?: string;
    }>;
}
export declare function createGoalTools(host: GoalToolHost): Tool[];
