import type { DatabaseSync } from 'node:sqlite';
export type DependencyTable = 'effect_history_dependencies' | 'task_history_dependencies' | 'context_dependencies';
/** One evaluator for main's write owner and readonly consumers; no implicit storage mutation. */
export declare function assertContinuityTaskReadable(taskId: string, options: {
    db: Pick<DatabaseSync, 'prepare'>;
    scope(id: string): 'readable' | 'blocked' | 'deleted';
    syncSource?(id: string): void;
    invalidate?(table: DependencyTable, taskId: string, sourceId: string): void;
}): void;
