import type { TaskExecutionScope, TaskMultiAgentPreparation, TaskContextAudit } from './types.js';
import type { ProtectedObservationClosure } from '../../ai/runtime/protected-observation-closure.js';
export interface CapturedTaskReference {
    namespace: string;
    relation: string;
    id: string;
    scopePath?: string;
    executionScope?: TaskExecutionScope;
}
/** Pure fixed-schema aggregation; never reads a path or issues ownership. */
export declare function createCapturedTaskDeclarationAccumulator(): {
    capture(value: unknown, path: string): void;
    finish(taskId: string, sessionIdentities: readonly string[]): Readonly<{
        kind: "captured-task-declarations";
        taskId: string;
        sessionIdentities: string[];
        references: CapturedTaskReference[];
        contexts: TaskContextAudit[];
        executionScopes: TaskExecutionScope[];
        executionScopeDeclarations: {
            path: string;
            scope: TaskExecutionScope;
        }[];
        multiAgentPreparations: TaskMultiAgentPreparation[];
        protectedObservationClosures: ProtectedObservationClosure[];
    }>;
};
