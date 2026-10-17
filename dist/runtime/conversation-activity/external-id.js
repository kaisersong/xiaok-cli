import { createHash } from 'node:crypto';
/**
 * New ledger IDs only; existing source/store identities must remain unchanged.
 * ASCII-only allow-list: control chars (NUL/CR/TAB/DEL), zero-width, bidi controls
 * and homoglyphs all fall outside it. Max length 128.
 */
export function isValidExternalId(value) {
    return typeof value === 'string' && value.length <= 128
        && /^[A-Za-z0-9][A-Za-z0-9._:#-]{0,127}$/.test(value)
        && !value.includes('..');
}
/**
 * Fail closed: invalid input is rejected (null), never converted into an alias.
 * Never serializes the input, so malicious toJSON/getters are not invoked.
 */
export function parseExternalId(value) {
    return isValidExternalId(value) ? value : null;
}
/** Hash the exact UTF-8 path; no platform-dependent path normalization. */
export function hashWorkspaceId(path) {
    return createHash('sha256').update(path).digest('hex');
}
