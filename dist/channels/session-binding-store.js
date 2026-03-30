import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
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
