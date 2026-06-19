/**
 * CLI runtime config helpers shared by chat command.
 *
 * Extracted from chat.ts so they can be unit-tested without booting the full
 * chat module (which has heavy startup side-effects).
 */
export declare const DEFAULT_AGENT_MAX_ITERATIONS = 100;
export declare const DEFAULT_CLEANUP_TIMEOUT_MS = 2000;
export declare const DEFAULT_TURN_TIMEOUT_MS: number;
export declare function resolveAgentMaxIterations(env?: NodeJS.ProcessEnv): number;
/**
 * Wall-clock timeout for a single non-interactive (`--print` / `--auto`) turn.
 *
 * Returns null when the user explicitly disables the deadline by setting
 * XIAOK_TURN_TIMEOUT_MS to "0" or a negative value. Non-numeric input falls
 * back to the default so a typo doesn't accidentally remove the safety net.
 */
export declare function resolveTurnTimeoutMs(env?: NodeJS.ProcessEnv): number | null;
export type CleanupStep = () => void | Promise<void>;
/**
 * Run cleanup steps sequentially with an overall timeout. If a step hangs,
 * the whole call resolves once timeoutMs elapses; remaining steps are skipped.
 * Step errors are swallowed via the provided onError sink (defaults to noop)
 * to mirror the original chat.ts cleanup behavior.
 */
export declare function runCleanupWithTimeout(steps: ReadonlyArray<CleanupStep>, timeoutMs?: number, onError?: (error: unknown) => void): Promise<void>;
