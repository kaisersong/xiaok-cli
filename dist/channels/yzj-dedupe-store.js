export class YZJInboundDedupeStore {
    ttlMs;
    seen = new Map();
    constructor(ttlMs = 5 * 60_000) {
        this.ttlMs = ttlMs;
    }
    markSeen(messageId) {
        const now = Date.now();
        this.sweep(now);
        if (this.seen.has(messageId)) {
            return false;
        }
        this.seen.set(messageId, now + this.ttlMs);
        return true;
    }
    sweep(now) {
        for (const [messageId, expiresAt] of this.seen) {
            if (expiresAt <= now) {
                this.seen.delete(messageId);
            }
        }
    }
}
