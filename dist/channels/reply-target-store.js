import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export class FileReplyTargetStore {
    filePath;
    entries = new Map();
    constructor(filePath) {
        this.filePath = filePath;
        this.load();
    }
    set(sessionId, replyTarget) {
        this.entries.set(sessionId, {
            replyTarget,
            updatedAt: Date.now(),
        });
        this.persist();
    }
    get(sessionId) {
        return this.entries.get(sessionId)?.replyTarget;
    }
    delete(sessionId) {
        if (this.entries.delete(sessionId)) {
            this.persist();
        }
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
            for (const entry of parsed.entries) {
                if (entry?.sessionId && entry.replyTarget) {
                    this.entries.set(entry.sessionId, {
                        replyTarget: entry.replyTarget,
                        updatedAt: entry.updatedAt ?? Date.now(),
                    });
                }
            }
        }
        catch {
            return;
        }
    }
    persist() {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const doc = {
            schemaVersion: 1,
            entries: [...this.entries.entries()].map(([sessionId, entry]) => ({
                sessionId,
                replyTarget: entry.replyTarget,
                updatedAt: entry.updatedAt,
            })),
        };
        writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
}
