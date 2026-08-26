export class InMemoryGoalStore {
    documents = new Map();
    failNextCommit = false;
    async load(sessionId) {
        const document = this.documents.get(sessionId);
        return document ? structuredClone(document) : null;
    }
    async commit(input) {
        if (this.failNextCommit) {
            this.failNextCommit = false;
            throw new Error('injected goal commit failure');
        }
        const current = this.documents.get(input.sessionId);
        const revision = current?.state.revision ?? null;
        if (revision !== input.expectedRevision) {
            throw new Error(`stale goal revision: expected ${input.expectedRevision}, found ${revision}`);
        }
        this.documents.set(input.sessionId, {
            state: structuredClone(input.next),
            events: [...(current?.events ?? []), ...structuredClone(input.events)],
            turns: [...(current?.turns ?? []), ...structuredClone(input.turns)],
            evidence: [...(current?.evidence ?? []), ...structuredClone(input.evidence)],
        });
    }
}
