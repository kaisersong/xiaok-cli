export interface ActiveRun {
    runId: string;
    signal: AbortSignal;
}
export declare class AgentRunController {
    private active;
    startRun(): ActiveRun;
    hasActiveRun(): boolean;
    abortActiveRun(): boolean;
    completeRun(runId: string): void;
}
