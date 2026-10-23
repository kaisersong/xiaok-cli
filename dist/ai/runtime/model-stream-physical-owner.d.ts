/** Fixed host lifetime. Counts original model promises, never outward races. */
export interface ModelReadReceipt {
    consume(): void;
    classifyFailure(error: unknown): void;
}
export interface ModelStreamPhysicalRun {
    observeRead<T>(raw: Promise<T>, knownReasons: () => readonly unknown[]): ModelReadReceipt;
    observeReturn<T>(raw: Promise<T>): void;
    noteReturnFailure(error: unknown): void;
    finish(): void;
}
export declare class ModelStreamPhysicalOwner {
    private readonly stopping;
    private sealed;
    private readonly claims;
    private readonly raw;
    private readonly failures;
    private readonly waiters;
    private closure;
    get signal(): AbortSignal;
    hasPending(): boolean;
    hasFailure(): boolean;
    admit(): ModelStreamPhysicalRun;
    stop(reason?: unknown): void;
    waitForStopped(): Promise<void>;
    waitForIdle(): Promise<void>;
    private track;
    private checkIdle;
}
