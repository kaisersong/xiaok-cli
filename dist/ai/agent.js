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
    session = new AgentSessionState();
    controller = new AgentRunController();
    sessionId = `sess_${(nextSessionOrdinal += 1)}`;
    turnCount = 0;
    runtime;
    constructor(adapter, registry, systemPrompt, options = {}) {
        this.adapter = adapter;
        this.registry = registry;
        this.systemPrompt = systemPrompt;
        this.options = options;
        this.runtime = this.createRuntime();
    }
    async runTurn(userInput, onChunk, signal) {
        if (signal?.aborted) {
            throw new Error('agent aborted');
        }
        const turnId = `turn_${(this.turnCount += 1)}`;
        await this.runtime.run(userInput, (event) => {
            this.emitLegacyHook(event, turnId);
            const chunk = toLegacyStreamChunk(event);
            if (chunk) {
                onChunk(chunk);
            }
        }, signal);
    }
    clearHistory() {
        this.session = new AgentSessionState();
        this.runtime = this.createRuntime();
    }
    forceCompact() {
        this.session.forceCompact('[context compacted]');
    }
    getUsage() {
        return this.session.getUsage();
    }
    exportSession() {
        return this.session.exportSnapshot();
    }
    restoreSession(snapshot) {
        this.session.restoreSnapshot(snapshot);
    }
    getSessionState() {
        return this.session;
    }
    setAdapter(adapter) {
        this.adapter = adapter;
        this.runtime.setAdapter(adapter);
    }
    setSystemPrompt(systemPrompt) {
        this.systemPrompt = systemPrompt;
        this.runtime.setSystemPrompt(systemPrompt);
    }
    setPromptSnapshot(promptSnapshot) {
        this.runtime.setPromptSnapshot(promptSnapshot);
    }
    createRuntime() {
        return new AgentRuntime({
            adapter: this.adapter,
            registry: this.registry,
            session: this.session,
            controller: this.controller,
            systemPrompt: this.systemPrompt,
            maxIterations: this.options.maxIterations,
            contextLimit: this.options.contextLimit,
            compactThreshold: this.options.compactThreshold,
            compactPlaceholder: this.options.compactPlaceholder,
        });
    }
    emitLegacyHook(event, turnId) {
        if (!this.options.hooks) {
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
                toolName: event.toolName,
                ok: event.ok,
            });
            return;
        }
        if (event.type === 'compact_triggered') {
            this.options.hooks.emit({
                type: 'compact_triggered',
                sessionId: this.sessionId,
                turnId,
            });
        }
    }
}
