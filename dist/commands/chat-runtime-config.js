/**
 * CLI runtime config helpers shared by chat command.
 *
 * Extracted from chat.ts so they can be unit-tested without booting the full
 * chat module (which has heavy startup side-effects).
 */
export const DEFAULT_AGENT_MAX_ITERATIONS = 100;
export const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000;
export const DEFAULT_TURN_TIMEOUT_MS = 4 * 60_000;
export function resolveAgentMaxIterations(env = process.env) {
    const raw = env.XIAOK_AGENT_MAX_ITERATIONS;
    if (!raw)
        return DEFAULT_AGENT_MAX_ITERATIONS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_AGENT_MAX_ITERATIONS;
    }
    return Math.floor(parsed);
}
/**
 * Wall-clock timeout for a single non-interactive (`--print` / `--auto`) turn.
 *
 * Returns null when the user explicitly disables the deadline by setting
 * XIAOK_TURN_TIMEOUT_MS to "0" or a negative value. Non-numeric input falls
 * back to the default so a typo doesn't accidentally remove the safety net.
 */
export function resolveTurnTimeoutMs(env = process.env) {
    const raw = env.XIAOK_TURN_TIMEOUT_MS;
    if (raw === undefined || raw === '')
        return DEFAULT_TURN_TIMEOUT_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed))
        return DEFAULT_TURN_TIMEOUT_MS;
    if (parsed <= 0)
        return null;
    return Math.floor(parsed);
}
/**
 * Run cleanup steps sequentially with an overall timeout. If a step hangs,
 * the whole call resolves once timeoutMs elapses; remaining steps are skipped.
 * Step errors are swallowed via the provided onError sink (defaults to noop)
 * to mirror the original chat.ts cleanup behavior.
 */
export async function runCleanupWithTimeout(steps, timeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS, onError = () => { }) {
    let timer = null;
    try {
        await Promise.race([
            (async () => {
                for (const step of steps) {
                    try {
                        await step();
                    }
                    catch (error) {
                        onError(error);
                    }
                }
            })(),
            new Promise((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
