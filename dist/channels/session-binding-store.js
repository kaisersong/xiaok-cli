import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export class InMemorySessionBindingStore {
    bindings = new Map();
    async bind(input) {
        const cwd = resolve(input.cwd);
        if (!existsSync(cwd)) {
            throw new Error(`路径不存在: ${cwd}`);
        }
        if (!statSync(cwd).isDirectory()) {
            throw new Error(`路径不是目录: ${cwd}`);
        }
        const binding = {
            sessionId: input.sessionId,
            channel: 'yzj',
            chatId: input.chatId,
            userId: input.userId,
            cwd,
            repoRoot: await getRepoRoot(cwd),
            branch: await getCurrentBranchSafe(cwd),
            updatedAt: Date.now(),
        };
        this.bindings.set(input.sessionId, binding);
        return binding;
    }
    get(sessionId) {
        return this.bindings.get(sessionId);
    }
    clear(sessionId) {
        return this.bindings.delete(sessionId);
    }
}
export class FileSessionBindingStore {
    bindings = new Map();
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
        this.load();
    }
    async bind(input) {
        const cwd = resolve(input.cwd);
        if (!existsSync(cwd)) {
            throw new Error(`路径不存在: ${cwd}`);
        }
        if (!statSync(cwd).isDirectory()) {
            throw new Error(`路径不是目录: ${cwd}`);
        }
        const binding = {
            sessionId: input.sessionId,
            channel: 'yzj',
            chatId: input.chatId,
            userId: input.userId,
            cwd,
            repoRoot: await getRepoRoot(cwd),
            branch: await getCurrentBranchSafe(cwd),
            updatedAt: Date.now(),
        };
        this.bindings.set(input.sessionId, binding);
        this.persist();
        return binding;
    }
    get(sessionId) {
        return this.bindings.get(sessionId);
    }
    clear(sessionId) {
        const deleted = this.bindings.delete(sessionId);
        if (deleted) {
            this.persist();
        }
        return deleted;
    }
    load() {
        if (!existsSync(this.filePath)) {
            return;
        }
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.bindings)) {
                return;
            }
            for (const binding of parsed.bindings) {
                if (binding?.sessionId) {
                    this.bindings.set(binding.sessionId, binding);
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
            bindings: [...this.bindings.values()],
        };
        writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
}
async function getRepoRoot(cwd) {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
        const repoRoot = stdout.trim();
        return repoRoot || undefined;
    }
    catch {
        return undefined;
    }
}
async function getCurrentBranchSafe(cwd) {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
        const branch = stdout.trim();
        return branch || undefined;
    }
    catch {
        return undefined;
    }
}
