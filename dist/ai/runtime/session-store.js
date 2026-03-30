import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../../utils/config.js';
const SESSION_SCHEMA_VERSION = 1;
export class FileSessionStore {
    rootDir;
    constructor(rootDir = join(getConfigDir(), 'sessions')) {
        this.rootDir = rootDir;
    }
    createSessionId() {
        return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }
    async save(snapshot) {
        mkdirSync(this.rootDir, { recursive: true });
        const document = {
            schemaVersion: SESSION_SCHEMA_VERSION,
            ...snapshot,
        };
        writeFileSync(this.getFilePath(snapshot.sessionId), JSON.stringify(document, null, 2), 'utf-8');
    }
    async load(sessionId) {
        const filePath = this.getFilePath(sessionId);
        if (!existsSync(filePath)) {
            return null;
        }
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== SESSION_SCHEMA_VERSION) {
            return null;
        }
        const { schemaVersion: _schemaVersion, ...snapshot } = parsed;
        return snapshot;
    }
    async list() {
        if (!existsSync(this.rootDir)) {
            return [];
        }
        const snapshots = readdirSync(this.rootDir)
            .filter((entry) => entry.endsWith('.json'))
            .map((entry) => this.load(entry.slice(0, -'.json'.length)));
        const loaded = (await Promise.all(snapshots)).filter((snapshot) => Boolean(snapshot));
        return loaded
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map((snapshot) => ({
            sessionId: snapshot.sessionId,
            cwd: snapshot.cwd,
            updatedAt: snapshot.updatedAt,
            preview: getPreview(snapshot.messages),
        }));
    }
    async fork(sessionId) {
        const source = await this.load(sessionId);
        if (!source) {
            throw new Error(`session not found: ${sessionId}`);
        }
        const now = Date.now();
        const forked = {
            ...source,
            sessionId: this.createSessionId(),
            createdAt: now,
            updatedAt: now,
            forkedFromSessionId: source.sessionId,
            messages: cloneMessages(source.messages),
            usage: { ...source.usage },
        };
        await this.save(forked);
        return forked;
    }
    getFilePath(sessionId) {
        return join(this.rootDir, `${sessionId}.json`);
    }
}
function cloneMessages(messages) {
    return messages.map((message) => ({
        role: message.role,
        content: message.content.map((block) => ({ ...block })),
    }));
}
function getPreview(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const block = message.content.find((entry) => entry.type === 'text');
        if (block?.type === 'text') {
            return block.text;
        }
    }
    return '';
}
