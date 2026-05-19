import { evaluateArtifactEvidenceGuard } from '../guards/artifact-evidence-guard.js';
import { runDeliverableGate } from './deliverable-gate.js';
import { projectRuntimeEventsToDesktopEvents } from './event-projection.js';
import { NeedsUserQuestionCorrelator } from './question-correlator.js';
import { buildTaskUnderstanding } from './task-understanding.js';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
export class InProcessTaskRuntimeHost {
    options;
    questions = new NeedsUserQuestionCorrelator();
    subscribers = new Map();
    mutationChains = new Map();
    cancellingTaskIds = new Set();
    history = [];
    activeExecutions = new Map();
    executionPromises = new Map();
    taskOrdinal = 0;
    sessionOrdinal = 0;
    constructor(options) {
        this.options = options;
    }
    async createTask(input) {
        const taskId = this.createTaskId();
        const sessionId = this.createSessionId();
        const materials = input.materials.map((item) => {
            const record = this.options.materialRegistry.get(item.materialId);
            if (!record) {
                throw new Error(`unknown material: ${item.materialId}`);
            }
            return item.role ? { ...record, role: item.role } : record;
        });
        const understanding = buildTaskUnderstanding({ prompt: input.prompt, materials });
        const snapshot = {
            taskId,
            sessionId,
            status: 'understanding',
            prompt: input.prompt,
            materials: materials.map((material) => this.options.materialRegistry.toView(material)),
            understanding,
            events: [],
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
    async *subscribeTask(taskId) {
        const snapshot = await this.requireSnapshot(taskId);
        for (const event of snapshot.events) {
            yield event;
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
        return this.options.snapshotStore.getActiveTasks();
    }
    async getActiveTask() {
        const tasks = await this.getActiveTasks();
        return tasks[0] ?? null;
    }
    async recoverTask(taskId) {
        const snapshot = await this.requireSnapshot(taskId);
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
        this.activeExecutions.set(taskId, { taskId, controller });
        await this.updateSnapshot(taskId, { status: 'running' });
        try {
            await this.options.runner({
                taskId,
                sessionId: snapshot.sessionId,
                prompt: snapshot.prompt,
                materials,
                understanding: snapshot.understanding,
                signal: controller.signal,
                history: [...this.history],
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
                        history: [...this.history],
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
            // Always record history so subsequent tasks see prior context
            const latest = await this.options.snapshotStore.recoverTask(taskId).catch(() => null);
            const assistantNote = latest?.result?.summary
                ?? (this.cancellingTaskIds.has(taskId) ? '任务已取消。' : '模型没有返回内容。');
            this.history.push({ role: 'user', content: snapshot.prompt }, { role: 'assistant', content: assistantNote });
            this.activeExecutions.delete(taskId);
            this.executionPromises.delete(taskId);
            this.cancellingTaskIds.delete(taskId);
        }
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
        await (this.mutationChains.get(taskId) ?? Promise.resolve());
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
function collectArtifactEvidence(snapshot) {
    const resultArtifacts = snapshot.result?.artifacts ?? [];
    const eventArtifacts = snapshot.events.filter((event) => event.type === 'artifact_recorded');
    return [...resultArtifacts, ...eventArtifacts];
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
const OPERATIONAL_PROMPT_PATTERN = /(?:定时任务|提醒我|提醒|闹钟|reminder|schedule|scheduled|继续推进|推进项目|诊断.*项目|项目.*诊断|恢复项目|修复项目|KSwarm|continue_project|让小K帮忙|问小K|卡住|阻塞|stuck project)/iu;
const ARTIFACT_PROMPT_PATTERN = /(?:ppt|pptx|幻灯片|演示文稿|slides?|deck|报告|文档|文章|故事|小故事|初稿|草稿|稿件|markdown|\.md\b|pdf|word|docx|excel|xlsx|表格|图表|图片|image|html|网页|文件|导出|保存为|生成.*(?:报告|文档|ppt|幻灯片|故事|文章|文件)|写.*(?:报告|文档|故事|文章|稿))/iu;
