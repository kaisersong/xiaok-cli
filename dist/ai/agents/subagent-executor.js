import { Agent } from '../agent.js';
import { SubAgentRunReporter } from './subagent-presentation.js';
import { ManagedAgentSessionCreationError } from './multi-agent-coordinator.js';
import { buildSynthesizedProviderContext, isStrictKimiK3Adapter, } from '../runtime/provider-private-projection.js';
export async function createNamedSubAgentSession(options) {
    options.signal?.throwIfAborted();
    const resolved = await resolveSubAgentCwd(options.worktreeManager, options.agentDef, options.sessionId, options.cwd, options.runtimeAgentId);
    const cwd = resolved.cwd;
    let registry;
    let agent;
    let checkpoint;
    const reporter = new SubAgentRunReporter(options.agentDef.name, options.runtimeAgentId, options.onSubAgentEvent);
    let deactivated = false;
    let deactivatePromise;
    let disposePromise;
    const deactivate = () => {
        deactivated = true;
        if (!registry)
            return Promise.resolve();
        const currentRegistry = registry;
        deactivatePromise ??= Promise.resolve().then(() => options.releaseRegistry
            ? options.releaseRegistry(currentRegistry) : currentRegistry.dispose());
        return deactivatePromise;
    };
    const disposeResources = () => {
        disposePromise ??= (async () => {
            try {
                await deactivate();
            }
            finally {
                if (resolved.allocation && resolved.allocation.cleanup === 'delete') {
                    await options.worktreeManager?.release(resolved.allocation.path);
                }
                agent = undefined;
                checkpoint = undefined;
            }
        })();
        return disposePromise;
    };
    try {
        options.signal?.throwIfAborted();
        const systemPromptBase = await options.buildSystemPrompt(cwd);
        options.signal?.throwIfAborted();
        registry = options.createRegistry(cwd, options.agentDef.allowedTools, options.runtimeAgentId ?? options.agentDef.name, { parentDepth: options.parentDepth });
        const systemPrompt = [
            systemPromptBase,
            options.agentDef.systemPrompt,
            options.collaborationPrompt,
        ].filter(Boolean).join('\n\n');
        const baseAdapter = options.adapter();
        const strictK3Parent = isStrictKimiK3Adapter(baseAdapter);
        const adapter = resolveSubAgentAdapter(baseAdapter, options.agentDef.model, options.agentDef.modelCapability, options.forkContext);
        let runContext;
        let running = false;
        const createAgent = () => new Agent(adapter, registry, systemPrompt, {
            maxIterations: options.agentDef.maxIterations,
            providerSurfaceKind: 'cli-subagent',
            onActivity: (activity) => {
                reporter.activity(activity);
                runContext?.onActivity(activity);
            },
            takePendingInput: () => runContext?.takePendingInput(),
        });
        agent = createAgent();
        const strictK3 = isStrictKimiK3Adapter(adapter);
        if (options.forkContext?.session && !strictK3Parent && !strictK3) {
            agent.restoreSession(completedForkSnapshot(options.forkContext.session));
        }
        let firstRun = true;
        return {
            async run(prompt, signal, context) {
                if (disposePromise)
                    throw new Error(`subagent session is disposed: ${options.runtimeAgentId ?? options.agentDef.name}`);
                if (deactivated)
                    throw new Error(`subagent session is deactivated: ${options.runtimeAgentId ?? options.agentDef.name}`);
                if (running)
                    throw new Error('subagent session already has an active run');
                const runPrompt = firstRun && (strictK3Parent || strictK3) && options.forkContext?.messages
                    ? `${buildSynthesizedProviderContext('subagent', options.forkContext.messages)}\n\n`
                        + `Current child task:\n${prompt}`
                    : prompt;
                const displayTask = firstRun && options.taskDescription?.trim() ? options.taskDescription : prompt;
                firstRun = false;
                running = true;
                runContext = context;
                reporter.start(displayTask);
                const chunks = [];
                let finalResponse = '';
                let iterationLimitReached = false;
                try {
                    if (!agent) {
                        registry = options.createRegistry(cwd, options.agentDef.allowedTools, options.runtimeAgentId ?? options.agentDef.name, { parentDepth: options.parentDepth });
                        agent = createAgent();
                        if (checkpoint)
                            agent.restoreSession(checkpoint);
                        checkpoint = undefined;
                    }
                    await agent.runTurn(runPrompt, (chunk) => {
                        if (chunk.type === 'text') {
                            chunks.push(chunk.delta);
                            finalResponse += chunk.delta;
                        }
                    }, signal, undefined, (event) => {
                        if (event.type === 'max_iterations_reached')
                            iterationLimitReached = true;
                        if (event.type === 'tool_started')
                            finalResponse = '';
                        if (event.type === 'tool_finished')
                            reporter.toolFinished(event.toolName, event.ok);
                    });
                    if (iterationLimitReached)
                        throw new Error('SUBAGENT_ITERATION_LIMIT: task did not finish within its iteration budget');
                    const result = chunks.join('').trim();
                    reporter.finish(signal?.aborted ? 'interrupted' : 'completed', signal?.aborted ? undefined : finalResponse.trim());
                    return result;
                }
                catch (error) {
                    reporter.finish(signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'interrupted' : 'failed');
                    throw error;
                }
                finally {
                    runContext = undefined;
                    running = false;
                }
            },
            async suspend() {
                if (running)
                    throw new Error('cannot suspend an active subagent run');
                if (deactivated || disposePromise)
                    return;
                if (agent)
                    checkpoint = agent.exportSession();
                if (registry) {
                    const currentRegistry = registry;
                    deactivatePromise ??= Promise.resolve().then(() => options.releaseRegistry
                        ? options.releaseRegistry(currentRegistry) : currentRegistry.dispose());
                    await deactivatePromise;
                }
                agent = undefined;
                registry = undefined;
                deactivatePromise = undefined;
            },
            deactivate,
            dispose: disposeResources,
        };
    }
    catch (error) {
        try {
            await disposeResources();
        }
        catch (cleanupError) {
            throw new ManagedAgentSessionCreationError(error, cleanupError);
        }
        throw error;
    }
}
function completedForkSnapshot(snapshot) {
    for (let index = 0; index < snapshot.messages.length; index += 1) {
        const message = snapshot.messages[index];
        if (message.role !== 'assistant')
            continue;
        const calls = message.content.filter((block) => block.type === 'tool_use');
        if (calls.length === 0)
            continue;
        const next = snapshot.messages[index + 1];
        const results = next?.role === 'user'
            ? next.content.filter((block) => block.type === 'tool_result')
            : [];
        const resultIds = new Set(results.map((block) => block.tool_use_id));
        if (results.length !== calls.length || resultIds.size !== calls.length
            || calls.some((call) => !resultIds.has(call.id))) {
            // Tools fork while their parent's current batch is still in flight.
            // Inherit only committed exchanges; never fabricate results or mutate
            // the parent, which will append its real results after this tool returns.
            return { ...snapshot, messages: snapshot.messages.slice(0, index) };
        }
    }
    return snapshot;
}
export async function executeNamedSubAgent(options) {
    const signals = [
        ...(options.signal ? [options.signal] : []),
        ...(options.forkContext?.signal ? [options.forkContext.signal] : []),
    ];
    const childSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const session = await createNamedSubAgentSession({ ...options, signal: childSignal });
    try {
        return await session.run(options.prompt, childSignal);
    }
    finally {
        await session.dispose();
    }
}
function resolveSubAgentAdapter(adapter, modelOverride, capabilityOverride, ctx) {
    if (modelOverride && capabilityOverride) {
        throw new Error('model and modelCapability are mutually exclusive');
    }
    if (modelOverride) {
        if (!supportsModelClone(adapter))
            return adapter;
        return adapter.cloneWithModel(modelOverride);
    }
    if (capabilityOverride) {
        if (!ctx?.settingsStore)
            throw new Error('settings context required for capability routing');
        const resolved = resolveCapability(capabilityOverride, ctx);
        if (!resolved)
            throw new Error(`unknown capability: ${capabilityOverride}`);
        if (!supportsModelClone(adapter))
            throw new Error('model clone required for capability routing');
        return adapter.cloneWithModel(resolved);
    }
    return adapter;
}
function resolveCapability(capability, ctx) {
    const settings = ctx.settingsStore?.getSettings();
    return settings?.modelCapabilities?.[capability] || null;
}
function supportsModelClone(adapter) {
    return typeof adapter.cloneWithModel === 'function';
}
export async function resolveSubAgentCwd(manager, agent, sessionId, cwd = process.cwd(), runtimeAgentId) {
    if (agent.isolation !== 'worktree') {
        return { cwd };
    }
    if (!manager) {
        throw new Error(`worktree manager is required for isolated agent ${agent.name}`);
    }
    const allocationId = runtimeAgentId ?? sessionId;
    const branch = `${agent.name}-${allocationId}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const allocation = await manager.allocate({
        owner: agent.name,
        taskId: allocationId,
        branch,
        cleanup: agent.cleanup ?? 'keep',
    });
    return {
        cwd: allocation.path,
        allocation,
    };
}
