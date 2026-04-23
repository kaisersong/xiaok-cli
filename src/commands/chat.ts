import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { ModelAdapter, MessageBlock } from '../types.js';
import type { IntentPlanDraft } from '../ai/intent-delegation/types.js';
import { loadConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { PermissionManager } from '../ai/permissions/manager.js';
import { ToolRegistry } from '../ai/tools/index.js';
import { createAskUserTool } from '../ai/tools/ask-user.js';
import { createAskUserQuestionTool } from '../ai/tools/ask-user-question.js';
import { createIntentDelegationTools } from '../ai/tools/intent-delegation.js';
import { Agent } from '../ai/agent.js';
import { PromptBuilder } from '../ai/prompts/builder.js';
import { createRuntimeHooks } from '../runtime/hooks.js';
import { createHooksRunner } from '../runtime/hooks-runner.js';
import type { RuntimeEvent } from '../runtime/events.js';
import { createIntentPlan } from '../ai/intent-delegation/planner.js';
import { writeError, isTTY } from '../utils/ui.js';
import { showPermissionPrompt } from '../ui/permission-prompt.js';
import { addAllowRule } from '../ai/permissions/settings.js';
import { loadSettings, mergeRules } from '../ai/permissions/settings.js';
import { createSkillCatalog, parseSlashCommand, formatSkillsContext, toSkillEntries, findSkillByCommandName } from '../ai/skills/loader.js';
import { createSkillTool } from '../ai/skills/tool.js';
import { buildSkillExecutionPlan } from '../ai/skills/planner.js';
import { resolveModelCapabilities } from '../ai/runtime/model-capabilities.js';
import { loadAutoContext, formatLoadedContext } from '../ai/runtime/context-loader.js';
import { FileSessionStore, type PersistedSessionSnapshot } from '../ai/runtime/session-store.js';
import { formatPrintOutput } from './chat-print-mode.js';
import { MarkdownRenderer } from '../ui/markdown.js';
import { StatusBar } from '../ui/statusbar.js';
import { ScrollRegionManager } from '../ui/scroll-region.js';
import { renderWelcomeScreen, renderInputSeparator, dim, formatProgressNote, formatSubmittedInput, formatToolActivity, formatHistoryBlock } from '../ui/render.js';
import { getDisplayWidth, stripAnsi } from '../ui/display-width.js';
import { InputReader } from '../ui/input.js';
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
import {
  cloneSessionSkillEvalState,
  createEmptySessionSkillEvalState,
  inferDeliverableFamily,
  type SessionSkillEvalState,
  type SkillFeedbackKind,
  type SkillFeedbackRecord,
  type SkillFeedbackSentiment,
} from '../runtime/intent-delegation/skill-eval.js';
import {
  consumeFreshContextHandoff,
  hasPendingFreshContextHandoff,
  resolveOwnedActiveIntent,
} from '../runtime/intent-delegation/handoff.js';
import { wireIntentDelegationToRuntimeSync } from '../runtime/intent-delegation/runtime-sync.js';
import {
  markSessionOwned,
  releaseSessionOwnership,
  resumeSessionOwnership,
  takeoverSessionOwnership,
} from '../runtime/intent-delegation/ownership.js';
import type { SessionIntentLedger } from '../runtime/intent-delegation/types.js';
import { EmbeddedYZJChannel } from '../channels/embedded-yzj.js';
import { selectYZJChannel } from '../ui/channel-selector.js';
import { resolveYZJConfig } from '../channels/yzj.js';
import { YZJTransport } from '../channels/yzj-transport.js';
import { InMemoryApprovalStore } from '../channels/approval-store.js';
import { getProviderProfile } from '../ai/providers/registry.js';
import {
  buildIntentReminderBlock,
  formatCurrentIntentSummaryLine,
  formatIntentCreatedTranscriptBlock,
  formatProgressTranscriptBlock,
  formatReceiptTranscriptBlock,
  formatSalvageTranscriptBlock,
  formatStageActivatedTranscriptBlock,
} from '../ui/orchestration.js';

const { version: cliVersion } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

interface ChatOptions {
  auto: boolean;
  dryRun: boolean;
  print?: boolean;
  json?: boolean;
  resume?: string;
  takeover?: string;
  confirmHighRiskTakeover?: boolean;
  forkSession?: string;
  continue?: boolean;
}

type ChatIntentOwnershipMode = 'new' | 'resume' | 'fork' | 'takeover';

function describeLiveActivity(toolName: string, input: Record<string, unknown>): string {
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

function countTerminalRowsForLine(line: string, columns: number): number {
  return Math.max(1, Math.ceil(getDisplayWidth(stripAnsi(line)) / Math.max(1, columns)));
}

function countTerminalRowsForOutput(output: string, columns: number): number {
  if (!output) {
    return 0;
  }

  const normalized = output.endsWith('\n') ? output.slice(0, -1) : output;
  const lines = normalized.split('\n');
  return lines.reduce((sum, line) => sum + countTerminalRowsForLine(line, columns), 0);
}

async function runChat(initialInput: string | undefined, opts: ChatOptions): Promise<void> {
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

  let adapter: ModelAdapter;
  try {
    adapter = createAdapter(config);
  } catch (e) {
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
  let persistedSession: PersistedSessionSnapshot | null = null;

  if (opts.continue) {
    persistedSession = await sessionStore.loadLast();
    if (!persistedSession) {
      writeError('没有可恢复的历史会话');
      process.exit(1);
    }
  } else if (opts.resume) {
    persistedSession = await sessionStore.load(opts.resume);
    if (!persistedSession) {
      writeError(`找不到会话: ${opts.resume}`);
      process.exit(1);
    }
  } else if (opts.takeover) {
    persistedSession = await sessionStore.load(opts.takeover);
    if (!persistedSession) {
      writeError(`找不到会话: ${opts.takeover}`);
      process.exit(1);
    }
  } else if (opts.forkSession) {
    persistedSession = await sessionStore.fork(opts.forkSession);
  }

  const sessionId = persistedSession?.sessionId ?? sessionStore.createSessionId();
  const sessionCreatedAt = persistedSession?.createdAt ?? Date.now();
  const forkedFromSessionId = persistedSession?.forkedFromSessionId;
  const sessionLineage = persistedSession?.lineage ?? [sessionId];
  const persistedIntentLedger = persistedSession?.intentDelegation ?? null;
  const instanceId = resolveChatInstanceId();
  const ownershipMode: ChatIntentOwnershipMode = opts.forkSession
    ? 'fork'
    : (opts.takeover ? 'takeover' : (opts.continue || opts.resume ? 'resume' : 'new'));
  const transcriptLogger = new FileTranscriptLogger(sessionId);
  let terminalUiSuspended = false;
  let terminalUiFailureNoted = false;
  let terminalUiFallbackStream: 'stdout' | 'stderr' | null = null;
  let suspendInteractiveUi = (
    _context: string,
    _error: unknown,
    _fallbackStream?: 'stdout' | 'stderr' | null,
  ): void => {
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
  let agent: Agent | undefined;
  let runtimeFacade: RuntimeFacade | undefined;
  let activeIntentReminderBlock: MessageBlock | undefined;
  let currentTurnIntentPlan: IntentPlanDraft | undefined;
  let currentIntentLedger: SessionIntentLedger;
  let currentSkillEvalState: SessionSkillEvalState = persistedSession?.skillEval
    ? cloneSessionSkillEvalState(persistedSession.skillEval)
    : createEmptySessionSkillEvalState(Date.now());
  try {
    currentIntentLedger = initializeChatIntentLedger(persistedIntentLedger, sessionId, instanceId, ownershipMode, {
      confirmHighRiskTakeover: opts.confirmHighRiskTakeover,
    });
  } catch (error) {
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

  const buildPromptSnapshot = async (
    promptCwd = cwd,
    nextSkills = skills,
    channel: 'chat' | 'yzj' = 'chat',
  ) => promptBuilder.build({
    ...(await getPromptInput(promptCwd, nextSkills)),
    cwd: promptCwd,
    channel,
  });

  const buildPrompt = async (nextSkills = skills, promptCwd = cwd) => (
    await buildPromptSnapshot(promptCwd, nextSkills)
  ).rendered;

  const refreshSkills = async (): Promise<void> => {
    skills = await skillCatalog.reload();
    inputReader.setSkills(skills);
    runtimeFacade?.resetSkillTracking();
  };

  // Lazy callbacks for AskUserQuestion — assigned after functions are declared.
  // This avoids TS2448 (use-before-declare) for const-declared functions.
  let askUserOnEnter: (() => void) | null = null;
  let askUserOnExit: (() => void) | null = null;

  const workflowTools = [
    createAskUserTool({
      ask: async (question, placeholder) => {
        if (!isTTY()) {
          throw new Error('当前运行模式不支持 ask_user 交互');
        }

        const promptText = `\n${dim('Agent question:')} ${question}\n`;
        if (replRenderer.hasActiveScrollRegion()) {
          scrollRegion.writeAtContentCursor(promptText);
        } else {
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
  const expandSandboxTargets = (rule: string | undefined, deniedPath: string): string[] => {
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
  const embeddedChannels: EmbeddedYZJChannel[] = [];
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
        if (choice.action === 'deny') return false;
        if (choice.action === 'allow_once') return true;
        if (choice.action === 'allow_session') { permissionManager.addSessionRule(choice.rule); return true; }
        if (choice.action === 'allow_project') { await addAllowRule('project', choice.rule, cwd); permissionManager.addSessionRule(choice.rule); return true; }
        if (choice.action === 'allow_global') { await addAllowRule('global', choice.rule, cwd); permissionManager.addSessionRule(choice.rule); return true; }
        return false;
      };
      return withPausedLiveActivity(async () => {
        if (embeddedChannels.length > 0) {
          return embeddedChannels[0]!.makeOnPrompt(tuiDecide)(name, input);
        }
        return tuiDecide();
      });
    },
    onSandboxDenied: async (deniedPath: string, toolName: string) => {
      return withPausedLiveActivity(async () => {
        const choice = await showPermissionPrompt(
          `sandbox-expand:${toolName}`,
          { file_path: deniedPath, _hint: `文件在工作目录外，是否允许扩展沙箱访问并读取？` },
          { transcriptLogger, renderer: replRenderer },
        );
        if (choice.action === 'deny') return { shouldProceed: false };
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
      } else {
        process.stdout.write(line);
      }
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
    emit(event: RuntimeEvent) {
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
    const lines: string[] = [];
    if (summaryLine) {
      lines.push(summaryLine);
    }
    if (statusLine) {
      lines.push(statusLine);
    }
    return lines;
  });
  inputReader.setScrollPromptRenderer((frame) => {
    if (!scrollRegion.isActive()) return false;
    scrollRegion.renderPromptFrame({
      inputValue: frame.inputValue,
      cursor: frame.cursor,
      placeholder: 'Type your message...',
      summaryLine: frame.summaryLine,
      statusLine: frame.statusLine,
      overlayLines: frame.overlayLines,
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
  const flushStreamingMarkdown = (): void => {
    const flushResult = mdRenderer.flush();
    if (flushResult.rows > 0 && scrollRegion.isActive() && scrollRegion.isContentStreaming()) {
      if (flushResult.renderedLine) {
        scrollRegion.advanceContentCursorByRenderedText(flushResult.renderedLine);
      } else {
        scrollRegion.advanceContentCursor(flushResult.rows);
      }
    }
  };

  // 收集历史消息用于稍后打印（在欢迎页之后）
  const historyMessages = persistedSession?.messages ?? [];
  let welcomeVisible = historyMessages.length === 0 && !opts.dryRun;

  let liveActivityTimer: NodeJS.Timeout | null = null;
  let resumeActivityTimer: NodeJS.Timeout | null = null;
  let reassuranceTimer: NodeJS.Timeout | null = null;
  let liveActivityFrame = 0;
  let liveActivityVisible = false;
  let responseStarted = false;
  let lastReassuranceBucket = -1;
  let contentRows = 0; // tracks how many rows of content have been written
  let turnActive = true; // blocks beginActivity() after turn has ended

  const renderLiveActivity = (): void => {
    // While content is actively streaming, stop rendering the activity line.
    // The streaming content naturally replaces the thinking indicator, and
    // re-rendering it causes duplication (activity line gets scrolled up by
    // terminal auto-scroll, then re-rendered at its original position).
    // This flag is reset after each turn's content streaming completes,
    // so tool execution phases can still show activity indicators.
    if (scrollRegion.isContentStreaming()) return;

    const line = statusBar.getActivityLine(Date.now(), liveActivityFrame++);
    if (!line) return;
    liveActivityVisible = true;
    try {
      scrollRegion.renderActivity(line);
    } catch (error) {
      suspendInteractiveUi('render_live_activity', error);
    }
  };

  const beginActivity = (label: string, restart = false, startedAt = Date.now()): void => {
    // Don't start new activity after the turn has ended —
    // a scheduled resumeActivityTimer may fire after stopActivity().
    if (!turnActive && liveActivityTimer) return;
    if (resumeActivityTimer) {
      clearTimeout(resumeActivityTimer);
      resumeActivityTimer = null;
    }

    if (restart || !liveActivityTimer) {
      statusBar.beginActivity(label, startedAt);
    } else {
      statusBar.updateActivity(label);
    }

    if (!liveActivityTimer) {
      renderLiveActivity();
      liveActivityTimer = setInterval(() => {
        renderLiveActivity();
      }, 120);
      return;
    }

    renderLiveActivity();
  };

  const scheduleActivityResume = (label: string, delayMs = 180): void => {
    if (resumeActivityTimer) {
      clearTimeout(resumeActivityTimer);
    }
    resumeActivityTimer = setTimeout(() => {
      resumeActivityTimer = null;
      beginActivity(label);
    }, delayMs);
  };

  const scheduleActivityPause = (delayMs = 180): void => {
    if (resumeActivityTimer) {
      clearTimeout(resumeActivityTimer);
      resumeActivityTimer = null;
    }
    setTimeout(() => {
      pauseActivity();
    }, delayMs);
  };

  const ensureReassuranceTimer = (): void => {
    if (reassuranceTimer) {
      return;
    }
    reassuranceTimer = setInterval(() => {
      // Don't write reassurance when content is actively streaming
      if (scrollRegion.isContentStreaming()) {
        return;
      }
      // Don't write reassurance during the first turn before any input
      // (welcome screen is showing, no need for reassurance)
      if (!responseStarted) {
        return;
      }
      const tick = statusBar.getReassuranceTick(Date.now(), lastReassuranceBucket);
      if (!tick) {
        return;
      }
      lastReassuranceBucket = tick.bucket;
      turnLayout.noteProgressNote();
      pauseActivity();
      process.stdout.write(formatProgressNote(tick.line));
      if (liveActivityTimer && !responseStarted) {
        scheduleActivityResume(statusBar.getActivityLabel() || 'Thinking', 240);
      }
    }, 1000);
  };

  const pauseActivity = (): void => {
    if (!liveActivityTimer || !liveActivityVisible) {
      return;
    }
    statusBar.clearLive();
    liveActivityVisible = false;
  };

  const stopLiveActivityTimer = (): void => {
    if (resumeActivityTimer) {
      clearTimeout(resumeActivityTimer);
      resumeActivityTimer = null;
    }
    if (liveActivityTimer) {
      clearInterval(liveActivityTimer);
      liveActivityTimer = null;
    }
    if (liveActivityVisible) {
      statusBar.clearLive();
      liveActivityVisible = false;
    }
  };

  const withPausedLiveActivity = async <T>(action: () => Promise<T>): Promise<T> => {
    const snapshot = statusBar.getActivitySnapshot();
    stopLiveActivityTimer();
    try {
      return await action();
    } finally {
      if (snapshot && !terminalUiSuspended && turnActive && !scrollRegion.isContentStreaming()) {
        beginActivity(snapshot.label, true, snapshot.startedAt);
      }
    }
  };

  // Wire up lazy callbacks for AskUserQuestion interactive prompt
  askUserOnEnter = stopLiveActivityTimer;
  askUserOnExit = () => {
    if (!liveActivityTimer) {
      beginActivity(describeLiveActivity('AskUserQuestion', {}), true);
    }
  };

  const stopActivity = (): void => {
    // Clear activity label FIRST so any pending renderLiveActivity() callback
    // sees an empty label and returns early.
    statusBar.endActivity();
    if (reassuranceTimer) {
      clearInterval(reassuranceTimer);
      reassuranceTimer = null;
    }
    if (resumeActivityTimer) {
      clearTimeout(resumeActivityTimer);
      resumeActivityTimer = null;
    }
    if (liveActivityTimer) {
      clearInterval(liveActivityTimer);
      liveActivityTimer = null;
    }
    if (liveActivityVisible) {
      statusBar.clearLive();
      liveActivityVisible = false;
    }
    liveActivityFrame = 0;
    responseStarted = false;
    lastReassuranceBucket = -1;
  };

  suspendInteractiveUi = (
    context: string,
    error: unknown,
    fallbackStream: 'stdout' | 'stderr' | null = null,
  ): void => {
    if (terminalUiSuspended) {
      return;
    }

    terminalUiSuspended = true;
    terminalUiFallbackStream = fallbackStream;
    turnActive = false;

    if (!terminalUiFailureNoted) {
      terminalUiFailureNoted = true;
      const rawMessage = `\n[xiaok] UI 输出已停用：${context} (${String(error)})\n`;
      const isBrokenPipe = /\bEPIPE\b/i.test(String(error));
      const displayMessage = isBrokenPipe
        ? '\n[xiaok] 终端富交互输出已切换为兼容模式，当前任务会继续运行。\n'
        : rawMessage;
      try {
        transcriptLogger.recordOutput('stderr', rawMessage);
      } catch {}
      try {
        if (fallbackStream === 'stdout') {
          originalStdoutWrite(displayMessage);
        } else {
          originalStderrWrite(displayMessage);
        }
      } catch {}
    }

    try {
      stopActivity();
    } catch {}
    try {
      statusBar.destroy();
    } catch {}
    try {
      scrollRegion.end();
    } catch {}
  };

  const resetTurnChrome = (): void => {
    stopActivity();
    toolExplorer.reset();
    turnLayout.reset();
    mdRenderer.reset();
  };

  const handleTurnFailure = (error: unknown): void => {
    resetTurnChrome();
    writeError(String(error));
  };

  const getCurrentIntentSummaryLine = (): string =>
    formatCurrentIntentSummaryLine(currentIntentLedger, instanceId);

  const refreshIntentLedger = async (): Promise<void> => {
    currentIntentLedger = await intentLedgerStore.load(sessionId) ?? currentIntentLedger;
  };

  const refreshSkillEvalState = async (): Promise<void> => {
    currentSkillEvalState = await skillEvalStore.load(sessionId) ?? currentSkillEvalState;
  };

  const renderIntentSummaryLine = (): void => {
    if (!scrollRegion.isActive() || scrollRegion.isContentStreaming()) {
      return;
    }

    try {
      scrollRegion.renderFooter({
        inputPrompt: 'Type your message...',
        summaryLine: getCurrentIntentSummaryLine(),
        statusLine: statusBar.getStatusLine(),
      });
    } catch (error) {
      suspendInteractiveUi('render_intent_summary', error);
    }
  };

  const prepareIntentReminderForInput = (input: string): void => {
    const activeIntent = currentIntentLedger.activeIntentId
      ? currentIntentLedger.intents.find((intent) => intent.intentId === currentIntentLedger.activeIntentId)
      : undefined;
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

    if (currentTurnIntentPlan?.continuationMode === 'continue_active') {
      activeIntentReminderBlock = buildIntentReminderBlock(currentIntentLedger, instanceId);
      return;
    }

    activeIntentReminderBlock = undefined;
  };

  const clearTurnIntentContext = (): void => {
    currentTurnIntentPlan = undefined;
    activeIntentReminderBlock = undefined;
  };

  const primeTurnIntentPlan = async (renderTranscriptBlock = false): Promise<void> => {
    if (!currentTurnIntentPlan) {
      return;
    }
    const turnIntentPlan = currentTurnIntentPlan;

    const beforeIntentCount = currentIntentLedger.intents.length;
    currentIntentLedger = await bootstrapTurnIntentPlan(
      intentLedgerStore,
      sessionId,
      currentIntentLedger,
      turnIntentPlan,
    );

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

  const maybePrepareFreshContextHandoff = async (): Promise<void> => {
    await refreshIntentLedger();
    if (!hasPendingFreshContextHandoff(currentIntentLedger, instanceId) || !agent) {
      return;
    }

    const activeIntent = resolveOwnedActiveIntent(currentIntentLedger, instanceId);
    if (!activeIntent) {
      return;
    }

    currentIntentLedger = await intentLedgerStore.saveDispatchedIntent(
      sessionId,
      consumeFreshContextHandoff(activeIntent, Date.now()),
    );
    agent.clearHistory();
    runtimeFacade?.resetSkillTracking();
    activeIntentReminderBlock = buildIntentReminderBlock(currentIntentLedger, instanceId);
    await persistSession();
  };

  const writeOrchestrationBlock = (block: string): void => {
    if (!block) {
      return;
    }

    if (scrollRegion.isActive()) {
      try {
        scrollRegion.writeAtContentCursor(block);
      } catch (error) {
        suspendInteractiveUi('write_orchestration_block', error);
      }
      return;
    }

    process.stdout.write(block);
  };

  const persistSession = async (): Promise<void> => {
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
    });
  };

  const releaseSessionOwnershipForExit = async (): Promise<void> => {
    await refreshIntentLedger();
    const ownerInstanceId = currentIntentLedger.ownership.ownerInstanceId;
    if (ownerInstanceId !== instanceId) {
      return;
    }

    currentIntentLedger = releaseSessionOwnership(currentIntentLedger, instanceId, Date.now());
    await persistSession();
  };

  const promptFeedbackChoice = async (
    message: string,
    prompt: string,
  ): Promise<'positive' | 'negative' | 'skip'> => withPausedLiveActivity(async () => {
    const note = `\n[xiaok] ${message}\n`;
    if (scrollRegion.isActive()) {
      scrollRegion.writeAtContentCursor(note);
    } else {
      process.stdout.write(note);
    }

    while (true) {
      const answer = (await inputReader.read(prompt))?.trim().toLowerCase();
      if (answer === null || answer === '' || answer === 's' || answer === 'skip') {
        return 'skip';
      }
      if (answer === 'y' || answer === 'yes') {
        return 'positive';
      }
      if (answer === 'n' || answer === 'no') {
        return 'negative';
      }
    }
  });

  const buildFeedbackRecord = (
    intentId: string,
    kind: SkillFeedbackKind,
    sentiment: SkillFeedbackSentiment,
    observationIds: string[],
    note?: string,
  ): SkillFeedbackRecord => ({
    feedbackId: `feedback_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    intentId,
    kind,
    sentiment,
    observationIds,
    note,
    createdAt: Date.now(),
  });

  const maybeCollectCompletedIntentFeedback = async (): Promise<void> => {
    if (!isTTY() || opts.auto) {
      return;
    }

    await refreshIntentLedger();
    await refreshSkillEvalState();
    const activeIntent = resolveOwnedActiveIntent(currentIntentLedger, instanceId);
    if (!activeIntent || activeIntent.overallStatus !== 'completed') {
      return;
    }
    if (currentSkillEvalState.promptedIntentIds.includes(activeIntent.intentId)) {
      return;
    }

    const relevantObservations = currentSkillEvalState.observations.filter((observation) => (
      observation.intentId === activeIntent.intentId && Boolean(observation.actualSkillName)
    ));
    currentSkillEvalState = await skillEvalStore.markPromptedIntent(sessionId, activeIntent.intentId);

    if (relevantObservations.length === 0) {
      return;
    }

    const observationIds = relevantObservations.map((observation) => observation.observationId);
    const pendingFeedback: SkillFeedbackRecord[] = [];

    const outcome = await promptFeedbackChoice(
      '这次生成物是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过',
      'Outcome [y/n/s]: ',
    );
    if (outcome !== 'skip') {
      pendingFeedback.push(buildFeedbackRecord(activeIntent.intentId, 'outcome', outcome, observationIds));
    }

    const routing = await promptFeedbackChoice(
      '这次 skill 路由是否合适？ [y] 合适 / [n] 不合适 / [s] 跳过',
      'Routing [y/n/s]: ',
    );
    if (routing !== 'skip') {
      pendingFeedback.push(buildFeedbackRecord(activeIntent.intentId, 'routing', routing, observationIds));
    }

    if (outcome === 'negative') {
      const understanding = await promptFeedbackChoice(
        '主要问题更接近需求理解错了吗？ [y] 是 / [n] 否 / [s] 跳过',
        'Intent [y/n/s]: ',
      );
      if (understanding !== 'skip') {
        pendingFeedback.push(buildFeedbackRecord(
          activeIntent.intentId,
          'intent_understanding',
          understanding,
          observationIds,
        ));
      }
    }

    if (pendingFeedback.length === 0) {
      return;
    }

    for (const feedback of pendingFeedback) {
      currentSkillEvalState = await skillEvalStore.recordFeedback(sessionId, feedback);
      skillScoreStore.recordFeedback(feedback, relevantObservations);
    }
    await persistSession();
  };

  // 初始化状态栏（在单次任务模式之前）
  const fullModelName = adapter.getModelName();
  statusBar.init(fullModelName, sessionId, process.cwd(), opts.dryRun ? 'dry-run' : permissionManager.getMode(), {
    contextLimit: modelCapabilities.contextLimit,
  });
  const branch = await getCurrentBranch(process.cwd());
  if (branch) statusBar.updateBranch(branch);
  statusBar.update({ inputTokens: 0, outputTokens: 0 });

  // 单次任务模式
  if (initialInput) {
    const inputBlocks = await parseInputBlocks(
      initialInput,
      resolveModelCapabilities(adapter).supportsImageInput,
    );
    clearPastedImagePaths();
    const printChunks: string[] = [];
    const toolCallsList: string[] = [];
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
      } else {
        mdRenderer.flush();
        process.stdout.write('\n');
      }
    } catch (e) {
      writeError(String(e));
      process.exit(1);
    } finally {
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
  const getActiveProviderLabel = (): string => {
    const providerId = config.defaultProvider;
    const profile = getProviderProfile(providerId);
    return (profile?.label ?? providerId).toLowerCase();
  };
  inputReader.setTranscriptLogger(transcriptLogger);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const getFallbackWriter = (): typeof originalStdoutWrite | typeof originalStderrWrite | null => {
    if (terminalUiFallbackStream === 'stderr') {
      return originalStderrWrite;
    }
    if (terminalUiFallbackStream === 'stdout') {
      return originalStdoutWrite;
    }
    return null;
  };
  process.stdout.write = ((chunk: any, ...args: any[]) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    transcriptLogger.recordOutput('stdout', text);
    if (terminalUiSuspended) {
      const fallbackWriter = getFallbackWriter();
      if (fallbackWriter) {
        try {
          return fallbackWriter(chunk, ...args);
        } catch {
          return true;
        }
      }
      return true;
    }
    try {
      return originalStdoutWrite(chunk, ...args);
    } catch (error) {
      suspendInteractiveUi('stdout_write', error);
      return true;
    }
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: any, ...args: any[]) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    transcriptLogger.recordOutput('stderr', text);
    if (terminalUiSuspended) {
      const fallbackWriter = getFallbackWriter();
      if (fallbackWriter) {
        try {
          return fallbackWriter(chunk, ...args);
        } catch {
          return true;
        }
      }
      return true;
    }
    try {
      return originalStderrWrite(chunk, ...args);
    } catch (error) {
      suspendInteractiveUi('stderr_write', error);
      return true;
    }
  }) as typeof process.stderr.write;

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

    if (opts.dryRun) process.stdout.write(`${dim('[dry-run 模式] 工具调用不会实际执行')}\n\n`);

    // 打印历史消息（session resume）- 在欢迎页之后
    if (historyMessages.length > 0) {
      const historyColumns = process.stdout.columns ?? 80;
      let replayedRows = 0;
      const writeHistoryChunk = (chunk: string): void => {
        if (!chunk) return;
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
            } else {
              writeHistoryChunk(formatHistoryBlock(block));
            }
          }
        } else if (msg.role === 'assistant') {
          for (const block of msg.content) {
            if (block.type === 'text') {
              for (const line of MarkdownRenderer.renderToLines(block.text)) {
                writeHistoryChunk(`${line}\n`);
              }
            } else {
              writeHistoryChunk(formatHistoryBlock(block));
            }
          }
        }
      }
      writeHistoryChunk('\n');
      scrollRegion.advanceContentCursor(replayedRows);
    }

    const dismissWelcomeScreen = (): void => {
      if (!welcomeVisible || !scrollRegion.isActive()) return;
      // Keep the welcome card in the scroll region as a visual separator from
      // terminal scrollback. Submitted input will append below and scroll it
      // away naturally as the conversation grows.
      welcomeVisible = false;
    };

    const writeCommandOutput = (commandText: string, output: string): void => {
      if (!scrollRegion.isActive()) {
        process.stdout.write(output);
        return;
      }

      try {
        scrollRegion.clearLastInput();
        scrollRegion.writeSubmittedInput(formatSubmittedInput(commandText));
        scrollRegion.writeAtContentCursor(output);
        replRenderer.prepareForInput();
      } catch (error) {
        suspendInteractiveUi('write_command_output', error);
      }
    };

    setStreamErrorHandler((error, stream) => {
      if (stream !== process.stdout && stream !== process.stderr) {
        return false;
      }
      suspendInteractiveUi(
        stream === process.stdout ? 'stdout_stream_error' : 'stderr_stream_error',
        error,
        stream === process.stdout ? 'stderr' : 'stdout',
      );
      return true;
    });

    // 创建输入读取器
    inputReader.setSkills(skills);

  runtimeHooks.on('turn_started', () => {
    toolExplorer.reset();
    turnLayout.reset();
    responseStarted = false;
    lastReassuranceBucket = -1;
    turnActive = true;
    beginActivity('Thinking', true);
    ensureReassuranceTimer();
  });

  runtimeHooks.on('tool_started', (e) => {
    beginActivity(describeLiveActivity(e.toolName, e.toolInput));
    const activity = toolExplorer.record(e.toolName, e.toolInput);
    if (activity) {
      turnLayout.noteToolActivity();
      pauseActivity();
      // Write tool output at the tracked content position (inside scroll region)
      if (scrollRegion.isActive()) {
        scrollRegion.writeAtContentCursor(activity);
      } else {
        process.stdout.write(activity);
      }
      scheduleActivityResume(describeLiveActivity(e.toolName, e.toolInput), 220);
    }
  });

  runtimeHooks.on('tool_finished', (_e) => {
    if (liveActivityTimer) {
      scheduleActivityResume('Thinking', 160);
    }
  });

  runtimeHooks.on('intent_created', async (event) => {
    await refreshIntentLedger();
    writeOrchestrationBlock(formatIntentCreatedTranscriptBlock(currentIntentLedger, event.intentId));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('stage_activated', async (event) => {
    await refreshIntentLedger();
    writeOrchestrationBlock(formatStageActivatedTranscriptBlock({
      order: event.order,
      totalStages: event.totalStages,
      label: event.label,
    }));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('step_activated', async (event) => {
    await refreshIntentLedger();
    writeOrchestrationBlock(formatProgressTranscriptBlock({
      stepId: event.stepId,
      status: 'running',
      message: `Active step moved to ${event.stepId.split(':step:')[1] ?? event.stepId}`,
    }));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('breadcrumb_emitted', async (event) => {
    await refreshIntentLedger();
    writeOrchestrationBlock(formatProgressTranscriptBlock({
      stepId: event.stepId,
      status: event.status,
      message: event.message,
    }));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('receipt_emitted', async (event) => {
    await refreshIntentLedger();
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
    stopActivity();
    void refreshIntentLedger().then(renderIntentSummaryLine);
  });

  runtimeHooks.on('turn_failed', () => {
    resetTurnChrome();
    void refreshIntentLedger().then(renderIntentSummaryLine);
  });

  runtimeHooks.on('turn_aborted', () => {
    resetTurnChrome();
    void refreshIntentLedger().then(renderIntentSummaryLine);
  });

  // Context 压缩通知
  runtimeHooks.on('compact_triggered', () => {
    beginActivity('Compacting context');
    turnLayout.noteProgressNote();
    pauseActivity();
    process.stdout.write(formatProgressNote('⚠ 上下文已压缩，保留最近对话'));
  });

  // 处理终端窗口大小调整
  let resizeTimeout: NodeJS.Timeout | null = null;
  const handleResize = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const rows = process.stdout.rows ?? 24;
      const cols = process.stdout.columns ?? 80;
      try {
        scrollRegion.updateSize(rows, cols);
      } catch (error) {
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
      process.stdout.off('resize', handleResize);
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

    // 交互循环
    while (true) {
      await refreshSkills();

      // 输入前的分隔线 — scroll region 激活后跳过，由 footer 处理
      if (!scrollRegion.isActive()) {
        renderInputSeparator();
      }
      const input = await inputReader.read('> ');

    if (input === null || input.trim() === '/exit') {
      clearTurnIntentContext();
      await releaseSessionOwnershipForExit();
      scrollRegion.end();
      statusBar.destroy();
      process.stdout.write(`\n再见！${dim(` 继续上次工作：xiaok -c  或  xiaok --resume ${sessionId}`)}\n`);
      break;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

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
      } else if (diff < 0) {
        writeCommandOutput(trimmed, `已刷新 skill 目录，移除 ${-diff} 个 skill，当前共 ${newCount} 个。\n\n`);
      } else {
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
        } catch {
          writeCommandOutput(trimmed, 'YZJ 未配置，请先运行 xiaok yzjchannel config set-webhook-url <url>\n\n');
          return null;
        }
      })();
      if (!yzjConfig) continue;

      const namedChannels = config.channels?.yzj?.namedChannels ?? [];
      const selectedChannel = await selectYZJChannel(namedChannels);
      if (!selectedChannel) {
        writeCommandOutput(trimmed, '已取消。\n\n');
        continue;
      }

      const transport = new YZJTransport({ webhookUrl: yzjConfig.webhookUrl });
      const embedded = new EmbeddedYZJChannel({
        runtimeFacade: runtimeFacade!,
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

    if (trimmed.startsWith('/mode')) {
      const [, requestedMode] = trimmed.split(/\s+/, 2);
      if (!requestedMode) {
        writeCommandOutput(trimmed, `当前权限模式：${permissionManager.getMode()}\n\n`);
        continue;
      }

      if (!['default', 'auto', 'plan'].includes(requestedMode)) {
        writeCommandOutput(trimmed, '用法：/mode [default|auto|plan]\n\n');
        continue;
      }

      permissionManager.setMode(requestedMode as 'default' | 'auto' | 'plan');
      statusBar.updateMode(requestedMode);
      writeCommandOutput(trimmed, `权限模式已切换为 ${requestedMode}\n\n`);
      continue;
    }

    if (trimmed === '/compact') {
      agent.forceCompact();
      writeCommandOutput(trimmed, `${dim('上下文已压缩。')}\n\n`);
      continue;
    }

    if (trimmed === '/models') {
      const selected = await selectModel(config);
      if (selected) {
        const newConfig = {
          ...config,
          defaultProvider: selected.provider,
          defaultModelId: selected.modelId,
        };
        try {
          adapter = createAdapter(newConfig);
          config = newConfig;
          agent.setAdapter(adapter);
          statusBar.updateModel(selected.model);
          writeCommandOutput(trimmed, `已切换到：[${selected.provider}] ${selected.label} (${selected.model})\n\n`);
        } catch (e) {
          writeCommandOutput(trimmed, `切换失败：${String(e)}\n\n`);
        }
      } else {
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
      } catch (e) {
        writeError(String(e));
      }
      continue;
    }

    if (trimmed === '/context') {
      try {
        const context = await loadAutoContext({ cwd });
        writeCommandOutput(trimmed, `${formatLoadedContext(context) || '当前没有可展示的仓库上下文。'}\n\n`);
      } catch (e) {
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
    if (!scrollRegion.isActive()) {
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
          activeIntentReminderBlock = undefined;

          process.stdout.write('\n');
          mdRenderer.reset();

          if (plan.strategy === 'fork' && primaryStep?.agent) {
            const result = await executeNamedSubAgent({
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
            mdRenderer.write(result);
          } else {
            const userMsg = slash.rest
              ? `执行 skill plan "${plan.primarySkill}"，用户补充说明：${slash.rest}\n\n${JSON.stringify(plan, null, 2)}`
              : `执行 skill plan：\n\n${JSON.stringify(plan, null, 2)}`;

            clearTurnIntentContext();
            scrollRegion.clearLastInput();

            await maybePrepareFreshContextHandoff();
            await runtimeFacade.runTurn({
              sessionId,
              cwd,
              source: 'chat',
              input: userMsg,
            }, (chunk) => {
              if (chunk.type === 'text') {
                if (/\S/.test(chunk.delta)) {
                  if (!responseStarted) {
                    responseStarted = true;
                    scrollRegion.clearActivityLine();
                    turnLayout.consumeAssistantLeadIn();
                    scrollRegion.beginContentStreaming();
                    beginActivity('Answering');
                    mdRenderer.setNewlineCallback(scrollRegion.getNewlineCallback());
                    scheduleActivityPause(220);
                  } else {
                    if (resumeActivityTimer) {
                      clearTimeout(resumeActivityTimer);
                      resumeActivityTimer = null;
                    }
                    pauseActivity();
                  }
                }
                mdRenderer.write(chunk.delta);
              }
              if (chunk.type === 'usage') {
                statusBar.update(chunk.usage);
                scrollRegion.updateStatusLine(statusBar.getStatusLine());
              }
            });
            await persistSession();
            await maybeCollectCompletedIntentFeedback();
            clearTurnIntentContext();
          }

          flushStreamingMarkdown();
          if (!scrollRegion.isActive()) {
            process.stdout.write('\n');
          }
        } catch (e) {
          handleTurnFailure(e);
        }
        if (!scrollRegion.isActive()) {
          process.stdout.write('\n');
        }
      } else {
        writeCommandOutput(
          trimmed,
          `找不到 skill "${slash.skillName}"。可用 skills：${skills.map(s => '/' + s.name).join(', ') || '（无）'}\n`,
        );
      }
      continue;
    }

    // 普通输入
    if (!scrollRegion.isActive()) {
      process.stdout.write('\n');
    }
    mdRenderer.reset();
    try {
      // UserPromptSubmit hook — broker 可在此注入额外上下文
      const promptHookResult = await lifecycleHooks.runHooks('UserPromptSubmit', {
        prompt: trimmed,
      });
      let effectiveInput = trimmed;
      if (promptHookResult.additionalContext) {
        effectiveInput = `${promptHookResult.additionalContext}\n\n${trimmed}`;
      }

      const inputBlocks = await parseInputBlocks(
        effectiveInput,
        resolveModelCapabilities(adapter).supportsImageInput,
      );
      clearPastedImagePaths();
      await refreshIntentLedger();
      prepareIntentReminderForInput(trimmed);

      let lastAssistantText = '';
      // Clear previously typed input so footer shows placeholder during turn
      scrollRegion.clearLastInput();

      // Re-display user input in the content area (after screen clear)
      if (scrollRegion.isActive()) {
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
          lastAssistantText += chunk.delta;
          if (/\S/.test(chunk.delta)) {
            if (!responseStarted) {
              responseStarted = true;
              scrollRegion.clearActivityLine();
              turnLayout.consumeAssistantLeadIn();
              // Don't call beginActivity before beginContentStreaming —
              // renderFooter would write at the content cursor position.
              scrollRegion.beginContentStreaming();
              beginActivity('Answering');
              mdRenderer.setNewlineCallback(scrollRegion.getNewlineCallback());
              scheduleActivityPause(220);
            } else {
              if (resumeActivityTimer) {
                clearTimeout(resumeActivityTimer);
                resumeActivityTimer = null;
              }
              pauseActivity();
            }
          }
          mdRenderer.write(chunk.delta);
        }
        if (chunk.type === 'usage') {
          statusBar.update(chunk.usage);
          scrollRegion.updateStatusLine(statusBar.getStatusLine());
        }
      });
      await persistSession();
      await maybeCollectCompletedIntentFeedback();
      clearTurnIntentContext();
      flushStreamingMarkdown();
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
        process.stdout.write(formatSubmittedInput(stopResult.message));
        process.stdout.write('\n');
        mdRenderer.reset();
        lastAssistantText = '';
        const continueBlocks = await parseInputBlocks(
          stopResult.message,
          resolveModelCapabilities(adapter).supportsImageInput,
        );
        clearPastedImagePaths();
        await refreshIntentLedger();
        prepareIntentReminderForInput(stopResult.message);
        await primeTurnIntentPlan(true);
        scrollRegion.clearLastInput();
        await maybePrepareFreshContextHandoff();
        await runtimeFacade.runTurn({
          sessionId,
          cwd,
          source: 'chat',
          input: continueBlocks,
        }, (chunk) => {
          if (chunk.type === 'text') {
            lastAssistantText += chunk.delta;
            if (/\S/.test(chunk.delta)) {
              if (!responseStarted) {
                responseStarted = true;
                scrollRegion.clearActivityLine();
                turnLayout.consumeAssistantLeadIn();
                scrollRegion.beginContentStreaming();
                beginActivity('Answering');
                mdRenderer.setNewlineCallback(scrollRegion.getNewlineCallback());
                scheduleActivityPause(220);
              } else {
                if (resumeActivityTimer) {
                  clearTimeout(resumeActivityTimer);
                  resumeActivityTimer = null;
                }
                pauseActivity();
              }
            }
            mdRenderer.write(chunk.delta);
          }
          if (chunk.type === 'usage') {
            statusBar.update(chunk.usage);
            scrollRegion.updateStatusLine(statusBar.getStatusLine());
          }
        });
        await persistSession();
        await maybeCollectCompletedIntentFeedback();
        clearTurnIntentContext();
        flushStreamingMarkdown();
        if (!scrollRegion.isActive()) {
          process.stdout.write('\n');
        }
      }
    } catch (e) {
      clearTurnIntentContext();
      handleTurnFailure(e);
    }
    // Restore footer after streaming
    if (scrollRegion.isActive()) {
      try {
        scrollRegion.endContentStreaming({
          inputPrompt: 'Type your message...',
          summaryLine: getCurrentIntentSummaryLine(),
          statusLine: statusBar.getStatusLine(),
        });
        // Ensure next TerminalRenderer render uses cursor movement (\x1b[1B)
        // instead of newlines (\n), which would scroll the footer up.
        replRenderer.prepareForInput();
      } catch (error) {
        suspendInteractiveUi('end_content_streaming', error);
      }
    }
    // Clear activity state BEFORE unblocking renderLiveActivity().
    // This prevents pending interval callbacks from rendering "Thinking"
    // in the window between contentStreaming=false and stopActivity().
    statusBar.endActivity();
    turnActive = false;
    stopActivity();
    // Activity line was already cleared by clearActivityLine() at the start
    // of content streaming. Skipping nextTick clear to avoid clearing content.
    }
  } finally {
    setStreamErrorHandler(null);
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    stopIntentRuntimeSync();
    stopSkillEvalRuntimeSync();
    await platform.dispose();
    for (const ch of embeddedChannels) {
      await ch.cleanup();
    }
  }
}

function resolveChatInstanceId(): string {
  return `inst_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function initializeChatIntentLedger(
  intentLedger: PersistedSessionSnapshot['intentDelegation'] | null,
  sessionId: string,
  instanceId: string,
  ownershipMode: ChatIntentOwnershipMode,
  options: { confirmHighRiskTakeover?: boolean } = {},
) {
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
      throw new Error(
        `会话 ${sessionId} 已处于 released 状态，请使用 xiaok --resume ${sessionId} 恢复，而不是 takeover。`,
      );
    }
    try {
      return takeoverSessionOwnership(intentLedger, instanceId, {
        now,
        confirmHighRisk: options.confirmHighRiskTakeover === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/high-risk takeover requires explicit confirmation/i.test(message)) {
        throw new Error(
          `会话 ${sessionId} 当前处于高风险步骤，请确认后重试：xiaok --takeover ${sessionId} --confirm-high-risk-takeover`,
        );
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

  throw new Error(
    `会话 ${sessionId} 当前仍由实例 ${currentOwner} 持有，当前进程不会自动 takeover。请先正常退出原实例后再使用 xiaok --resume ${sessionId}，或显式执行 xiaok --takeover ${sessionId}`,
  );
}

function buildCapabilityHealthNotice(health: Awaited<ReturnType<typeof createPlatformRuntimeContext>>['health']): string {
  if (!health.hasDegradedCapabilities()) {
    return '';
  }

  return [`[platform] degraded capabilities detected`, health.summary()].join('\n');
}

export function registerChatCommands(program: Command): void {
  program
    .command('chat', { isDefault: true })
    .description('启动 AI 编程助手（默认命令）')
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
    .action(async (input: string | undefined, opts: ChatOptions) => {
      setCrashContext({ command: 'chat', args: process.argv.slice(2), cwd: process.cwd() });
      try {
        await runChat(input, opts);
      } catch (error) {
        const { reportCrash } = await import('../utils/crash-reporter.js');
        const path = await reportCrash(error);
        writeError(`运行中断，崩溃报告已保存: ${path}`);
        process.exit(1);
      }
    });
}
