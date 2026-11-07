/** Shared by schema, direct/interactive bash and the isolated consumer. Never clamp approved input. */
export const BASH_TIMEOUT_MAX = 2_147_483_647;
export const BASH_OUTPUT_MIN = 1024;
export const BASH_OUTPUT_MAX = 1_048_576;
export function validateBashLimits(timeout: unknown, maxChars: unknown): string | undefined {
  if (!Number.isInteger(timeout) || (timeout as number) < 1 || (timeout as number) > BASH_TIMEOUT_MAX)
    return `Error: timeout_ms must be an integer in 1..${BASH_TIMEOUT_MAX}`;
  if (!Number.isInteger(maxChars) || (maxChars as number) < BASH_OUTPUT_MIN || (maxChars as number) > BASH_OUTPUT_MAX)
    return `Error: max_chars must be an integer in ${BASH_OUTPUT_MIN}..${BASH_OUTPUT_MAX}`;
}
