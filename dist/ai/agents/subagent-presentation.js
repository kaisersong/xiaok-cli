import { randomUUID } from 'node:crypto';
export function publicAgentSummary(value, limit = 180) {
    return value.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, limit);
}
export class SubAgentRunReporter {
    taskName;
    observer;
    id;
    turn = 0;
    current;
    constructor(taskName, id, observer) {
        this.taskName = taskName;
        this.observer = observer;
        this.id = id ?? `subagent_${randomUUID()}`;
    }
    start(task) {
        const now = Date.now();
        this.current = { kind: 'started', agentId: this.id, taskName: publicAgentSummary(this.taskName),
            task: publicAgentSummary(task), turn: ++this.turn, timestamp: now, startedAt: now, elapsedMs: 0,
            status: 'running', phase: 'starting', toolsCompleted: 0, toolsFailed: 0, toolCounts: {} };
        this.emit('started');
    }
    activity(activity) {
        if (!this.current || this.current.status !== 'running')
            return;
        this.current.phase = activity.phase;
        this.current.currentTool = activity.toolName && publicAgentSummary(activity.toolName, 60);
        this.emit('activity');
    }
    toolFinished(name, ok) {
        if (!this.current || this.current.status !== 'running')
            return;
        this.current.toolsCompleted += 1;
        if (!ok)
            this.current.toolsFailed += 1;
        const tool = publicAgentSummary(name, 60);
        const previous = this.current.toolCounts[tool];
        this.current.toolCounts = { ...this.current.toolCounts, [tool]: (typeof previous === 'number' ? previous : 0) + 1 };
        this.emit('activity');
    }
    finish(status, result) {
        if (!this.current || this.current.status !== 'running')
            return;
        this.current.status = status;
        this.current.currentTool = undefined;
        this.current.resultSummary = result ? publicAgentSummary(result) : undefined;
        this.emit('finished');
    }
    emit(kind) {
        if (!this.current || !this.observer)
            return;
        const timestamp = Date.now();
        try {
            this.observer({ ...this.current, kind, timestamp,
                elapsedMs: Math.max(0, timestamp - this.current.startedAt), toolCounts: { ...this.current.toolCounts } });
        }
        catch { /* A display observer cannot break execution or cleanup. */ }
    }
}
