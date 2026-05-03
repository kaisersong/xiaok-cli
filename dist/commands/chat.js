import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadConfig, saveConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { PermissionManager } from '../ai/permissions/manager.js';
import { createAskUserTool } from '../ai/tools/ask-user.js';
import { createAskUserQuestionTool } from '../ai/tools/ask-user-question.js';
import { createIntentDelegationTools } from '../ai/tools/intent-delegation.js';
import { Agent } from '../ai/agent.js';
import { PromptBuilder } from '../ai/prompts/builder.js';
import { createRuntimeHooks } from '../runtime/hooks.js';
import { createHooksRunner } from '../runtime/hooks-runner.js';
import { createIntentPlan } from '../ai/intent-delegation/planner.js';
import { writeError, isTTY } from '../utils/ui.js';
import { showPermissionPrompt } from '../ui/permission-prompt.js';
import { addAllowRule } from '../ai/permissions/settings.js';
import { loadSettings, mergeRules } from '../ai/permissions/settings.js';
import { createSkillCatalog, parseSlashCommand, toSkillEntries, findSkillByCommandName } from '../ai/skills/loader.js';
import { createSkillCatalogWatcher } from '../ai/skills/watcher.js';
import { createSkillTool } from '../ai/skills/tool.js';
import { buildSkillExecutionPlan } from '../ai/skills/planner.js';
import { buildComplianceReminder, evaluateSkillCompliance } from '../ai/skills/compliance.js';
import { activateSkillInvocation, cloneSessionSkillExecutionState, createEmptySessionSkillExecutionState, findLatestRunningInvocation, recordSkillEvidence, updateSkillCompliance, } from '../ai/skills/execution-state.js';
import { resolveModelCapabilities } from '../ai/runtime/model-capabilities.js';
import { loadAutoContext, formatLoadedContext } from '../ai/runtime/context-loader.js';
import { FileSessionStore } from '../ai/runtime/session-store.js';
import { formatPrintOutput } from './chat-print-mode.js';
import { MarkdownRenderer } from '../ui/markdown.js';
import { StatusBar } from '../ui/statusbar.js';
import { ScrollRegionManager } from '../ui/scroll-region.js';
import { TuiRuntimeState } from '../ui/tui/runtime-state.js';
import { renderWelcomeScreen, renderInputSeparator, dim, formatProgressNote, formatSubmittedInput, formatToolActivity, formatHistoryBlock } from '../ui/render.js';
import { getDisplayWidth, stripAnsi } from '../ui/display-width.js';
import { InputReader } from '../ui/input.js';
import { sliceByDisplayColumns } from '../ui/text-metrics.js';
import { ReplRenderer } from '../ui/repl-renderer.js';
import { ToolExplorer } from '../ui/tool-explorer.js';
import { TurnLayout } from '../ui/turn-layout.js';
import { parseInputBlocks, clearPastedImagePaths } from '../ui/image-input.js';
import { selectModel } from '../ui/model-selector.js';
import { getCurrentBranch } from '../utils/git.js';
import { executeReminderSlashCommand } from './chat-reminder.js';
import { buildChatHelpText } from './registry.js';
import { createPlatformRuntimeContext } from '../platform/runtime/context.js';
import { createPlatformRegistryFactory } from '../platform/runtime/registry-factory.js';
import { extractSandboxAllowedPaths } from '../platform/sandbox/policy.js';
import { FileTranscriptLogger } from '../ui/transcript.js';
import { setCrashContext, setStreamErrorHandler } from '../utils/crash-reporter.js';
import { createInstallSkillTool } from '../ai/tools/install-skill.js';
import { createUninstallSkillTool } from '../ai/tools/uninstall-skill.js';
import { executeNamedSubAgent } from '../ai/agents/subagent-executor.js';
import { RuntimeFacade } from '../ai/runtime/runtime-facade.js';
import { SessionIntentDelegationStore, createEmptySessionIntentLedger } from '../runtime/intent-delegation/store.js';
import { SessionSkillEvalStore } from '../runtime/intent-delegation/skill-eval-store.js';
import { FileSkillScoreStore } from '../runtime/intent-delegation/skill-score-store.js';
import { bootstrapTurnIntentPlan } from '../runtime/intent-delegation/chat-bootstrap.js';
import { wireSkillEvalToRuntimeSync } from '../runtime/intent-delegation/skill-eval-sync.js';
import { cloneSessionSkillEvalState, createEmptySessionSkillEvalState, inferDeliverableFamily, } from '../runtime/intent-delegation/skill-eval.js';
import { consumeFreshContextHandoff, hasPendingFreshContextHandoff, resolveOwnedActiveIntent, } from '../runtime/intent-delegation/handoff.js';
import { wireIntentDelegationToRuntimeSync } from '../runtime/intent-delegation/runtime-sync.js';
import { markSessionOwned, releaseSessionOwnership, resumeSessionOwnership, takeoverSessionOwnership, } from '../runtime/intent-delegation/ownership.js';
import { EmbeddedYZJChannel } from '../channels/embedded-yzj.js';
import { selectYZJChannel } from '../ui/channel-selector.js';
import { resolveYZJConfig } from '../channels/yzj.js';
import { YZJTransport } from '../channels/yzj-transport.js';
import { InMemoryApprovalStore } from '../channels/approval-store.js';
import { getProviderProfile } from '../ai/providers/registry.js';
import { FileSkillAdherenceStore } from '../runtime/skills/adherence-store.js';
import { buildIntentReminderBlock, formatCurrentIntentSummaryLine, formatCurrentTurnIntentSummaryLine, formatIntentCreatedTranscriptBlock, formatIntentStageSummaryTranscriptBlock, formatProgressTranscriptBlock, formatReceiptTranscriptBlock, formatSalvageTranscriptBlock, formatStageActivatedTranscriptBlock, } from '../ui/orchestration.js';
const { version: cliVersion } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
// Completed-intent feedback currently re-enters the footer/input surface and
// has repeatedly regressed in narrow real TTYs. Keep the data path in place,
// but do not prompt interactively until feedback has a non-footer surface.
const COMPLETED_INTENT_FEEDBACK_ENABLED = false;
const THINKING_ONLY_TOOL_TURN_NOTICE = '正在执行工具...';
function describeLiveActivity(toolName, input) {
    if (['tool_search', 'grep', 'glob', 'read', 'skill', 'web_fetch', 'web_search'].includes(toolName)) {
        return 'Exploring codebase';
    }
    if (toolName === 'write' || toolName === 'edit') {
        return 'Updating files';
    }
    if (toolName === 'install_skill' || toolName === 'uninstall_skill') {
        return 'Updating skills';
    }
    if (toolName === 'bash') {
        const command = typeof input.command === 'string' ? input.command.toLowerCase() : '';
        if (/(^|\s)(npm|pnpm|yarn|bun)\s+(test|run test|run build|build)\b/.test(command) || /^(vitest|pytest|go test|cargo test)\b/.test(command)) {
            return 'Running verification';
        }
        if (command.includes('export-pptx.py') || command.includes('.pptx')) {
            return 'Exporting presentation';
        }
        if (/^(ls|find|rg|grep|cat|sed|head|tail|pwd)\b/.test(command) || /^git (status|diff|log|show)\b/.test(command)) {
            return 'Inspecting workspace';
        }
        return 'Running command';
    }
    return 'Working';
}
function countTerminalRowsForLine(line, columns) {
    return Math.max(1, Math.ceil(getDisplayWidth(stripAnsi(line)) / Math.max(1, columns)));
}
function countTerminalRowsForOutput(output, columns) {
    if (!output) {
        return 0;
    }
    const normalized = output.endsWith('\n') ? output.slice(0, -1) : output;
    const lines = normalized.split('\n');
    return lines.reduce((sum, line) => sum + countTerminalRowsForLine(line, columns), 0);
}
async function runChat(initialInput, opts) {
    if ((opts.print || opts.json) && !initialInput) {
        writeError('print/json 模式需要提供单次输入');
        process.exit(1);
    }
    const sessionModeFlags = [opts.continue, opts.resume, opts.takeover, opts.forkSession].filter(Boolean);
    if (sessionModeFlags.length > 1) {
        writeError('--continue / --resume / --takeover / --fork-session 只能同时使用一个');
        process.exit(1);
    }
    if (opts.confirmHighRiskTakeover && !opts.takeover) {
        writeError('--confirm-high-risk-takeover 只能与 --takeover 一起使用');
        process.exit(1);
    }
    // 检测 CI 环境
    const autoMode = opts.auto || !isTTY();
    if (!isTTY() && !opts.auto) {
        console.warn('\x1b[33m[警告]\x1b[0m stdin 非 TTY，自动切换为 --auto 模式');
    }
    // 加载配置和凭据
    let config = await loadConfig();
    let adapter;
    try {
        adapter = createAdapter(config);
    }
    catch (e) {
        writeError(String(e));
        process.exit(1);
    }
    const creds = await loadCredentials();
    const devApp = await getDevAppIdentity();
    const cwd = process.cwd();
    const builtinCommands = ['chat', 'doctor', 'init', 'review', 'pr', 'commit', 'settings', 'context'];
    const platform = await createPlatformRuntimeContext({ cwd, builtinCommands });
    const pluginRuntime = platform.pluginRuntime;
    const customAgents = platform.customAgents;
    const sessionStore = new FileSessionStore();
    const intentLedgerStore = new SessionIntentDelegationStore(sessionStore);
    const skillEvalStore = new SessionSkillEvalStore(sessionStore);
    const skillScoreStore = new FileSkillScoreStore();
    let persistedSession = null;
    if (opts.continue) {
        persistedSession = await sessionStore.loadLast();
        if (!persistedSession) {
            writeError('没有可恢复的历史会话');
            process.exit(1);
        }
    }
    else if (opts.resume) {
        persistedSession = await sessionStore.load(opts.resume);
        if (!persistedSession) {
            writeError(`找不到会话: ${opts.resume}`);
            process.exit(1);
        }
    }
    else if (opts.takeover) {
        persistedSession = await sessionStore.load(opts.takeover);
        if (!persistedSession) {
            writeError(`找不到会话: ${opts.takeover}`);
            process.exit(1);
        }
    }
    else if (opts.forkSession) {
        persistedSession = await sessionStore.fork(opts.forkSession);
    }
    const sessionId = persistedSession?.sessionId ?? sessionStore.createSessionId();
    const sessionCreatedAt = persistedSession?.createdAt ?? Date.now();
    const forkedFromSessionId = persistedSession?.forkedFromSessionId;
    const sessionLineage = persistedSession?.lineage ?? [sessionId];
    const persistedIntentLedger = persistedSession?.intentDelegation ?? null;
    const instanceId = resolveChatInstanceId();
    const ownershipMode = opts.forkSession
        ? 'fork'
        : (opts.takeover ? 'takeover' : (opts.continue || opts.resume ? 'resume' : 'new'));
    const transcriptLogger = new FileTranscriptLogger(sessionId);
    let terminalUiSuspended = false;
    let terminalUiFailureNoted = false;
    let terminalUiFallbackStream = null;
    let stdoutFallbackToStderr = false;
    let suspendInteractiveUi = (_context, _error, _fallbackStream) => {
        terminalUiSuspended = true;
    };
    // 设置环境变量，让 plugin hook 可以 fallback 读取
    process.env['XIAOK_CODE_SESSION_ID'] = sessionId;
    // 加载 skills
    const skillCatalog = createSkillCatalog(undefined, cwd, { extraRoots: pluginRuntime.skillRoots });
    let skills = await skillCatalog.reload();
    const replRenderer = new ReplRenderer(process.stdout);
    const inputReader = new InputReader(replRenderer);
    const toolExplorer = new ToolExplorer(formatToolActivity);
    const turnLayout = new TurnLayout();
    const skillTool = createSkillTool(skillCatalog, platform.capabilityRegistry);
    const promptBuilder = new PromptBuilder();
    let agent;
    let runtimeFacade;
    let skillCatalogWatcher;
    let activeIntentReminderBlock;
    let currentTurnIntentPlan;
    let currentTurnStageIndex = 0;
    let currentTurnStageStatus = 'Drafting Plan';
    let currentTurnStageObservedSkillNames = new Map();
    let completedTurnIntentSummaryLine = '';
    let currentIntentLedger;
    let currentSkillEvalState = persistedSession?.skillEval
        ? cloneSessionSkillEvalState(persistedSession.skillEval)
        : createEmptySessionSkillEvalState(Date.now());
    let currentSkillExecutionState = persistedSession?.skillExecution
        ? cloneSessionSkillExecutionState(persistedSession.skillExecution)
        : createEmptySessionSkillExecutionState(Date.now());
    const skillAdherenceStore = new FileSkillAdherenceStore();
    let activeSkillInvocationId = null;
    try {
        currentIntentLedger = initializeChatIntentLedger(persistedIntentLedger, sessionId, instanceId, ownershipMode, {
            confirmHighRiskTakeover: opts.confirmHighRiskTakeover,
        });
    }
    catch (error) {
        writeError(String(error instanceof Error ? error.message : error));
        process.exit(1);
    }
    // Resolve model capabilities early (needed for getPromptInput)
    const modelCapabilities = resolveModelCapabilities(adapter);
    const getPromptInput = async (promptCwd = cwd, nextSkills = skills) => ({
        enterpriseId: creds?.enterpriseId ?? null,
        devApp,
        budget: modelCapabilities.contextLimit,
        skills: nextSkills,
        pluginCommands: pluginRuntime.commandDeclarations,
        lspDiagnostics: platform.lspManager.getSummary(),
        agents: customAgents.map((item) => ({
            name: item.name,
            model: item.model,
            allowedTools: item.allowedTools,
        })),
        autoContext: await loadAutoContext({
            cwd: promptCwd,
            maxChars: Math.max(1_200, modelCapabilities.contextLimit * 2),
        }),
    });
    const buildPromptSnapshot = async (promptCwd = cwd, nextSkills = skills, channel = 'chat') => promptBuilder.build({
        ...(await getPromptInput(promptCwd, nextSkills)),
        cwd: promptCwd,
        channel,
    });
    const buildPrompt = async (nextSkills = skills, promptCwd = cwd) => (await buildPromptSnapshot(promptCwd, nextSkills)).rendered;
    const refreshSkills = async () => {
        skills = await skillCatalog.reload();
        inputReader.setSkills(skills);
        runtimeFacade?.resetSkillTracking();
    };
    const getInvocationById = (invocationId) => {
        if (!invocationId) {
            return undefined;
        }
        return currentSkillExecutionState.invocations.find((invocation) => invocation.invocationId === invocationId);
    };
    const getTrackedInvocation = (agentId) => {
        const active = getInvocationById(activeSkillInvocationId);
        if (active && active.status === 'running') {
            return active;
        }
        return findLatestRunningInvocation(currentSkillExecutionState, agentId)
            ?? findLatestRunningInvocation(currentSkillExecutionState);
    };
    const activateTrackedSkillPlan = (plan, agentId = 'main') => {
        const activation = activateSkillInvocation(currentSkillExecutionState, {
            sessionId,
            agentId,
            plan,
        });
        currentSkillExecutionState = activation.state;
        activeSkillInvocationId = activation.invocation.invocationId;
        return activation.invocation;
    };
    const recordSkillReferenceEvidence = (invocation, absolutePath, agentId) => {
        const normalizedAbsolutePath = absolutePath.replaceAll('\\', '/');
        for (const step of invocation.plan.resolved) {
            for (const relativePath of step.requiredReferences) {
                const expectedAbsolutePath = join(step.rootDir, relativePath).replaceAll('\\', '/');
                if (expectedAbsolutePath !== normalizedAbsolutePath) {
                    continue;
                }
                currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, invocation.invocationId, {
                    type: 'read_reference',
                    agentId,
                    path: relativePath,
                });
            }
        }
    };
    const recordSkillScriptEvidence = (invocation, command, agentId) => {
        const normalizedCommand = command.trim().replace(/\s+/g, ' ');
        const matchedRequiredCommands = [];
        for (const step of invocation.plan.resolved) {
            for (const requiredCommand of step.requiredScripts) {
                const normalizedRequired = requiredCommand.trim().replace(/\s+/g, ' ');
                if (normalizedCommand !== normalizedRequired) {
                    continue;
                }
                matchedRequiredCommands.push(normalizedRequired);
                currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, invocation.invocationId, {
                    type: 'run_script',
                    agentId,
                    command: normalizedRequired,
                });
            }
        }
        return matchedRequiredCommands;
    };
    const invocationRequiresStep = (invocation, stepId) => (invocation.plan.resolved.some((step) => step.requiredSteps.includes(stepId)));
    const recordSkillStepCompletionEvidence = (invocation, stepId, agentId) => {
        if (!invocationRequiresStep(invocation, stepId)) {
            return;
        }
        currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, invocation.invocationId, {
            type: 'step_completed',
            agentId,
            stepId,
        });
    };
    const recordSkillArtifactFileEvidence = (invocation, filePath, agentId) => {
        const fileName = basename(filePath).toLowerCase();
        if (fileName === 'brief.json') {
            recordSkillStepCompletionEvidence(invocation, 'create_brief_json', agentId);
        }
    };
    const recordSkillCommandStepEvidence = (invocation, matchedRequiredCommands, agentId) => {
        if (matchedRequiredCommands.length === 0) {
            return;
        }
        const normalizedCommands = matchedRequiredCommands.join('\n').toLowerCase();
        if (/(^|[/\s_-])render(?:_from_brief)?(?:[.\s_-]|$)/u.test(normalizedCommands)) {
            recordSkillStepCompletionEvidence(invocation, 'render_from_brief', agentId);
        }
        if (/(^|[/\s_-])(validate|check)(?:[.\s_-]|$)/u.test(normalizedCommands)) {
            recordSkillStepCompletionEvidence(invocation, 'validate_artifact', agentId);
        }
    };
    const observeSkillToolResult = (event) => {
        if (event.toolName !== 'skill' || !event.ok) {
            return;
        }
        try {
            const parsed = JSON.parse(event.result);
            if (parsed.type !== 'skill_plan') {
                return;
            }
            activateTrackedSkillPlan(parsed, event.agentId);
        }
        catch { }
    };
    const observeSkillEvidence = (event) => {
        const invocation = getTrackedInvocation(event.agentId);
        if (!invocation) {
            return;
        }
        if (event.toolName === 'read' && event.ok && typeof event.input.file_path === 'string') {
            recordSkillReferenceEvidence(invocation, event.input.file_path, event.agentId);
            return;
        }
        if ((event.toolName === 'write' || event.toolName === 'edit') && event.ok && typeof event.input.file_path === 'string') {
            recordSkillArtifactFileEvidence(invocation, event.input.file_path, event.agentId);
            return;
        }
        if (event.toolName === 'bash' && event.ok && typeof event.input.command === 'string') {
            const matchedRequiredCommands = recordSkillScriptEvidence(invocation, event.input.command, event.agentId);
            recordSkillCommandStepEvidence(invocation, matchedRequiredCommands, event.agentId);
        }
    };
    // Lazy callbacks for AskUserQuestion — assigned after functions are declared.
    // This avoids TS2448 (use-before-declare) for const-declared functions.
    let askUserOnEnter = null;
    let askUserOnExit = null;
    const workflowTools = [
        createAskUserTool({
            ask: async (question, placeholder) => {
                if (!isTTY()) {
                    throw new Error('当前运行模式不支持 ask_user 交互');
                }
                const promptText = `\n${dim('Agent question:')} ${question}\n`;
                if (replRenderer.hasActiveScrollRegion()) {
                    scrollRegion.writeAtContentCursor(promptText);
                }
                else {
                    process.stdout.write(promptText);
                }
                const answer = await inputReader.read(placeholder ? `${placeholder}: ` : 'Answer: ');
                if (answer === null) {
                    throw new Error('用户取消了问题输入');
                }
                return answer;
            },
        }),
        ...createIntentDelegationTools({
            ledgerStore: intentLedgerStore,
            sessionId,
            instanceId,
            getTurnIntentPlan: () => currentTurnIntentPlan,
        }),
        createAskUserQuestionTool({
            onEnterInteractive: () => askUserOnEnter?.(),
            onExitInteractive: () => askUserOnExit?.(),
        }),
        createInstallSkillTool({
            cwd,
            capabilityRegistry: platform.capabilityRegistry,
            onInstall: refreshSkills,
        }),
        createUninstallSkillTool({
            cwd,
            capabilityRegistry: platform.capabilityRegistry,
            onUninstall: refreshSkills,
        }),
    ];
    const initialPromptSnapshot = await buildPromptSnapshot();
    const capabilityHealthNotice = buildCapabilityHealthNotice(platform.health);
    const persistedPermissionSettings = await loadSettings(cwd);
    const persistedPermissionRules = mergeRules(persistedPermissionSettings);
    const permissionManager = new PermissionManager({
        mode: autoMode ? 'auto' : 'default',
        allowRules: persistedPermissionRules.allowRules,
        denyRules: persistedPermissionRules.denyRules,
    });
    const expandSandboxTargets = (rule, deniedPath) => {
        if (!rule) {
            return [deniedPath];
        }
        const extracted = extractSandboxAllowedPaths([rule]);
        return extracted.length > 0 ? extracted : [deniedPath];
    };
    const persistedSandboxAllowedPaths = extractSandboxAllowedPaths(persistedPermissionRules.allowRules);
    if (persistedSandboxAllowedPaths.length > 0) {
        platform.sandboxPolicy.expandAllowedPaths(persistedSandboxAllowedPaths);
    }
    inputReader.setModeCycleHandler(() => {
        const nextMode = PermissionManager.nextMode(permissionManager.getMode());
        permissionManager.setMode(nextMode);
        statusBar.updateMode(nextMode);
        return nextMode;
    });
    // 嵌入式 channel 管理
    const embeddedChannels = [];
    const embeddedApprovalStore = new InMemoryApprovalStore();
    const registryFactory = createPlatformRegistryFactory({
        platform,
        source: 'chat',
        sessionId,
        transcriptPath: transcriptLogger.path,
        adapter: () => adapter,
        skillTool,
        workflowTools,
        dryRun: opts.dryRun,
        permissionManager,
        onPrompt: async (name, input) => {
            const tuiDecide = async () => {
                const choice = await showPermissionPrompt(name, input, { transcriptLogger, renderer: replRenderer });
                if (choice.action === 'deny')
                    return false;
                if (choice.action === 'allow_once')
                    return true;
                if (choice.action === 'allow_session') {
                    permissionManager.addSessionRule(choice.rule);
                    return true;
                }
                if (choice.action === 'allow_project') {
                    await addAllowRule('project', choice.rule, cwd);
                    permissionManager.addSessionRule(choice.rule);
                    return true;
                }
                if (choice.action === 'allow_global') {
                    await addAllowRule('global', choice.rule, cwd);
                    permissionManager.addSessionRule(choice.rule);
                    return true;
                }
                return false;
            };
            return withPausedLiveActivity(async () => {
                if (embeddedChannels.length > 0) {
                    return embeddedChannels[0].makeOnPrompt(tuiDecide)(name, input);
                }
                return tuiDecide();
            });
        },
        onSandboxDenied: async (deniedPath, toolName) => {
            return withPausedLiveActivity(async () => {
                const choice = await showPermissionPrompt(`sandbox-expand:${toolName}`, { file_path: deniedPath, _hint: `文件在工作目录外，是否允许扩展沙箱访问并读取？` }, { transcriptLogger, renderer: replRenderer });
                if (choice.action === 'deny')
                    return { shouldProceed: false };
                if (choice.action === 'allow_once') {
                    platform.sandboxPolicy.expandAllowedPaths([deniedPath]);
                    return { shouldProceed: true };
                }
                if (choice.action === 'allow_session') {
                    platform.sandboxPolicy.expandAllowedPaths(expandSandboxTargets(choice.rule, deniedPath));
                    permissionManager.addSessionRule(choice.rule);
                    return { shouldProceed: true };
                }
                if (choice.action === 'allow_project') {
                    platform.sandboxPolicy.expandAllowedPaths(expandSandboxTargets(choice.rule, deniedPath));
                    await addAllowRule('project', choice.rule, cwd);
                    permissionManager.addSessionRule(choice.rule);
                    return { shouldProceed: true };
                }
                if (choice.action === 'allow_global') {
                    platform.sandboxPolicy.expandAllowedPaths(expandSandboxTargets(choice.rule, deniedPath));
                    await addAllowRule('global', choice.rule, cwd);
                    permissionManager.addSessionRule(choice.rule);
                    return { shouldProceed: true };
                }
                return { shouldProceed: false };
            });
        },
        buildSystemPrompt: async (promptCwd) => buildPrompt(skills, promptCwd),
        notifyBackgroundJob: async (job) => {
            const line = `\n[background] ${job.jobId} ${job.status}${job.resultSummary ? `: ${job.resultSummary}` : ''}\n`;
            if (replRenderer.hasActiveScrollRegion()) {
                scrollRegion.writeAtContentCursor(line);
            }
            else {
                process.stdout.write(line);
            }
        },
        onToolObserved: async (event) => {
            observeSkillToolResult(event);
            observeSkillEvidence(event);
        },
    });
    const registry = registryFactory.createRegistry(cwd);
    const reminders = registryFactory.getReminderApi();
    // Top-level hooks runner for lifecycle events (SessionStart / UserPromptSubmit / Stop)
    const lifecycleHooks = createHooksRunner({
        hooks: pluginRuntime.hookConfigs,
        context: {
            session_id: sessionId,
            cwd,
            transcript_path: transcriptLogger.path,
        },
    });
    const rawRuntimeHooks = createRuntimeHooks();
    const runtimeHooks = {
        on: rawRuntimeHooks.on,
        onAny: rawRuntimeHooks.onAny,
        emit(event) {
            rawRuntimeHooks.emit({ ...event, sessionId });
        },
    };
    agent = new Agent(adapter, registry, initialPromptSnapshot.rendered, { hooks: runtimeHooks });
    agent.getSessionState().attachPromptSnapshot(initialPromptSnapshot.id, initialPromptSnapshot.memoryRefs);
    agent.setPromptSnapshot(initialPromptSnapshot);
    runtimeFacade = new RuntimeFacade({
        promptBuilder,
        getPromptInput: async (promptCwd) => getPromptInput(promptCwd, skills),
        agent,
        getSkillEntries: () => toSkillEntries(skills),
        getIntentReminderBlock: () => activeIntentReminderBlock,
    });
    skillCatalogWatcher = createSkillCatalogWatcher({
        cwd,
        options: { extraRoots: pluginRuntime.skillRoots },
        onChange: refreshSkills,
    });
    if (persistedSession) {
        agent.restoreSession(persistedSession);
    }
    await sessionStore.save({
        ...agent.exportSession(),
        sessionId,
        cwd: process.cwd(),
        model: adapter.getModelName(),
        createdAt: sessionCreatedAt,
        updatedAt: Date.now(),
        forkedFromSessionId,
        lineage: sessionLineage,
        intentDelegation: currentIntentLedger,
        skillEval: currentSkillEvalState,
        skillExecution: currentSkillExecutionState,
    });
    // 触发 SessionStart hook
    void lifecycleHooks.runHooks('SessionStart', {
        source: opts.continue || opts.resume || opts.takeover ? 'resume' : 'startup',
    });
    // 创建 UI 组件
    const mdRenderer = new MarkdownRenderer();
    const statusBar = new StatusBar();
    const scrollRegion = new ScrollRegionManager();
    replRenderer.setScrollRegion(scrollRegion);
    inputReader.setStatusLineProvider(() => {
        const summaryLine = getCurrentIntentSummaryLine();
        const statusLine = statusBar.getStatusLine();
        const lines = [];
        if (summaryLine) {
            lines.push(summaryLine);
        }
        lines.push(statusLine || ' ');
        return lines;
    });
    inputReader.setScrollPromptRenderer((frame) => {
        if (!scrollRegion.isActive())
            return false;
        scrollRegion.renderPromptFrame({
            inputValue: frame.inputValue,
            cursor: frame.cursor,
            placeholder: 'Type your message...',
            summaryLine: frame.summaryLine,
            statusLine: frame.statusLine,
            overlayLines: frame.overlayLines,
            overlayKind: frame.overlayKind,
        });
        return true;
    });
    const stopIntentRuntimeSync = wireIntentDelegationToRuntimeSync({
        hooks: runtimeHooks,
        ledgerStore: intentLedgerStore,
        sessionId,
    });
    const stopSkillEvalRuntimeSync = wireSkillEvalToRuntimeSync({
        hooks: runtimeHooks,
        ledgerStore: intentLedgerStore,
        skillEvalStore,
        scoreStore: skillScoreStore,
        sessionId,
    });
    let streamingSegmentText = '';
    let turnVisibleAssistantTextSeen = false;
    let turnThinkingOnlyToolNoticeWritten = false;
    let thinkingOnlyToolNoticeTimer = null;
    const resetStreamingSegment = () => {
        streamingSegmentText = '';
    };
    const noteVisibleAssistantText = (delta) => {
        if (/\S/.test(delta)) {
            turnVisibleAssistantTextSeen = true;
        }
    };
    const flushStreamingMarkdown = () => {
        const renderedSegment = streamingSegmentText;
        const flushResult = mdRenderer.flush();
        if (scrollRegion.isActive() && scrollRegion.isContentStreaming()) {
            if (renderedSegment) {
                scrollRegion.syncContentCursorFromRenderedLines(MarkdownRenderer.renderToLines(renderedSegment));
            }
            else if (flushResult.rows > 0) {
                if (flushResult.renderedLine) {
                    scrollRegion.advanceContentCursorByRenderedText(flushResult.renderedLine, { finalizeLine: true });
                }
                else {
                    scrollRegion.advanceContentCursor(flushResult.rows);
                }
            }
        }
        resetStreamingSegment();
    };
    // 收集历史消息用于稍后打印（在欢迎页之后）
    const historyMessages = persistedSession?.messages ?? [];
    let welcomeVisible = historyMessages.length === 0 && !opts.dryRun;
    let contentRows = 0; // tracks how many rows of content have been written
    let resizeTimeout = null;
    let handleResize = null;
    suspendInteractiveUi = (context, error, fallbackStream = null) => {
        if (terminalUiSuspended) {
            return;
        }
        terminalUiSuspended = true;
        terminalUiFallbackStream = fallbackStream;
        runtimeState.deactivateTurn();
        inputReader.setForcePlainMode(false);
        if (!terminalUiFailureNoted) {
            terminalUiFailureNoted = true;
            const rawMessage = `\n[xiaok] UI 输出已停用：${context} (${String(error)})\n`;
            const isBrokenPipe = /\bEPIPE\b/i.test(String(error));
            try {
                transcriptLogger.recordOutput('stderr', rawMessage);
            }
            catch { }
            if (!isBrokenPipe) {
                try {
                    if (fallbackStream === 'stdout') {
                        originalStdoutWrite(rawMessage);
                    }
                    else {
                        originalStderrWrite(rawMessage);
                    }
                }
                catch { }
            }
        }
        try {
            stopActivity();
        }
        catch { }
        try {
            statusBar.destroy();
        }
        catch { }
        try {
            scrollRegion.end();
        }
        catch { }
    };
    const runtimeState = new TuiRuntimeState({
        statusBar,
        scrollRegion,
        onWriteProgressNote: (note) => {
            turnLayout.noteProgressNote();
            writeProgressTranscriptNote(note);
        },
        onSuspendInteractiveUi: (context, error) => {
            suspendInteractiveUi(context, error);
        },
        isTerminalUiSuspended: () => terminalUiSuspended,
    });
    const beginActivity = (label, restart = false, startedAt = Date.now()) => {
        runtimeState.beginActivity(label, restart, startedAt);
    };
    const scheduleActivityResume = (label, delayMs = 180) => {
        runtimeState.scheduleActivityResume(label, delayMs);
    };
    const scheduleActivityPause = (delayMs = 180) => {
        runtimeState.scheduleActivityPause(delayMs);
    };
    const pauseActivity = () => {
        runtimeState.pauseActivity();
    };
    const stopLiveActivityTimer = () => {
        runtimeState.stopLiveActivityTimer();
    };
    const withPausedLiveActivity = async (action) => (runtimeState.withPausedLiveActivity(action));
    // Wire up lazy callbacks for AskUserQuestion interactive prompt
    askUserOnEnter = () => {
        runtimeState.enterInteractivePrompt();
        if (scrollRegion.isActive()) {
            scrollRegion.clearActivityLine();
            scrollRegion.positionCursorAtContentCursor();
        }
    };
    askUserOnExit = () => {
        runtimeState.exitInteractivePrompt();
        runtimeState.beginActivity(describeLiveActivity('AskUserQuestion', {}), true);
    };
    const stopActivity = () => {
        runtimeState.stopActivity();
    };
    const resetTurnChrome = () => {
        stopActivity();
        toolExplorer.reset();
        turnLayout.reset();
        mdRenderer.reset();
        resetStreamingSegment();
    };
    const handleTurnFailure = (error) => {
        runtimeState.markInputReady();
        resetTurnChrome();
        writeError(String(error));
        renderFooterChrome();
    };
    const getFooterInputPrompt = () => runtimeState.getFooterInputPrompt();
    const renderFooterChrome = () => {
        if (!scrollRegion.isActive()) {
            return;
        }
        try {
            const footerOptions = {
                inputPrompt: getFooterInputPrompt(),
                summaryLine: getCurrentIntentSummaryLine(),
                statusLine: statusBar.getStatusLine(),
            };
            if (scrollRegion.isContentStreaming()) {
                scrollRegion.endContentStreaming(footerOptions);
                mdRenderer.beginNewSegment();
                resetStreamingSegment();
            }
            else {
                scrollRegion.renderFooter(footerOptions);
            }
            replRenderer.prepareForInput();
        }
        catch (error) {
            suspendInteractiveUi('render_footer_chrome', error);
        }
    };
    const endStreamingPhaseForInterrupt = () => {
        if (!scrollRegion.isActive() || !scrollRegion.isContentStreaming()) {
            return;
        }
        flushStreamingMarkdown();
        runtimeState.enterToolInterrupt();
        try {
            scrollRegion.endContentStreaming({
                inputPrompt: getFooterInputPrompt(),
                summaryLine: getCurrentIntentSummaryLine(),
                statusLine: statusBar.getStatusLine(),
            });
            replRenderer.prepareForInput();
        }
        catch (error) {
            suspendInteractiveUi('end_streaming_interrupt', error);
        }
        mdRenderer.beginNewSegment();
        resetStreamingSegment();
    };
    const ensureStreamingPhase = () => {
        if (scrollRegion.isContentStreaming()) {
            pauseActivity();
            return;
        }
        scrollRegion.clearActivityLine();
        const assistantLeadIn = turnLayout.consumeAssistantLeadIn();
        if (assistantLeadIn) {
            if (scrollRegion.isActive()) {
                scrollRegion.writeAtContentCursor(assistantLeadIn);
            }
            else {
                process.stdout.write(assistantLeadIn);
            }
        }
        scrollRegion.beginContentStreaming();
        runtimeState.enterStreamingContent();
        beginActivity('Answering');
        mdRenderer.setNewlineCallback(scrollRegion.getNewlineCallback());
        scheduleActivityPause(220);
    };
    const getCurrentIntentSummaryLine = () => {
        let source = 'none';
        let line = '';
        if (currentTurnIntentPlan) {
            source = 'turn';
            line = getCurrentTurnSummaryLine();
        }
        else if (completedTurnIntentSummaryLine) {
            source = 'completed_turn';
            line = completedTurnIntentSummaryLine;
        }
        else if (currentIntentLedger.activeIntentId
            && currentIntentLedger.intents.find((intent) => (intent.intentId === currentIntentLedger.activeIntentId
                && intent.overallStatus === 'waiting_user'))) {
            source = 'waiting_user';
            line = formatCurrentIntentSummaryLine(currentIntentLedger, instanceId);
        }
        runtimeState.setSummarySource(source);
        return line;
    };
    function writeProgressTranscriptNote(note) {
        if (!note) {
            return;
        }
        const block = formatProgressNote(note);
        endStreamingPhaseForInterrupt();
        if (scrollRegion.isActive()) {
            try {
                scrollRegion.writeAtContentCursor(block);
            }
            catch (error) {
                suspendInteractiveUi('write_progress_note', error);
            }
            mdRenderer.beginNewSegment();
            resetStreamingSegment();
            return;
        }
        process.stdout.write(block);
        mdRenderer.beginNewSegment();
        resetStreamingSegment();
    }
    const maybeWriteThinkingOnlyToolNotice = () => {
        if (turnVisibleAssistantTextSeen || turnThinkingOnlyToolNoticeWritten) {
            return;
        }
        // 延迟判断，给文本 chunk 时间到达
        if (thinkingOnlyToolNoticeTimer) {
            return;
        }
        thinkingOnlyToolNoticeTimer = setTimeout(() => {
            if (!turnVisibleAssistantTextSeen && !turnThinkingOnlyToolNoticeWritten) {
                turnThinkingOnlyToolNoticeWritten = true;
                turnLayout.noteProgressNote();
                writeProgressTranscriptNote(THINKING_ONLY_TOOL_TURN_NOTICE);
            }
            thinkingOnlyToolNoticeTimer = null;
        }, 150); // 150ms 延迟
    };
    const isTerminalIntentStatus = (status) => status === 'completed' || status === 'failed' || status === 'cancelled';
    const refreshIntentLedger = async () => {
        currentIntentLedger = await intentLedgerStore.load(sessionId) ?? currentIntentLedger;
    };
    const refreshSkillEvalState = async () => {
        currentSkillEvalState = await skillEvalStore.load(sessionId) ?? currentSkillEvalState;
    };
    const buildComplianceEvidenceView = (invocation) => ({
        readReferences: invocation.evidence
            .filter((event) => event.type === 'read_reference' && event.path)
            .map((event) => event.path),
        runScripts: invocation.evidence
            .filter((event) => event.type === 'run_script' && event.command)
            .map((event) => event.command),
        completedSteps: invocation.evidence
            .filter((event) => event.type === 'step_completed' && event.stepId)
            .map((event) => event.stepId),
    });
    const applyComplianceResult = (invocation, finalAnswerText) => {
        const liveInvocation = getInvocationById(invocation.invocationId) ?? invocation;
        const compliance = evaluateSkillCompliance({
            plan: liveInvocation.plan,
            evidence: buildComplianceEvidenceView(liveInvocation),
            finalAnswer: finalAnswerText,
        });
        currentSkillExecutionState = updateSkillCompliance(currentSkillExecutionState, liveInvocation.invocationId, compliance);
        const refreshedInvocation = getInvocationById(liveInvocation.invocationId);
        if (refreshedInvocation) {
            if (compliance.missingReferences.length === 0) {
                currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, liveInvocation.invocationId, {
                    type: 'step_completed',
                    agentId: refreshedInvocation.agentId,
                    stepId: 'read_required_references',
                });
            }
            if (compliance.missingScripts.length === 0) {
                currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, liveInvocation.invocationId, {
                    type: 'step_completed',
                    agentId: refreshedInvocation.agentId,
                    stepId: 'run_required_scripts',
                });
            }
            if (/\S/.test(finalAnswerText)) {
                currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, liveInvocation.invocationId, {
                    type: 'step_completed',
                    agentId: refreshedInvocation.agentId,
                    stepId: 'summarize_findings',
                });
            }
            for (const failedCheck of compliance.failedChecks) {
                currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, liveInvocation.invocationId, {
                    type: 'success_check_result',
                    agentId: refreshedInvocation.agentId,
                    stepId: `${failedCheck.type}:${failedCheck.terms.join('|')}`,
                    passed: false,
                });
            }
            for (const step of liveInvocation.plan.resolved) {
                for (const successCheck of step.successChecks) {
                    const key = `${successCheck.type}:${successCheck.terms.join('|')}`;
                    const failed = compliance.failedChecks.some((check) => `${check.type}:${check.terms.join('|')}` === key);
                    if (!failed) {
                        currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, liveInvocation.invocationId, {
                            type: 'success_check_result',
                            agentId: refreshedInvocation.agentId,
                            stepId: key,
                            passed: true,
                        });
                    }
                }
            }
        }
        return compliance;
    };
    const runStrictContinuationTurn = async (input) => {
        let continuationText = '';
        await maybePrepareFreshContextHandoff();
        await runtimeFacade.runTurn({
            sessionId,
            cwd,
            source: 'chat',
            input,
        }, (chunk) => {
            if (chunk.type === 'text') {
                noteVisibleAssistantText(chunk.delta);
                continuationText += chunk.delta;
                if (/\S/.test(chunk.delta)) {
                    runtimeState.noteResponseStarted();
                    ensureStreamingPhase();
                }
                streamingSegmentText += chunk.delta;
                mdRenderer.write(chunk.delta);
            }
            if (chunk.type === 'usage') {
                statusBar.update(chunk.usage);
                scrollRegion.updateStatusLine(statusBar.getStatusLine());
            }
        });
        flushStreamingMarkdown();
        await finalizeCurrentTurnIntentIfNeeded();
        return continuationText;
    };
    const maybeRunStrictCompletionLoop = async (assistantText) => {
        let combinedAssistantText = assistantText;
        const invocation = getTrackedInvocation();
        if (!invocation?.strictMode) {
            return combinedAssistantText;
        }
        let latestInvocation = invocation;
        let finalCompliance = applyComplianceResult(latestInvocation, combinedAssistantText);
        let attempts = 0;
        while (!finalCompliance.passed && attempts < 2) {
            attempts += 1;
            const continuationText = await runStrictContinuationTurn(buildComplianceReminder(finalCompliance));
            combinedAssistantText += continuationText;
            latestInvocation = getInvocationById(latestInvocation.invocationId) ?? latestInvocation;
            finalCompliance = applyComplianceResult(latestInvocation, combinedAssistantText);
        }
        skillAdherenceStore.record(latestInvocation.skillName, finalCompliance);
        if (!finalCompliance.passed) {
            writeProgressTranscriptNote(`Strict skill contract still incomplete: ${[
                ...finalCompliance.missingReferences.map((item) => `reference:${item}`),
                ...finalCompliance.missingScripts.map((item) => `script:${item}`),
                ...finalCompliance.missingSteps.map((item) => `step:${item}`),
                ...finalCompliance.failedChecks.map((item) => `check:${item.type}`),
            ].join(', ')}`);
        }
        return combinedAssistantText;
    };
    const renderIntentSummaryLine = () => {
        if (!scrollRegion.isActive() || scrollRegion.isContentStreaming()) {
            return;
        }
        try {
            scrollRegion.renderFooter({
                inputPrompt: getFooterInputPrompt(),
                summaryLine: getCurrentIntentSummaryLine(),
                statusLine: statusBar.getStatusLine(),
            });
        }
        catch (error) {
            suspendInteractiveUi('render_intent_summary', error);
        }
    };
    const hasContinuationCue = (input) => (/^(继续|继续做|继续写|继续生成|再改一版|基于(刚才|上一个|上一版|刚才那个)|按(刚才|上一个|上一版)|重新生成同一件事)/u).test(input.trim());
    const isSupplementOrClarification = (input) => (/^(补充|补一下|补一个|再补充|这里还有|答案是|是|不是|可以|不可以|用中文|用英文|好的，继续|继续吧)/u).test(input.trim());
    const getWaitingUserIntentForInput = (input) => {
        if (!currentIntentLedger.activeIntentId) {
            return undefined;
        }
        const activeIntent = currentIntentLedger.intents.find((intent) => (intent.intentId === currentIntentLedger.activeIntentId
            && intent.overallStatus === 'waiting_user'));
        if (!activeIntent) {
            return undefined;
        }
        if (!hasContinuationCue(input) && !isSupplementOrClarification(input)) {
            return undefined;
        }
        return activeIntent;
    };
    const resetCurrentTurnSummary = () => {
        currentTurnStageIndex = 0;
        currentTurnStageStatus = 'Drafting Plan';
        currentTurnStageObservedSkillNames = new Map();
    };
    const normalizeStageMatchText = (value) => value.toLowerCase();
    const stageLooksLikeReport = (value) => /(报告|report|brief|document|doc)/iu.test(value);
    const stageLooksLikeSlides = (value) => /(幻灯片|slide|slides|deck|ppt|presentation)/iu.test(value);
    const stageLooksLikeMarkdown = (value) => /(^|[^a-z])md([^a-z]|$)|markdown|提取\s*markdown/iu.test(value);
    const scoreStageForSkillName = (stage, skillName) => {
        const stageText = normalizeStageMatchText(`${stage.deliverable} ${stage.label}`);
        const skillText = normalizeStageMatchText(skillName);
        let score = 0;
        if (stageLooksLikeReport(stageText) && /(report|报告)/iu.test(skillText)) {
            score += 20;
        }
        if (stageLooksLikeSlides(stageText) && /(slide|slides|deck|ppt|幻灯片)/iu.test(skillText)) {
            score += 20;
        }
        if (stageLooksLikeMarkdown(stageText) && /(^|[^a-z])md([^a-z]|$)|markdown|extract/iu.test(skillText)) {
            score += 20;
        }
        return score;
    };
    const scoreStageForToolInput = (stage, toolName, toolInput) => {
        const stageText = normalizeStageMatchText(`${stage.deliverable} ${stage.label}`);
        const inputText = normalizeStageMatchText(JSON.stringify(toolInput));
        const toolText = `${normalizeStageMatchText(toolName)} ${inputText}`;
        let score = 0;
        if (stageLooksLikeReport(stageText) && /(report|报告|\.report\.md|生成报告|report-)/iu.test(toolText)) {
            score += 12;
        }
        if (stageLooksLikeSlides(stageText) && /(slide|slides|deck|ppt|幻灯片|演示文稿)/iu.test(toolText)) {
            score += 12;
        }
        if (stageLooksLikeMarkdown(stageText)
            && /(markdown|merged_md|提取\s*markdown|\.md["'\s,}])/iu.test(toolText)
            && !/\.report\.md/iu.test(toolText)) {
            score += 8;
        }
        return score;
    };
    const findBestMatchingStageIndex = (scoreStage) => {
        if (!currentTurnIntentPlan) {
            return -1;
        }
        let bestIndex = -1;
        let bestScore = 0;
        currentTurnIntentPlan.stages.forEach((stage, index) => {
            const score = scoreStage(stage);
            if (score > bestScore || (score === bestScore && score > 0 && index > bestIndex)) {
                bestIndex = index;
                bestScore = score;
            }
        });
        return bestScore > 0 ? bestIndex : -1;
    };
    const inferStageIndexForSkillName = (skillName) => (findBestMatchingStageIndex((stage) => scoreStageForSkillName(stage, skillName)));
    const inferStageIndexForTool = (toolName, toolInput) => (findBestMatchingStageIndex((stage) => scoreStageForToolInput(stage, toolName, toolInput)));
    const advanceCurrentTurnStage = (stageIndex, announce = false) => {
        if (!currentTurnIntentPlan || stageIndex < 0 || stageIndex >= currentTurnIntentPlan.stages.length) {
            return;
        }
        if (stageIndex > currentTurnStageIndex) {
            currentTurnStageIndex = stageIndex;
            if (announce) {
                const stage = currentTurnIntentPlan.stages[stageIndex];
                if (stage) {
                    writeOrchestrationBlock(formatStageActivatedTranscriptBlock({
                        order: stage.order,
                        totalStages: currentTurnIntentPlan.stages.length,
                        label: stage.label,
                    }));
                }
            }
        }
    };
    const getStageSkillNames = (stage) => ([...(currentTurnStageObservedSkillNames.get(stage.order) ?? [])]);
    const recordCurrentTurnStageSkill = (stageIndex, skillName) => {
        const normalized = skillName.trim();
        if (!currentTurnIntentPlan
            || stageIndex < 0
            || stageIndex >= currentTurnIntentPlan.stages.length
            || !normalized
            || normalized.startsWith('generic_llm::')) {
            return;
        }
        const current = currentTurnStageObservedSkillNames.get(stageIndex) ?? new Set();
        current.add(normalized);
        currentTurnStageObservedSkillNames.set(stageIndex, current);
    };
    const maybeAdvanceCurrentTurnStageForTool = (toolName, toolInput) => {
        if (!currentTurnIntentPlan) {
            return;
        }
        if (toolName !== 'skill') {
            advanceCurrentTurnStage(inferStageIndexForTool(toolName, toolInput), true);
            currentTurnStageStatus = 'Working';
            return;
        }
        const skillName = typeof toolInput.name === 'string' ? toolInput.name.trim() : '';
        if (!skillName) {
            currentTurnStageStatus = 'Working';
            return;
        }
        const stageIndex = inferStageIndexForSkillName(skillName);
        advanceCurrentTurnStage(stageIndex, true);
        recordCurrentTurnStageSkill(stageIndex, skillName);
        currentTurnStageStatus = 'Working';
    };
    const getCurrentTurnSummaryLine = () => {
        if (!currentTurnIntentPlan) {
            return '';
        }
        const stages = currentTurnIntentPlan.stages;
        const stage = stages[Math.min(currentTurnStageIndex, Math.max(stages.length - 1, 0))];
        if (!stage) {
            return '';
        }
        return formatCurrentTurnIntentSummaryLine({
            deliverable: currentTurnIntentPlan.deliverable,
            stageOrder: stage.order,
            totalStages: stages.length,
            stageLabel: stage.label,
            skillNames: getStageSkillNames(stage),
            status: currentTurnStageStatus,
        });
    };
    const getCurrentTurnStageSummaryBlock = () => {
        if (!currentTurnIntentPlan || currentTurnIntentPlan.stages.length <= 1) {
            return '';
        }
        const totalStages = currentTurnIntentPlan.stages.length;
        return formatIntentStageSummaryTranscriptBlock({
            deliverable: currentTurnIntentPlan.deliverable,
            stages: currentTurnIntentPlan.stages.map((stage) => ({
                order: stage.order,
                totalStages,
                label: stage.label,
                skillNames: getStageSkillNames(stage),
                status: stage.order <= currentTurnStageIndex ? 'Completed' : 'Skipped',
            })),
        });
    };
    const finalizeCurrentTurnIntentIfNeeded = async () => {
        const intentId = currentTurnIntentPlan?.intentId;
        if (!intentId) {
            return;
        }
        await refreshIntentLedger();
        const intent = currentIntentLedger.intents.find((candidate) => candidate.intentId === intentId);
        if (!intent || intent.overallStatus === 'waiting_user' || isTerminalIntentStatus(intent.overallStatus)) {
            return;
        }
        currentIntentLedger = await intentLedgerStore.updateIntent(sessionId, intentId, {
            overallStatus: 'completed',
            latestReceipt: intent.latestReceipt ?? `Completed ${intent.finalDeliverable || intent.deliverable}`,
            blockedReason: '',
        });
    };
    const prepareIntentReminderForInput = (input) => {
        const activeIntent = getWaitingUserIntentForInput(input);
        const planResult = createIntentPlan({
            instanceId,
            sessionId,
            input,
            skills,
            skillScoreLookup: ({ skillName, intentType, stageRole, deliverable }) => skillScoreStore.getBoost({
                skillName,
                intentType,
                stageRole,
                deliverableFamily: inferDeliverableFamily(deliverable),
            }),
            activeIntent: activeIntent
                ? {
                    intentId: activeIntent.intentId,
                    deliverable: activeIntent.deliverable,
                    intentType: activeIntent.intentType,
                    templateId: activeIntent.templateId,
                }
                : undefined,
        });
        currentTurnIntentPlan = planResult.kind === 'plan' ? planResult.plan : undefined;
        resetCurrentTurnSummary();
        if (currentTurnIntentPlan?.continuationMode === 'continue_active') {
            activeIntentReminderBlock = buildIntentReminderBlock(currentIntentLedger, instanceId);
            return;
        }
        activeIntentReminderBlock = undefined;
    };
    const clearTurnIntentContext = () => {
        currentTurnIntentPlan = undefined;
        activeIntentReminderBlock = undefined;
        resetCurrentTurnSummary();
    };
    const primeTurnIntentPlan = async (renderTranscriptBlock = false) => {
        if (!currentTurnIntentPlan) {
            return;
        }
        const turnIntentPlan = currentTurnIntentPlan;
        const beforeIntentCount = currentIntentLedger.intents.length;
        currentIntentLedger = await bootstrapTurnIntentPlan(intentLedgerStore, sessionId, currentIntentLedger, turnIntentPlan);
        if (turnIntentPlan.continuationMode === 'new_intent') {
            activeIntentReminderBlock = buildIntentReminderBlock(currentIntentLedger, instanceId);
            const createdIntent = currentIntentLedger.intents.find((intent) => intent.intentId === turnIntentPlan.intentId);
            if (createdIntent) {
                currentSkillEvalState = await skillEvalStore.ensureObservationsForIntent(sessionId, createdIntent);
            }
            if (renderTranscriptBlock && currentIntentLedger.intents.length > beforeIntentCount) {
                writeOrchestrationBlock(formatIntentCreatedTranscriptBlock(currentIntentLedger, turnIntentPlan.intentId));
                renderIntentSummaryLine();
            }
        }
    };
    const maybePrepareFreshContextHandoff = async () => {
        await refreshIntentLedger();
        if (!hasPendingFreshContextHandoff(currentIntentLedger, instanceId) || !agent) {
            return;
        }
        const activeIntent = resolveOwnedActiveIntent(currentIntentLedger, instanceId);
        if (!activeIntent) {
            return;
        }
        currentIntentLedger = await intentLedgerStore.saveDispatchedIntent(sessionId, consumeFreshContextHandoff(activeIntent, Date.now()));
        agent.clearHistory();
        runtimeFacade?.resetSkillTracking();
        activeIntentReminderBlock = buildIntentReminderBlock(currentIntentLedger, instanceId);
        await persistSession();
    };
    const writeOrchestrationBlock = (block) => {
        if (!block) {
            return;
        }
        endStreamingPhaseForInterrupt();
        const separatedBlock = block.startsWith('\n') ? block : `\n${block}`;
        if (scrollRegion.isActive()) {
            try {
                scrollRegion.writeAtContentCursor(separatedBlock);
            }
            catch (error) {
                suspendInteractiveUi('write_orchestration_block', error);
            }
            mdRenderer.beginNewSegment();
            resetStreamingSegment();
            return;
        }
        process.stdout.write(separatedBlock);
        mdRenderer.beginNewSegment();
        resetStreamingSegment();
    };
    const persistSession = async () => {
        await refreshIntentLedger();
        await refreshSkillEvalState();
        const snapshot = agent.exportSession();
        await sessionStore.save({
            ...snapshot,
            sessionId,
            cwd: process.cwd(),
            model: adapter.getModelName(),
            createdAt: sessionCreatedAt,
            updatedAt: Date.now(),
            forkedFromSessionId,
            lineage: sessionLineage,
            intentDelegation: currentIntentLedger,
            skillEval: currentSkillEvalState,
            skillExecution: currentSkillExecutionState,
        });
    };
    const releaseSessionOwnershipForExit = async () => {
        await refreshIntentLedger();
        const ownerInstanceId = currentIntentLedger.ownership.ownerInstanceId;
        if (ownerInstanceId !== instanceId) {
            return;
        }
        currentIntentLedger = releaseSessionOwnership(currentIntentLedger, instanceId, Date.now());
        await persistSession();
    };
    const wrapOverlayText = (text, maxWidth) => {
        const safeWidth = Math.max(1, maxWidth);
        const rawLines = stripAnsi(text).split(/\r?\n/u);
        const wrappedLines = [];
        for (const rawLine of rawLines) {
            if (rawLine.length === 0) {
                wrappedLines.push('');
                continue;
            }
            let remaining = rawLine;
            while (remaining.length > 0) {
                if (getDisplayWidth(remaining) <= safeWidth) {
                    wrappedLines.push(remaining);
                    break;
                }
                const slice = sliceByDisplayColumns(remaining, 0, safeWidth);
                if (!slice) {
                    wrappedLines.push(remaining);
                    break;
                }
                wrappedLines.push(slice);
                remaining = remaining.slice(slice.length);
            }
        }
        return wrappedLines;
    };
    const promptFeedbackChoice = async (message) => withPausedLiveActivity(async () => {
        runtimeState.enterWaitingFeedback();
        try {
            const feedbackLine = `[xiaok] ${message}`;
            const feedbackOverlayLines = wrapOverlayText(feedbackLine, Math.max(1, (process.stdout.columns ?? 80) - 2));
            if (!scrollRegion.isActive()) {
                const note = `\n${feedbackLine}\n`;
                process.stdout.write(note);
            }
            while (true) {
                const answer = await inputReader.read('> ', scrollRegion.isActive() ? { overlayLines: feedbackOverlayLines, overlayKind: 'feedback' } : undefined);
                if (answer === null) {
                    return { outcome: 'skip', exitRequested: true };
                }
                const trimmedAnswer = answer.trim();
                const normalizedAnswer = trimmedAnswer.toLowerCase();
                if (trimmedAnswer === '' || normalizedAnswer === 's' || normalizedAnswer === 'skip') {
                    return { outcome: 'skip' };
                }
                if (normalizedAnswer === 'y' || normalizedAnswer === 'yes') {
                    return { outcome: 'positive' };
                }
                if (normalizedAnswer === 'n' || normalizedAnswer === 'no') {
                    return { outcome: 'negative' };
                }
                // Treat ordinary free-form follow-up text as "skip feedback and continue".
                // Otherwise the completed-intent feedback loop swallows the next user turn.
                return { outcome: 'skip', deferredInput: answer };
            }
        }
        finally {
            runtimeState.markInputReady();
            renderIntentSummaryLine();
        }
    });
    const buildFeedbackRecord = (intentId, kind, sentiment, observationIds, note) => ({
        feedbackId: `feedback_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        intentId,
        kind,
        sentiment,
        observationIds,
        note,
        createdAt: Date.now(),
    });
    const maybeCollectCompletedIntentFeedback = async () => {
        const noFeedbackResult = { deferredInput: null, exitRequested: false };
        if (!COMPLETED_INTENT_FEEDBACK_ENABLED) {
            return noFeedbackResult;
        }
        if (!isTTY() || opts.auto) {
            return noFeedbackResult;
        }
        await refreshIntentLedger();
        await refreshSkillEvalState();
        const activeIntent = currentIntentLedger.activeIntentId
            ? currentIntentLedger.intents.find((intent) => intent.intentId === currentIntentLedger.activeIntentId)
            : undefined;
        if (!activeIntent || activeIntent.overallStatus !== 'completed') {
            return noFeedbackResult;
        }
        if (currentSkillEvalState.promptedIntentIds.includes(activeIntent.intentId)) {
            return noFeedbackResult;
        }
        const relevantObservations = currentSkillEvalState.observations.filter((observation) => (observation.intentId === activeIntent.intentId && Boolean(observation.actualSkillName)));
        currentSkillEvalState = await skillEvalStore.markPromptedIntent(sessionId, activeIntent.intentId);
        if (relevantObservations.length === 0) {
            return noFeedbackResult;
        }
        const observationIds = relevantObservations.map((observation) => observation.observationId);
        const pendingFeedback = [];
        const outcome = await promptFeedbackChoice('这次结果是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过');
        if (outcome.exitRequested) {
            return { deferredInput: null, exitRequested: true };
        }
        if (outcome.deferredInput) {
            return { deferredInput: outcome.deferredInput, exitRequested: false };
        }
        if (outcome.outcome !== 'skip') {
            pendingFeedback.push(buildFeedbackRecord(activeIntent.intentId, 'outcome', outcome.outcome, observationIds));
        }
        if (pendingFeedback.length === 0) {
            return noFeedbackResult;
        }
        for (const feedback of pendingFeedback) {
            currentSkillEvalState = await skillEvalStore.recordFeedback(sessionId, feedback);
            skillScoreStore.recordFeedback(feedback, relevantObservations);
        }
        await persistSession();
        return noFeedbackResult;
    };
    // 初始化状态栏（在单次任务模式之前）
    const fullModelName = adapter.getModelName();
    statusBar.init(fullModelName, sessionId, process.cwd(), opts.dryRun ? 'dry-run' : permissionManager.getMode(), {
        contextLimit: modelCapabilities.contextLimit,
    });
    const branch = await getCurrentBranch(process.cwd());
    if (branch)
        statusBar.updateBranch(branch);
    statusBar.update({ inputTokens: 0, outputTokens: 0 });
    // 单次任务模式
    if (initialInput) {
        const inputBlocks = await parseInputBlocks(initialInput, resolveModelCapabilities(adapter).supportsImageInput);
        clearPastedImagePaths();
        const printChunks = [];
        const toolCallsList = [];
        let askUserCalls = 0;
        const startTime = Date.now();
        if (!opts.print && !opts.json) {
            process.stdout.write('\n');
        }
        try {
            if (capabilityHealthNotice) {
                process.stderr.write(`${capabilityHealthNotice}\n`);
            }
            await refreshSkills();
            await refreshIntentLedger();
            prepareIntentReminderForInput(initialInput);
            await primeTurnIntentPlan();
            await maybePrepareFreshContextHandoff();
            await runtimeFacade.runTurn({
                sessionId,
                cwd,
                source: 'chat',
                input: inputBlocks,
            }, (chunk) => {
                if (chunk.type === 'text') {
                    printChunks.push(chunk.delta);
                    if (!opts.print && !opts.json) {
                        mdRenderer.write(chunk.delta);
                    }
                }
                if (chunk.type === 'tool_use') {
                    toolCallsList.push(chunk.name);
                    if (chunk.name === 'AskUserQuestion') {
                        askUserCalls += 1;
                    }
                }
                if (chunk.type === 'usage') {
                    statusBar.update(chunk.usage);
                }
            });
            await finalizeCurrentTurnIntentIfNeeded();
            await persistSession();
            if (opts.print || opts.json) {
                process.stdout.write(formatPrintOutput({
                    sessionId,
                    text: printChunks.join(''),
                    usage: agent.getUsage(),
                    num_turns: 1,
                    ask_user_calls: askUserCalls,
                    tool_calls: toolCallsList,
                    duration_ms: Date.now() - startTime,
                }, Boolean(opts.json)) + '\n');
            }
            else {
                mdRenderer.flush();
                process.stdout.write('\n');
            }
        }
        catch (e) {
            writeError(String(e));
            process.exit(1);
        }
        finally {
            clearTurnIntentContext();
            await releaseSessionOwnershipForExit();
            await platform.dispose();
        }
        if (!opts.print && !opts.json) {
            process.stdout.write('\n');
        }
        return;
    }
    // 交互模式 - 显示欢迎界面
    const getActiveProviderLabel = () => {
        const providerId = config.defaultProvider;
        const profile = getProviderProfile(providerId);
        return (profile?.label ?? providerId).toLowerCase();
    };
    inputReader.setTranscriptLogger(transcriptLogger);
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const isBrokenPipeError = (error) => (typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'EPIPE');
    const activateStdoutFallback = (error) => {
        if (!isBrokenPipeError(error)) {
            return false;
        }
        stdoutFallbackToStderr = true;
        terminalUiFallbackStream = 'stderr';
        return true;
    };
    const getFallbackWriter = () => {
        if (terminalUiFallbackStream === 'stderr') {
            return originalStderrWrite;
        }
        if (terminalUiFallbackStream === 'stdout') {
            return originalStdoutWrite;
        }
        return null;
    };
    process.stdout.write = ((chunk, ...args) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        transcriptLogger.recordOutput('stdout', text);
        if (terminalUiSuspended) {
            const fallbackWriter = getFallbackWriter();
            if (fallbackWriter) {
                try {
                    return fallbackWriter(chunk, ...args);
                }
                catch {
                    return true;
                }
            }
            return true;
        }
        try {
            const writer = stdoutFallbackToStderr ? originalStderrWrite : originalStdoutWrite;
            return writer(chunk, ...args);
        }
        catch (error) {
            if (activateStdoutFallback(error)) {
                try {
                    return originalStderrWrite(chunk, ...args);
                }
                catch {
                    return true;
                }
            }
            suspendInteractiveUi('stdout_write', error);
            return true;
        }
    });
    process.stderr.write = ((chunk, ...args) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        transcriptLogger.recordOutput('stderr', text);
        if (terminalUiSuspended) {
            const fallbackWriter = getFallbackWriter();
            if (fallbackWriter) {
                try {
                    return fallbackWriter(chunk, ...args);
                }
                catch {
                    return true;
                }
            }
            return true;
        }
        try {
            return originalStderrWrite(chunk, ...args);
        }
        catch (error) {
            suspendInteractiveUi('stderr_write', error);
            return true;
        }
    });
    try {
        // 激活 scroll region（必须在欢迎屏幕之前）
        // 这样欢迎内容自然填充到 scroll region 内，footer 固定在底部
        scrollRegion.begin();
        // 显示欢迎界面
        contentRows = renderWelcomeScreen({
            model: getActiveProviderLabel(),
            cwd: process.cwd(),
            sessionId,
            mode: opts.auto ? 'auto' : opts.dryRun ? 'dry-run' : 'default',
            version: cliVersion,
        });
        // Initialize scroll region to match welcome screen position.
        // setWelcomeRows updates both _totalRows and _cursorRow based on
        // the row count returned by renderWelcomeScreen (console.log calls).
        scrollRegion.setWelcomeRows(contentRows);
        // 设置初始 usage
        statusBar.update({ inputTokens: 0, outputTokens: 0 });
        if (opts.dryRun)
            process.stdout.write(`${dim('[dry-run 模式] 工具调用不会实际执行')}\n\n`);
        // 打印历史消息（session resume）- 在欢迎页之后
        if (historyMessages.length > 0) {
            const historyColumns = process.stdout.columns ?? 80;
            let replayedRows = 0;
            const writeHistoryChunk = (chunk) => {
                if (!chunk)
                    return;
                if (scrollRegion.isActive()) {
                    scrollRegion.writeAtContentCursor(chunk);
                    return;
                }
                process.stdout.write(chunk);
                replayedRows += countTerminalRowsForOutput(chunk, historyColumns);
            };
            writeHistoryChunk('\n');
            for (const msg of historyMessages) {
                if (msg.role === 'user') {
                    for (const block of msg.content) {
                        if (block.type === 'text') {
                            const text = block.text;
                            // Skip system-reminder content
                            if (text && !text.startsWith('<system-reminder>')) {
                                writeHistoryChunk(formatHistoryBlock(block));
                            }
                        }
                        else {
                            writeHistoryChunk(formatHistoryBlock(block));
                        }
                    }
                }
                else if (msg.role === 'assistant') {
                    for (const block of msg.content) {
                        if (block.type === 'text') {
                            for (const line of MarkdownRenderer.renderToLines(block.text)) {
                                writeHistoryChunk(`${line}\n`);
                            }
                        }
                        else {
                            writeHistoryChunk(formatHistoryBlock(block));
                        }
                    }
                }
            }
            writeHistoryChunk('\n');
            if (!scrollRegion.isActive()) {
                scrollRegion.advanceContentCursor(replayedRows);
            }
        }
        const dismissWelcomeScreen = () => {
            if (!welcomeVisible || !scrollRegion.isActive())
                return;
            // Keep the welcome card in the scroll region as a visual separator from
            // terminal scrollback. Submitted input will append below and scroll it
            // away naturally as the conversation grows.
            welcomeVisible = false;
        };
        const writeCommandOutput = (commandText, output) => {
            if (!scrollRegion.isActive()) {
                process.stdout.write(output);
                return;
            }
            try {
                scrollRegion.clearLastInput();
                scrollRegion.writeSubmittedInput(formatSubmittedInput(commandText));
                scrollRegion.writeAtContentCursor(output);
                replRenderer.prepareForInput();
            }
            catch (error) {
                suspendInteractiveUi('write_command_output', error);
            }
        };
        setStreamErrorHandler((error, stream) => {
            if (stream !== process.stdout && stream !== process.stderr) {
                return false;
            }
            if (stream === process.stdout && activateStdoutFallback(error)) {
                return true;
            }
            suspendInteractiveUi(stream === process.stdout ? 'stdout_stream_error' : 'stderr_stream_error', error, stream === process.stdout ? 'stderr' : 'stdout');
            return true;
        });
        // 创建输入读取器
        inputReader.setSkills(skills);
        runtimeHooks.on('turn_started', () => {
            completedTurnIntentSummaryLine = '';
            toolExplorer.reset();
            turnLayout.reset();
            resetStreamingSegment();
            turnVisibleAssistantTextSeen = false;
            turnThinkingOnlyToolNoticeWritten = false;
            if (thinkingOnlyToolNoticeTimer) {
                clearTimeout(thinkingOnlyToolNoticeTimer);
                thinkingOnlyToolNoticeTimer = null;
            }
            runtimeState.beginTurn('Thinking');
            if (!terminalUiSuspended) {
                scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() });
            }
        });
        runtimeHooks.on('tool_started', (e) => {
            endStreamingPhaseForInterrupt();
            runtimeState.enterToolInterrupt();
            beginActivity(describeLiveActivity(e.toolName, e.toolInput));
            maybeAdvanceCurrentTurnStageForTool(e.toolName, e.toolInput);
            maybeWriteThinkingOnlyToolNotice();
            const activity = toolExplorer.record(e.toolName, e.toolInput);
            if (activity) {
                turnLayout.noteToolActivity();
                pauseActivity();
                // Write tool output at the tracked content position (inside scroll region)
                if (scrollRegion.isActive()) {
                    scrollRegion.writeAtContentCursor(activity);
                }
                else {
                    process.stdout.write(activity);
                }
                mdRenderer.beginNewSegment();
                resetStreamingSegment();
                beginActivity(describeLiveActivity(e.toolName, e.toolInput), true);
                renderIntentSummaryLine();
            }
        });
        runtimeHooks.on('tool_finished', (_e) => {
            scheduleActivityResume('Thinking', 160);
        });
        runtimeHooks.on('intent_created', async (event) => {
            await refreshIntentLedger();
            writeOrchestrationBlock(formatIntentCreatedTranscriptBlock(currentIntentLedger, event.intentId));
            renderIntentSummaryLine();
        });
        runtimeHooks.on('stage_activated', async (event) => {
            await refreshIntentLedger();
            currentTurnStageIndex = event.order;
            currentTurnStageStatus = 'Working';
            writeOrchestrationBlock(formatStageActivatedTranscriptBlock({
                order: event.order,
                totalStages: event.totalStages,
                label: event.label,
            }));
            renderIntentSummaryLine();
        });
        runtimeHooks.on('step_activated', async (event) => {
            await refreshIntentLedger();
            currentTurnStageStatus = 'Working';
            writeOrchestrationBlock(formatProgressTranscriptBlock({
                stepId: event.stepId,
                status: 'running',
                message: `Active step moved to ${event.stepId.split(':step:')[1] ?? event.stepId}`,
            }));
            renderIntentSummaryLine();
        });
        runtimeHooks.on('breadcrumb_emitted', async (event) => {
            await refreshIntentLedger();
            currentTurnStageStatus = event.status === 'blocked' ? 'Waiting User' : 'Working';
            writeOrchestrationBlock(formatProgressTranscriptBlock({
                stepId: event.stepId,
                status: event.status,
                message: event.message,
            }));
            renderIntentSummaryLine();
        });
        runtimeHooks.on('receipt_emitted', async (event) => {
            await refreshIntentLedger();
            currentTurnStageStatus = 'Completed';
            writeOrchestrationBlock(formatReceiptTranscriptBlock(event.note));
            renderIntentSummaryLine();
        });
        runtimeHooks.on('salvage_emitted', async (event) => {
            await refreshIntentLedger();
            writeOrchestrationBlock(formatSalvageTranscriptBlock(event.summary, event.reason));
            renderIntentSummaryLine();
        });
        runtimeHooks.on('turn_completed', () => {
            toolExplorer.reset();
            if (currentTurnIntentPlan?.stages.length) {
                currentTurnStageIndex = currentTurnIntentPlan.stages.length - 1;
                currentTurnStageStatus = 'Completed';
                completedTurnIntentSummaryLine = getCurrentTurnSummaryLine();
                const stageSummaryBlock = getCurrentTurnStageSummaryBlock();
                if (stageSummaryBlock) {
                    writeOrchestrationBlock(stageSummaryBlock);
                }
            }
            runtimeState.markBusyFinishing();
            stopActivity();
            void refreshIntentLedger().then(renderIntentSummaryLine);
        });
        runtimeHooks.on('turn_failed', () => {
            completedTurnIntentSummaryLine = '';
            runtimeState.markInputReady();
            resetTurnChrome();
            void refreshIntentLedger().then(renderIntentSummaryLine);
        });
        runtimeHooks.on('turn_aborted', () => {
            completedTurnIntentSummaryLine = '';
            runtimeState.markInputReady();
            resetTurnChrome();
            void refreshIntentLedger().then(renderIntentSummaryLine);
        });
        // Context 压缩通知
        runtimeHooks.on('compact_triggered', () => {
            beginActivity('Compacting context');
            turnLayout.noteProgressNote();
            pauseActivity();
            writeProgressTranscriptNote('⚠ 上下文已压缩，保留最近对话');
        });
        // 处理终端窗口大小调整
        handleResize = () => {
            if (resizeTimeout)
                clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const rows = process.stdout.rows ?? 24;
                const cols = process.stdout.columns ?? 80;
                try {
                    scrollRegion.updateSize(rows, cols);
                }
                catch (error) {
                    suspendInteractiveUi('resize_render', error);
                }
                // 普通文档流模式下不做底部重绘，后续输出自然适配新尺寸
            }, 100);
        };
        process.stdout.on('resize', handleResize);
        // SIGINT 处理
        process.on('SIGINT', () => {
            void (async () => {
                stopActivity();
                if (handleResize) {
                    process.stdout.off('resize', handleResize);
                }
                skillCatalogWatcher?.close();
                clearTurnIntentContext();
                await releaseSessionOwnershipForExit();
                await platform.dispose();
                for (const ch of embeddedChannels) {
                    await ch.cleanup();
                }
                statusBar.destroy();
                process.stdout.write(`\n已退出。${dim(` 继续上次工作：xiaok -c  或  xiaok --resume ${sessionId}`)}\n`);
                process.exit(0);
            })();
        });
        let deferredInput = null;
        const handleCompletedIntentFeedbackResult = async (result) => {
            if (result.deferredInput !== null) {
                if (scrollRegion.isActive()) {
                    scrollRegion.clearOverlayPromptState();
                }
                runtimeState.markInputReady();
                renderFooterChrome();
                deferredInput = result.deferredInput;
            }
            if (!result.exitRequested) {
                return false;
            }
            clearTurnIntentContext();
            await releaseSessionOwnershipForExit();
            scrollRegion.end();
            statusBar.destroy();
            process.stdout.write(`\n已退出。${dim(` 继续上次工作：xiaok -c  或  xiaok --resume ${sessionId}`)}\n`);
            return true;
        };
        // 交互循环
        interactiveLoop: while (true) {
            await refreshSkills();
            let input;
            if (deferredInput !== null) {
                input = deferredInput;
                deferredInput = null;
            }
            else {
                // 输入前的分隔线 — scroll region 激活后跳过，由 footer 处理
                if (!scrollRegion.isActive() && !terminalUiSuspended) {
                    renderInputSeparator();
                }
                input = await inputReader.read('> ');
            }
            if (input === null || input.trim() === '/exit') {
                clearTurnIntentContext();
                await releaseSessionOwnershipForExit();
                scrollRegion.end();
                statusBar.destroy();
                process.stdout.write(`\n再见！${dim(` 继续上次工作：xiaok -c  或  xiaok --resume ${sessionId}`)}\n`);
                break;
            }
            const trimmed = input.trim();
            if (!trimmed)
                continue;
            if (completedTurnIntentSummaryLine) {
                completedTurnIntentSummaryLine = '';
                renderFooterChrome();
            }
            await refreshSkills();
            // 处理内置命令
            if (trimmed === '/clear') {
                scrollRegion.end();
                process.stdout.write('\x1b[2J\x1b[H');
                contentRows = renderWelcomeScreen({
                    model: getActiveProviderLabel(),
                    cwd: process.cwd(),
                    sessionId,
                    mode: opts.auto ? 'auto' : opts.dryRun ? 'dry-run' : 'default',
                    version: cliVersion,
                });
                scrollRegion.begin();
                scrollRegion.setWelcomeRows(contentRows);
                welcomeVisible = true;
                continue;
            }
            dismissWelcomeScreen();
            if (trimmed === '/help') {
                writeCommandOutput(trimmed, buildChatHelpText(skills));
                continue;
            }
            if (reminders) {
                const reminderOutput = await executeReminderSlashCommand(trimmed, {
                    reminders,
                    sessionId,
                    creatorUserId: sessionId,
                });
                if (reminderOutput !== null) {
                    writeCommandOutput(trimmed, `${reminderOutput}\n\n`);
                    continue;
                }
            }
            if (trimmed === '/skills-reload') {
                const prevCount = skills.length;
                await refreshSkills();
                const newCount = skills.length;
                inputReader.setSkills(skills);
                const diff = newCount - prevCount;
                if (diff > 0) {
                    writeCommandOutput(trimmed, `已刷新 skill 目录，新增 ${diff} 个 skill，当前共 ${newCount} 个。\n\n`);
                }
                else if (diff < 0) {
                    writeCommandOutput(trimmed, `已刷新 skill 目录，移除 ${-diff} 个 skill，当前共 ${newCount} 个。\n\n`);
                }
                else {
                    writeCommandOutput(trimmed, `已刷新 skill 目录，当前共 ${newCount} 个 skill。\n\n`);
                }
                continue;
            }
            if (trimmed === '/yzjchannel') {
                if (embeddedChannels.length > 0) {
                    writeCommandOutput(trimmed, '已有活跃的云之家 channel，请先关闭当前 chat 进程再重新连接。\n\n');
                    continue;
                }
                const yzjConfig = (() => {
                    try {
                        return resolveYZJConfig(config);
                    }
                    catch {
                        writeCommandOutput(trimmed, 'YZJ 未配置，请先运行 xiaok yzjchannel config set-webhook-url <url>\n\n');
                        return null;
                    }
                })();
                if (!yzjConfig)
                    continue;
                const namedChannels = config.channels?.yzj?.namedChannels ?? [];
                const selectedChannel = await selectYZJChannel(namedChannels);
                if (!selectedChannel) {
                    writeCommandOutput(trimmed, '已取消。\n\n');
                    continue;
                }
                const transport = new YZJTransport({ webhookUrl: yzjConfig.webhookUrl });
                const embedded = new EmbeddedYZJChannel({
                    runtimeFacade: runtimeFacade,
                    runtimeHooks,
                    approvalStore: embeddedApprovalStore,
                    onPromptOverride: async () => true,
                    transport,
                    selectedChannel,
                    yzjConfig,
                    sessionId,
                    cwd,
                });
                await embedded.start();
                embeddedChannels.push(embedded);
                continue;
            }
            if (trimmed === '/mode' || trimmed.startsWith('/mode ')) {
                const [, requestedMode] = trimmed.split(/\s+/, 2);
                if (!requestedMode) {
                    writeCommandOutput(trimmed, `当前权限模式：${permissionManager.getMode()}\n\n`);
                    continue;
                }
                if (!['default', 'auto', 'plan'].includes(requestedMode)) {
                    writeCommandOutput(trimmed, '用法：/mode [default|auto|plan]\n\n');
                    continue;
                }
                permissionManager.setMode(requestedMode);
                statusBar.updateMode(requestedMode);
                writeCommandOutput(trimmed, `权限模式已切换为 ${requestedMode}\n\n`);
                continue;
            }
            if (trimmed === '/compact') {
                const compaction = agent.forceCompact();
                if (compaction) {
                    writeCommandOutput(trimmed, `${dim(`已压缩较早对话，保留最近上下文（折叠 ${compaction.replacedMessages} 条历史消息）。`)}\n\n`);
                }
                else {
                    writeCommandOutput(trimmed, `${dim('当前历史很短，暂时无需压缩。')}\n\n`);
                }
                continue;
            }
            if (trimmed === '/models') {
                const selected = await selectModel(config, { renderer: replRenderer });
                if (selected) {
                    const newConfig = {
                        ...config,
                        defaultProvider: selected.provider,
                        defaultModelId: selected.modelId,
                    };
                    try {
                        const nextAdapter = createAdapter(newConfig);
                        await saveConfig(newConfig);
                        adapter = nextAdapter;
                        config = newConfig;
                        agent.setAdapter(adapter);
                        statusBar.updateModel(selected.model);
                        writeCommandOutput(trimmed, `已切换到：[${selected.provider}] ${selected.label} (${selected.model})\n\n`);
                    }
                    catch (e) {
                        writeCommandOutput(trimmed, `切换失败：${String(e)}\n\n`);
                    }
                }
                else {
                    writeCommandOutput(trimmed, '已取消\n\n');
                }
                continue;
            }
            if (trimmed === '/settings') {
                try {
                    const settings = await loadSettings(cwd);
                    const rules = mergeRules(settings);
                    writeCommandOutput(trimmed, `${JSON.stringify({
                        config,
                        permissions: rules,
                    }, null, 2)}\n\n`);
                }
                catch (e) {
                    writeError(String(e));
                }
                continue;
            }
            if (trimmed === '/context') {
                try {
                    const context = await loadAutoContext({ cwd });
                    writeCommandOutput(trimmed, `${formatLoadedContext(context) || '当前没有可展示的仓库上下文。'}\n\n`);
                }
                catch (e) {
                    writeError(String(e));
                }
                continue;
            }
            if (trimmed === '/doctor') {
                writeCommandOutput(trimmed, 'chat 中已不再支持 /doctor，请直接运行：xiaok doctor\n\n');
                continue;
            }
            if (trimmed === '/init') {
                writeCommandOutput(trimmed, 'chat 中已不再支持 /init，请直接运行：xiaok init\n\n');
                continue;
            }
            if (trimmed === '/review') {
                writeCommandOutput(trimmed, 'chat 中已不再支持 /review，请直接运行：xiaok review\n\n');
                continue;
            }
            if (trimmed === '/pr') {
                writeCommandOutput(trimmed, 'chat 中已不再支持 /pr，请直接运行：xiaok pr\n\n');
                continue;
            }
            if (trimmed === '/commit' || trimmed.startsWith('/commit ')) {
                writeCommandOutput(trimmed, 'chat 中已不再支持 /commit，请直接运行：xiaok commit\n\n');
                continue;
            }
            // Clear terminal renderer state — but NOT when scroll region is active,
            // because the scroll region's endContentStreaming() has already positioned
            // the footer at the bottom, and TerminalRenderer's initial render (\n)
            // would scroll it up.
            if (!scrollRegion.isActive()) {
                replRenderer.prepareBlockOutput();
            }
            // 输入后的分隔线 — scroll region 激活后跳过，footer 已包含分隔效果
            if (!scrollRegion.isActive() && !terminalUiSuspended) {
                renderInputSeparator();
            }
            // 将光标移到 scroll region 内容区，避免用户输入覆盖 footer
            // Uses the scroll region's tracked content cursor (_contentCursor)
            // which accounts for all written content including tool explorer output.
            if (scrollRegion.isActive()) {
                scrollRegion.positionAfterContent();
            }
            // 显示用户输入（带背景色）— 写入 scroll region 内容区
            // Note: In scroll region mode, we DON'T write input here because
            // clearLastInput() will clear the screen. Instead, input is written
            // after clearLastInput() via writeSubmittedInput().
            if (!scrollRegion.isActive()) {
                process.stdout.write(formatSubmittedInput(trimmed));
            }
            // 斜杠命令：直接触发对应 skill
            const slash = parseSlashCommand(trimmed);
            if (slash) {
                let skill = findSkillByCommandName(skills, slash.skillName);
                if (!skill) {
                    await refreshSkills();
                    skill = findSkillByCommandName(skills, slash.skillName);
                }
                if (skill) {
                    try {
                        const plan = buildSkillExecutionPlan([skill.name], skills);
                        const primaryStep = plan.resolved[plan.resolved.length - 1];
                        const invocation = activateTrackedSkillPlan(plan, plan.strategy === 'fork' && primaryStep?.agent ? primaryStep.agent : 'main');
                        activeIntentReminderBlock = undefined;
                        process.stdout.write('\n');
                        mdRenderer.reset();
                        resetStreamingSegment();
                        if (plan.strategy === 'fork' && primaryStep?.agent) {
                            let result = await executeNamedSubAgent({
                                agentDef: customAgents.find((item) => item.name === primaryStep.agent) ?? {
                                    name: primaryStep.name,
                                    systemPrompt: primaryStep.content,
                                    allowedTools: primaryStep.allowedTools,
                                    model: primaryStep.model,
                                },
                                prompt: slash.rest
                                    ? `执行 skill "${primaryStep.name}"。用户补充说明：${slash.rest}`
                                    : `执行 skill "${primaryStep.name}"。`,
                                sessionId,
                                adapter: () => adapter,
                                createRegistry: (subCwd, allowedTools) => registryFactory.createRegistry(subCwd, allowedTools),
                                buildSystemPrompt: async (promptCwd) => buildPrompt(skills, promptCwd),
                                worktreeManager: platform.worktreeManager,
                                forkContext: {
                                    session: agent.exportSession(),
                                    messages: agent.exportSession().messages,
                                    systemPrompt: await buildPrompt(skills),
                                    toolDefinitions: registry.getToolDefinitions(),
                                },
                            });
                            if (invocation.strictMode) {
                                const compliance = applyComplianceResult(invocation, result);
                                if (!compliance.passed) {
                                    result += await runStrictContinuationTurn(buildComplianceReminder(compliance));
                                    result = await maybeRunStrictCompletionLoop(result);
                                }
                                else {
                                    skillAdherenceStore.record(invocation.skillName, compliance);
                                }
                            }
                            mdRenderer.write(result);
                        }
                        else {
                            const userMsg = slash.rest
                                ? `执行 skill plan "${plan.primarySkill}"，用户补充说明：${slash.rest}\n\n${JSON.stringify(plan, null, 2)}`
                                : `执行 skill plan：\n\n${JSON.stringify(plan, null, 2)}`;
                            let slashAssistantText = '';
                            clearTurnIntentContext();
                            if (!terminalUiSuspended) {
                                scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() });
                            }
                            await maybePrepareFreshContextHandoff();
                            await runtimeFacade.runTurn({
                                sessionId,
                                cwd,
                                source: 'chat',
                                input: userMsg,
                            }, (chunk) => {
                                if (chunk.type === 'text') {
                                    noteVisibleAssistantText(chunk.delta);
                                    slashAssistantText += chunk.delta;
                                    if (/\S/.test(chunk.delta)) {
                                        runtimeState.noteResponseStarted();
                                        ensureStreamingPhase();
                                    }
                                    streamingSegmentText += chunk.delta;
                                    mdRenderer.write(chunk.delta);
                                }
                                if (chunk.type === 'usage') {
                                    statusBar.update(chunk.usage);
                                    scrollRegion.updateStatusLine(statusBar.getStatusLine());
                                }
                            });
                            flushStreamingMarkdown();
                            slashAssistantText = await maybeRunStrictCompletionLoop(slashAssistantText);
                            await finalizeCurrentTurnIntentIfNeeded();
                            await persistSession();
                            // Feedback is a new interactive prompt. Clear the completed turn
                            // summary first so the footer does not keep rendering "Completed"
                            // intent chrome underneath the feedback input.
                            clearTurnIntentContext();
                            const feedbackResult = await maybeCollectCompletedIntentFeedback();
                            if (await handleCompletedIntentFeedbackResult(feedbackResult)) {
                                break interactiveLoop;
                            }
                            if (deferredInput === null) {
                                runtimeState.markInputReady();
                                renderFooterChrome();
                            }
                        }
                        if (!scrollRegion.isActive()) {
                            process.stdout.write('\n');
                        }
                    }
                    catch (e) {
                        handleTurnFailure(e);
                    }
                    if (!scrollRegion.isActive()) {
                        process.stdout.write('\n');
                    }
                }
                else {
                    writeCommandOutput(trimmed, `找不到 skill "${slash.skillName}"。可用 skills：${skills.map(s => '/' + s.name).join(', ') || '（无）'}\n`);
                }
                continue;
            }
            // 普通输入
            if (!scrollRegion.isActive()) {
                process.stdout.write('\n');
            }
            mdRenderer.reset();
            resetStreamingSegment();
            try {
                // UserPromptSubmit hook — broker 可在此注入额外上下文
                const promptHookResult = await lifecycleHooks.runHooks('UserPromptSubmit', {
                    prompt: trimmed,
                });
                let effectiveInput = trimmed;
                if (promptHookResult.additionalContext) {
                    effectiveInput = `${promptHookResult.additionalContext}\n\n${trimmed}`;
                }
                const inputBlocks = await parseInputBlocks(effectiveInput, resolveModelCapabilities(adapter).supportsImageInput);
                clearPastedImagePaths();
                await refreshIntentLedger();
                prepareIntentReminderForInput(trimmed);
                let lastAssistantText = '';
                // Clear previously typed input so footer shows placeholder during turn
                if (!terminalUiSuspended) {
                    scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() });
                }
                // Re-display user input in the content area (after screen clear)
                if (scrollRegion.isActive() && !terminalUiSuspended) {
                    scrollRegion.writeSubmittedInput(formatSubmittedInput(trimmed));
                }
                await primeTurnIntentPlan(true);
                await maybePrepareFreshContextHandoff();
                await runtimeFacade.runTurn({
                    sessionId,
                    cwd,
                    source: 'chat',
                    input: inputBlocks,
                }, (chunk) => {
                    if (chunk.type === 'text') {
                        noteVisibleAssistantText(chunk.delta);
                        lastAssistantText += chunk.delta;
                        if (/\S/.test(chunk.delta)) {
                            runtimeState.noteResponseStarted();
                            ensureStreamingPhase();
                        }
                        streamingSegmentText += chunk.delta;
                        mdRenderer.write(chunk.delta);
                    }
                    if (chunk.type === 'usage') {
                        statusBar.update(chunk.usage);
                        scrollRegion.updateStatusLine(statusBar.getStatusLine());
                    }
                });
                flushStreamingMarkdown();
                lastAssistantText = await maybeRunStrictCompletionLoop(lastAssistantText);
                await finalizeCurrentTurnIntentIfNeeded();
                await persistSession();
                // Feedback prompt should render against a clean footer, not a completed
                // turn summary that still belongs to the previous response.
                clearTurnIntentContext();
                const feedbackResult = await maybeCollectCompletedIntentFeedback();
                if (await handleCompletedIntentFeedbackResult(feedbackResult)) {
                    break interactiveLoop;
                }
                if (deferredInput !== null) {
                    continue interactiveLoop;
                }
                if (deferredInput === null) {
                    renderFooterChrome();
                }
                if (!scrollRegion.isActive()) {
                    process.stdout.write('\n');
                }
                // Stop hook — broker 可在此注入新任务（auto-continue）
                const stopResult = await lifecycleHooks.runHooks('Stop', {
                    stopHookActive: true,
                    lastAssistantMessage: lastAssistantText,
                });
                if (stopResult.preventContinuation && stopResult.message) {
                    // broker 返回 block + message：把 message 作为下一轮输入自动继续
                    if (scrollRegion.isActive() && !terminalUiSuspended) {
                        scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() });
                        scrollRegion.writeSubmittedInput(formatSubmittedInput(stopResult.message));
                        replRenderer.prepareForInput();
                    }
                    else {
                        process.stdout.write(formatSubmittedInput(stopResult.message));
                        process.stdout.write('\n');
                    }
                    mdRenderer.reset();
                    resetStreamingSegment();
                    lastAssistantText = '';
                    const continueBlocks = await parseInputBlocks(stopResult.message, resolveModelCapabilities(adapter).supportsImageInput);
                    clearPastedImagePaths();
                    await refreshIntentLedger();
                    prepareIntentReminderForInput(stopResult.message);
                    await primeTurnIntentPlan(true);
                    if (!terminalUiSuspended) {
                        scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() });
                    }
                    await maybePrepareFreshContextHandoff();
                    await runtimeFacade.runTurn({
                        sessionId,
                        cwd,
                        source: 'chat',
                        input: continueBlocks,
                    }, (chunk) => {
                        if (chunk.type === 'text') {
                            noteVisibleAssistantText(chunk.delta);
                            lastAssistantText += chunk.delta;
                            if (/\S/.test(chunk.delta)) {
                                runtimeState.noteResponseStarted();
                                ensureStreamingPhase();
                            }
                            streamingSegmentText += chunk.delta;
                            mdRenderer.write(chunk.delta);
                        }
                        if (chunk.type === 'usage') {
                            statusBar.update(chunk.usage);
                            scrollRegion.updateStatusLine(statusBar.getStatusLine());
                        }
                    });
                    flushStreamingMarkdown();
                    lastAssistantText = await maybeRunStrictCompletionLoop(lastAssistantText);
                    await finalizeCurrentTurnIntentIfNeeded();
                    await persistSession();
                    clearTurnIntentContext();
                    const autoContinueFeedbackResult = await maybeCollectCompletedIntentFeedback();
                    if (await handleCompletedIntentFeedbackResult(autoContinueFeedbackResult)) {
                        break interactiveLoop;
                    }
                    if (deferredInput !== null) {
                        continue interactiveLoop;
                    }
                    if (deferredInput === null) {
                        renderFooterChrome();
                    }
                    if (!scrollRegion.isActive()) {
                        process.stdout.write('\n');
                    }
                }
                if (deferredInput === null) {
                    runtimeState.markInputReady();
                    renderFooterChrome();
                }
            }
            catch (e) {
                clearTurnIntentContext();
                handleTurnFailure(e);
            }
            if (deferredInput === null && scrollRegion.isActive() && runtimeState.getSnapshot().footerMode !== 'busy') {
                renderFooterChrome();
            }
            runtimeState.deactivateTurn();
            stopActivity();
            // Activity line was already cleared by clearActivityLine() at the start
            // of content streaming. Skipping nextTick clear to avoid clearing content.
        }
    }
    finally {
        stopActivity();
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
            resizeTimeout = null;
        }
        if (handleResize) {
            process.stdout.off('resize', handleResize);
        }
        try {
            statusBar.destroy();
        }
        catch { }
        try {
            scrollRegion.end();
        }
        catch { }
        setStreamErrorHandler(null);
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
        stopIntentRuntimeSync();
        stopSkillEvalRuntimeSync();
        skillCatalogWatcher?.close();
        await platform.dispose();
        for (const ch of embeddedChannels) {
            await ch.cleanup();
        }
    }
}
function resolveChatInstanceId() {
    return `inst_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
export function initializeChatIntentLedger(intentLedger, sessionId, instanceId, ownershipMode, options = {}) {
    if (!intentLedger) {
        return markSessionOwned(createEmptySessionIntentLedger(sessionId, Date.now()), instanceId);
    }
    const now = Date.now();
    if (ownershipMode === 'fork') {
        return markSessionOwned({
            ...intentLedger,
            instanceId: undefined,
            ownership: {
                state: 'released',
                updatedAt: now,
            },
            updatedAt: now,
        }, instanceId, now);
    }
    if (ownershipMode === 'takeover') {
        if (intentLedger.ownership.state === 'released') {
            throw new Error(`会话 ${sessionId} 已处于 released 状态，请使用 xiaok --resume ${sessionId} 恢复，而不是 takeover。`);
        }
        try {
            return takeoverSessionOwnership(intentLedger, instanceId, {
                now,
                confirmHighRisk: options.confirmHighRiskTakeover === true,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/high-risk takeover requires explicit confirmation/i.test(message)) {
                throw new Error(`会话 ${sessionId} 当前处于高风险步骤，请确认后重试：xiaok --takeover ${sessionId} --confirm-high-risk-takeover`);
            }
            throw error;
        }
    }
    if (intentLedger.ownership.state === 'released') {
        return ownershipMode === 'resume'
            ? resumeSessionOwnership(intentLedger, instanceId, now)
            : markSessionOwned(intentLedger, instanceId, now);
    }
    const currentOwner = intentLedger.ownership.ownerInstanceId;
    if (!currentOwner) {
        return markSessionOwned(intentLedger, instanceId, now);
    }
    throw new Error(`会话 ${sessionId} 当前仍由实例 ${currentOwner} 持有，当前进程不会自动 takeover。请先正常退出原实例后再使用 xiaok --resume ${sessionId}，或显式执行 xiaok --takeover ${sessionId}`);
}
function buildCapabilityHealthNotice(health) {
    if (!health.hasDegradedCapabilities()) {
        return '';
    }
    return [`[platform] degraded capabilities detected`, health.summary()].join('\n');
}
export function registerChatCommands(program) {
    program
        .command('chat', { isDefault: true })
        .description('启动 AI skill 任务交付工作台（默认命令）')
        .option('--auto', '自动执行所有工具，无需确认（适用于 CI）')
        .option('--dry-run', '打印工具调用但不执行')
        .option('-p, --print', '以纯文本模式输出单次结果')
        .option('--json', '以 JSON 模式输出单次结果')
        .option('--resume <id>', '恢复已保存会话')
        .option('--takeover <id>', '显式接管仍被其他实例持有的会话')
        .option('--confirm-high-risk-takeover', '确认接管处于高风险步骤的会话')
        .option('-c, --continue', '恢复上一次会话')
        .option('--fork-session <id>', '从已有会话分叉一个新会话')
        .argument('[input]', '单次任务描述（省略则进入交互模式）')
        .action(async (input, opts) => {
        setCrashContext({ command: 'chat', args: process.argv.slice(2), cwd: process.cwd() });
        try {
            await runChat(input, opts);
        }
        catch (error) {
            const { reportCrash } = await import('../utils/crash-reporter.js');
            const path = await reportCrash(error);
            writeError(`运行中断，崩溃报告已保存: ${path}`);
            process.exit(1);
        }
    });
}
