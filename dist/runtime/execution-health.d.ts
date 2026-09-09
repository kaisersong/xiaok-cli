/** Main-owned liveness; never treats cancellation as physical settlement. */
export type ExecutionHealthState = 'running' | 'waiting' | 'recovering' | 'cleanup_pending';
export declare function resolveExecutionIdleMs(raw: string | undefined, fallback?: number): number;
export declare function createExecutionHealthMonitor(options: {
    idleMs: number;
    onStalled(): void;
    onState?(state: ExecutionHealthState): void;
}): {
    progress(recovering?: boolean): void;
    delegate(id: string): void;
    wait(id: string): void;
    resume(id: string): void;
    cancel(): void;
    dispose(): void;
};
