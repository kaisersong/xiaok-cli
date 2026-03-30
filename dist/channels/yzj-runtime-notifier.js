export class YZJRuntimeNotifier {
    transport;
    taskManager;
    approvalStore;
    flushDelayMs;
    buffers = new Map();
    constructor(transport, taskManager, approvalStore, flushDelayMs = 1500) {
        this.transport = transport;
        this.taskManager = taskManager;
        this.approvalStore = approvalStore;
        this.flushDelayMs = flushDelayMs;
    }
    bind(sessionId, hooks) {
        const subscriptions = [
            hooks.on('turn_started', () => {
                const task = this.taskManager.getActiveTask(sessionId);
                if (!task) {
                    return;
                }
                this.taskManager.setTaskEvent(task.taskId, 'Agent 已开始执行');
                void this.sendForSession(sessionId, `任务 ${task.taskId} 开始执行`);
            }),
            hooks.on('tool_started', (event) => {
                const task = this.taskManager.getActiveTask(sessionId);
                if (!task) {
                    return;
                }
                this.taskManager.setTaskEvent(task.taskId, `执行工具 ${event.toolName}`);
                this.enqueueProgress(sessionId, `开始 ${event.toolName}${formatToolInput(event.toolInput)}`);
            }),
            hooks.on('tool_finished', (event) => {
                const task = this.taskManager.getActiveTask(sessionId);
                if (!task) {
                    return;
                }
                this.taskManager.setTaskEvent(task.taskId, `工具 ${event.toolName} ${event.ok ? '完成' : '失败'}`);
                this.enqueueProgress(sessionId, `${event.toolName} ${event.ok ? '完成' : '失败'}`);
            }),
            hooks.on('compact_triggered', () => {
                const task = this.taskManager.getActiveTask(sessionId);
                if (!task) {
                    return;
                }
                this.taskManager.setTaskEvent(task.taskId, '上下文已压缩');
                void this.sendForSession(sessionId, `任务 ${task.taskId}：上下文已压缩，已保留最近上下文`);
            }),
            hooks.on('approval_required', (event) => {
                const task = this.taskManager.getActiveTask(sessionId);
                const approval = this.approvalStore.get(event.approvalId);
                if (!task || !approval) {
                    return;
                }
                this.taskManager.markWaitingApproval(sessionId, approval);
                void this.flushSession(sessionId);
                void this.sendForSession(sessionId, [
                    `任务 ${task.taskId} 需要审批`,
                    `审批单：${approval.approvalId}`,
                    `操作：${approval.toolName ?? 'unknown'}`,
                    `摘要：${approval.summary}`,
                    `发送 /approve ${approval.approvalId} 或 /deny ${approval.approvalId}`,
                ].join('\n'));
            }),
        ];
        return () => {
            for (const unsubscribe of subscriptions) {
                unsubscribe();
            }
            const buffer = this.buffers.get(sessionId);
            if (buffer?.timer) {
                clearTimeout(buffer.timer);
            }
            this.buffers.delete(sessionId);
        };
    }
    enqueueProgress(sessionId, line) {
        const buffer = this.buffers.get(sessionId) ?? { lines: [], timer: null };
        buffer.lines.push(line);
        if (!buffer.timer) {
            buffer.timer = setTimeout(() => {
                void this.flushSession(sessionId);
            }, this.flushDelayMs);
        }
        this.buffers.set(sessionId, buffer);
    }
    async flushSession(sessionId) {
        const buffer = this.buffers.get(sessionId);
        if (!buffer || buffer.lines.length === 0) {
            if (buffer?.timer) {
                clearTimeout(buffer.timer);
                buffer.timer = null;
            }
            return;
        }
        if (buffer.timer) {
            clearTimeout(buffer.timer);
            buffer.timer = null;
        }
        const task = this.taskManager.getActiveTask(sessionId);
        const target = this.taskManager.getActiveReplyTarget(sessionId);
        const lines = buffer.lines.splice(0, buffer.lines.length);
        if (!task || !target) {
            return;
        }
        await this.transport.send(target, [`任务 ${task.taskId} 进展：`, ...lines].join('\n'));
    }
    async sendForSession(sessionId, text) {
        const target = this.taskManager.getActiveReplyTarget(sessionId);
        if (!target) {
            return;
        }
        await this.transport.send(target, text);
    }
}
function formatToolInput(input) {
    if (typeof input.command === 'string') {
        return ` (${truncate(input.command, 60)})`;
    }
    if (typeof input.file_path === 'string') {
        return ` (${truncate(input.file_path, 60)})`;
    }
    if (typeof input.path === 'string') {
        return ` (${truncate(input.path, 60)})`;
    }
    return '';
}
function truncate(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}...`;
}
