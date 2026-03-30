export class InMemoryTaskStore {
    tasks = new Map();
    nextId = 1;
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
        return task;
    }
    get(taskId) {
        return this.tasks.get(taskId);
    }
    update(taskId, patch) {
        const current = this.tasks.get(taskId);
        if (!current)
            return undefined;
        const next = {
            ...current,
            ...patch,
            updatedAt: Date.now(),
        };
        this.tasks.set(taskId, next);
        return next;
    }
    listBySession(sessionId) {
        return [...this.tasks.values()]
            .filter((task) => task.sessionId === sessionId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }
}
