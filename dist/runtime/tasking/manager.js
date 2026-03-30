export class SerialTaskManager {
    store;
    running = new Map();
    sessionTails = new Map();
    activeBySession = new Map();
    createTaskInput;
    buildAckMessageImpl;
    buildCompletionSummaryImpl;
    executeTask;
    notify;
    constructor(options) {
        this.store = options.store;
        this.createTaskInput = options.createTaskInput;
        this.buildAckMessageImpl = options.buildAckMessage;
        this.buildCompletionSummaryImpl = options.buildCompletionSummary;
        this.executeTask = options.execute;
        this.notify = options.notify;
    }
    async createAndStart(request, sessionId, options) {
        const task = this.store.create(this.createTaskInput(request, sessionId, options));
        await this.notify(request, this.buildAckMessageImpl(task, options));
        const abortController = new AbortController();
        this.running.set(task.taskId, { sessionId, abortController });
        const previous = this.sessionTails.get(sessionId) ?? Promise.resolve();
        const scheduled = previous
            .catch(() => undefined)
            .then(async () => {
            await this.runTask(task.taskId, request, sessionId, abortController);
        });
        this.sessionTails.set(sessionId, scheduled.then(() => undefined, () => undefined));
        return this.store.get(task.taskId);
    }
    getTask(taskId) {
        return this.store.get(taskId);
    }
    getLatestTask(sessionId) {
        return this.store.listBySession(sessionId)[0];
    }
    listTasks(sessionId) {
        return this.store.listBySession(sessionId);
    }
    getActiveTask(sessionId) {
        const taskId = this.activeBySession.get(sessionId);
        return taskId ? this.store.get(taskId) : undefined;
    }
    updateTask(taskId, patch) {
        return this.store.update(taskId, patch);
    }
    setTaskEvent(taskId, latestEvent) {
        return this.updateTask(taskId, { latestEvent });
    }
    setSessionProgress(sessionId, latestEvent) {
        const task = this.getActiveTask(sessionId);
        if (!task) {
            return undefined;
        }
        return this.setTaskEvent(task.taskId, latestEvent);
    }
    cancelTask(taskId) {
        const task = this.store.get(taskId);
        if (!task) {
            return { ok: false, message: `未找到任务 ${taskId}` };
        }
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            return { ok: false, message: `任务 ${taskId} 当前状态为 ${task.status}，不可取消`, task };
        }
        const running = this.running.get(taskId);
        if (!running) {
            this.updateTask(taskId, {
                status: 'cancelled',
                finishedAt: Date.now(),
                errorMessage: 'cancelled before execution binding',
            });
            return { ok: true, message: `任务 ${taskId} 已取消`, task: this.store.get(taskId) };
        }
        running.abortController.abort();
        this.updateTask(taskId, {
            status: 'cancelled',
            finishedAt: Date.now(),
            errorMessage: 'cancelled by user',
        });
        this.running.delete(taskId);
        return { ok: true, message: `任务 ${taskId} 已取消`, task: this.store.get(taskId) };
    }
    buildCompletionSummary(task) {
        return this.buildCompletionSummaryImpl(task);
    }
    async runTask(taskId, request, sessionId, abortController) {
        try {
            if (abortController.signal.aborted) {
                return;
            }
            this.activeBySession.set(sessionId, taskId);
            this.updateTask(taskId, {
                status: 'running',
                startedAt: Date.now(),
                latestEvent: '任务开始执行',
            });
            const result = await this.executeTask({
                request,
                sessionId,
                taskId,
                signal: abortController.signal,
            });
            if (abortController.signal.aborted) {
                this.updateTask(taskId, {
                    status: 'cancelled',
                    finishedAt: Date.now(),
                    errorMessage: 'cancelled by user',
                });
                return;
            }
            if (result.ok) {
                const completed = this.updateTask(taskId, {
                    status: 'completed',
                    finishedAt: Date.now(),
                    replyLength: result.replyLength,
                    replySummary: result.replyPreview,
                    latestEvent: result.replyLength > 0 ? '任务完成并已发送结果' : '任务完成',
                });
                if (completed && (completed.replyLength ?? 0) > 1200) {
                    await this.notify(request, this.buildCompletionSummary(completed));
                }
                return;
            }
            const failed = this.updateTask(taskId, {
                status: result.cancelled ? 'cancelled' : 'failed',
                finishedAt: Date.now(),
                errorMessage: result.errorMessage,
                latestEvent: result.cancelled ? '任务已取消' : '任务执行失败',
            });
            if (failed) {
                await this.notify(request, this.buildCompletionSummary(failed));
            }
        }
        finally {
            this.running.delete(taskId);
            if (this.activeBySession.get(sessionId) === taskId) {
                this.activeBySession.delete(sessionId);
            }
        }
    }
}
