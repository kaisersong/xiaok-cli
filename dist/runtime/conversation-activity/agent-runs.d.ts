export type AgentRunOutcome = 'completed' | 'failed' | 'cancelled';
export interface AgentActivityRun {
    runId: string;
    groupId: string;
    threadId: string;
    bootId: string;
    kind: 'root' | 'user_followup';
    originId: string;
    rootTaskId?: string;
    state: 'accepted' | 'running' | 'unknown' | AgentRunOutcome;
    acceptedAt: number;
    startSequence: number;
    terminalEventId?: string;
    sourceUnavailable?: string;
    rootTerminal?: {
        taskId: string;
        sessionId: string;
        eventIndex: number;
        outcome: AgentRunOutcome;
    };
}
export interface AgentActivityMember {
    memberId: string;
    runId: string;
    groupId: string;
    agentId: string;
    operationId: string;
    turnId?: string;
    state: 'accepted' | 'running' | 'settled' | 'unknown';
    physicalSettled: boolean;
    outcome?: AgentRunOutcome;
}
/** Execution outcome only; business/project acceptance remains with its owner. */
export declare function agentRunState(run: AgentActivityRun, members: AgentActivityMember[]): AgentActivityRun['state'];
