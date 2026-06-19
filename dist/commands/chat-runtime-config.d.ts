/**
 * CLI runtime config helpers shared by chat command.
 *
 * Extracted from chat.ts so they can be unit-tested without booting the full
 * chat module (which has heavy startup side-effects).
 */
export declare const DEFAULT_AGENT_MAX_ITERATIONS = 100;
export declare const DEFAULT_CLEANUP_TIMEOUT_MS = 2000;
export declare function resolveAgentMaxIterations(env?: NodeJS.ProcessEnv): number;
export type CleanupStep = () => void | Promise<void>;
/**
 * Run cleanup steps sequentially with an overall timeout. If a step hangs,
 * the whole call resolves once timeoutMs elapses; remaining steps are skipped.
 * Step errors are swallowed via the provided onError sink (defaults to noop)
 * to mirror the original chat.ts cleanup behavior.
 */
export declare function runCleanupWithTimeout(steps: ReadonlyArray<CleanupStep>, timeoutMs?: number, onError?: (error: unknown) => void): Promise<void>;
