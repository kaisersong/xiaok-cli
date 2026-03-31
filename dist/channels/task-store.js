import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { InMemoryTaskStore as SharedInMemoryTaskStore } from '../runtime/tasking/store.js';
export class InMemoryTaskStore extends SharedInMemoryTaskStore {
    constructor() {
        super((taskId, now, input) => ({
            taskId,
            sessionId: input.sessionId,
            channel: 'yzj',
            status: 'queued',
            prompt: input.prompt,
            replyTarget: input.replyTarget,
            createdAt: now,
            updatedAt: now,
            cwd: input.cwd,
            repoRoot: input.repoRoot,
            branch: input.branch,
        }));
    }
}
export class FileTaskStore {
    filePath;
    tasks = new Map();
    nextId = 1;
    constructor(filePath) {
        this.filePath = filePath;
        this.load();
    }
    create(input) {
        const now = Date.now();
        const task = {
            taskId: `task_${this.nextId++}`,
            sessionId: input.sessionId,
            channel: 'yzj',
            status: 'queued',
            prompt: input.prompt,
            replyTarget: input.replyTarget,
            createdAt: now,
            updatedAt: now,
            cwd: input.cwd,
            repoRoot: input.repoRoot,
            branch: input.branch,
        };
        this.tasks.set(task.taskId, task);
        this.persist();
        return task;
    }
    get(taskId) {
        return this.tasks.get(taskId);
    }
    update(taskId, patch) {
        const current = this.tasks.get(taskId);
        if (!current) {
            return undefined;
        }
        const next = {
            ...current,
            ...patch,
            updatedAt: Date.now(),
        };
        this.tasks.set(taskId, next);
        this.persist();
        return next;
    }
    listBySession(sessionId) {
        return [...this.tasks.values()]
            .filter((task) => task.sessionId === sessionId)
            .sort((a, b) => {
            if (a.createdAt !== b.createdAt) {
                return b.createdAt - a.createdAt;
            }
            return extractSequence(b.taskId) - extractSequence(a.taskId);
        });
    }
    load() {
        if (!existsSync(this.filePath)) {
            return;
        }
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tasks)) {
                return;
            }
            for (const task of parsed.tasks) {
                if (task?.taskId) {
                    const recovered = recoverTaskAfterRestart(task);
                    this.tasks.set(task.taskId, recovered);
                    const seq = extractSequence(task.taskId);
                    if (seq >= this.nextId) {
                        this.nextId = seq + 1;
                    }
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
        const doc = {
            schemaVersion: 1,
            tasks: [...this.tasks.values()],
        };
        writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
}
function extractSequence(taskId) {
    const match = /(\d+)$/.exec(taskId);
    return match ? Number(match[1]) : 0;
}
function recoverTaskAfterRestart(task) {
    if (task.status !== 'queued' && task.status !== 'running' && task.status !== 'waiting_approval') {
        return task;
    }
    const reason = task.status === 'waiting_approval'
        ? 'approval interrupted by process restart'
        : 'task interrupted by process restart';
    return {
        ...task,
        status: 'failed',
        finishedAt: task.finishedAt ?? Date.now(),
        errorMessage: task.errorMessage ?? reason,
        latestEvent: reason,
        approvalId: undefined,
        updatedAt: Date.now(),
    };
}
