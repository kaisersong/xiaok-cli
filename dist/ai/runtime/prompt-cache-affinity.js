import { createHash } from 'node:crypto';
const CACHE_AFFINITY_DOMAIN = 'xiaok:kimi-prompt-cache:v1\0';
const CACHEABLE_SESSION_ID = /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createPromptCacheAffinity(sessionId) {
    if (!CACHEABLE_SESSION_ID.test(sessionId)) {
        return undefined;
    }
    return `pc1_${createHash('sha256')
        .update(`${CACHE_AFFINITY_DOMAIN}${sessionId}`)
        .digest('hex')}`;
}
