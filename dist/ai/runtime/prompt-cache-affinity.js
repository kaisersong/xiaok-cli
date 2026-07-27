import { createHash } from 'node:crypto';
const CLI_CACHE_AFFINITY_DOMAIN = 'xiaok:kimi-prompt-cache:cli:v1\0';
const DESKTOP_CACHE_AFFINITY_DOMAIN = 'xiaok:kimi-prompt-cache:desktop:v1\0';
const CLI_SESSION_ID = /^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DESKTOP_SESSION_ID = /^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DESKTOP_INVOCATION_ID = /^inv_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function createPromptCacheAffinity(sessionId) {
    if (!CLI_SESSION_ID.test(sessionId)) {
        return undefined;
    }
    return `pc1_${createHash('sha256')
        .update(`${CLI_CACHE_AFFINITY_DOMAIN}${sessionId}`)
        .digest('hex')}`;
}
export function createDesktopPromptCacheAffinity(sessionId, invocationId) {
    if (!DESKTOP_SESSION_ID.test(sessionId)
        || !DESKTOP_INVOCATION_ID.test(invocationId)) {
        return undefined;
    }
    return `pc1_${createHash('sha256')
        .update(`${DESKTOP_CACHE_AFFINITY_DOMAIN}${sessionId}\0${invocationId}`)
        .digest('hex')}`;
}
