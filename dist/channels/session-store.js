import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export class InMemoryChannelSessionStore {
    sessions = new Map();
    nextId = 1;
    getOrCreate(key) {
        const storeKey = this.buildStoreKey(key);
        const existing = this.sessions.get(storeKey);
        if (existing) {
            return existing;
        }
        const created = {
            sessionId: `sess_${this.nextId++}`,
        };
        this.sessions.set(storeKey, created);
        return created;
    }
    buildStoreKey(key) {
        return [key.channel, key.chatId, key.threadId ?? '', key.userId ?? ''].join(':');
    }
}
export class FileChannelSessionStore extends InMemoryChannelSessionStore {
    filePath;
    constructor(filePath) {
        super();
        this.filePath = filePath;
        this.load();
    }
    getOrCreate(key) {
        const session = super.getOrCreate(key);
        this.persist();
        return session;
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
            let nextId = 1;
            for (const entry of parsed.entries) {
                if (!entry?.storeKey || !entry.session?.sessionId) {
                    continue;
                }
                this.sessions.set(entry.storeKey, entry.session);
                nextId = Math.max(nextId, extractSequence(entry.session.sessionId) + 1);
            }
            this.nextId = nextId;
        }
        catch {
            return;
        }
    }
    persist() {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const doc = {
            schemaVersion: 1,
            entries: [...this.sessions.entries()].map(([storeKey, session]) => ({ storeKey, session })),
        };
        writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
}
function extractSequence(sessionId) {
    const match = /^sess_(\d+)$/.exec(sessionId);
    return match ? Number(match[1]) : 0;
}
