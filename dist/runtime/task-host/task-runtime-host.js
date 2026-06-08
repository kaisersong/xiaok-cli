import { evaluateArtifactEvidenceGuard } from '../guards/artifact-evidence-guard.js';
import { runDeliverableGate } from './deliverable-gate.js';
import { projectRuntimeEventsToDesktopEvents } from './event-projection.js';
import { NeedsUserQuestionCorrelator } from './question-correlator.js';
import { buildTaskUnderstanding } from './task-understanding.js';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_CONTEXT_MAX_TASKS = 12;
const DEFAULT_CONTEXT_MAX_USER_CHARS = 4000;
const DEFAULT_CONTEXT_MAX_ASSISTANT_CHARS = 6000;
const DEFAULT_CONTEXT_MAX_TOTAL_CHARS = 30000;
export function buildHistoryFromTaskSnapshots(snapshots, options = {}) {
    const maxTasks = options.maxTasks ?? DEFAULT_CONTEXT_MAX_TASKS;
    const maxUserChars = options.maxUserChars ?? DEFAULT_CONTEXT_MAX_USER_CHARS;
    const maxAssistantChars = options.maxAssistantChars ?? DEFAULT_CONTEXT_MAX_ASSISTANT_CHARS;
    const maxTotalChars = options.maxTotalChars ?? DEFAULT_CONTEXT_MAX_TOTAL_CHARS;
    const skipped = [];
    const byTaskId = new Map();
    for (const snapshot of snapshots) {
        const taskId = typeof snapshot?.taskId === 'string' ? snapshot.taskId : '';
        if (!taskId) {
            skipped.push({ taskId: '', reason: 'invalid' });
            continue;
        }
        if (options.currentTaskId && taskId === options.currentTaskId) {
            skipped.push({ taskId, reason: 'self' });
            continue;
        }
        if (!isValidContextSnapshot(snapshot)) {
            skipped.push({ taskId, reason: 'invalid' });
            continue;
        }
        if (!TERMINAL_STATUSES.has(snapshot.status)) {
            skipped.push({ taskId, reason: 'non_terminal' });
            continue;
        }
        byTaskId.set(taskId, snapshot);
    }
    const sorted = [...byTaskId.values()].sort((left, right) => {
        const byCreatedAt = left.createdAt - right.createdAt;
        return byCreatedAt !== 0 ? byCreatedAt : left.taskId.localeCompare(right.taskId);
    });
    const overTaskBudget = Math.max(0, sorted.length - Math.max(0, maxTasks));
    for (const snapshot of sorted.slice(0, overTaskBudget)) {
        skipped.push({ taskId: snapshot.taskId, reason: 'too_old' });
    }
    const pairs = sorted.slice(overTaskBudget).map((snapshot) => ({
        taskId: snapshot.taskId,
        user: { role: 'user', content: truncateContextText(snapshot.prompt, maxUserChars) },
        assistant: { role: 'assistant', content: truncateContextText(formatAssistantContext(snapshot), maxAssistantChars) },
    }));
    let totalChars = countHistoryChars(pairs);
    while (pairs.length > 0 && totalChars > maxTotalChars) {
        const dropped = pairs.shift();
        skipped.push({ taskId: dropped.taskId, reason: 'too_old' });
        totalChars = countHistoryChars(pairs);
    }
    return {
        history: pairs.flatMap(pair => [pair.user, pair.assistant]),
        loadedTaskIds: pairs.map(pair => pair.taskId),
        skipped,
    };
}
export class InProcessTaskRuntimeHost {
    options;
    questions = new NeedsUserQuestionCorrelator();
    subscribers = new Map();
    mutationChains = new Map();
    cancellingTaskIds = new Set();
    taskHistories = new Map();
    activeExecutions = new Map();
    executionPromises = new Map();
    taskOrdinal = 0;
    sessionOrdinal = 0;
    permissionModes = new Map();
    constructor(options) {
        this.options = options;
    }
    async createTask(input) {
        const taskId = this.createTaskId();
        if (input.permissionMode) {
            this.permissionModes.set(taskId, input.permissionMode);
        }
        const sessionId = this.createSessionId();
        const materials = input.materials.map((item) => {
            const record = this.options.materialRegistry.get(item.materialId);
            if (!record) {
                throw new Error(`unknown material: ${item.materialId}`);
            }
            return item.role ? { ...record, role: item.role } : record;
        });
        const understanding = buildTaskUnderstanding({ prompt: input.prompt, materials });
        const contextHistory = await this.resolveContextHistory(taskId, input.context);
        this.taskHistories.set(taskId, contextHistory.history);
        const snapshot = {
            taskId,
            sessionId,
            status: 'understanding',
            prompt: input.prompt,
            materials: materials.map((material) => this.options.materialRegistry.toView(material)),
            understanding,
            events: [],
            context: contextHistory.audit,
            createdAt: this.now(),
            updatedAt: this.now(),
        };
        await this.saveSnapshot(snapshot);
        await this.appendEvent(taskId, { type: 'task_started', taskId });
        await this.appendEvent(taskId, { type: 'understanding_updated', understanding });
        const execPromise = this.executeTask(taskId).catch(() => undefined);
        this.executionPromises.set(taskId, execPromise);
        return { taskId, understanding };
    }
    async *subscribeTask(taskId, options) {
        const snapshot = await this.requireSnapshot(taskId);
        // events is append-only (only grown via [...events, event]), so a numeric
        // index is a stable replay cursor. Clamp into [0, length] to make negative or
        // out-of-range cursors safe (out-of-range = skip all history, only live).
        const requested = options?.sinceIndex ?? 0;
        const start = Math.max(0, Math.min(requested, snapshot.events.length));
        for (let i = start; i < snapshot.events.length; i++) {
            yield snapshot.events[i];
        }
        if (TERMINAL_STATUSES.has(snapshot.status)) {
            return;
        }
        const queue = [];
        let wake = null;
        let closed = false;
        const subscription = {
            push(event) {
                queue.push(event);
                wake?.();
                wake = null;
            },
            close() {
                closed = true;
                wake?.();
                wake = null;
            },
        };
        this.addSubscriber(taskId, subscription);
        try {
            while (!closed || queue.length > 0) {
                if (queue.length === 0) {
                    await new Promise((resolve) => {
                        wake = resolve;
                    });
                    continue;
                }
                yield queue.shift();
            }
        }
        finally {
            this.removeSubscriber(taskId, subscription);
        }
    }
    async answerQuestion(input) {
        const result = this.questions.answer(input.taskId, input.answer);
        if (result.status === 'not_found') {
            throw new Error(`question not found: ${input.answer.questionId}`);
        }
        if (result.status === 'stale') {
            throw new Error(`stale question answer: ${input.answer.questionId}`);
        }
        if (result.question.kind === 'confirm_understanding'
            && input.answer.type === 'choice'
            && input.answer.choiceId === 'confirm') {
            await this.executeTask(input.taskId);
        }
    }
    async cancelTask(taskId) {
        const snapshot = await this.requireSnapshot(taskId);
        if (TERMINAL_STATUSES.has(snapshot.status)) {
            return;
        }
        const execution = this.activeExecutions.get(taskId);
        if (execution) {
            this.cancellingTaskIds.add(taskId);
            execution.controller.abort();
        }
        const salvage = {
            summary: ['任务已取消，可基于已识别的任务理解继续。'],
            reason: 'cancelled',
        };
        await this.appendEvent(taskId, { type: 'salvage', salvage });
        await this.updateSnapshot(taskId, {
            status: 'cancelled',
            salvage,
        });
        await this.options.snapshotStore.clearActiveTask(taskId);
        this.closeSubscribers(taskId);
    }
    async getActiveTasks() {
        const refs = await this.options.snapshotStore.getActiveTasks();
        const activeRefs = [];
        for (const ref of refs) {
            const snapshot = await this.options.snapshotStore.recoverTask(ref.taskId);
            if (!snapshot || TERMINAL_STATUSES.has(snapshot.status)) {
                await this.options.snapshotStore.clearActiveTask(ref.taskId);
                continue;
            }
            activeRefs.push(ref);
        }
        return activeRefs;
    }
    async getActiveTask() {
        const tasks = await this.getActiveTasks();
        return tasks[0] ?? null;
    }
    async recoverTask(taskId) {
        const snapshot = await this.recoverStaleRunningTask(await this.requireSnapshot(taskId));
        this.rehydrateWaitingQuestion(snapshot);
        return { snapshot };
    }
    isExecutingForTest(taskId) {
        return this.activeExecutions.has(taskId);
    }
    async executeTask(taskId) {
        const snapshot = await this.requireSnapshot(taskId);
        if (!snapshot.understanding) {
            throw new Error(`task has no understanding: ${taskId}`);
        }
        const materials = snapshot.materials.map((material) => {
            const record = this.options.materialRegistry.get(material.materialId);
            if (!record) {
                throw new Error(`unknown material: ${material.materialId}`);
            }
            return record;
        });
        const controller = new AbortController();
        const taskHistory = this.taskHistories.get(taskId) ?? [];
        this.activeExecutions.set(taskId, { taskId, controller });
        await this.updateSnapshot(taskId, { status: 'running' });
        const watchdogMs = this.options.taskWatchdogMs ?? 30 * 60_000;
        const watchdogTimer = setTimeout(() => controller.abort(), watchdogMs);
        try {
            await this.options.runner({
                taskId,
                sessionId: snapshot.sessionId,
                prompt: snapshot.prompt,
                materials,
                understanding: snapshot.understanding,
                signal: controller.signal,
                history: [...taskHistory],
                permissionMode: this.permissionModes.get(taskId),
                emitRuntimeEvent: (event) => {
                    void this.appendRuntimeEvent(taskId, event);
                },
            });
            await this.flushMutations(taskId);
            const latest = await this.requireSnapshot(taskId);
            if (latest.status !== 'cancelled' && !this.cancellingTaskIds.has(taskId)) {
                // Layer 3: Deliverable Gate — check if all requested deliverables were produced
                const gatePass = await runDeliverableGate(latest, this.options.completionGate, controller.signal);
                if (!gatePass && !this.cancellingTaskIds.has(taskId)) {
                    // Retry once with a resume prompt
                    await this.options.runner({
                        taskId,
                        sessionId: snapshot.sessionId,
                        prompt: '你之前的执行遗漏了部分交付物。请回顾用户原始请求，继续完成所有尚未生成的产物。',
                        materials: [],
                        understanding: snapshot.understanding,
                        signal: controller.signal,
                        history: [...taskHistory],
                        permissionMode: this.permissionModes.get(taskId),
                        emitRuntimeEvent: (event) => {
                            void this.appendRuntimeEvent(taskId, event);
                        },
                    });
                    await this.flushMutations(taskId);
                }
                const guardedLatest = await this.requireSnapshot(taskId);
                if (!await this.applyArtifactEvidenceGuard(taskId, guardedLatest)) {
                    await this.options.snapshotStore.clearActiveTask(taskId);
                    this.closeSubscribers(taskId);
                    return;
                }
                if (this.isEmptyDelivery(guardedLatest)) {
                    await this.appendEvent(taskId, {
                        type: 'progress',
                        eventId: `${taskId}:degraded`,
                        message: '任务完成但未产出实质内容，已标记为降级交付。',
                        stage: 'warning',
                    });
                    const currentResult = guardedLatest.result ?? { summary: '', artifacts: [] };
                    await this.updateSnapshot(taskId, { result: { ...currentResult, degraded: true } });
                }
                await this.updateSnapshot(taskId, { status: 'completed' });
                await this.options.snapshotStore.clearActiveTask(taskId);
                this.closeSubscribers(taskId);
            }
        }
        catch (error) {
            if (this.cancellingTaskIds.has(taskId)) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            const salvage = {
                summary: [
                    snapshot.understanding ? '已保留任务理解' : '已保留任务输入',
                    `已保留 ${snapshot.materials.length} 个材料引用`,
                ],
                reason: message,
            };
            await this.appendEvent(taskId, { type: 'error', message });
            await this.updateSnapshot(taskId, { status: 'failed', salvage });
            await this.options.snapshotStore.clearActiveTask(taskId);
            this.closeSubscribers(taskId);
            throw error;
        }
        finally {
            clearTimeout(watchdogTimer);
            this.taskHistories.delete(taskId);
            this.permissionModes.delete(taskId);
            this.activeExecutions.delete(taskId);
            this.executionPromises.delete(taskId);
            this.cancellingTaskIds.delete(taskId);
        }
    }
    async resolveContextHistory(currentTaskId, context) {
        if (!context) {
            return { history: [] };
        }
        const requestedTaskIds = dedupeTaskIds(context.taskIds ?? []);
        const skipped = [];
        const snapshots = [];
        for (const taskId of requestedTaskIds) {
            if (taskId === currentTaskId) {
                skipped.push({ taskId, reason: 'self' });
                continue;
            }
            try {
                const snapshot = await this.options.snapshotStore.recoverTask(taskId);
                if (!snapshot) {
                    skipped.push({ taskId, reason: 'missing' });
                    continue;
                }
                snapshots.push(snapshot);
            }
            catch {
                skipped.push({ taskId, reason: 'invalid' });
            }
        }
        const built = buildHistoryFromTaskSnapshots(snapshots, { currentTaskId });
        const threadId = normalizeContextId(context.threadId);
        return {
            history: built.history,
            audit: {
                ...(threadId ? { threadId } : {}),
                taskIds: requestedTaskIds,
                loadedTaskIds: built.loadedTaskIds,
                skipped: [...skipped, ...built.skipped],
            },
        };
    }
    isEmptyDelivery(snapshot) {
        const summary = snapshot.result?.summary?.trim() ?? '';
        const isFallbackSummary = !summary || summary === '模型没有返回内容。';
        const hasArtifacts = (snapshot.result?.artifacts?.length ?? 0) > 0;
        const hasRecordedArtifacts = snapshot.events.some((e) => e.type === 'artifact_recorded');
        const hasAssistantOutput = snapshot.events.some((e) => e.type === 'assistant_delta');
        return isFallbackSummary && !hasArtifacts && !hasRecordedArtifacts && !hasAssistantOutput;
    }
    async appendRuntimeEvent(taskId, event) {
        const desktopEvents = projectRuntimeEventsToDesktopEvents({ taskId, events: [event] });
        for (const desktopEvent of desktopEvents) {
            await this.appendEvent(taskId, desktopEvent);
        }
    }
    async applyArtifactEvidenceGuard(taskId, snapshot) {
        if (!this.options.aheGuards?.artifactEvidence) {
            return true;
        }
        if (!shouldRequireArtifactEvidence(snapshot)) {
            return true;
        }
        if (hasProjectCreationEvidence(snapshot)) {
            return true;
        }
        const artifacts = collectArtifactEvidence(snapshot);
        const decision = evaluateArtifactEvidenceGuard({
            taskId,
            status: 'completed',
            artifacts,
        });
        if (decision.ok) {
            return true;
        }
        await this.appendEvent(taskId, {
            type: 'progress',
            eventId: `${taskId}:guard:artifact-evidence`,
            message: decision.reason,
            stage: 'blocked',
        });
        await this.appendEvent(taskId, { type: 'error', message: decision.reason });
        await this.updateSnapshot(taskId, {
            status: 'failed',
            salvage: {
                summary: ['AHE artifact evidence guard blocked task completion before an empty delivery could be marked complete.'],
                reason: decision.reason,
            },
        });
        return false;
    }
    async recoverStaleRunningTask(snapshot) {
        if (snapshot.status !== 'running' || this.activeExecutions.has(snapshot.taskId)) {
            return snapshot;
        }
        const salvage = {
            summary: ['任务执行进程已中断，已保留当前快照，可重新发起或基于现有上下文继续。'],
            reason: 'stale_running_task_recovered',
        };
        await this.appendEvent(snapshot.taskId, { type: 'error', message: 'stale_running_task_recovered' });
        await this.updateSnapshot(snapshot.taskId, { status: 'failed', salvage });
        await this.options.snapshotStore.clearActiveTask(snapshot.taskId);
        this.closeSubscribers(snapshot.taskId);
        return this.requireSnapshot(snapshot.taskId);
    }
    async appendEvent(taskId, event) {
        await this.enqueueMutation(taskId, async () => {
            const snapshot = await this.requireSnapshot(taskId);
            // Merge artifacts when appending artifact_recorded events
            let nextResult = snapshot.result;
            if (event.type === 'result') {
                nextResult = event.result;
            }
            else if (event.type === 'artifact_recorded' && snapshot.result) {
                const artifact = {
                    artifactId: event.artifactId,
                    kind: event.kind,
                    title: event.label,
                    createdAt: event.turnId,
                    previewAvailable: event.previewAvailable,
                    filePath: event.filePath,
                    creator: event.creator ?? 'agent',
                };
                nextResult = {
                    ...snapshot.result,
                    artifacts: [...(snapshot.result.artifacts || []), artifact],
                };
            }
            const next = {
                ...snapshot,
                status: event.type === 'task_cancelled' ? 'cancelled' : snapshot.status,
                events: [...snapshot.events, event],
                result: nextResult,
                salvage: event.type === 'salvage' ? event.salvage : snapshot.salvage,
                updatedAt: this.now(),
            };
            await this.saveSnapshot(next);
            this.pushLiveEvent(taskId, event);
        });
    }
    async updateSnapshot(taskId, patch) {
        await this.enqueueMutation(taskId, async () => {
            const snapshot = await this.requireSnapshot(taskId);
            await this.saveSnapshot({
                ...snapshot,
                ...patch,
                updatedAt: this.now(),
            });
        });
    }
    async enqueueMutation(taskId, action) {
        const previous = this.mutationChains.get(taskId) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(action);
        this.mutationChains.set(taskId, next.catch(() => undefined));
        await next;
    }
    async flushMutations(taskId) {
        while (true) {
            const chain = this.mutationChains.get(taskId);
            if (!chain) {
                return;
            }
            await chain;
            if (this.mutationChains.get(taskId) === chain) {
                return;
            }
        }
    }
    async saveSnapshot(snapshot) {
        await this.options.snapshotStore.save(snapshot);
    }
    async requireSnapshot(taskId) {
        const snapshot = await this.options.snapshotStore.recoverTask(taskId);
        if (!snapshot) {
            throw new Error(`task not found: ${taskId}`);
        }
        return snapshot;
    }
    rehydrateWaitingQuestion(snapshot) {
        if (TERMINAL_STATUSES.has(snapshot.status)) {
            return;
        }
        const questionEvent = [...snapshot.events]
            .reverse()
            .find((event) => event.type === 'needs_user');
        if (questionEvent) {
            this.questions.publish(questionEvent.question);
        }
    }
    addSubscriber(taskId, subscription) {
        const existing = this.subscribers.get(taskId) ?? new Set();
        existing.add(subscription);
        this.subscribers.set(taskId, existing);
    }
    removeSubscriber(taskId, subscription) {
        const existing = this.subscribers.get(taskId);
        if (!existing) {
            return;
        }
        existing.delete(subscription);
        if (existing.size === 0) {
            this.subscribers.delete(taskId);
        }
    }
    pushLiveEvent(taskId, event) {
        for (const subscriber of this.subscribers.get(taskId) ?? []) {
            subscriber.push(event);
        }
    }
    closeSubscribers(taskId) {
        for (const subscriber of this.subscribers.get(taskId) ?? []) {
            subscriber.close();
        }
        this.subscribers.delete(taskId);
    }
    createTaskId() {
        if (this.options.createTaskId) {
            return this.options.createTaskId();
        }
        this.taskOrdinal += 1;
        return `task_${this.taskOrdinal}`;
    }
    createSessionId() {
        if (this.options.createSessionId) {
            return this.options.createSessionId();
        }
        this.sessionOrdinal += 1;
        return `sess_${this.sessionOrdinal}`;
    }
    now() {
        return this.options.now?.() ?? Date.now();
    }
}
function isValidContextSnapshot(snapshot) {
    return typeof snapshot.taskId === 'string'
        && snapshot.taskId.trim().length > 0
        && typeof snapshot.prompt === 'string'
        && typeof snapshot.createdAt === 'number'
        && typeof snapshot.updatedAt === 'number'
        && typeof snapshot.status === 'string';
}
function formatAssistantContext(snapshot) {
    const explicitSummary = snapshot.result?.summary?.trim();
    if (explicitSummary) {
        return explicitSummary;
    }
    const resultEvent = [...snapshot.events]
        .reverse()
        .find((event) => event.type === 'result');
    const resultSummary = resultEvent?.result.summary?.trim();
    if (resultSummary) {
        return resultSummary;
    }
    const assistantText = snapshot.events
        .filter((event) => event.type === 'assistant_delta')
        .map(event => event.delta)
        .join('')
        .trim();
    if (assistantText) {
        return assistantText;
    }
    const salvageText = snapshot.salvage?.summary.join('\n').trim();
    if (snapshot.status === 'cancelled') {
        return salvageText ? '上一轮已取消：\n' + salvageText : '上一轮已取消：任务已取消。';
    }
    if (snapshot.status === 'failed') {
        const errorEvent = [...snapshot.events]
            .reverse()
            .find((event) => event.type === 'error');
        const failureText = salvageText || errorEvent?.message || '模型没有返回可恢复摘要。';
        return '上一轮失败：\n' + failureText;
    }
    return '模型没有返回内容。';
}
function truncateContextText(text, maxChars) {
    if (maxChars < 0 || text.length <= maxChars) {
        return text;
    }
    return text.slice(0, maxChars) + '[已截断，保留前 ' + maxChars + ' 字符]';
}
function countHistoryChars(pairs) {
    return pairs.reduce((sum, pair) => sum + pair.user.content.length + pair.assistant.content.length, 0);
}
function dedupeTaskIds(taskIds) {
    const seen = new Set();
    const deduped = [];
    for (const rawTaskId of taskIds) {
        const taskId = normalizeContextId(rawTaskId);
        if (!taskId || seen.has(taskId)) {
            continue;
        }
        seen.add(taskId);
        deduped.push(taskId);
    }
    return deduped;
}
function normalizeContextId(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
function collectArtifactEvidence(snapshot) {
    const resultArtifacts = snapshot.result?.artifacts ?? [];
    const eventArtifacts = snapshot.events.filter((event) => event.type === 'artifact_recorded');
    return [...resultArtifacts, ...eventArtifacts];
}
function hasProjectCreationEvidence(snapshot) {
    return snapshot.events.some((event) => {
        if (event.type !== 'canvas_tool_result') {
            return false;
        }
        if (event.toolName !== 'create_project' || !event.ok) {
            return false;
        }
        return isProjectCardResponse(event.response);
    });
}
function isProjectCardResponse(response) {
    try {
        const parsed = JSON.parse(response);
        return parsed.type === 'project_card'
            && typeof parsed.projectId === 'string'
            && parsed.projectId.trim().length > 0;
    }
    catch {
        return false;
    }
}
function shouldRequireArtifactEvidence(snapshot) {
    const prompt = snapshot.prompt.trim();
    if (!prompt) {
        return false;
    }
    // The current Desktop understanding builder is still sales-deck biased, so
    // the guard follows explicit user wording rather than inferred deliverable.
    if (OPERATIONAL_PROMPT_PATTERN.test(prompt)) {
        return false;
    }
    return ARTIFACT_PROMPT_PATTERN.test(prompt);
}
const OPERATIONAL_PROMPT_PATTERN = /(?:定时任务|提醒我|提醒|闹钟|reminder|schedule|scheduled|继续推进|推进项目|诊断.*项目|项目.*诊断|恢复项目|修复项目|KSwarm|continue_project|让小K帮忙|问小K|卡住|阻塞|stuck project|(?:验证|测试|诊断|检查).*(?:CUA|xiaok_computer_use|cua-driver|Computer Use|computer-use)|(?:CUA|xiaok_computer_use|cua-driver|Computer Use|computer-use).*(?:验证|测试|诊断|检查))/iu;
const ARTIFACT_PROMPT_PATTERN = /(?:ppt|pptx|幻灯片|演示文稿|slides?|deck|报告|文档|文章|故事|小故事|初稿|草稿|稿件|markdown|\.md\b|pdf|word|docx|excel|xlsx|表格|图表|图片|image|html|网页|文件|导出|保存为|生成.*(?:报告|文档|ppt|幻灯片|故事|文章|文件)|写.*(?:报告|文档|故事|文章|稿))/iu;
