import { join } from 'node:path';
import { createLogger } from '../../utils/logger.js';
const logger = createLogger('agent-runtime');
import { isAbortError } from './abort-utils.js';
import { buildPromptCacheSegments, resolveModelCapabilities, } from './model-capabilities.js';
import { estimateTokens, shouldCompact, truncateToolResult } from './usage.js';
import { CompactRunner } from './compact-runner.js';
import { evaluateVerificationBeforeCompletionGuard } from '../../runtime/guards/verification-before-completion-guard.js';
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
    compactRunner;
    memoryStore;
    // 空响应自动重试配置
    static MAX_EMPTY_RETRIES = 2;
    constructor(options) {
        this.adapter = options.adapter;
        this.registry = options.registry;
        this.session = options.session;
        this.controller = options.controller;
        this.systemPrompt = options.systemPrompt;
        this.promptSnapshot = options.promptSnapshot;
        this.maxIterations = options.maxIterations;
        this.contextLimitOverride = options.contextLimit;
        this.compactThresholdOverride = options.compactThreshold;
        this.contextLimit = 200_000;
        this.compactThreshold = 0.85;
        this.compactPlaceholder = options.compactPlaceholder ?? '[context compacted]';
        this.supportsPromptCaching = false;
        this.refreshModelPolicy();
        this.compactRunner = new CompactRunner(this.adapter);
        this.memoryStore = options.memoryStore;
    }
    setAdapter(adapter) {
        this.adapter = adapter;
        this.refreshModelPolicy();
        this.compactRunner = new CompactRunner(adapter);
    }
    setSystemPrompt(systemPrompt) {
        this.systemPrompt = systemPrompt;
    }
    setPromptSnapshot(promptSnapshot) {
        this.promptSnapshot = promptSnapshot;
    }
    async run(input, onEvent, externalSignal) {
        if (externalSignal?.aborted) {
            throw new DOMException('agent aborted', 'AbortError');
        }
        const run = this.controller.startRun();
        onEvent({ type: 'run_started', runId: run.runId });
        const mergedSignal = externalSignal
            ? AbortSignal.any([run.signal, externalSignal])
            : run.signal;
        let currentAssistantBlocks = [];
        let assistantBlocksCommitted = false;
        let toolResults = [];
        let executedToolIds = new Set();
        try {
            if (mergedSignal.aborted) {
                onEvent({ type: 'run_aborted', runId: run.runId });
                throw new DOMException('agent aborted', 'AbortError');
            }
            if (typeof input === 'string') {
                this.session.appendUserText(input);
                if (this.memoryStore?.writeRawMessage) {
                    const sessionKey = this.promptSnapshot?.id?.slice(0, 16) ?? 'cli';
                    this.memoryStore.writeRawMessage(sessionKey, 'user', input).catch((err) => {
                        logger.warn('writeRawMessage failed', { error: err instanceof Error ? err.message : String(err) });
                    });
                }
            }
            else {
                this.session.appendUserBlocks(input);
            }
            let iteration = 0;
            let emptyRetries = 0;
            const verificationToolCalls = [];
            let codeMutatingToolSeen = false;
            while (true) {
                this.throwIfAborted(mergedSignal, onEvent, run.runId);
                currentAssistantBlocks = [];
                assistantBlocksCommitted = false;
                toolResults = [];
                executedToolIds = new Set();
                // Check if we've reached the max iterations limit (Claude Code style)
                if (this.maxIterations !== undefined && iteration >= this.maxIterations) {
                    onEvent({
                        type: 'max_iterations_reached',
                        runId: run.runId,
                        maxIterations: this.maxIterations,
                        currentIteration: iteration,
                    });
                    onEvent({ type: 'run_completed', runId: run.runId });
                    return;
                }
                if (shouldCompact(estimateTokens(this.session.getMessages()), this.contextLimit, this.compactThreshold)) {
                    const messages = this.session.getMessages();
                    let summaryText;
                    try {
                        summaryText = await this.compactRunner.run(messages, mergedSignal);
                    }
                    catch (compactError) {
                        if (isAbortError(compactError)) {
                            throw compactError;
                        }
                        onEvent({
                            type: 'compact_failed',
                            runId: run.runId,
                            error: compactError instanceof Error ? compactError.message : String(compactError),
                        });
                        summaryText = '';
                    }
                    const compaction = this.session.forceCompact(summaryText || this.compactPlaceholder);
                    onEvent({
                        type: 'compact_triggered',
                        runId: run.runId,
                        summary: compaction?.summary ?? this.compactPlaceholder,
                        compactionId: compaction?.id,
                    });
                    await this.injectMemoryAfterCompact();
                }
                for await (const chunk of this.adapter.stream(this.session.getMessages(), this.registry.getToolDefinitions(), this.systemPrompt, this.buildInvocationOptions(mergedSignal))) {
                    this.throwIfAborted(mergedSignal, onEvent, run.runId);
                    if (chunk.type === 'text') {
                        // Merge consecutive text blocks to avoid fragmented storage
                        const lastBlock = currentAssistantBlocks[currentAssistantBlocks.length - 1];
                        if (lastBlock?.type === 'text') {
                            lastBlock.text += chunk.delta;
                        }
                        else {
                            currentAssistantBlocks.push({ type: 'text', text: chunk.delta });
                        }
                        onEvent({ type: 'assistant_text', runId: run.runId, delta: chunk.delta });
                        continue;
                    }
                    if (chunk.type === 'thinking') {
                        const lastBlock = currentAssistantBlocks[currentAssistantBlocks.length - 1];
                        if (lastBlock?.type === 'thinking') {
                            lastBlock.thinking += chunk.delta;
                        }
                        else {
                            currentAssistantBlocks.push({ type: 'thinking', thinking: chunk.delta });
                        }
                        continue;
                    }
                    if (chunk.type === 'tool_use') {
                        currentAssistantBlocks.push(chunk);
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
                const hasVisibleOutput = currentAssistantBlocks.some((block) => block.type === 'text' || block.type === 'tool_use');
                if (!hasVisibleOutput) {
                    // 模型只返回了 thinking（无 text/tool_use），视为空响应自动重试
                    if (emptyRetries < AgentRuntime.MAX_EMPTY_RETRIES) {
                        emptyRetries++;
                        continue;
                    }
                    throw new Error('模型未返回任何文本或工具调用（已重试 2 次）');
                }
                // 成功收到响应，重置空响应计数器
                emptyRetries = 0;
                this.session.appendAssistantBlocks(currentAssistantBlocks);
                assistantBlocksCommitted = true;
                const toolCalls = currentAssistantBlocks.filter((block) => block.type === 'tool_use');
                if (toolCalls.length === 0) {
                    this.emitVerificationGuardIfNeeded(input, verificationToolCalls, codeMutatingToolSeen, run.runId, onEvent);
                    onEvent({ type: 'run_completed', runId: run.runId });
                    return;
                }
                toolResults = [];
                const toolExecutionContext = this.buildToolExecutionContext(mergedSignal);
                for (const toolCall of toolCalls) {
                    this.throwIfAborted(mergedSignal, onEvent, run.runId);
                    onEvent({
                        type: 'tool_started',
                        runId: run.runId,
                        toolName: toolCall.name,
                        input: toolCall.input,
                    });
                    const result = await this.registry.executeTool(toolCall.name, toolCall.input, toolExecutionContext);
                    const ok = !result.startsWith('Error');
                    executedToolIds.add(toolCall.id);
                    verificationToolCalls.push({
                        id: toolCall.id,
                        name: toolCall.name,
                        inputPreview: JSON.stringify(toolCall.input),
                        outputPreview: result.slice(0, 10_000),
                        startedAt: new Date().toISOString(),
                        endedAt: new Date().toISOString(),
                        ok,
                    });
                    codeMutatingToolSeen = codeMutatingToolSeen || isCodeMutatingToolCall(toolCall.name, toolCall.input);
                    onEvent({
                        type: 'tool_finished',
                        runId: run.runId,
                        toolName: toolCall.name,
                        ok,
                    });
                    const sessionSnapshot = this.session.exportSnapshot();
                    const truncated = truncateToolResult(result, undefined, {
                        sessionId: sessionSnapshot.sessionId,
                        toolCallId: toolCall.id,
                        spillDir: join(sessionSnapshot.cwd, '.xiaok', 'spill'),
                    });
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolCall.id,
                        content: truncated.content,
                        is_error: !ok,
                    });
                }
                this.session.appendUserToolResults(toolResults);
                toolResults = [];
                executedToolIds = new Set();
                iteration += 1;
            }
        }
        catch (error) {
            if (isAbortError(error)) {
                const partialSentinel = '\n\n[partial - interrupted by user]';
                const blocks = currentAssistantBlocks.map((block) => ({ ...block }));
                if (!assistantBlocksCommitted && blocks.length > 0) {
                    const lastTextIndex = blocks.map((block) => block.type).lastIndexOf('text');
                    if (lastTextIndex >= 0) {
                        const textBlock = blocks[lastTextIndex];
                        if (textBlock.type === 'text') {
                            blocks[lastTextIndex] = {
                                ...textBlock,
                                text: `${textBlock.text}${partialSentinel}`,
                            };
                        }
                    }
                    this.session.appendAssistantBlocks(blocks);
                    assistantBlocksCommitted = true;
                }
                const seenToolResultIds = new Set(toolResults
                    .filter((block) => block.type === 'tool_result')
                    .map((block) => block.tool_use_id));
                const syntheticToolResults = blocks
                    .filter((block) => block.type === 'tool_use')
                    .filter((toolCall) => !executedToolIds.has(toolCall.id) && !seenToolResultIds.has(toolCall.id))
                    .map((toolCall) => {
                    seenToolResultIds.add(toolCall.id);
                    return {
                        type: 'tool_result',
                        tool_use_id: toolCall.id,
                        content: '[user-cancelled]',
                        is_error: true,
                    };
                });
                const mergedToolResults = [...toolResults, ...syntheticToolResults];
                if (mergedToolResults.length > 0) {
                    this.session.appendUserToolResults(mergedToolResults);
                    toolResults = [];
                }
                const partialText = blocks
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text)
                    .join('');
                onEvent({ type: 'run_aborted', runId: run.runId, partialText });
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
    throwIfAborted(signal, onEvent, runId) {
        if (!signal.aborted) {
            return;
        }
        onEvent({ type: 'run_aborted', runId });
        throw new DOMException('agent aborted', 'AbortError');
    }
    refreshModelPolicy() {
        const capabilities = resolveModelCapabilities(this.adapter);
        this.contextLimit = this.contextLimitOverride ?? capabilities.contextLimit;
        this.compactThreshold = this.compactThresholdOverride ?? capabilities.compactThreshold;
        this.supportsPromptCaching = capabilities.supportsPromptCaching;
    }
    buildInvocationOptions(signal) {
        if (!this.supportsPromptCaching) {
            return signal ? { signal } : undefined;
        }
        const toolDefinitions = this.registry.getToolDefinitions()
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name));
        // Use segments for multi-block system prompt cache boundary if available.
        const snapshot = this.promptSnapshot;
        const systemSegments = snapshot?.segments
            .filter((seg) => seg.key !== 'memory_summary')
            .filter((seg) => seg.text)
            .map((seg) => ({ text: seg.text, cacheable: seg.cacheable }));
        const systemPromptInput = systemSegments && systemSegments.length >= 1
            ? systemSegments
            : this.systemPrompt;
        return {
            promptCache: buildPromptCacheSegments(systemPromptInput, toolDefinitions, this.session.getMessages()),
            signal,
        };
    }
    buildToolExecutionContext(signal) {
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
            signal,
        };
    }
    emitVerificationGuardIfNeeded(input, toolCalls, codeMutatingToolSeen, runId, onEvent) {
        if (!codeMutatingToolSeen || !looksLikeCodeRequest(input)) {
            return;
        }
        const bundle = buildGuardTraceBundle(toolCalls);
        const decision = evaluateVerificationBeforeCompletionGuard({
            scope: { kind: 'code', confidence: 0.85 },
            bundle,
        });
        if (decision.ok) {
            return;
        }
        const event = decision.events[0];
        onEvent({
            type: 'guard_evaluated',
            runId,
            guardId: 'verification-before-completion',
            mode: decision.mode === 'block' ? 'blocked' : 'warned',
            category: typeof event?.data?.category === 'string' ? event.data.category : 'missing_verification',
            reason: decision.reason,
            action: decision.action,
        });
    }
    async injectMemoryAfterCompact() {
        if (!this.memoryStore)
            return;
        const snapshot = this.session.getPromptSnapshot();
        if (!snapshot?.memoryRefs?.length)
            return;
        const memories = await this.memoryStore.listRelevant({ cwd: snapshot.cwd, query: '' });
        const relevant = memories.filter((m) => snapshot.memoryRefs.includes(m.id));
        if (relevant.length === 0)
            return;
        const memText = relevant.map((m) => `- ${m.title}: ${m.summary}`).join('\n');
        this.session.appendUserText(`<system-reminder>\n[Memory restored after compact]\n${memText}\n</system-reminder>`);
    }
}
function looksLikeCodeRequest(input) {
    const text = typeof input === 'string'
        ? input
        : input.map((block) => block.type === 'text' ? block.text : '').join('\n');
    return /(code|bug|test|tests|typescript|javascript|python|rust|go|编译|测试|代码|修复|修改|实现|src\/|\.ts\b|\.tsx\b|\.js\b|\.py\b)/iu.test(text);
}
function isCodeMutatingToolCall(toolName, input) {
    const normalized = toolName.toLowerCase();
    if (normalized === 'edit' || normalized === 'write') {
        return typeof input.file_path === 'string' && /\.(ts|tsx|js|jsx|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|css|scss|json|ya?ml|toml|mjs|cjs)$/iu.test(input.file_path);
    }
    if (normalized === 'bash' && typeof input.command === 'string') {
        return /\b(apply_patch|sed\s+-i|perl\s+-pi|npm\s+run\s+build|tsc|cargo|go)\b/iu.test(input.command);
    }
    return false;
}
function buildGuardTraceBundle(toolCalls) {
    const now = new Date().toISOString();
    return {
        schemaVersion: 1,
        bundleId: 'runtime_guard_verification',
        createdAt: now,
        source: { app: 'xiaok-cli' },
        scope: { kind: 'session', sessionId: 'runtime' },
        environment: {},
        turns: [],
        events: [],
        toolCalls,
        approvals: [],
        tasks: [],
        agents: [],
        artifacts: [],
        memoryRefs: [],
        skillEvidence: [],
        recovery: [],
        crashes: [],
        redactions: [],
        attachments: [],
        summary: { toolCallCount: toolCalls.length },
    };
}
