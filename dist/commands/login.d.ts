/**
 * `xiaok login` — first-run friendly provider credential setup.
 *
 * Modeled after `opencode auth login` (pick provider → password-style key
 * entry → verify → persist) and `kimi-code`'s login command shape, but for
 * xiaok's API-key providers (xiaok has no first-party OAuth today; the
 * existing `xiaok auth` group covers the Yunzhijia enterprise channel and
 * stays untouched).
 *
 * Flow:
 *   1. pick a first-party provider from the capability registry
 *   2. show where to create a key + any env vars already detected on this
 *      machine (reuse without retyping)
 *   3. hidden-input API key entry (never echoed, never logged)
 *   4. optional live verification via the read-only model-list probe used
 *      by `xiaok doctor --check-keys` (only when the user opts in)
 *   5. persist to `providers.<id>.apiKey` in ~/.xiaok/config.json
 *   6. offer to switch the default model to that provider's default
 *
 * Non-interactive flags cover scripting:
 *   xiaok login --provider deepseek --api-key sk-... --set-default
 */
import type { Command } from 'commander';
interface LoginOptions {
    provider?: string;
    apiKey?: string;
    setDefault?: boolean;
    skipVerify?: boolean;
}
export declare function runLoginCommand(options: LoginOptions): Promise<void>;
export declare function registerLoginCommand(program: Command): void;
export {};
