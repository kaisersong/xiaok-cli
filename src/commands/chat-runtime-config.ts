/**
 * CLI runtime config helpers shared by chat command.
 *
 * Extracted from chat.ts so they can be unit-tested without booting the full
 * chat module (which has heavy startup side-effects).
 */

export const DEFAULT_AGENT_MAX_ITERATIONS = 100;
export const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000;

export function resolveAgentMaxIterations(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.XIAOK_AGENT_MAX_ITERATIONS;
  if (!raw) return DEFAULT_AGENT_MAX_ITERATIONS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AGENT_MAX_ITERATIONS;
  }
  return Math.floor(parsed);
}

export type CleanupStep = () => void | Promise<void>;

/**
 * Run cleanup steps sequentially with an overall timeout. If a step hangs,
 * the whole call resolves once timeoutMs elapses; remaining steps are skipped.
 * Step errors are swallowed via the provided onError sink (defaults to noop)
 * to mirror the original chat.ts cleanup behavior.
 */
export async function runCleanupWithTimeout(
  steps: ReadonlyArray<CleanupStep>,
  timeoutMs: number = DEFAULT_CLEANUP_TIMEOUT_MS,
  onError: (error: unknown) => void = () => {},
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      (async () => {
        for (const step of steps) {
          try {
            await step();
          } catch (error) {
            onError(error);
          }
        }
      })(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
