/**
 * New ledger IDs only; existing source/store identities must remain unchanged.
 * ASCII-only allow-list: control chars (NUL/CR/TAB/DEL), zero-width, bidi controls
 * and homoglyphs all fall outside it. Max length 128.
 */
export declare function isValidExternalId(value: unknown): value is string;
/**
 * Fail closed: invalid input is rejected (null), never converted into an alias.
 * Never serializes the input, so malicious toJSON/getters are not invoked.
 */
export declare function parseExternalId(value: unknown): string | null;
/** Hash the exact UTF-8 path; no platform-dependent path normalization. */
export declare function hashWorkspaceId(path: string): string;
