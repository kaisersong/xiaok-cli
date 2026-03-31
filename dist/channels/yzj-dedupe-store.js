import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
export class FileYZJInboundDedupeStore extends YZJInboundDedupeStore {
    filePath;
    constructor(filePath, ttlMs = 5 * 60_000) {
        super(ttlMs);
        this.filePath = filePath;
        this.load();
    }
    markSeen(messageId) {
        const accepted = super.markSeen(messageId);
        this.persist();
        return accepted;
    }
    load() {
        if (!existsSync(this.filePath)) {
            return;
        }
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
                return;
            }
            const now = Date.now();
            for (const entry of parsed.entries) {
                if (entry?.messageId && typeof entry.expiresAt === 'number' && entry.expiresAt > now) {
                    this.seen.set(entry.messageId, entry.expiresAt);
                }
            }
            this.persist();
        }
        catch {
            return;
        }
    }
    persist() {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const now = Date.now();
        const entries = [...this.seen.entries()]
            .filter(([, expiresAt]) => expiresAt > now)
            .map(([messageId, expiresAt]) => ({ messageId, expiresAt }));
        const doc = {
            schemaVersion: 1,
            entries,
        };
        writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
}
