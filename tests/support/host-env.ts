/**
 * Tests must not depend on the host environment.
 *
 * A developer shell (or CI runner) that exports KIMI_API_KEY / GLM_API_KEY / ...
 * changes real product behaviour: `login` reuses an environment key and skips
 * the hidden key prompt, provider resolution finds a key that the test never
 * configured, and so on. The resulting failures are order dependent and can
 * leak into later tests (see PR body of the isolation PR for the N1 incident).
 *
 * This module is the single definition of "host variables a test must never
 * inherit". It is used by `setup-host-env.ts` (every vitest config), by the
 * canary test and by `scripts/check-test-env-isolation.mjs` (CI).
 */

/** Provider env prefixes read by src/ai/providers/registry.ts (`envPrefixes`). A test asserts this stays in sync. */
export const PROVIDER_ENV_PREFIXES = ['OPENAI', 'ANTHROPIC', 'CLAUDE', 'KIMI', 'DEEPSEEK', 'GLM', 'MINIMAX', 'GEMINI'] as const;

/** Variables other than `*_API_KEY` that change provider resolution. */
const PROVIDER_SUFFIXES = ['AUTH_TOKEN', 'BASE_URL'] as const;

/** Any `*_API_KEY` (provider keys, XIAOK_<PROVIDER>_API_KEY, search/tool keys) plus <PROVIDER>_{AUTH_TOKEN,BASE_URL}. */
export function isHostLeakVariable(name: string): boolean {
  if (/_API_KEY$/.test(name)) return true;
  return PROVIDER_ENV_PREFIXES.some(prefix => PROVIDER_SUFFIXES.some(suffix => name === `${prefix}_${suffix}` || name === `XIAOK_${prefix}_${suffix}`));
}

/** Names (not values) of leaking variables currently in `env`. */
export function findHostLeaks(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env).filter(name => env[name] !== undefined && isHostLeakVariable(name)).sort();
}

/** Delete leaking variables from `env`; returns the removed names (never the values). */
export function stripHostLeaks(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed = findHostLeaks(env);
  for (const name of removed) delete env[name];
  return removed;
}
