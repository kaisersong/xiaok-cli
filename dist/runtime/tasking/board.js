import { InMemoryTaskStore } from './store.js';
export class SessionTaskBoard {
    defaultSource;
    store;
    constructor(defaultSource = 'cli') {
        this.defaultSource = defaultSource;
        this.store = new InMemoryTaskStore((taskId, now, input) => ({
            taskId,
            sessionId: input.sessionId,
            status: 'queued',
            createdAt: now,
            updatedAt: now,
            title: input.title,
            details: input.details,
            owner: input.owner,
            source: input.source,
            notes: [],
        }));
    }
    create(sessionId, input) {
        return this.store.create({
            sessionId,
            title: input.title,
            details: input.details,
            owner: input.owner,
            source: input.source ?? this.defaultSource,
        });
    }
    get(sessionId, taskId) {
        const task = this.store.get(taskId);
        if (!task || task.sessionId !== sessionId) {
            return undefined;
        }
        return task;
    }
    list(sessionId, options = {}) {
        const tasks = this.store.listBySession(sessionId)
            .filter((task) => !options.status || task.status === options.status);
        if (typeof options.limit === 'number' && options.limit >= 0) {
            return tasks.slice(0, options.limit);
        }
        return tasks;
    }
    update(sessionId, taskId, patch) {
        const current = this.get(sessionId, taskId);
        if (!current) {
            return undefined;
        }
        const notes = patch.note ? [...current.notes, patch.note] : current.notes;
        const latestEvent = patch.latestEvent ?? patch.note ?? current.latestEvent;
        return this.store.update(taskId, {
            title: patch.title ?? current.title,
            details: patch.details ?? current.details,
            owner: patch.owner ?? current.owner,
            status: patch.status ?? current.status,
            notes,
            latestEvent,
            startedAt: patch.status === 'running' && !current.startedAt ? Date.now() : current.startedAt,
            finishedAt: patch.status && ['completed', 'failed', 'cancelled'].includes(patch.status)
                ? Date.now()
                : current.finishedAt,
        });
    }
}
