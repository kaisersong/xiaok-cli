import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';
const GOAL_DOCUMENT_SCHEMA_VERSION = 1;
export class GoalTamperDetectedError extends Error {
    constructor(sessionId) {
        super(`Goal document tamper detected for session ${sessionId}`);
        this.name = 'GoalTamperDetectedError';
    }
}
export class FileGoalStore {
    rootDir;
    atomicWrite;
    digests = new Map();
    queue = Promise.resolve();
    constructor(rootDir, atomicWrite = writeFileAtomicallySync) {
        this.rootDir = rootDir;
        this.atomicWrite = atomicWrite;
    }
    async load(sessionId) {
        const raw = this.readRaw(sessionId);
        if (raw === null)
            return null;
        if (!this.digests.has(sessionId)) {
            this.digests.set(sessionId, digest(raw));
        }
        return parseDocument(raw);
    }
    async commit(input) {
        let release;
        const previous = this.queue;
        this.queue = new Promise((resolve) => { release = resolve; });
        await previous;
        try {
            await this.commitLocked(input);
        }
        finally {
            release();
        }
    }
    async commitLocked(input) {
        mkdirSync(this.rootDir, { recursive: true });
        const raw = this.readRaw(input.sessionId);
        const cachedDigest = this.digests.get(input.sessionId);
        if (cachedDigest !== undefined && raw !== null && digest(raw) !== cachedDigest) {
            throw new GoalTamperDetectedError(input.sessionId);
        }
        const current = raw === null ? null : parseDocument(raw);
        const revision = current?.state.revision ?? null;
        if (revision !== input.expectedRevision) {
            throw new Error(`stale goal revision: expected ${input.expectedRevision}, found ${revision}`);
        }
        const document = {
            schemaVersion: GOAL_DOCUMENT_SCHEMA_VERSION,
            state: structuredClone(input.next),
            events: [...(current?.events ?? []), ...structuredClone(input.events)],
            turns: [...(current?.turns ?? []), ...structuredClone(input.turns)],
            evidence: [...(current?.evidence ?? []), ...structuredClone(input.evidence)],
        };
        const nextRaw = JSON.stringify(document, null, 2);
        this.atomicWrite(this.filePath(input.sessionId), nextRaw);
        this.digests.set(input.sessionId, digest(nextRaw));
    }
    readRaw(sessionId) {
        const filePath = this.filePath(sessionId);
        return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
    }
    filePath(sessionId) {
        return join(this.rootDir, `${sessionId}.goal.json`);
    }
}
function parseDocument(raw) {
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== GOAL_DOCUMENT_SCHEMA_VERSION) {
        throw new Error(`Unsupported Goal document schema: ${String(parsed.schemaVersion)}`);
    }
    return {
        state: structuredClone(parsed.state),
        events: structuredClone(parsed.events ?? []),
        turns: structuredClone(parsed.turns ?? []),
        evidence: structuredClone(parsed.evidence ?? []),
    };
}
function digest(raw) {
    return createHash('sha256').update(raw).digest('hex');
}
