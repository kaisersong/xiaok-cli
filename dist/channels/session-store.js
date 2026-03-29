export class InMemoryChannelSessionStore {
    sessions = new Map();
    getOrCreate(key) {
        const storeKey = this.buildStoreKey(key);
        const existing = this.sessions.get(storeKey);
        if (existing) {
            return existing;
        }
        const created = {
            sessionId: `sess_${this.sessions.size + 1}`,
        };
        this.sessions.set(storeKey, created);
        return created;
    }
    buildStoreKey(key) {
        return [key.channel, key.chatId, key.threadId ?? '', key.userId ?? ''].join(':');
    }
}
