import { InMemoryTaskStore } from './task-store.js';
export class TaskManager {
    store;
    running = new Map();
    sessionTails = new Map();
    activeBySession = new Map();
    executeTask;
    notify;
    constructor(options) {
        this.store = options.store ?? new InMemoryTaskStore();
        this.executeTask = options.execute;
        this.notify = options.notify;
    }
    async createAndStart(request, sessionId, options = {}) {
        const task = this.store.create({
            sessionId,
            prompt: request.message,
            replyTarget: request.replyTarget,
            cwd: options.binding?.cwd,
            repoRoot: options.binding?.repoRoot,
            branch: options.binding?.branch,
        });
        await this.notify(request, options.ackText ?? this.buildAckMessage(task));
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
    getActiveReplyTarget(sessionId) {
        return this.getActiveTask(sessionId)?.replyTarget;
    }
    setTaskEvent(taskId, latestEvent) {
        return this.store.update(taskId, { latestEvent });
    }
    setSessionProgress(sessionId, latestEvent) {
        const task = this.getActiveTask(sessionId);
        if (!task) {
            return undefined;
        }
        return this.store.update(task.taskId, { latestEvent });
    }
    markWaitingApproval(sessionId, approval) {
        const task = this.getActiveTask(sessionId);
        if (!task) {
            return undefined;
        }
        return this.store.update(task.taskId, {
            status: 'waiting_approval',
            approvalId: approval.approvalId,
            latestEvent: approval.summary,
        });
    }
    resumeFromApproval(approval, action) {
        if (!approval.taskId) {
            return undefined;
        }
        const nextEvent = action === 'expired'
            ? `审批 ${approval.approvalId} 已超时失效`
            : `审批 ${approval.approvalId} 已${action === 'approve' ? '通过' : '拒绝'}`;
        return this.store.update(approval.taskId, {
            status: 'running',
            approvalId: undefined,
            latestEvent: nextEvent,
        });
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
            this.store.update(taskId, {
                status: 'cancelled',
                finishedAt: Date.now(),
                errorMessage: 'cancelled before execution binding',
            });
            return { ok: true, message: `任务 ${taskId} 已取消`, task: this.store.get(taskId) };
        }
        running.abortController.abort();
        this.store.update(taskId, {
            status: 'cancelled',
            finishedAt: Date.now(),
            errorMessage: 'cancelled by user',
        });
        this.running.delete(taskId);
        return { ok: true, message: `任务 ${taskId} 已取消`, task: this.store.get(taskId) };
    }
    formatStatus(task) {
        const lines = [
            `任务 ${task.taskId}`,
            `状态：${task.status}`,
            `创建时间：${new Date(task.createdAt).toLocaleString()}`,
        ];
        if (task.cwd)
            lines.push(`工作区：${task.cwd}`);
        if (task.branch)
            lines.push(`分支：${task.branch}`);
        if (task.startedAt)
            lines.push(`开始时间：${new Date(task.startedAt).toLocaleString()}`);
        if (task.finishedAt)
            lines.push(`结束时间：${new Date(task.finishedAt).toLocaleString()}`);
        if (task.latestEvent)
            lines.push(`最近进展：${task.latestEvent}`);
        if (task.approvalId)
            lines.push(`待审批：${task.approvalId}`);
        if (task.replyLength)
            lines.push(`回复长度：${task.replyLength}`);
        if (task.replySummary)
            lines.push(`回复摘要：${task.replySummary}`);
        if (task.errorMessage)
            lines.push(`错误：${task.errorMessage}`);
        return lines.join('\n');
    }
    async runTask(taskId, request, sessionId, abortController) {
        try {
            if (abortController.signal.aborted) {
                return;
            }
            this.activeBySession.set(sessionId, taskId);
            this.store.update(taskId, {
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
                this.store.update(taskId, {
                    status: 'cancelled',
                    finishedAt: Date.now(),
                    errorMessage: 'cancelled by user',
                });
                return;
            }
            if (result.ok) {
                const completed = this.store.update(taskId, {
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
            const failed = this.store.update(taskId, {
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
    buildAckMessage(task) {
        const lines = [
            `已创建任务 ${task.taskId}`,
            `状态：${task.status}`,
        ];
        if (task.cwd) {
            lines.push(`工作区：${task.cwd}`);
        }
        else {
            lines.push('当前未绑定工作区，涉及仓库文件时可先发送 /bind <cwd>');
        }
        lines.push(`发送 /status ${task.taskId} 查看进度`);
        return lines.join('\n');
    }
    buildCompletionSummary(task) {
        const lines = [
            `任务 ${task.taskId} 已${task.status === 'completed' ? '完成' : task.status === 'cancelled' ? '取消' : '结束'}`,
            `状态：${task.status}`,
        ];
        if (task.replySummary) {
            lines.push(`摘要：${task.replySummary}`);
        }
        if (task.errorMessage) {
            lines.push(`错误：${task.errorMessage}`);
        }
        lines.push(`发送 /status ${task.taskId} 查看详情`);
        return lines.join('\n');
    }
}
