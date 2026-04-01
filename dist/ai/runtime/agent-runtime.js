import { buildPromptCacheSegments, resolveModelCapabilities, } from './model-capabilities.js';
import { estimateTokens, shouldCompact } from './usage.js';
export class AgentRuntime {
    adapter;
    registry;
    session;
    controller;
    systemPrompt;
    maxIterations;
    contextLimitOverride;
    compactThresholdOverride;
    contextLimit;
    compactThreshold;
    compactPlaceholder;
    supportsPromptCaching;
    promptSnapshot;
    constructor(options) {
        this.adapter = options.adapter;
        this.registry = options.registry;
        this.session = options.session;
        this.controller = options.controller;
        this.systemPrompt = options.systemPrompt;
        this.promptSnapshot = options.promptSnapshot;
        this.maxIterations = options.maxIterations ?? 12;
        this.contextLimitOverride = options.contextLimit;
        this.compactThresholdOverride = options.compactThreshold;
        this.contextLimit = 200_000;
        this.compactThreshold = 0.85;
        this.compactPlaceholder = options.compactPlaceholder ?? '[context compacted]';
        this.supportsPromptCaching = false;
        this.refreshModelPolicy();
    }
    setAdapter(adapter) {
        this.adapter = adapter;
        this.refreshModelPolicy();
    }
    setSystemPrompt(systemPrompt) {
        this.systemPrompt = systemPrompt;
    }
    setPromptSnapshot(promptSnapshot) {
        this.promptSnapshot = promptSnapshot;
    }
    async run(input, onEvent, externalSignal) {
        this.throwIfAborted(externalSignal);
        const run = this.controller.startRun();
        onEvent({ type: 'run_started', runId: run.runId });
        if (typeof input === 'string') {
            this.session.appendUserText(input);
        }
        else {
            this.session.appendUserBlocks(input);
        }
        try {
            for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
                this.throwIfAborted(run.signal, externalSignal, onEvent, run.runId);
                if (shouldCompact(estimateTokens(this.session.getMessages()), this.contextLimit, this.compactThreshold)) {
                    const compaction = this.session.forceCompact(this.compactPlaceholder);
                    onEvent({
                        type: 'compact_triggered',
                        runId: run.runId,
                        summary: compaction?.summary ?? this.compactPlaceholder,
                        compactionId: compaction?.id,
                    });
                }
                const assistantBlocks = [];
                for await (const chunk of this.adapter.stream(this.session.getMessages(), this.registry.getToolDefinitions(), this.systemPrompt, this.buildInvocationOptions())) {
                    this.throwIfAborted(run.signal, externalSignal, onEvent, run.runId);
                    if (chunk.type === 'text') {
                        assistantBlocks.push({ type: 'text', text: chunk.delta });
                        onEvent({ type: 'assistant_text', runId: run.runId, delta: chunk.delta });
                        continue;
                    }
                    if (chunk.type === 'tool_use') {
                        assistantBlocks.push(chunk);
                        continue;
                    }
                    if (chunk.type === 'usage') {
                        const usage = this.session.updateUsage(chunk.usage);
                        onEvent({ type: 'usage_updated', runId: run.runId, usage });
                        continue;
                    }
                    if (chunk.type === 'done') {
                        break;
                    }
                }
                this.session.appendAssistantBlocks(assistantBlocks);
                if (assistantBlocks.length === 0) {
                    throw new Error('模型未返回任何文本或工具调用');
                }
                const toolCalls = assistantBlocks.filter((block) => block.type === 'tool_use');
                if (toolCalls.length === 0) {
                    onEvent({ type: 'run_completed', runId: run.runId });
                    return;
                }
                const toolResults = [];
                const toolExecutionContext = this.buildToolExecutionContext();
                for (const toolCall of toolCalls) {
                    this.throwIfAborted(run.signal, externalSignal, onEvent, run.runId);
                    onEvent({
                        type: 'tool_started',
                        runId: run.runId,
                        toolName: toolCall.name,
                        input: toolCall.input,
                    });
                    const result = await this.registry.executeTool(toolCall.name, toolCall.input, toolExecutionContext);
                    const ok = !result.startsWith('Error');
                    onEvent({
                        type: 'tool_finished',
                        runId: run.runId,
                        toolName: toolCall.name,
                        ok,
                    });
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolCall.id,
                        content: result,
                        is_error: !ok,
                    });
                }
                this.session.appendUserToolResults(toolResults);
            }
            throw new Error('agent runtime reached max iterations');
        }
        catch (error) {
            if (this.isAbortError(error)) {
                throw error;
            }
            const normalized = error instanceof Error ? error : new Error(String(error));
            onEvent({ type: 'run_failed', runId: run.runId, error: normalized });
            throw normalized;
        }
        finally {
            this.controller.completeRun(run.runId);
        }
    }
    throwIfAborted(activeSignal, externalSignal, onEvent, runId) {
        if (!activeSignal?.aborted && !externalSignal?.aborted) {
            return;
        }
        if (onEvent && runId) {
            onEvent({ type: 'run_aborted', runId });
        }
        throw new Error('agent aborted');
    }
    isAbortError(error) {
        return error instanceof Error && /aborted/i.test(error.message);
    }
    refreshModelPolicy() {
        const capabilities = resolveModelCapabilities(this.adapter);
        this.contextLimit = this.contextLimitOverride ?? capabilities.contextLimit;
        this.compactThreshold = this.compactThresholdOverride ?? capabilities.compactThreshold;
        this.supportsPromptCaching = capabilities.supportsPromptCaching;
    }
    buildInvocationOptions() {
        if (!this.supportsPromptCaching) {
            return undefined;
        }
        const toolDefinitions = this.registry.getToolDefinitions()
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name));
        return {
            promptCache: buildPromptCacheSegments(this.systemPrompt, toolDefinitions, this.session.getMessages()),
        };
    }
    buildToolExecutionContext() {
        const toolDefinitions = this.registry.getToolDefinitions()
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name));
        return {
            session: this.session.exportSnapshot(),
            messages: this.session.getMessages().map((message) => ({
                role: message.role,
                content: message.content.map((block) => ({ ...block })),
            })),
            systemPrompt: this.systemPrompt,
            toolDefinitions,
            promptSnapshot: this.promptSnapshot,
            promptCache: this.supportsPromptCaching
                ? buildPromptCacheSegments(this.systemPrompt, toolDefinitions, this.session.getMessages())
                : undefined,
        };
    }
}
