import type { Command } from 'commander';
/** Explicit host command, never an agent tool or project-discovered action. */
export declare function deleteObservationSession(input: {
    requestSource: 'user' | 'agent' | 'scheduler';
    sessionId: string;
}): Promise<{
    sessionId: string;
    referenceReconciliation: "pending" | "complete";
}>;
export declare function registerObservationCommands(program: Command): void;
