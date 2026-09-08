import type { RuntimeActivity } from '../runtime/events.js';
/** Public execution facts only. This is not a resource/lifecycle authority. */
export interface SubAgentProgressEvent {
    kind: 'started' | 'activity' | 'finished';
    agentId: string;
    taskName: string;
    task: string;
    turn: number;
    timestamp: number;
    startedAt: number;
    elapsedMs: number;
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    phase?: RuntimeActivity['phase'];
    currentTool?: string;
    toolsCompleted: number;
    toolsFailed: number;
    toolCounts: Record<string, number>;
    resultSummary?: string;
}
export declare function publicAgentSummary(value: string, limit?: number): string;
export declare class SubAgentRunReporter {
    private readonly taskName;
    private readonly observer?;
    private readonly id;
    private turn;
    private current?;
    constructor(taskName: string, id: string | undefined, observer?: ((event: SubAgentProgressEvent) => void) | undefined);
    start(task: string): void;
    activity(activity: RuntimeActivity): void;
    toolFinished(name: string, ok: boolean): void;
    finish(status: Exclude<SubAgentProgressEvent['status'], 'running'>, result?: string): void;
    private emit;
}
