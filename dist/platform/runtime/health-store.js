import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export class FileCapabilityHealthStore {
    filePath;
    entries = new Map();
    constructor(filePath) {
        this.filePath = filePath;
        this.load();
    }
    get(cwd) {
        return this.entries.get(cwd);
    }
    set(cwd, snapshot) {
        this.entries.set(cwd, snapshot);
        this.persist();
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
                if (entry?.cwd && entry.snapshot) {
                    this.entries.set(entry.cwd, entry.snapshot);
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
            entries: [...this.entries.entries()].map(([cwd, snapshot]) => ({ cwd, snapshot })),
        };
        writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
}
