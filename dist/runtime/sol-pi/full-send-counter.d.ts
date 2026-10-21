import { type AtomicWriteFile } from '../../utils/atomic-file.js';
export interface FullSendAttempt {
    logicalInvocationId: string;
    serializedBody: string;
    observationIds: readonly string[];
}
export interface FullSendCounterPort {
    prepare(input: FullSendAttempt): void;
    confirm(input: FullSendAttempt): void;
    markUnknown(input: FullSendAttempt): void;
}
/** Void TypeScript callbacks can still return promises at runtime. Never await a
 * persistence hook: dispatch requires completion in this synchronous call. */
export declare function assertSynchronousFullSendResult(result: unknown): void;
/** HOST ONLY. registerNewObservation is called only from a new native capture,
 * never from restored references, model arguments, or a missing-count fallback. */
export declare function createFullSendCounter(options: {
    root: string;
    sessionId: string;
    atomicWrite?: AtomicWriteFile;
}): Readonly<FullSendCounterPort & {
    getStorageReservation(): Readonly<{
        root: string;
        sessionId: string;
        maximumBytes: number;
    }>;
    registerNewObservation(id: string): void;
    read(id: string): number | null;
    dispose(): void;
}>;
