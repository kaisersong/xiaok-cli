import type { TaskSnapshot } from './types.js';
/** Durable snapshots contain execution history, never cached verification authority. */
export declare function withoutTaskCompletionObservation(snapshot: TaskSnapshot): TaskSnapshot;
export declare function observeTaskSnapshotCompletion(snapshot: TaskSnapshot, taskId: string, signal?: AbortSignal): Promise<TaskSnapshot>;
export declare function observeTaskSnapshotCompletionSync(snapshot: TaskSnapshot, taskId: string): TaskSnapshot;
