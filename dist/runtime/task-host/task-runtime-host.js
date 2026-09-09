import { createExecutionHealthMonitor, resolveExecutionIdleMs } from '../execution-health.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { evaluateArtifactEvidenceGuard } from '../guards/artifact-evidence-guard.js';
import { collectArtifactEvidence, buildCompletionEvidenceContext, evidenceForExpectation, shouldRequireArtifactEvidence, hasClarificationResult, isEmptyDelivery } from './delivery-pure.js';
import { runDeliverableGate } from './deliverable-gate.js';
import { HostDeliveryAttempt } from './delivery-attempt.js';
import { DeliveryVerifier } from './delivery-verifier.js';
import { projectRuntimeEventsToDesktopEvents } from './event-projection.js';
import { NeedsUserQuestionCorrelator } from './question-correlator.js';
import { buildTaskUnderstanding } from './task-understanding.js';
function captureTaskSource(snapshot) {
    return { taskId: snapshot.taskId, ...(snapshot.multiAgentPreparation ? { marker: { ...snapshot.multiAgentPreparation } } : {}) };
}
function assertTaskSource(source, snapshot) {
    const marker = snapshot.multiAgentPreparation;
    if (source.taskId !== snapshot.taskId || Boolean(source.marker) !== Boolean(marker)
        || source.marker && (!marker || source.marker.groupId !== marker.groupId || source.marker.rootEpoch !== marker.rootEpoch
            || source.marker.rootTurnId !== marker.rootTurnId || source.marker.preparationId !== marker.preparationId || source.marker.bootId !== marker.bootId)) {
        throw new Error('task_cancellation_source_changed');
    }
}
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_CONTEXT_MAX_TASKS = 12;
const DEFAULT_CONTEXT_MAX_USER_CHARS = 4000;
const DEFAULT_CONTEXT_MAX_ASSISTANT_CHARS = 6000;
const DEFAULT_CONTEXT_MAX_TOTAL_CHARS = 30000;
const RUNNER_DEADLINE_RESERVE_MS = 2 * 60_000;
const ASSISTANT_DELTA_FLUSH_MS = 50;
const ASSISTANT_DELTA_MAX_BUFFER_CHARS = 16 * 1024;
function abortWithReason(controller, reason) {
    controller.abort(new Error(reason));
}
function normalizeAbortReason(reason) {
    if (reason instanceof Error)
        return reason.message;
    if (typeof reason === 'string')
        return reason;
    return 'aborted';
}
function normalizeUsageValue(value) {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
function computeRunnerDeadlineMs(watchdogMs) {
    // A delivery reserve cannot consume virtually all of an explicit short
    // budget. This never extends the host's original absolute watchdog deadline.
    return watchdogMs - Math.min(RUNNER_DEADLINE_RESERVE_MS, watchdogMs / 2);
}
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
    cancellationPromises = new Map();
    cancellationSettlements = new Map();
    assistantDeltaFlushes = new Map();
    taskHistories = new Map();
    activeExecutions = new Map();
    executionPromises = new Map();
    taskWatchdogs = new Map();
    taskOrdinal = 0;
    permissionModes = new Map();
    maxToolLoopIterations = new Map();
    pendingAssistantDeltas = new Map();
    runtimeEventErrors = new Map();
    persistedEventDispatchChains = new Map();
    pendingTerminalPersistedEvents = new Map();
    stoppedAcceptingReason = null;
    identityReservations = new WeakSet();
    admissionPromises = new Map();
    deliveryVerifier = new DeliveryVerifier();
    /** Failure fallback only. Successful delivery always rereads and verifies. */
    lastCommittedSnapshots = new Map();
    multiAgentRecovery;
    recoveryReadSignal = new AbortController().signal;
    taskIdleTimeoutMs;
    constructor(options) {
        this.options = options;
        this.taskIdleTimeoutMs = resolveExecutionIdleMs(options.taskIdleTimeoutMs === undefined ? process.env.XIAOK_TASK_IDLE_TIMEOUT_MS : String(options.taskIdleTimeoutMs));
    }
    /** Installed once by service.initialize, before its recovery microtask runs. */
    bindMultiAgentRecovery(ready) {
        if (this.multiAgentRecovery && this.multiAgentRecovery !== ready)
            throw new Error('multi_agent_recovery_already_bound');
        this.multiAgentRecovery = ready;
        void ready.catch(() => undefined);
    }
    /** No filesystem/index write and no runnable task until prepareTask commits. */
    reserveTaskIdentity() {
        if (this.stoppedAcceptingReason)
            throw new Error(`shutting_down: ${this.stoppedAcceptingReason}`);
        const reservation = Object.freeze({ taskId: this.options.createTaskId?.() ?? `task_${randomUUID()}`, reservationId: randomUUID() });
        this.identityReservations.add(reservation);
        return reservation;
    }
    async prepareTask(input, preparation) {
        let marker;
        const taskId = preparation?.reservation?.taskId ?? this.createTaskId();
        if (preparation) {
            if (!this.identityReservations.has(preparation.reservation))
                throw new Error('invalid or consumed task identity reservation');
            if (!this.options.authorizePreparation)
                throw new Error('multi_agent_preparation_not_supported');
            marker = { ...preparation.marker };
            this.options.authorizePreparation(taskId, marker);
            this.identityReservations.delete(preparation.reservation);
        }
        if (input.permissionMode) {
            this.permissionModes.set(taskId, input.permissionMode);
        }
        if (input.watchdogMs !== undefined && Number.isFinite(input.watchdogMs) && input.watchdogMs > 0) {
            this.taskWatchdogs.set(taskId, input.watchdogMs);
        }
        if (input.maxToolLoopIterations !== undefined && Number.isFinite(input.maxToolLoopIterations) && input.maxToolLoopIterations > 0) {
            this.maxToolLoopIterations.set(taskId, input.maxToolLoopIterations);
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
            executionScope: input.executionScope,
            ...(marker ? { multiAgentPreparation: marker } : {}),
            usage: { inputTokens: 0, outputTokens: 0, known: false },
            createdAt: this.now(),
            updatedAt: this.now(),
        };
        await this.saveSnapshot(snapshot);
        await this.appendEvent(taskId, { type: 'task_started', taskId });
        await this.appendEvent(taskId, { type: 'understanding_updated', understanding });
        return { taskId, understanding };
    }
    async startTask(taskId) {
        // The duplicate guard runs inside startTrackedExecution, before its first
        // await, so a concurrent duplicate loses deterministically instead of
        // racing a snapshot read. This is a deliberate behaviour change (R27-02):
        // concurrent duplicates now surface "already started" rather than a later
        // snapshot/terminal error.
        const tracked = this.startTrackedExecution(taskId);
        await this.admissionPromises.get(taskId);
        const snapshot = await this.requireSnapshot(taskId);
        if (TERMINAL_STATUSES.has(snapshot.status)) {
            throw new Error(`task is terminal: ${taskId}`);
        }
        void tracked;
    }
    /**
     * The single production entry point that registers a background execution.
     * Both `startTask()` and the confirm path of `answerQuestion()` go through
     * here, so `drain()` observes a real map rather than a second counter.
     */
    startTrackedExecution(taskId) {
        if (this.executionPromises.has(taskId) || this.activeExecutions.has(taskId)) {
            throw new Error(`task already started: ${taskId}`);
        }
        if (this.stoppedAcceptingReason) {
            throw new Error(`shutting_down: ${this.stoppedAcceptingReason}`);
        }
        const token = this.options.acquireExecutionToken?.(taskId) ?? null;
        const admission = this.options.assertTaskAdmission
            ? this.requireSnapshot(taskId).then(snapshot => this.options.assertTaskAdmission(snapshot))
            : Promise.resolve();
        this.admissionPromises.set(taskId, admission);
        const execPromise = admission.then(() => this.executeTask(taskId))
            .catch(() => undefined)
            .finally(() => this.finalizeExecution(taskId, () => {
            this.executionPromises.delete(taskId);
            this.admissionPromises.delete(taskId);
            token?.release();
        }));
        this.executionPromises.set(taskId, execPromise);
        return execPromise;
    }
    /** Shutdown owner API (§5.5 phase ③). */
    stopAccepting(reason = 'app_shutdown') {
        this.stoppedAcceptingReason = reason;
    }
    abortAllActive(reason = 'app_shutdown') {
        for (const execution of this.activeExecutions.values()) {
            if (reason === 'app_shutdown')
                execution.deliveryShutdownRequested = true;
            this.requestExecutionAbort(execution, reason);
        }
    }
    async drain() {
        while (this.executionPromises.size > 0 || this.cancellationPromises.size > 0) {
            await Promise.allSettled([...this.executionPromises.values(), ...this.cancellationPromises.keys()]);
        }
    }
    activeExecutionCount() {
        return this.executionPromises.size;
    }
    /** Main owner inspection, including admitted work before executeTask starts. */
    inFlightTaskIds() {
        return [...new Set([...this.executionPromises.keys(), ...this.activeExecutions.keys()])];
    }
    async createTask(input) {
        const prepared = await this.prepareTask(input);
        await this.startTask(prepared.taskId);
        return prepared;
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
        if (this.options.assertTaskAdmission)
            await this.options.assertTaskAdmission(await this.requireSnapshot(input.taskId));
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
            // Tracked so a confirm-triggered execution is visible to drain(); the
            // external timing (await until this execution finishes) is preserved.
            await this.startTrackedExecution(input.taskId);
        }
    }
    cancelTask(taskId, reason = 'user_cancelled') {
        const existing = this.cancellationSettlements.get(taskId);
        const joined = existing && !existing.settled ? existing : undefined;
        const promise = Promise.resolve().then(() => this.cancelTaskOwned(taskId, reason, joined)).finally(() => {
            this.cancellationPromises.delete(promise);
            if (!this.executionPromises.has(taskId) && ![...this.cancellationPromises.values()].includes(taskId)) {
                this.cancellationSettlements.delete(taskId);
                this.cancellingTaskIds.delete(taskId);
                this.assistantDeltaFlushes.delete(taskId);
                this.runtimeEventErrors.delete(taskId);
            }
        });
        this.cancellationPromises.set(promise, taskId);
        return promise;
    }
    async cancelTaskOwned(taskId, reason, joined) {
        const snapshot = await this.requireSnapshot(taskId);
        const source = captureTaskSource(snapshot);
        if (TERMINAL_STATUSES.has(snapshot.status)) {
            if (joined) {
                assertTaskSource(joined.source, snapshot);
                const outcome = await joined.settlement;
                if (!outcome.ok)
                    throw outcome.error;
            }
            await this.enqueueMutation(taskId, async () => {
                const current = await this.requireSnapshot(taskId);
                assertTaskSource(source, current);
                await this.cleanupCancellationLocked(taskId, current);
            });
            return;
        }
        const decision = this.options.decideCancellation
            ? await this.options.decideCancellation(snapshot, reason)
            : undefined;
        if (decision && !decision.hostAbortAllowed)
            return;
        let record;
        let execution;
        let settle;
        await this.enqueueMutation(taskId, async () => {
            const current = await this.requireSnapshot(taskId);
            assertTaskSource(source, current);
            const existing = joined ?? this.cancellationSettlements.get(taskId);
            if (existing && (!existing.settled || joined === existing)) {
                assertTaskSource(existing.source, current);
                record = existing;
                return;
            }
            if (TERMINAL_STATUSES.has(current.status)) {
                await this.cleanupCancellationLocked(taskId, current);
                return;
            }
            const settlement = new Promise(resolve => { settle = resolve; });
            record = { source, settlement, settled: false };
            this.cancellationSettlements.set(taskId, record);
            this.cancellingTaskIds.add(taskId);
            execution = this.activeExecutions.get(taskId);
        });
        if (!record)
            return;
        if (settle) {
            let failure;
            try {
                if (execution && this.activeExecutions.get(taskId) === execution)
                    abortWithReason(execution.controller, reason);
                try {
                    await this.flushRuntimeEvents(taskId);
                }
                catch (error) {
                    failure = { error };
                }
                await this.enqueueMutation(taskId, async () => {
                    const current = await this.requireSnapshot(taskId);
                    assertTaskSource(source, current);
                    if (!TERMINAL_STATUSES.has(current.status)) {
                        const failed = failure !== undefined;
                        const salvage = failed
                            ? { summary: ['Cancellation could not flush the original runtime output.'], reason: 'cancellation_flush_failed' }
                            : { summary: ['任务已取消，可基于已识别的任务理解继续。'], reason: 'cancelled' };
                        const status = failed ? 'failed' : 'cancelled';
                        const events = [failed ? { type: 'error', message: 'cancellation_flush_failed' } : { type: 'salvage', salvage },
                            { type: 'task_terminal', status }];
                        const next = { ...current, status, salvage, events: [...current.events, ...events], updatedAt: this.now() };
                        const receipt = { source, snapshot: next, eventIndex: current.events.length, events, published: 0 };
                        record.receipt = receipt;
                        let committed;
                        try {
                            await this.saveSnapshot(next, current);
                            committed = next;
                        }
                        catch (error) {
                            failure ??= { error };
                        }
                        try {
                            committed = await this.confirmReceiptLocked(receipt, committed);
                        }
                        catch (error) {
                            failure ??= { error };
                        }
                        if (committed) {
                            try {
                                await this.cleanupCancellationLocked(taskId, committed);
                            }
                            catch (error) {
                                failure ??= { error };
                            }
                            // The original terminal map now owns the only deferred snapshot.
                            // Followers need the outcome, not another entire task history.
                            record.receipt = undefined;
                        }
                        else
                            this.closeSubscribers(taskId);
                    }
                    else
                        await this.cleanupCancellationLocked(taskId, current);
                });
            }
            catch (error) {
                failure ??= { error };
            }
            finally {
                record.settled = true;
                settle(failure ? { ok: false, error: failure.error } : { ok: true });
            }
        }
        const outcome = await record.settlement;
        if (!outcome.ok)
            throw outcome.error;
        if (decision?.ack === 'unknown')
            throw new Error('multi_agent_cancellation_persistence_failed');
    }
    /** Only original FileStore facts can confirm a save which rejected. Its cache
     * is committed only after append; an append rejection invalidates that cache. */
    async confirmReceiptLocked(receipt, committed) {
        const current = committed ?? await this.requireSnapshot(receipt.source.taskId);
        assertTaskSource(receipt.source, current);
        const end = receipt.eventIndex + receipt.events.length;
        if (current.events.length < end)
            return undefined; // incomplete append, not a new write permission
        if (!isDeepStrictEqual(current.events.slice(0, end), receipt.snapshot.events.slice(0, end))) {
            throw new Error('task_cancellation_receipt_conflict');
        }
        if (receipt.events.some(event => event.type === 'task_terminal')
            && (current.status !== receipt.snapshot.status || !isDeepStrictEqual(current.salvage, receipt.snapshot.salvage))) {
            throw new Error('task_cancellation_receipt_conflict');
        }
        while (receipt.published < receipt.events.length) {
            const eventIndex = receipt.eventIndex + receipt.published;
            const event = current.events[eventIndex];
            const persisted = { taskId: current.taskId, eventIndex, event, snapshot: current };
            if (event.type === 'task_terminal')
                this.retainTerminalReceipt(persisted);
            else
                this.schedulePersistedEvent(persisted);
            this.pushLiveEvent(current.taskId, event);
            receipt.published++;
        }
        return current;
    }
    retainTerminalReceipt(input) {
        const existing = this.pendingTerminalPersistedEvents.get(input.taskId);
        if (existing) {
            if (existing.eventIndex !== input.eventIndex || !isDeepStrictEqual(existing.event, input.event)) {
                throw new Error('task_terminal_receipt_conflict');
            }
            assertTaskSource(captureTaskSource(existing.snapshot), input.snapshot);
        }
        this.pendingTerminalPersistedEvents.set(input.taskId, input);
    }
    /** Called under the original writer queue. There is no await between the
     * final fact validation, replacement and the unique terminal map take. */
    handoffTerminalLocked(taskId, current) {
        const pending = this.pendingTerminalPersistedEvents.get(taskId);
        if (!pending)
            return;
        assertTaskSource(captureTaskSource(pending.snapshot), current);
        if (current.status !== pending.snapshot.status
            || !isDeepStrictEqual(current.events.slice(0, pending.eventIndex + 1), pending.snapshot.events.slice(0, pending.eventIndex + 1))) {
            throw new Error('task_terminal_receipt_conflict');
        }
        this.pendingTerminalPersistedEvents.set(taskId, { ...pending, snapshot: current });
        this.flushPendingTerminalPersistedEvent(taskId);
    }
    async cleanupCancellationLocked(taskId, current) {
        if (!TERMINAL_STATUSES.has(current.status))
            return;
        try {
            await this.options.snapshotStore.clearActiveTask(taskId);
        }
        finally {
            this.closeSubscribers(taskId);
            // This caller's original IO is settled; it never waits its own Promise.
            // Admission/runner still present instead leave the receipt to outer finally.
            if (!this.executionPromises.has(taskId))
                this.handoffTerminalLocked(taskId, current);
        }
    }
    async finalizeExecution(taskId, release) {
        const pendingCancellations = () => [...this.cancellationPromises].filter(([, id]) => id === taskId).map(([promise]) => promise);
        try {
            while (true) {
                const pending = pendingCancellations();
                if (pending.length) {
                    await Promise.allSettled(pending);
                    continue;
                }
                // Wait the batch actually dispatched by the timer, not a caught queue
                // tail or a second flush. Never-settling SDK IO keeps the owner resident.
                const batch = this.assistantDeltaFlushes.get(taskId);
                if (batch)
                    await Promise.allSettled([batch.promise]);
                try {
                    await this.enqueueMutation(taskId, async () => {
                        if (pendingCancellations().length)
                            return;
                        const cancellation = this.cancellationSettlements.get(taskId);
                        let current;
                        if (cancellation?.receipt && cancellation.receipt.published < cancellation.receipt.events.length) {
                            current = await this.confirmReceiptLocked(cancellation.receipt);
                        }
                        if (this.pendingTerminalPersistedEvents.has(taskId)) {
                            if (cancellation) {
                                current ??= await this.requireSnapshot(taskId);
                                if (pendingCancellations().length)
                                    return;
                                this.handoffTerminalLocked(taskId, current);
                            }
                            else
                                this.flushPendingTerminalPersistedEvent(taskId);
                        }
                    });
                }
                catch (error) {
                    // A missing final fact is unknown, not permission to publish an old
                    // zero-cost snapshot as current. This observation has truly settled.
                    this.pendingTerminalPersistedEvents.delete(taskId);
                    console.warn('[task-host] cancellation finalization unconfirmed:', error instanceof Error ? error.message : String(error));
                }
                // An explicit stop can enter during a real read. Recheck before the
                // synchronous physical release, not only before that read began.
                if (!pendingCancellations().length)
                    break;
            }
        }
        finally {
            this.taskHistories.delete(taskId);
            this.permissionModes.delete(taskId);
            this.taskWatchdogs.delete(taskId);
            this.maxToolLoopIterations.delete(taskId);
            this.activeExecutions.delete(taskId);
            this.cancellingTaskIds.delete(taskId);
            this.clearPendingAssistantDelta(taskId);
            this.assistantDeltaFlushes.delete(taskId);
            this.runtimeEventErrors.delete(taskId);
            this.lastCommittedSnapshots.delete(taskId);
            this.cancellationSettlements.delete(taskId);
            this.pendingTerminalPersistedEvents.delete(taskId);
            this.closeSubscribers(taskId);
            release();
        }
    }
    async getActiveTasks() {
        const refs = await this.inspectActiveTasks();
        const activeRefs = [];
        for (const ref of refs) {
            let snapshot = await this.inspectTask(ref.taskId);
            if (snapshot && Object.hasOwn(snapshot, 'multiAgentPreparation')) {
                await this.waitForMultiAgentRecovery();
                snapshot = await this.inspectTask(ref.taskId);
            }
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
        let current = await this.requireSnapshot(taskId);
        if (Object.hasOwn(current, 'multiAgentPreparation')) {
            await this.waitForMultiAgentRecovery();
            current = await this.requireSnapshot(taskId);
        }
        const snapshot = await this.recoverStaleRunningTask(current);
        this.rehydrateWaitingQuestion(snapshot);
        return { snapshot };
    }
    /** Read-only startup inspection; unlike recoverTask, this never changes status. */
    inspectTask(taskId, options) {
        const raw = this.options.snapshotStore.recoverTask(taskId, options
            ? { signal: this.recoveryReadSignal, trackPending: options.trackPending } : undefined);
        options?.trackPending(raw);
        return raw;
    }
    /** Startup uses this read-only index access; public reads must not await
     * themselves through service.initialize or clear index entries prematurely. */
    inspectActiveTasks() {
        return this.options.snapshotStore.getActiveTasks();
    }
    async waitForMultiAgentRecovery() {
        if (!this.multiAgentRecovery)
            throw new Error('multi_agent_recovery_not_bound');
        await this.multiAgentRecovery;
    }
    async abandonMultiAgentPreparation(input) {
        if (input.requestSource !== 'scheduler')
            throw new Error('preparation recovery source is not permitted');
        const taskId = input.taskId;
        const expectedMarker = { ...input.expectedMarker };
        const trackPending = input.trackPending;
        const recovery = input.delivery ? { authority: input.delivery.authority, record: structuredClone(input.delivery.record) } : undefined;
        const track = (raw) => { trackPending?.(raw); return raw; };
        const load = async () => {
            if (!trackPending && !recovery)
                return this.requireSnapshot(taskId);
            const snapshot = await this.inspectTask(taskId, { trackPending: track });
            if (!snapshot)
                throw new Error(`task not found: ${taskId}`);
            return snapshot;
        };
        const authorize = (snapshot) => {
            if (!recovery)
                return;
            if (!this.options.authorizeDeliveryRecovery)
                throw new Error('host_delivery_recovery_not_supported');
            this.options.authorizeDeliveryRecovery({ authority: recovery.authority, taskId,
                snapshot, delivery: recovery.record });
        };
        if (recovery)
            authorize(await load());
        let persisted;
        await track(this.enqueueMutation(taskId, async () => {
            const snapshot = await load();
            authorize(snapshot);
            const marker = snapshot.multiAgentPreparation;
            if (!marker || ['groupId', 'rootEpoch', 'rootTurnId', 'preparationId', 'bootId']
                .some(key => marker[key] !== expectedMarker[key]))
                throw new Error('preparation recovery marker mismatch');
            if (this.executionPromises.has(taskId) || this.activeExecutions.has(taskId))
                throw new Error('cannot recover a live execution');
            if (TERMINAL_STATUSES.has(snapshot.status))
                return;
            if (recovery && !Number.isSafeInteger(recovery.record.revision + 1))
                throw new Error('host_delivery_recovery_revision_overflow');
            const event = { type: 'task_terminal', status: 'failed' };
            const reason = recovery ? 'recovery_unconfirmed' : 'multi_agent_prepare_interrupted';
            const hostDelivery = recovery ? {
                ...recovery.record, revision: recovery.record.revision + 1,
                status: 'unknown', stage: 'settle', hostSettlement: 'committed', hostTerminalStatus: 'failed',
                guardFailure: { code: 'recovery_unconfirmed', stage: 'settle', needsExplicitFollowup: true },
                finishedAt: this.now(), readerCleanup: recovery.record.readerCleanup === 'none' ? 'none' : 'settled',
                storeCleanup: 'settled',
            } : undefined;
            const next = { ...snapshot, status: 'failed', updatedAt: this.now(),
                salvage: { summary: [reason], reason },
                events: [...snapshot.events, { type: 'error', message: reason }, event],
                ...(hostDelivery ? { hostDelivery } : {}),
            };
            // All construction above is synchronous. This is the final authority
            // boundary immediately before the sole recovery mutation is dispatched.
            authorize(snapshot);
            await track(this.saveSnapshot(next, snapshot));
            persisted = { taskId, eventIndex: next.events.length - 1, event, snapshot: next };
            this.pushLiveEvent(taskId, event);
        }));
        await track(this.options.snapshotStore.clearActiveTask(taskId));
        this.closeSubscribers(taskId);
        if (persisted)
            this.schedulePersistedEvent(persisted);
    }
    isExecutingForTest(taskId) {
        return this.activeExecutions.has(taskId);
    }
    async executeTask(taskId) {
        const snapshot = await this.requireSnapshot(taskId);
        if (!snapshot.understanding) {
            throw new Error(`task has no understanding: ${taskId}`);
        }
        const policy = this.options.getExecutionPolicy?.(snapshot);
        const materials = snapshot.materials.map((material) => {
            const record = this.options.materialRegistry.get(material.materialId);
            if (!record) {
                throw new Error(`unknown material: ${material.materialId}`);
            }
            return record;
        });
        const controller = new AbortController();
        const taskHistory = this.taskHistories.get(taskId) ?? [];
        const execution = { taskId, controller, phase: 'runner' };
        let started = false;
        await this.enqueueMutation(taskId, async () => {
            const current = await this.requireSnapshot(taskId);
            assertTaskSource(captureTaskSource(snapshot), current);
            if (TERMINAL_STATUSES.has(current.status) || this.cancellationSettlements.has(taskId))
                return;
            this.activeExecutions.set(taskId, execution);
            await this.saveSnapshot({ ...current, status: 'running', updatedAt: this.now() }, current);
            started = true;
        });
        if (!started)
            return;
        execution.health = createExecutionHealthMonitor({
            idleMs: this.taskIdleTimeoutMs,
            onStalled: () => { if (this.activeExecutions.get(taskId) === execution)
                this.requestExecutionAbort(execution, 'task_idle_timeout'); },
            onState: state => {
                if (this.activeExecutions.get(taskId) !== execution)
                    return;
                // Health is a later observation, never a shortcut around an already
                // buffered model event and its checkpoint/publication receipt.
                void this.flushPendingAssistantDelta(taskId)
                    .then(() => this.activeExecutions.get(taskId) === execution
                    ? this.appendEvent(taskId, { type: 'execution_health', state }, { runtimeOrigin: true }) : undefined)
                    .catch(error => this.runtimeEventErrors.set(taskId, error));
            },
        });
        const onHealthAbort = () => execution.health?.cancel();
        controller.signal.addEventListener('abort', onHealthAbort, { once: true });
        const configuredWatchdog = this.taskWatchdogs.get(taskId) ?? this.options.taskWatchdogMs;
        const watchdogMs = configuredWatchdog !== undefined && Number.isFinite(configuredWatchdog) && configuredWatchdog > 0
            ? configuredWatchdog : undefined;
        const deadlineMs = watchdogMs === undefined ? undefined : computeRunnerDeadlineMs(watchdogMs);
        // Runtime duration is unlimited unless explicitly bounded. Delivery is a
        // separate finite I/O transaction, begun only after that runner returns.
        let deliveryDeadline = watchdogMs === undefined ? undefined : performance.now() + watchdogMs;
        let watchdogStartedAt = this.now();
        let watchdogTimer;
        const onWatchdog = () => {
            const execution = this.activeExecutions.get(taskId);
            if (execution?.controller !== controller)
                return;
            // Ordinary runner timing stays unchanged. Once sealed, both watchdog
            // and verifier honor the same absolute monotonic delivery deadline.
            if (deliveryDeadline !== undefined) {
                const remaining = deliveryDeadline - performance.now();
                if (remaining > 0) {
                    watchdogTimer = setTimeout(onWatchdog, Math.min(2 ** 31 - 1, Math.max(1, Math.ceil(remaining))));
                    return;
                }
            }
            this.requestExecutionAbort(execution, 'task_watchdog_timeout');
        };
        if (watchdogMs !== undefined)
            watchdogTimer = setTimeout(onWatchdog, Math.min(2 ** 31 - 1, watchdogMs));
        try {
            if (this.activeExecutions.get(taskId) !== execution || controller.signal.aborted || this.cancellingTaskIds.has(taskId))
                return;
            await this.options.runner({
                taskId,
                sessionId: snapshot.sessionId,
                prompt: snapshot.prompt,
                materials,
                understanding: snapshot.understanding,
                signal: controller.signal,
                deadlineMs,
                history: [...taskHistory],
                permissionMode: this.permissionModes.get(taskId),
                maxToolLoopIterations: this.maxToolLoopIterations.get(taskId),
                executionScope: snapshot.executionScope,
                emitRuntimeEvent: (event) => this.activeExecutions.get(taskId) === execution ? this.appendRuntimeEvent(taskId, event) : Promise.resolve(),
                emitUsage: (usage) => this.appendUsage(taskId, usage),
            });
            controller.signal.throwIfAborted();
            if (policy?.deliveryRepair === 'explicit' && snapshot.multiAgentPreparation
                && !controller.signal.aborted && !this.cancellingTaskIds.has(taskId)) {
                const deliveryBudget = watchdogMs ?? RUNNER_DEADLINE_RESERVE_MS;
                if (deliveryDeadline === undefined) {
                    watchdogStartedAt = this.now();
                    deliveryDeadline = performance.now() + deliveryBudget;
                    watchdogTimer = setTimeout(onWatchdog, deliveryBudget);
                }
                await this.finishExplicitDelivery(execution, snapshot, deliveryDeadline, watchdogStartedAt, deliveryBudget);
                return;
            }
            if (this.cancellingTaskIds.has(taskId))
                return;
            await this.flushRuntimeEvents(taskId);
            const latest = await this.requireSnapshot(taskId);
            if (latest.status !== 'cancelled' && !this.cancellingTaskIds.has(taskId)) {
                // Layer 3: Deliverable Gate — check if all requested deliverables were produced
                // A sealed multi-agent root cannot be reentered by a model-backed gate
                // or an implicit repair turn. Its built-in evidence check still runs.
                const gatePass = await runDeliverableGate(latest, policy?.deliveryRepair === 'explicit' ? undefined : this.options.completionGate, controller.signal);
                if (!gatePass && !this.cancellingTaskIds.has(taskId)) {
                    if (policy?.deliveryRepair === 'explicit')
                        throw new Error('needs_explicit_followup');
                    // Retry once with a resume prompt
                    await this.options.runner({
                        taskId,
                        sessionId: snapshot.sessionId,
                        prompt: '你之前的执行遗漏了部分交付物。请回顾用户原始请求，继续完成所有尚未生成的产物。',
                        materials: [],
                        understanding: snapshot.understanding,
                        signal: controller.signal,
                        deadlineMs,
                        history: [...taskHistory],
                        permissionMode: this.permissionModes.get(taskId),
                        maxToolLoopIterations: this.maxToolLoopIterations.get(taskId),
                        executionScope: snapshot.executionScope,
                        emitRuntimeEvent: (event) => this.activeExecutions.get(taskId) === execution ? this.appendRuntimeEvent(taskId, event) : Promise.resolve(),
                        emitUsage: (usage) => this.appendUsage(taskId, usage),
                    });
                    await this.flushRuntimeEvents(taskId);
                }
                const guardedLatest = await this.requireSnapshot(taskId);
                if (!await this.applyArtifactEvidenceGuard(taskId, guardedLatest, execution)) {
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
                    }, { runtimeOrigin: true });
                    const currentResult = guardedLatest.result ?? { summary: '', artifacts: [] };
                    await this.updateSnapshot(taskId, { result: { ...currentResult, degraded: true } }, execution);
                }
                await this.updateSnapshot(taskId, { status: 'completed' }, execution);
                await this.options.snapshotStore.clearActiveTask(taskId);
                this.closeSubscribers(taskId);
            }
        }
        catch (error) {
            // Delivery has one settlement owner. Never reenter the runner catch's
            // flush/write sequence after a post-seal error or partially committed save.
            if (execution.delivery)
                throw error;
            if (this.cancellingTaskIds.has(taskId))
                return;
            let executionError = error;
            try {
                await this.flushRuntimeEvents(taskId);
            }
            catch (flushError) {
                executionError = flushError;
            }
            if (this.cancellingTaskIds.has(taskId)) {
                return;
            }
            const message = controller.signal.aborted
                ? normalizeAbortReason(controller.signal.reason)
                : executionError instanceof Error
                    ? executionError.message
                    : String(executionError);
            const salvage = {
                summary: [
                    snapshot.understanding ? '已保留任务理解' : '已保留任务输入',
                    `已保留 ${snapshot.materials.length} 个材料引用`,
                ],
                reason: message,
            };
            await this.appendEvent(taskId, { type: 'error', message }, { runtimeOrigin: true });
            await this.updateSnapshot(taskId, { status: 'failed', salvage }, execution);
            await this.options.snapshotStore.clearActiveTask(taskId);
            this.closeSubscribers(taskId);
            throw executionError;
        }
        finally {
            clearTimeout(watchdogTimer);
            execution.health?.dispose();
            controller.signal.removeEventListener('abort', onHealthAbort);
        }
    }
    async finishExplicitDelivery(execution, initial, deadline, startedAt, watchdogMs) {
        const taskId = execution.taskId;
        const delivery = new HostDeliveryAttempt({ sourceTaskId: taskId, ...initial.multiAgentPreparation }, deadline, startedAt, startedAt + watchdogMs, () => this.now(), this.options.onDeliveryReport);
        execution.delivery = delivery;
        execution.health?.dispose();
        execution.phase = 'delivery';
        // Buffer timers belong to the runner. Do not let a previously scheduled
        // delta flush cross the durable checking handoff ahead of its ACK.
        const buffered = this.pendingAssistantDeltas.get(taskId);
        if (buffered?.timer) {
            clearTimeout(buffered.timer);
            buffered.timer = null;
        }
        let verified;
        let guardMessage;
        let validationStarted = false;
        try {
            await delivery.begin();
            if (execution.deliveryShutdownRequested)
                delivery.abort('app_shutdown');
            delivery.assertActive();
            validationStarted = true;
            delivery.record = { ...delivery.record, storeCleanup: 'pending' };
            await delivery.wait(this.flushRuntimeEvents(taskId));
            delivery.record = { ...delivery.record, stage: 'snapshot' };
            await delivery.wait(this.requireSnapshot(taskId));
            const latest = await delivery.wait(this.requireSnapshot(taskId));
            delivery.assertActive();
            delivery.record = { ...delivery.record, stage: 'verify' };
            verified = await delivery.wait(this.deliveryVerifier.verify(latest, {
                signal: delivery.controller.signal, deadline, trackPending: raw => {
                    delivery.readerStarted = true;
                    delivery.record = { ...delivery.record, readerCleanup: 'pending' };
                    delivery.track(raw);
                },
                artifactEvidence: this.options.aheGuards?.artifactEvidence === true,
            }));
            // verify only resolves after the actual Worker exit and file checks; its
            // separate physical receipt remains owned through every exceptional path.
            delivery.assertActive();
            if (!verified.planComplete)
                delivery.fail('deliverables_incomplete');
            else if (verified.guard && !verified.guard.ok) {
                guardMessage = verified.guard.reason;
                delivery.fail('artifact_evidence_failed');
            }
            else
                delivery.pass();
        }
        catch (error) {
            if (delivery.record.verification === 'pending') {
                const code = error instanceof Error ? error.message : '';
                const verifierCodes = ['delivery_timeout', 'app_shutdown', 'verifier_start_failed',
                    'verifier_crashed', 'verifier_protocol_error', 'verifier_internal_error', 'verifier_capacity', 'validation_limit'];
                delivery.fail(verifierCodes.includes(code) ? code
                    : delivery.record.stage === 'snapshot' ? 'snapshot_read_failed'
                        : delivery.record.stage === 'verify' ? 'verifier_internal_error' : 'snapshot_write_failed');
            }
            delivery.unknown();
        }
        execution.phase = 'settling';
        delivery.record = { ...delivery.record, stage: 'settle' };
        try {
            // No second writer is dispatched while a timed-out flush/read/Worker or
            // opaque reporting call still owns its physical operation.
            await delivery.drain();
            await this.settleExplicitDelivery(taskId, initial, delivery, validationStarted, verified?.emptyDelivery === true, guardMessage);
        }
        catch {
            // A failed persistence receipt is not a verifier decision and cannot
            // reverse a terminal that the original writer may already have committed.
            const alreadyUnknown = delivery.record.status === 'unknown';
            if (!delivery.record.guardFailure)
                delivery.record = { ...delivery.record,
                    guardFailure: { code: 'snapshot_write_failed', stage: 'settle', needsExplicitFollowup: true } };
            delivery.unknown();
            if (alreadyUnknown)
                delivery.publish();
        }
        finally {
            await delivery.drain();
            if (delivery.record.status === 'unknown' && (delivery.record.storeCleanup === 'pending'
                || delivery.record.readerCleanup === 'pending')) {
                // Rejection is a physical settlement too. Keep persistence unknown,
                // but do not leave a false cleanup lock once every original IO exited.
                // This is one observation, not another snapshot writer or verifier.
                delivery.record = { ...delivery.record, stage: 'cleanup', storeCleanup: 'settled',
                    readerCleanup: delivery.readerStarted ? 'settled' : 'none' };
                delivery.publish();
                await delivery.drain();
            }
        }
    }
    async settleExplicitDelivery(taskId, initial, delivery, validationStarted, emptyDelivery, guardMessage) {
        const passed = delivery.record.verification === 'passed';
        const status = passed ? 'completed' : 'failed';
        let persisted;
        await delivery.track(this.enqueueMutation(taskId, async () => {
            // Before the checking ACK there is no permission for a delivery read.
            // The last actual commit is used only to preserve the failure identity.
            const snapshot = validationStarted ? await this.requireSnapshot(taskId)
                : this.lastCommittedSnapshots.get(taskId) ?? initial;
            if (TERMINAL_STATUSES.has(snapshot.status))
                return;
            let events = [...snapshot.events];
            let result = snapshot.result;
            let salvage = snapshot.salvage;
            if (passed && emptyDelivery) {
                events.push({ type: 'progress', eventId: `${taskId}:degraded`,
                    message: '任务完成但未产出实质内容，已标记为降级交付。', stage: 'warning' });
                result = { ...(result ?? { summary: '', artifacts: [] }), degraded: true };
            }
            else if (!passed) {
                if (delivery.record.guardFailure?.code === 'artifact_evidence_failed') {
                    events.push({ type: 'progress', eventId: `${taskId}:guard:artifact-evidence`,
                        message: guardMessage ?? 'artifact_evidence_failed', stage: 'blocked' });
                    salvage = { summary: ['Completion evidence guard blocked task completion.'], reason: guardMessage ?? 'artifact_evidence_failed' };
                }
                else {
                    salvage = { summary: [initial.understanding ? '已保留任务理解' : '已保留任务输入',
                            `已保留 ${initial.materials.length} 个材料引用`], reason: 'needs_explicit_followup' };
                }
                events.push({ type: 'error', message: guardMessage ?? 'needs_explicit_followup' });
            }
            const terminal = { type: 'task_terminal', status };
            events.push(terminal);
            const committed = (finishedAt = this.now()) => {
                // Reserve the candidate's number before dispatching its writer. A
                // concurrent timeout observation must not reuse that same revision for
                // a different payload while the journal is already durably visible.
                delivery.record = { ...delivery.record, revision: delivery.record.revision + 1 };
                return { ...delivery.record, status: passed ? 'passed' : 'failed', stage: 'settle', hostSettlement: 'committed',
                    hostTerminalStatus: status, finishedAt,
                    readerCleanup: delivery.readerStarted ? 'settled' : 'none', storeCleanup: 'settled' };
            };
            let candidate = committed();
            let next = { ...snapshot, status, result, salvage, events, updatedAt: this.now(),
                ...(delivery.acknowledged ? { hostDelivery: candidate } : {}) };
            let repairIndex = false;
            try {
                await this.saveSnapshot(next, snapshot);
            }
            catch (error) {
                // save() has physically exited. Journal commit can precede checkpoint
                // or index failure, so read that original aggregate before compensating.
                if (!delivery.acknowledged)
                    throw error;
                repairIndex = true;
                delivery.unknown();
                const actual = await this.requireSnapshot(taskId);
                if (TERMINAL_STATUSES.has(actual.status)) {
                    if (actual.status !== status || !actual.hostDelivery
                        || actual.hostDelivery.verification !== delivery.record.verification)
                        throw error;
                    next = actual;
                }
                else {
                    // One registered compensation, in this same mutation queue; it never
                    // reruns the verifier or flushes buffered output a second time.
                    candidate = committed();
                    next = { ...actual, status, result, salvage, events: [...actual.events,
                            ...events.slice(snapshot.events.length)], updatedAt: this.now(), hostDelivery: candidate };
                    await this.saveSnapshot(next, actual);
                }
            }
            // save() already owns the successful terminal/index transition. Only a
            // rejected original receipt needs this one bounded index compensation.
            if (repairIndex)
                await delivery.track(this.options.snapshotStore.clearActiveTask(taskId));
            if (delivery.acknowledged) {
                // A deadline may have published unknown while the original save/index
                // was pending. Reconcile its higher observation revision without ever
                // appending a second terminal or changing the won verification.
                if (!next.hostDelivery || next.hostDelivery.revision < delivery.record.revision) {
                    candidate = committed(next.hostDelivery?.finishedAt);
                    const revised = { ...next, hostDelivery: candidate, updatedAt: this.now() };
                    await this.saveSnapshot(revised, next);
                    next = revised;
                }
                delivery.record = next.hostDelivery;
            }
            this.lastCommittedSnapshots.set(taskId, next);
            persisted = { taskId, eventIndex: next.events.length - 1, event: terminal, snapshot: next };
            for (const event of next.events.slice(snapshot.events.length))
                this.pushLiveEvent(taskId, event);
        }));
        if (persisted)
            this.pendingTerminalPersistedEvents.set(taskId, persisted);
        this.closeSubscribers(taskId);
        delivery.publish(false);
    }
    requestExecutionAbort(execution, reason) {
        if (execution.phase !== 'runner') {
            execution.delivery?.abort(reason === 'app_shutdown' ? 'app_shutdown' : 'delivery_timeout');
            return;
        }
        if (!this.options.decideCancellation) {
            abortWithReason(execution.controller, reason);
            return;
        }
        void this.requireSnapshot(execution.taskId)
            .then(snapshot => execution.phase === 'runner' && this.activeExecutions.get(execution.taskId) === execution
            ? this.options.decideCancellation(snapshot, reason) : { hostAbortAllowed: false })
            .then(decision => {
            if (decision.hostAbortAllowed && this.activeExecutions.get(execution.taskId) === execution && execution.phase === 'runner') {
                abortWithReason(execution.controller, reason);
            }
            if (decision.ack === 'unknown')
                console.warn('[task-host] cancellation persisted state is unknown:', execution.taskId);
        })
            .catch(error => console.warn('[task-host] cancellation decision failed; host not aborted:', error instanceof Error ? error.message : String(error)));
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
        return isEmptyDelivery(snapshot);
    }
    async appendRuntimeEvent(taskId, event) {
        this.throwRuntimeEventError(taskId);
        const health = this.activeExecutions.get(taskId)?.health;
        if (event.type === 'tool_finished') {
            health?.resume(`managed:${event.invocationId}`);
            health?.resume(`tool:${event.invocationId}`);
        }
        if (event.type === 'approval_required')
            health?.wait(event.approvalId);
        else if (event.type === 'approval_resolved')
            health?.resume(event.approvalId);
        else if (event.type === 'execution_health') {
            if (event.state === 'running' && event.invocationId)
                health?.delegate(`managed:${event.invocationId}`);
            if (event.state === 'cleanup_pending')
                health?.cancel();
            else if (event.state === 'waiting')
                health?.wait(`tool:${event.invocationId ?? event.turnId}`);
            else {
                health?.resume(`tool:${event.invocationId ?? event.turnId}`);
                health?.progress(event.state === 'recovering');
            }
        }
        else if (['execution_progress', 'assistant_delta', 'tool_started', 'tool_finished', 'artifact_recorded', 'receipt_emitted', 'step_activated', 'turn_started'].includes(event.type))
            health?.progress();
        const desktopEvents = projectRuntimeEventsToDesktopEvents({ taskId, events: [event] });
        for (const desktopEvent of desktopEvents) {
            if (desktopEvent.type === 'assistant_delta') {
                await this.bufferAssistantDelta(taskId, desktopEvent);
                continue;
            }
            await this.flushPendingAssistantDelta(taskId);
            this.throwRuntimeEventError(taskId);
            await this.appendEvent(taskId, desktopEvent, { runtimeOrigin: true });
        }
    }
    async appendUsage(taskId, usage) {
        const inputTokens = normalizeUsageValue(usage.inputTokens);
        const outputTokens = normalizeUsageValue(usage.outputTokens);
        await this.appendEvent(taskId, { type: 'usage_recorded', inputTokens, outputTokens });
    }
    bufferAssistantDelta(taskId, event) {
        let pending = this.pendingAssistantDeltas.get(taskId);
        if (!pending) {
            pending = { delta: '', eventId: event.eventId, timer: null };
            this.pendingAssistantDeltas.set(taskId, pending);
        }
        pending.delta += event.delta;
        if (pending.delta.length >= ASSISTANT_DELTA_MAX_BUFFER_CHARS) {
            return this.flushPendingAssistantDelta(taskId);
        }
        if (!pending.timer) {
            pending.timer = setTimeout(() => {
                void this.flushPendingAssistantDelta(taskId).catch((error) => {
                    this.runtimeEventErrors.set(taskId, error);
                });
            }, ASSISTANT_DELTA_FLUSH_MS);
        }
        return Promise.resolve();
    }
    async flushPendingAssistantDelta(taskId) {
        const inFlight = this.assistantDeltaFlushes.get(taskId);
        if (inFlight) {
            await inFlight.promise;
            if (this.assistantDeltaFlushes.get(taskId) === inFlight)
                this.assistantDeltaFlushes.delete(taskId);
        }
        const pending = this.pendingAssistantDeltas.get(taskId);
        if (!pending) {
            return;
        }
        this.pendingAssistantDeltas.delete(taskId);
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        if (pending.delta.length === 0) {
            return;
        }
        // Publish the fixed raw batch Promise before it can dispatch. All original
        // flush callers share it, including a timer which already took the buffer.
        const batch = {
            promise: Promise.resolve().then(() => this.appendEvent(taskId, {
                type: 'assistant_delta', eventId: pending.eventId, delta: pending.delta,
            }, { runtimeOrigin: true, batch })),
        };
        this.assistantDeltaFlushes.set(taskId, batch);
        await batch.promise;
        if (this.assistantDeltaFlushes.get(taskId) === batch)
            this.assistantDeltaFlushes.delete(taskId);
    }
    async flushRuntimeEvents(taskId) {
        try {
            await this.flushPendingAssistantDelta(taskId);
        }
        catch (error) {
            const batch = this.assistantDeltaFlushes.get(taskId);
            if (batch?.receipt && batch.receipt.published < batch.receipt.events.length) {
                try {
                    await this.enqueueMutation(taskId, async () => { await this.confirmReceiptLocked(batch.receipt); });
                }
                catch { /* Original flush error remains the caller's outcome. */ }
                if (batch.receipt.published === batch.receipt.events.length)
                    batch.receipt = undefined;
            }
            throw error;
        }
        await this.flushMutations(taskId);
        this.throwRuntimeEventError(taskId);
    }
    throwRuntimeEventError(taskId) {
        if (!this.runtimeEventErrors.has(taskId)) {
            return;
        }
        const error = this.runtimeEventErrors.get(taskId);
        throw error;
    }
    clearPendingAssistantDelta(taskId) {
        const pending = this.pendingAssistantDeltas.get(taskId);
        if (pending?.timer) {
            clearTimeout(pending.timer);
        }
        this.pendingAssistantDeltas.delete(taskId);
    }
    async applyArtifactEvidenceGuard(taskId, snapshot, execution) {
        if (!this.options.aheGuards?.artifactEvidence) {
            return true;
        }
        const completionContext = buildCompletionEvidenceContext(taskId, snapshot);
        const expectation = completionContext.expectation;
        if (!expectation && hasClarificationResult(snapshot)) {
            return true;
        }
        if (!expectation && !shouldRequireArtifactEvidence(snapshot)) {
            return true;
        }
        const artifacts = collectArtifactEvidence(snapshot);
        const decision = expectation
            ? evaluateArtifactEvidenceGuard({
                taskId,
                status: 'completed',
                expectation,
                evidence: evidenceForExpectation(expectation, completionContext.evidence),
            })
            : evaluateArtifactEvidenceGuard({
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
        }, { runtimeOrigin: Boolean(execution) });
        await this.appendEvent(taskId, { type: 'error', message: decision.reason }, { runtimeOrigin: Boolean(execution) });
        await this.updateSnapshot(taskId, {
            status: 'failed',
            salvage: {
                summary: ['Completion evidence guard blocked task completion.'],
                reason: decision.reason,
            },
        }, execution);
        return false;
    }
    async recoverStaleRunningTask(snapshot) {
        if (snapshot.status !== 'running' || this.activeExecutions.has(snapshot.taskId)) {
            return snapshot;
        }
        if (Object.hasOwn(snapshot, 'multiAgentPreparation'))
            throw new Error('multi_agent_recovery_unconfirmed');
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
    async appendEvent(taskId, event, options) {
        let persisted;
        await this.enqueueMutation(taskId, async () => {
            const snapshot = await this.requireSnapshot(taskId);
            if (options?.runtimeOrigin && TERMINAL_STATUSES.has(snapshot.status))
                return;
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
                usage: event.type === 'usage_recorded'
                    ? {
                        inputTokens: (snapshot.usage?.inputTokens ?? 0) + event.inputTokens,
                        outputTokens: (snapshot.usage?.outputTokens ?? 0) + event.outputTokens,
                        known: true,
                    }
                    : snapshot.usage,
                updatedAt: this.now(),
            };
            if (options?.batch) {
                options.batch.receipt = { source: captureTaskSource(snapshot), snapshot: next,
                    eventIndex: snapshot.events.length, events: [event], published: 0 };
            }
            await this.saveSnapshot(next, snapshot);
            persisted = {
                taskId,
                eventIndex: next.events.length - 1,
                event,
                snapshot: next,
            };
            this.pushLiveEvent(taskId, event);
            if (options?.batch?.receipt)
                options.batch.receipt.published = 1;
        });
        if (persisted)
            this.schedulePersistedEvent(persisted);
    }
    async updateSnapshot(taskId, patch, execution) {
        let persisted;
        await this.enqueueMutation(taskId, async () => {
            const snapshot = await this.requireSnapshot(taskId);
            if (execution && (this.activeExecutions.get(taskId) !== execution || TERMINAL_STATUSES.has(snapshot.status)
                || this.cancellationSettlements.has(taskId)))
                return;
            const terminalStatus = patch.status !== undefined
                && patch.status !== snapshot.status
                && TERMINAL_STATUSES.has(patch.status)
                ? patch.status
                : undefined;
            const terminalEvent = terminalStatus
                ? { type: 'task_terminal', status: terminalStatus }
                : undefined;
            const next = {
                ...snapshot,
                ...patch,
                events: terminalEvent ? [...snapshot.events, terminalEvent] : snapshot.events,
                updatedAt: this.now(),
            };
            await this.saveSnapshot(next, snapshot);
            if (terminalEvent) {
                persisted = {
                    taskId,
                    eventIndex: next.events.length - 1,
                    event: terminalEvent,
                    snapshot: next,
                };
                this.pushLiveEvent(taskId, terminalEvent);
            }
        });
        if (persisted) {
            if (this.activeExecutions.has(taskId) || this.executionPromises.has(taskId)) {
                this.pendingTerminalPersistedEvents.set(taskId, persisted);
            }
            else {
                this.schedulePersistedEvent(persisted);
            }
        }
    }
    flushPendingTerminalPersistedEvent(taskId) {
        const persisted = this.pendingTerminalPersistedEvents.get(taskId);
        if (!persisted)
            return;
        this.pendingTerminalPersistedEvents.delete(taskId);
        this.schedulePersistedEvent(persisted);
    }
    schedulePersistedEvent(input) {
        if (!this.options.onPersistedEvent)
            return;
        const previous = this.persistedEventDispatchChains.get(input.taskId) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(() => new Promise(resolve => setImmediate(resolve)))
            .then(async () => {
            try {
                await this.options.onPersistedEvent?.(input);
            }
            catch (error) {
                console.warn('[task-host] persisted event consumer failed:', error instanceof Error ? error.message : String(error));
            }
        })
            .finally(() => {
            if (this.persistedEventDispatchChains.get(input.taskId) === next) {
                this.persistedEventDispatchChains.delete(input.taskId);
            }
        });
        this.persistedEventDispatchChains.set(input.taskId, next);
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
                this.mutationChains.delete(taskId);
                return;
            }
        }
    }
    async saveSnapshot(snapshot, expectedPrevious) {
        const raw = this.options.snapshotStore.save(snapshot, expectedPrevious);
        this.activeExecutions.get(snapshot.taskId)?.delivery?.track(raw);
        await raw;
        if (this.activeExecutions.has(snapshot.taskId))
            this.lastCommittedSnapshots.set(snapshot.taskId, snapshot);
    }
    async requireSnapshot(taskId) {
        const execution = this.activeExecutions.get(taskId);
        const delivery = execution?.delivery;
        const raw = this.options.snapshotStore.recoverTask(taskId, delivery && execution.phase === 'delivery'
            ? { signal: delivery.controller.signal, trackPending: delivery.track } : undefined);
        delivery?.track(raw);
        const snapshot = await raw;
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
        return `sess_${randomUUID()}`;
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
