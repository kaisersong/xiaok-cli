import type { StreamChunk } from '../../types.js';
export interface ModelRecoveryPolicy {
    windowMs: number;
    idleMs: number;
    initialDelayMs: number;
    maxDelayMs: number;
}
export interface ModelRecoveryNotice {
    attempt: number;
    delayMs: number;
    remainingMs: number;
}
export declare function resolveModelRecoveryPolicy(env?: NodeJS.ProcessEnv): ModelRecoveryPolicy;
/** Retries only model reads. Callers never execute tools until a complete stream commits. */
export declare function recoverModelStream(input: {
    open(signal: AbortSignal): AsyncIterable<StreamChunk>;
    signal: AbortSignal;
    policy?: ModelRecoveryPolicy;
    onRetry?(notice: ModelRecoveryNotice): void;
}): AsyncIterable<StreamChunk>;
