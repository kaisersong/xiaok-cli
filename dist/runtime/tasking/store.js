export class InMemoryTaskStore {
    factory;
    tasks = new Map();
    nextId = 1;
    constructor(factory) {
        this.factory = factory;
    }
    create(input) {
        const now = Date.now();
        const task = this.factory(`task_${this.nextId++}`, now, input);
        this.tasks.set(task.taskId, task);
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
        return next;
    }
    listBySession(sessionId) {
        return [...this.tasks.values()]
            .filter((task) => task.sessionId === sessionId)
            .sort((a, b) => this.compareTasks(a, b));
    }
    compareTasks(a, b) {
        if (a.createdAt !== b.createdAt) {
            return b.createdAt - a.createdAt;
        }
        return this.extractSequence(b.taskId) - this.extractSequence(a.taskId);
    }
    extractSequence(taskId) {
        const match = /(\d+)$/.exec(taskId);
        return match ? Number(match[1]) : 0;
    }
}
