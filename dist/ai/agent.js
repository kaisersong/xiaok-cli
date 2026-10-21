import { ModelStreamPhysicalOwner } from './runtime/model-stream-physical-owner.js';
import { AgentRunController } from './runtime/controller.js';
import { toLegacyStreamChunk } from './runtime/events.js';
import { AgentRuntime } from './runtime/agent-runtime.js';
import { AgentSessionState } from './runtime/session.js';
let nextSessionOrdinal = 0;
export class Agent {
    adapter;
    registry;
    systemPrompt;
    options;
    session;
    observationOwner;
    disposed = false;
    modelPhysicalOwner = new ModelStreamPhysicalOwner();
    disposalScheduled = false;
    disposalWork;
    controller = new AgentRunController();
    sessionId = `sess_${(nextSessionOrdinal += 1)}`;
    turnCount = 0;
    runtime;
    constructor(adapter, registry, systemPrompt, options = {}) {
        this.adapter = adapter;
        this.registry = registry;
        this.systemPrompt = systemPrompt;
        this.options = options;
        this.observationOwner = options.observationOwner;
        if (this.observationOwner && !options.initialSession)
            throw new Error('SOL_PI_AGENT_INITIAL_SESSION_REQUIRED');
        this.session = options.initialSession ?? new AgentSessionState();
        this.observationOwner?.assertSession(this.session);
        this.runtime = this.createRuntime();
    }
    async runTurn(userInput, onChunk, signal, invocationContext, onRuntimeEvent) {
        signal?.throwIfAborted();
        this.assertLive();
        const turnId = `turn_${(this.turnCount += 1)}`;
        await this.runtime.run(userInput, (event) => {
            this.emitLegacyHook(event, turnId);
            onRuntimeEvent?.(event);
            const chunk = toLegacyStreamChunk(event);
            if (chunk) {
                onChunk(chunk);
            }
        }, signal, invocationContext);
    }
    clearHistory() {
        this.assertHistoryMutationAllowed();
        this.session = new AgentSessionState();
        this.runtime = this.createRuntime();
    }
    forceCompact() {
        this.assertHistoryMutationAllowed();
        return this.session.forceCompact();
    }
    getUsage() {
        return this.session.getUsage();
    }
    exportSession() {
        return this.session.exportSnapshot();
    }
    restoreSession(snapshot) {
        this.assertHistoryMutationAllowed();
        this.session.restoreSnapshot(snapshot);
    }
    getSessionState() {
        return this.session;
    }
    setAdapter(adapter) {
        this.assertLive();
        if (adapter !== this.adapter && (this.modelPhysicalOwner.hasPending() || this.modelPhysicalOwner.hasFailure()))
            throw Error('agent_model_resources_pending');
        if (this.observationOwner) {
            if (adapter !== this.adapter)
                throw new Error('SOL_PI_AGENT_FRESH_TASK_REQUIRED');
            return;
        }
        this.runtime.setAdapter(adapter);
        this.adapter = adapter;
    }
    setSystemPrompt(systemPrompt) {
        this.assertLive();
        this.systemPrompt = systemPrompt;
        this.runtime.setSystemPrompt(systemPrompt);
    }
    notifySubtaskBoundary() {
        this.assertLive();
        this.runtime.notifySubtaskBoundary();
    }
    setPromptSnapshot(promptSnapshot) {
        this.assertLive();
        this.runtime.setPromptSnapshot(promptSnapshot);
    }
    /** Host stop closes ingress without revoking an owner still used by writers. */
    stopNewRuns(reason) {
        if (this.disposed)
            return;
        this.disposed = true;
        this.modelPhysicalOwner.stop(reason);
        this.controller.abortActiveRun(this.modelPhysicalOwner.signal.reason);
    }
    waitForStoppedResources() { return this.modelPhysicalOwner.waitForStopped(); }
    waitForIdleResources() { return this.modelPhysicalOwner.waitForIdle(); }
    dispose() {
        this.stopNewRuns();
        if (this.disposalScheduled)
            return;
        this.disposalScheduled = true;
        if (!this.modelPhysicalOwner.hasPending() && !this.modelPhysicalOwner.hasFailure()) {
            try {
                this.observationOwner?.dispose();
                this.disposalWork = Promise.resolve();
            }
            catch (error) {
                this.disposalWork = Promise.reject(error);
                void this.disposalWork.catch(() => { });
                throw error;
            }
            return;
        }
        this.disposalWork = this.waitForStoppedResources().then(() => this.observationOwner?.dispose());
        // Observe both outcomes while retaining the exact rejected cleanup Promise
        // for a host. Never turn an unknown owner failure into successful release.
        void this.disposalWork.catch(() => { });
    }
    waitForDisposedResources() {
        return this.disposalScheduled ? this.disposalWork : Promise.reject(Error('agent_disposal_not_started'));
    }
    assertLive() {
        if (this.disposed)
            throw new Error('agent_disposed');
    }
    assertHistoryMutationAllowed() {
        this.assertLive();
        if (this.modelPhysicalOwner.hasPending() || this.modelPhysicalOwner.hasFailure())
            throw Error('agent_model_resources_pending');
        if (this.observationOwner)
            throw new Error('SOL_PI_AGENT_FRESH_TASK_REQUIRED');
    }
    createRuntime() {
        return new AgentRuntime({
            modelPhysicalOwner: this.modelPhysicalOwner,
            adapter: this.adapter,
            registry: this.registry,
            session: this.session,
            observationOwner: this.observationOwner,
            semanticCompactionOwner: this.options.semanticCompactionOwner,
            onSemanticCompactionOutcome: this.options.onSemanticCompactionOutcome,
            controller: this.controller,
            systemPrompt: this.systemPrompt,
            maxIterations: this.options.maxIterations,
            contextLimit: this.options.contextLimit,
            compactThreshold: this.options.compactThreshold,
            compactPlaceholder: this.options.compactPlaceholder,
            memoryStore: this.options.memoryStore,
            providerSurfaceKind: this.options.providerSurfaceKind,
            onActivity: this.options.onActivity,
            takePendingInput: this.options.takePendingInput,
            onSemanticCompactionDecision: this.options.onSemanticCompactionDecision,
        });
    }
    emitLegacyHook(event, turnId) {
        if (!this.options.hooks) {
            return;
        }
        if (event.type === 'execution_progress') {
            this.options.hooks.emit({ type: 'execution_progress', sessionId: this.sessionId, turnId });
            return;
        }
        if (event.type === 'execution_health' || event.type === 'model_recovery') {
            this.options.hooks.emit({ type: 'execution_health', sessionId: this.sessionId, turnId, ...(event.type === 'execution_health' ? { invocationId: event.invocationId } : {}), state: event.type === 'model_recovery' ? 'recovering' : event.state });
            return;
        }
        if (event.type === 'run_started') {
            this.options.hooks.emit({
                type: 'turn_started',
                sessionId: this.sessionId,
                turnId,
            });
            return;
        }
        if (event.type === 'run_completed') {
            this.options.hooks.emit({
                type: 'turn_completed',
                sessionId: this.sessionId,
                turnId,
            });
            this.options.hooks.emit({
                type: 'turn_stop',
                sessionId: this.sessionId,
                turnId,
                reason: 'completed',
            });
            return;
        }
        if (event.type === 'run_failed') {
            this.options.hooks.emit({
                type: 'turn_failed',
                sessionId: this.sessionId,
                turnId,
                error: event.error,
            });
            this.options.hooks.emit({
                type: 'turn_stop',
                sessionId: this.sessionId,
                turnId,
                reason: 'error',
            });
            return;
        }
        if (event.type === 'run_aborted') {
            this.options.hooks.emit({
                type: 'turn_aborted',
                sessionId: this.sessionId,
                turnId,
                partialText: event.partialText,
            });
            this.options.hooks.emit({
                type: 'turn_stop',
                sessionId: this.sessionId,
                turnId,
                reason: 'user_aborted',
            });
            return;
        }
        if (event.type === 'tool_started') {
            this.options.hooks.emit({
                type: 'tool_started',
                sessionId: this.sessionId,
                turnId,
                toolName: event.toolName,
                toolInput: event.input,
            });
            return;
        }
        if (event.type === 'tool_finished') {
            this.options.hooks.emit({
                type: 'tool_finished',
                sessionId: this.sessionId,
                turnId,
                invocationId: event.invocationId,
                toolName: event.toolName,
                ok: event.ok,
            });
            return;
        }
        if (event.type === 'tool_execution_fact') {
            this.options.hooks.emit({
                type: 'tool_execution_fact',
                sessionId: this.sessionId,
                turnId,
                invocationId: event.invocationId,
                toolName: event.toolName,
                factKind: event.factKind,
                exitCode: event.exitCode,
                normalizedFilePaths: event.normalizedFilePaths,
            });
            return;
        }
        if (event.type === 'compact_triggered') {
            this.options.hooks.emit({
                type: 'compact_triggered',
                sessionId: this.sessionId,
                turnId,
            });
            return;
        }
        if (event.type === 'compact_failed') {
            this.options.hooks.emit({
                type: 'compact_failed',
                sessionId: this.sessionId,
                turnId,
                error: event.error,
            });
            return;
        }
        if (event.type === 'guard_evaluated') {
            this.options.hooks.emit({
                type: 'guard_evaluated',
                sessionId: this.sessionId,
                turnId,
                guardId: event.guardId,
                mode: event.mode,
                category: event.category,
                reason: event.reason,
                action: event.action,
                taskId: event.taskId,
                artifactId: event.artifactId,
                target: event.target,
            });
        }
    }
}
