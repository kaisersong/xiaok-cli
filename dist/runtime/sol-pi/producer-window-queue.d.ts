/** Scheduling primitive only. This queue issues no execution, publication or
 * quiescence authority. Product adapters must authenticate actual owners and
 * keep work pending until their real publication/transport obligations finish. */
export interface ProducerQueueScope {
    readonly opaqueProducerQueueScope: never;
}
export interface ProducerQueueWindow {
    readonly drained: Promise<void>;
    handoff<T>(work: (scope: ProducerQueueScope) => Promise<T>): Promise<T>;
    release(): void;
    cancel(error: unknown): void;
    fail(error: unknown): void;
}
export declare function createProducerWindowQueue(): Readonly<{
    run: <T>(work: (scope: ProducerQueueScope) => Promise<T>, signal?: AbortSignal) => Promise<T>;
    fail: (error: unknown) => void;
    /** Transfer scheduling ownership to an authenticated publication adapter.
     * This primitive's completion method itself is not a physical receipt. */
    transfer(token: ProducerQueueScope): Readonly<{
        run<T>(work: () => Promise<T>): Promise<T>;
        complete(): void;
        fail(error: unknown): void;
    }>;
    inherit<T>(token: ProducerQueueScope, work: (scope: ProducerQueueScope) => Promise<T>): Promise<T>;
    closeAdmission(): ProducerQueueWindow;
}>;
