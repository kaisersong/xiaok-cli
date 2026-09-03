import { existsSync, readFileSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';
import type { Command } from 'commander';
import type { ModelAdapter, MessageBlock, UsageStats } from '../types.js';
import { DEFAULT_INTENT_BOUNDARY_CONFIG } from '../types.js';
import type { IntentPlanDraft } from '../ai/intent-delegation/types.js';
import { getConfigDir, loadConfig, saveConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { createChatAdapterWithLoginBootstrap } from './chat-login-bootstrap.js';
import { PermissionManager } from '../ai/permissions/manager.js';
import { ToolRegistry, type ToolObservation } from '../ai/tools/index.js';
import { createAskUserTool } from '../ai/tools/ask-user.js';
import { createAskUserQuestionTool } from '../ai/tools/ask-user-question.js';
import { createIntentDelegationTools } from '../ai/tools/intent-delegation.js';
import { createGoalTools } from '../ai/tools/goal.js';
import { executeStagedSkill, formatDebugOutput, type StageDef, type StageOutput, type DebugEvent, analyzeIntent as analyzeStageIntent } from '../runtime/stage/executor.js';
import { Agent } from '../ai/agent.js';
import { PromptBuilder } from '../ai/prompts/builder.js';
import { createMemoryStoreAsync, type MemoryStore } from '../ai/memory/store.js';
import { createLLMFromAdapter } from '../ai/memory/layered-store.js';
import { createRuntimeHooks } from '../runtime/hooks.js';
import { createHooksRunner } from '../runtime/hooks-runner.js';
import type { RuntimeEvent } from '../runtime/events.js';
import { createIntentBoundaryResolver } from '../ai/intent-delegation/boundary-resolver.js';
import { classifyBoundaryWithLlm, createAdapterBoundaryInvoker } from '../ai/intent-delegation/llm-boundary-classifier.js';
import { writeError, formatErrorText, isTTY } from '../utils/ui.js';
import { showPermissionPrompt } from '../ui/permission-prompt.js';
import { askQuestion } from '../ui/ask-question.js';
import { addAllowRule } from '../ai/permissions/settings.js';
import { loadSettings, mergeRules } from '../ai/permissions/settings.js';
import { createSkillCatalog, parseSlashCommand, formatSkillsContext, toSkillEntries, findSkillByCommandName } from '../ai/skills/loader.js';
import { createSkillCatalogWatcher, type SkillCatalogWatcher } from '../ai/skills/watcher.js';
import { createSkillTool } from '../ai/skills/tool.js';
import { buildSkillExecutionPlan } from '../ai/skills/planner.js';
import {
  activateSkillInvocation,
  cloneSessionSkillExecutionState,
  createEmptySessionSkillExecutionState,
  findLatestRunningInvocation,
  recordSkillEvidence,
  type SessionSkillExecutionState,
  type SkillInvocationState,
} from '../ai/skills/execution-state.js';
import { resolveModelCapabilities } from '../ai/runtime/model-capabilities.js';
import { loadAutoContext, formatLoadedContext } from '../ai/runtime/context-loader.js';
import {
  assertKimiK3TargetResumeSupported,
  createFileSessionStore,
  KimiK3DurableResumeUnsupportedError,
  type PersistedSessionSnapshot,
} from '../ai/runtime/session-store.js';
import {
  assertKimiK3SessionModelSwitchSupported,
  resolveRegisteredStrictKimiK3Profile,
} from '../ai/runtime/model-harness-identity.js';
import { formatPrintOutput } from './chat-print-mode.js';
import { writeAssistantTextChunkInOrder } from './chat/assistant-streaming.js';
import {
  runInteractiveRuntimeTurn,
  type InteractiveRuntimeTurnRequest,
  type InteractiveTurnChunkHandlers,
} from './chat/runtime-turn-runner.js';
import { createChatIntentTurnState } from './chat/intent-turn-state.js';
import { createStrictSkillAdherenceFlow } from './chat/skill-adherence-flow.js';
import {
  endStreamingPhaseForInterruptInOrder,
  ensureStreamingPhaseInOrder,
  renderFooterChromeInOrder,
} from './chat/terminal-streaming-boundary.js';
import { MarkdownRenderer } from '../ui/markdown.js';
import { StatusBar } from '../ui/statusbar.js';
import { ScrollRegionManager } from '../ui/scroll-region.js';
import { TuiRuntimeState, type TuiSummarySource } from '../ui/tui/runtime-state.js';
import { renderWelcomeScreen, renderInputSeparator, dim, boldCyan, yellow, formatProgressNote, formatSubmittedInput, formatToolActivity, formatHistoryBlock } from '../ui/render.js';
import { getDisplayWidth, stripAnsi } from '../ui/display-width.js';
import { InputReader, type BusyCaptureHandle } from '../ui/input.js';
import { sliceByDisplayColumns } from '../ui/text-metrics.js';
import { ReplRenderer } from '../ui/repl-renderer.js';
import { ToolExplorer } from '../ui/tool-explorer.js';
import { TurnLayout } from '../ui/turn-layout.js';
import { parseInputBlocks, clearPastedImagePaths } from '../ui/image-input.js';
import { selectModel } from '../ui/model-selector.js';
import { getCurrentBranch } from '../utils/git.js';
import { executeReminderSlashCommand } from './chat-reminder.js';
import { parseShellEscapeInput, runInteractiveShellCommand, type ShellCommandResult, type ShellEscapeExecutor } from './chat-shell-escape.js';
import { createTurnActivityWatchdog, resolveAgentMaxIterations, resolveTurnTimeoutMs, runCleanupWithTimeout } from './chat-runtime-config.js';
import { buildChatHelpText } from './registry.js';
import { createPlatformRuntimeContext } from '../platform/runtime/context.js';
import { createPlatformRegistryFactory } from '../platform/runtime/registry-factory.js';
import { extractSandboxAllowedPaths } from '../platform/sandbox/policy.js';
import { FileTranscriptLogger } from '../ui/transcript.js';
import { TranscriptBuffer, recordToolObservation } from '../ui/transcript-buffer.js';
import { openTranscriptPager, spawnPagerProcess, type TranscriptPagerStatus } from '../ui/transcript-pager.js';
import { detectImageProtocol, readImageDimensions, renderImageLines, formatImageFallbackLine } from '../ui/image-renderer.js';
import { setCrashContext, setStreamErrorHandler } from '../utils/crash-reporter.js';
import { createLogger } from '../utils/logger.js';
import { createInstallSkillTool } from '../ai/tools/install-skill.js';
import { createUninstallSkillTool } from '../ai/tools/uninstall-skill.js';
import { executeNamedSubAgent } from '../ai/agents/subagent-executor.js';
import { isAbortError } from '../ai/runtime/abort-utils.js';
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
  assertSessionWriteOwnership,
  markSessionOwned,
  releaseSessionOwnership,
  resumeSessionOwnership,
  takeoverSessionOwnership,
} from '../runtime/intent-delegation/ownership.js';
import type { IntentLedgerRecord, SessionIntentLedger } from '../runtime/intent-delegation/types.js';
import { EmbeddedYZJChannel } from '../channels/embedded-yzj.js';
import { selectYZJChannel } from '../ui/channel-selector.js';
import { resolveYZJConfig } from '../channels/yzj.js';
import { YZJTransport } from '../channels/yzj-transport.js';
import { InMemoryApprovalStore } from '../channels/approval-store.js';
import {
  isOfficialKimiK3OpenAIEndpoint,
  resolveModelRuntimeOptions,
} from '../ai/providers/model-runtime-options.js';
import { getProviderProfile, listProviderProfiles } from '../ai/providers/registry.js';
import { resolveProviderApiKey } from '../ai/providers/auth-resolver.js';
import { FileSkillAdherenceStore } from '../runtime/skills/adherence-store.js';
import { checkForUpdate } from '../update/version-check.js';
import {
  buildIntentReminderBlock,
  formatCurrentIntentSummaryLine,
  formatCurrentTurnIntentSummaryLine,
  formatIntentCreatedTranscriptBlock,
  formatIntentStageSummaryTranscriptBlock,
  formatProgressTranscriptBlock,
  formatReceiptTranscriptBlock,
  formatSalvageTranscriptBlock,
  formatStageActivatedTranscriptBlock,
} from '../ui/orchestration.js';
import { createRuntimeTraceRecorderFromEnv } from '../runtime/trace/runtime-recorder.js';
import {
  buildGoalContextBlock,
  ContinuationArbiter,
  FileGoalStore,
  GoalCompletionEvaluator,
  GoalEvidenceCollector,
  GoalSessionLease,
  GoalService,
  GoalTamperDetectedError,
  type GoalActivation,
  type GoalState,
} from '../runtime/goal/index.js';
import {
  buildGoalContinuationInput,
  formatGoalPreview,
  formatGoalStatus,
  formatGoalSummaryLine,
  GOAL_COMMAND_HELP,
  inferGoalInput,
  isUnsupportedSingleShotGoalInput,
  parseGoalSlashCommand,
} from './chat-goal.js';

const { version: cliVersion } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

// Completed-intent feedback currently re-enters the footer/input surface and
// has repeatedly regressed in narrow real TTYs. Keep the data path in place,
// but do not prompt interactively until feedback has a non-footer surface.
const COMPLETED_INTENT_FEEDBACK_ENABLED = false;
const THINKING_ONLY_TOOL_TURN_NOTICE = '正在执行工具...';

type IntentBoundaryResolverFactory = typeof createIntentBoundaryResolver;
let intentBoundaryResolverFactoryForTests: IntentBoundaryResolverFactory | undefined;

export function __setIntentBoundaryResolverFactoryForTests(
  factory: IntentBoundaryResolverFactory | undefined,
): void {
  intentBoundaryResolverFactoryForTests = factory;
}

let shellEscapeExecutorForTests: ShellEscapeExecutor | undefined;

export function __setShellEscapeExecutorForTests(
  executor: ShellEscapeExecutor | undefined,
): void {
  shellEscapeExecutorForTests = executor;
}

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
  skillDebug?: boolean;
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

const log = createLogger('chat');

async function disposeModelAdapter(adapter: ModelAdapter | undefined): Promise<void> {
  const disposable = adapter as (ModelAdapter & { dispose?: () => void | Promise<void> }) | undefined;
  await disposable?.dispose?.();
}

async function flushStandardStreams(): Promise<void> {
  await Promise.all([
    new Promise<void>((resolve) => process.stdout.write('', () => resolve())),
    new Promise<void>((resolve) => process.stderr.write('', () => resolve())),
  ]);
}

async function runChat(initialInput: string | undefined, opts: ChatOptions): Promise<void> {
  if ((opts.print || opts.json) && !initialInput) {
    writeError('print/json 模式需要提供单次输入');
    process.exit(1);
  }
  if (initialInput && isUnsupportedSingleShotGoalInput(initialInput)) {
    writeError('Goal Mode 仅支持交互式 chat；print/json/单次输入不能创建或恢复 Goal');
    process.exitCode = 2;
    return;
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
  log.info('chat started', { initialInput: initialInput?.slice(0, 80) });
  let config = await loadConfig();
  let adapter: ModelAdapter;
  try {
    const bootstrap = await createChatAdapterWithLoginBootstrap(config, {
      interactive: isTTY(),
      hasInitialInput: initialInput !== undefined,
    });
    config = bootstrap.config;
    adapter = bootstrap.adapter;
  } catch (e) {
    writeError(String(e));
    process.exit(1);
  }
  const memoryStore: MemoryStore = await createMemoryStoreAsync(
    config.memory as Record<string, unknown> | undefined,
  );
  memoryStore.setLLMFn?.(createLLMFromAdapter(adapter));

  const creds = await loadCredentials();
  const devApp = await getDevAppIdentity();
  const cwd = process.cwd();
  const builtinCommands = ['chat', 'doctor', 'init', 'review', 'pr', 'commit', 'settings', 'context'];
  const platform = await createPlatformRuntimeContext({ cwd, builtinCommands });
  const pluginRuntime = platform.pluginRuntime;
  let skillDebugEnabled = opts.skillDebug ?? false;
  const customAgents = platform.customAgents;
  const sessionStore = createFileSessionStore();
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
    const forkSource = await sessionStore.load(opts.forkSession);
    if (!forkSource) {
      writeError(`找不到会话: ${opts.forkSession}`);
      process.exit(1);
    }
    assertKimiK3TargetResumeSupported(
      resolveRegisteredStrictKimiK3Profile(adapter) !== undefined,
      forkSource,
    );
    persistedSession = await sessionStore.fork(opts.forkSession);
  }
  if (persistedSession) {
    assertKimiK3TargetResumeSupported(
      resolveRegisteredStrictKimiK3Profile(adapter) !== undefined,
      persistedSession,
    );
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
  const transcriptBuffer = new TranscriptBuffer({
    onError: (error) => log.debug('transcript_buffer_record_failed', String(error)),
  });
  let nextInlineImageId = 1;
  let terminalUiSuspended = false;
  let terminalUiFailureNoted = false;
  let terminalUiFallbackStream: 'stdout' | 'stderr' | null = null;
  let stdoutFallbackToStderr = false;
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
  const promptBuilder = new PromptBuilder({ memoryStore });
  let agent: Agent | undefined;
  let runtimeFacade: RuntimeFacade | undefined;
  let skillCatalogWatcher: SkillCatalogWatcher | undefined;
  let activeBusyCapture: BusyCaptureHandle | null = null;
  let stopBusyCapture: () => void = () => {};
  let currentTurnAbortController: AbortController | null = null;
  const abortedRuntimeTurnIds = new Set<string>();
  let currentOuterTurnId: string | null = null;
  const continuationArbiter = new ContinuationArbiter();
  const intentTurnState = createChatIntentTurnState();
  let preparedIntentTurnSequence = 0;
  let currentTurnStageObservedSkillNames = new Map<number, Set<string>>();
  let currentIntentLedger: SessionIntentLedger;
  let currentGoalState: GoalState | null = null;
  let goalActivation: GoalActivation = 'disarmed';
  let pendingGoalCompleteSummary: string | null = null;
  let pendingGoalBlockedClaim: { reason: string; fingerprint: string } | null = null;
  type GoalTurnDraft = {
    turnId: string;
    goalId: string;
    epoch: number;
    startedAt: number;
    usageTokens: number | null;
    collector: GoalEvidenceCollector;
    outcome?: 'completed' | 'failed' | 'aborted';
  };
  const goalTurnDrafts = new Map<string, GoalTurnDraft>();
  const settledGoalTurns: GoalTurnDraft[] = [];
  let activeRuntimeTurnId: string | null = null;
  let goalTurnAdmissionEnabled = false;
  let goalLeaseHeartbeat: NodeJS.Timeout | null = null;
  let currentSkillEvalState: SessionSkillEvalState = persistedSession?.skillEval
    ? cloneSessionSkillEvalState(persistedSession.skillEval)
    : createEmptySessionSkillEvalState(Date.now());
  let currentSkillExecutionState: SessionSkillExecutionState = persistedSession?.skillExecution
    ? cloneSessionSkillExecutionState(persistedSession.skillExecution)
    : createEmptySessionSkillExecutionState(Date.now());
  const skillAdherenceStore = new FileSkillAdherenceStore();
  let activeSkillInvocationId: string | null = null;

  const beginPreparedIntentTurnContext = (): string => {
    const turnToken = `${sessionId}:prepared-intent:${++preparedIntentTurnSequence}`;
    intentTurnState.beginTurn(turnToken);
    currentTurnStageObservedSkillNames = new Map<number, Set<string>>();
    return turnToken;
  };

  const carryPreparedIntentContextToRuntimeTurn = (turnToken: string): void => {
    const snapshot = intentTurnState.getSnapshot();
    const plan = snapshot.currentTurnIntentPlan;
    const reminderBlock = snapshot.activeIntentReminderBlock;
    intentTurnState.beginTurn(turnToken);
    if (plan) {
      intentTurnState.setPlan(turnToken, plan);
    }
    if (reminderBlock) {
      intentTurnState.setActiveIntentReminderBlock(turnToken, reminderBlock);
    }
    currentTurnStageObservedSkillNames = new Map<number, Set<string>>();
  };

  const requestCurrentTurnAbort = (): void => {
    if (process.env['XIAOK_NO_ESC_INTERRUPT'] === '1') {
      return;
    }
    currentTurnAbortController?.abort();
  };

  type RuntimeTurnRequestArg = Parameters<RuntimeFacade['runTurn']>[0];
  type RuntimeTurnChunkHandler = Parameters<RuntimeFacade['runTurn']>[1];
  type RuntimeTurnActivityHandler = Parameters<RuntimeFacade['runTurn']>[3];
  const runRuntimeTurn = async (
    request: RuntimeTurnRequestArg,
    onChunk: RuntimeTurnChunkHandler,
    externalSignal?: AbortSignal,
    onRuntimeActivity?: RuntimeTurnActivityHandler,
  ): Promise<void> => {
    const previousController: AbortController | null = currentTurnAbortController;
    const controller = new AbortController();
    currentTurnAbortController = controller;
    const onExternalAbort = externalSignal
      ? () => controller.abort()
      : null;
    if (externalSignal && onExternalAbort) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    try {
      await runtimeFacade!.runTurn(request, onChunk, controller.signal, onRuntimeActivity);
    } finally {
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
      if (currentTurnAbortController === controller) {
        currentTurnAbortController = previousController;
      }
    }
  };

  try {
    currentIntentLedger = initializeChatIntentLedger(persistedIntentLedger, sessionId, instanceId, ownershipMode, {
      confirmHighRiskTakeover: opts.confirmHighRiskTakeover,
    });
  } catch (error) {
    writeError(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  const goalStore = new FileGoalStore(getConfigDir('goals'));
  const goalLease = new GoalSessionLease({
    rootDir: getConfigDir('goal-leases'),
    sessionId,
    instanceId,
  });
  const goalService = new GoalService({
    store: goalStore,
    ownership: {
      async assertOwned(goalSessionId, goalInstanceId) {
        const latestLedger = await intentLedgerStore.load(goalSessionId);
        if (latestLedger) currentIntentLedger = latestLedger;
        assertSessionWriteOwnership(currentIntentLedger, goalInstanceId, 'mutate Goal');
        goalLease.assertOwned();
      },
    },
  });
  currentGoalState = (await goalService.load(sessionId))?.state ?? null;

  if (opts.forkSession && !currentGoalState) {
    const sourceGoal = await goalStore.load(opts.forkSession);
    if (sourceGoal) {
      goalLease.acquire();
      try {
        currentGoalState = await goalService.fork({
          sessionId,
          instanceId,
          requestSource: 'user',
          expectedRevision: null,
        }, sourceGoal.state);
      } finally {
        goalLease.release();
      }
    }
  }

  const stopGoalLeaseHeartbeat = (): void => {
    if (goalLeaseHeartbeat) {
      clearInterval(goalLeaseHeartbeat);
      goalLeaseHeartbeat = null;
    }
  };
  const disarmGoal = (): void => {
    goalActivation = 'disarmed';
    stopGoalLeaseHeartbeat();
    goalLease.release();
  };
  const isGoalArmed = (): boolean => goalActivation === 'armed';
  const armGoal = (recoverExpired = false): void => {
    goalLease.acquire({ recoverExpired });
    goalActivation = 'armed';
    stopGoalLeaseHeartbeat();
    goalLeaseHeartbeat = setInterval(() => {
      try {
        goalLease.heartbeat();
      } catch (error) {
        log.warn('goal lease heartbeat failed', { error: String(error) });
        disarmGoal();
      }
    }, 10_000);
    goalLeaseHeartbeat.unref?.();
  };
  const goalMutationContext = (requestSource: 'user' | 'runtime') => ({
    sessionId,
    instanceId,
    requestSource,
    expectedRevision: currentGoalState?.revision ?? null,
  });
  // Resolve model capabilities early (needed for getPromptInput)
  let modelCapabilities = resolveModelCapabilities(adapter);

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

  const getInvocationById = (invocationId: string | null): SkillInvocationState | undefined => {
    if (!invocationId) {
      return undefined;
    }
    return currentSkillExecutionState.invocations.find((invocation) => invocation.invocationId === invocationId);
  };

  const getTrackedInvocation = (agentId?: string): SkillInvocationState | undefined => {
    const active = getInvocationById(activeSkillInvocationId);
    if (active && active.status === 'running') {
      return active;
    }
    return findLatestRunningInvocation(currentSkillExecutionState, agentId)
      ?? findLatestRunningInvocation(currentSkillExecutionState);
  };

  const activateTrackedSkillPlan = (
    plan: ReturnType<typeof buildSkillExecutionPlan>,
    agentId = 'main',
  ): SkillInvocationState => {
    const activation = activateSkillInvocation(currentSkillExecutionState, {
      sessionId,
      agentId,
      plan,
    });
    currentSkillExecutionState = activation.state;
    activeSkillInvocationId = activation.invocation.invocationId;
    return activation.invocation;
  };

  const recordSkillReferenceEvidence = (invocation: SkillInvocationState, absolutePath: string, agentId: string): void => {
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

  const recordSkillScriptEvidence = (invocation: SkillInvocationState, command: string, agentId: string): string[] => {
    const normalizedCommand = command.trim().replace(/\s+/g, ' ');
    const matchedRequiredCommands: string[] = [];
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

  const invocationRequiresStep = (invocation: SkillInvocationState, stepId: string): boolean => (
    invocation.plan.resolved.some((step) => step.requiredSteps.includes(stepId))
  );

  const recordSkillStepCompletionEvidence = (
    invocation: SkillInvocationState,
    stepId: string,
    agentId: string,
  ): void => {
    if (!invocationRequiresStep(invocation, stepId)) {
      return;
    }
    currentSkillExecutionState = recordSkillEvidence(currentSkillExecutionState, invocation.invocationId, {
      type: 'step_completed',
      agentId,
      stepId,
    });
  };

  const recordSkillArtifactFileEvidence = (
    invocation: SkillInvocationState,
    filePath: string,
    agentId: string,
  ): void => {
    const fileName = basename(filePath).toLowerCase();
    if (fileName === 'brief.json') {
      recordSkillStepCompletionEvidence(invocation, 'create_brief_json', agentId);
    }
  };

  const recordSkillCommandStepEvidence = (
    invocation: SkillInvocationState,
    matchedRequiredCommands: string[],
    agentId: string,
  ): void => {
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

  const observeSkillToolResult = (event: ToolObservation): void => {
    if (event.toolName !== 'skill' || !event.ok) {
      return;
    }

    try {
      const parsed = JSON.parse(event.result) as { type?: string };
      if (parsed.type !== 'skill_plan') {
        return;
      }
      activateTrackedSkillPlan(parsed as ReturnType<typeof buildSkillExecutionPlan>, event.agentId);
    } catch (e) { log.warn('skill result JSON parse failed', (e as Error).message) }
  };

  const observeSkillEvidence = (event: ToolObservation): void => {
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
  let askUserOnEnter: (() => void) | null = null;
  let askUserOnExit: (() => void) | null = null;
  let askUserRenderFrame: ((lines: string[]) => boolean | void) | null = null;
  let askUserClearFrame: (() => void) | null = null;

  const workflowTools = [
    createAskUserTool({
      ask: async (question, placeholder, interaction) => {
        if (!isTTY()) {
          throw new Error('当前运行模式不支持 ask_user 交互');
        }

        askUserOnEnter?.();
        try {
          if (interaction?.options.length) {
            const result = await askQuestion({
              question,
              options: interaction.options,
              multiSelect: interaction.multiSelect ?? false,
              renderFrame: (lines) => askUserRenderFrame?.(lines) ?? false,
              clearFrame: () => askUserClearFrame?.(),
            });
            return [...result.labels, result.otherText]
              .filter((value): value is string => Boolean(value))
              .join(', ');
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
        } finally {
          askUserOnExit?.();
        }
      },
    }),
    ...createIntentDelegationTools({
      ledgerStore: intentLedgerStore,
      sessionId,
      instanceId,
      getTurnIntentPlan: () => intentTurnState.getSnapshot().currentTurnIntentPlan,
    }),
    ...createGoalTools({
      getGoal: () => ({
        state: currentGoalState,
        activation: goalActivation,
      }),
      async requestComplete(summary) {
        if (!currentGoalState || currentGoalState.status !== 'active' || !isGoalArmed()) {
          return { accepted: false, reason: 'no armed active Goal' };
        }
        pendingGoalCompleteSummary = summary;
        return { accepted: true };
      },
      async requestBlocked(claim) {
        if (!currentGoalState || currentGoalState.status !== 'active' || !isGoalArmed()) {
          return { accepted: false, reason: 'no armed active Goal' };
        }
        pendingGoalBlockedClaim = claim;
        return { accepted: true };
      },
    }),
    createAskUserQuestionTool({
      onEnterInteractive: () => askUserOnEnter?.(),
      onExitInteractive: () => askUserOnExit?.(),
      renderFrame: (lines) => askUserRenderFrame?.(lines) ?? false,
      clearFrame: () => askUserClearFrame?.(),
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
    memoryStore,
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
    onToolObserved: async (event) => {
      recordToolObservation(transcriptBuffer, event);
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
  const buildCleanupSteps = (): Array<() => void | Promise<void>> => [
    () => platform.dispose(),
    () => disposeModelAdapter(adapter),
    () => memoryStore.close?.(),
    ...embeddedChannels.map((ch) => () => ch.cleanup()),
  ];
  const onCleanupError = (error: unknown): void => {
    log.warn('chat cleanup failed', { error: String(error) });
  };
  const cleanupRuntimeResourcesWithTimeout = async (): Promise<void> => {
    await runCleanupWithTimeout(buildCleanupSteps(), 2000, onCleanupError);
  };

  const rawRuntimeHooks = createRuntimeHooks();
  const runtimeHooks = {
    on: rawRuntimeHooks.on,
    onAny: rawRuntimeHooks.onAny,
    emit(event: RuntimeEvent) {
      rawRuntimeHooks.emit({ ...event, sessionId });
    },
  };
  const traceRecorder = createRuntimeTraceRecorderFromEnv({
    sessionId,
    cwd,
    command: 'xiaok chat',
    version: cliVersion,
    onWarning: (error) => {
      log.warn('runtime trace recorder warning', { error: String(error) });
    },
  });
  if (traceRecorder) {
    rawRuntimeHooks.onAny((event) => {
      traceRecorder.handleEvent(event);
      if (
        event.type === 'turn_completed'
        || event.type === 'turn_failed'
        || event.type === 'turn_aborted'
        || event.type === 'session_end'
      ) {
        void traceRecorder.flush();
      }
    });
  }
  log.info('agent created', { provider: config.defaultProvider, model: config.defaultModelId, skills: skills.length });
  agent = new Agent(adapter, registry, initialPromptSnapshot.rendered, {
    hooks: runtimeHooks,
    memoryStore,
    maxIterations: resolveAgentMaxIterations(),
  });
  agent.getSessionState().attachPromptSnapshot(initialPromptSnapshot.id, initialPromptSnapshot.memoryRefs);
  agent.setPromptSnapshot(initialPromptSnapshot);
  runtimeFacade = new RuntimeFacade({
    promptBuilder,
    getPromptInput: async (promptCwd) => getPromptInput(promptCwd, skills),
    agent,
    getSkillEntries: () => toSkillEntries(skills),
    getIntentReminderBlock: () => intentTurnState.getSnapshot().activeIntentReminderBlock,
    getGoalReminderBlock: () => (
      isGoalArmed() && currentGoalState?.status === 'active'
        ? buildGoalContextBlock(currentGoalState)
        : undefined
    ),
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
    const lines: string[] = [];
    if (summaryLine) {
      lines.push(summaryLine);
    }
    lines.push(statusLine || ' ');
    return lines;
  });
  inputReader.setScrollPromptRenderer((frame) => {
    if (!scrollRegion.isActive()) return false;
    const placeholder = frame.placeholder === '> ' ? '' : frame.placeholder;
    scrollRegion.renderPromptFrame({
      inputValue: frame.inputValue,
      cursor: frame.cursor,
      placeholder,
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
  let thinkingOnlyToolNoticeTimer: NodeJS.Timeout | null = null;
  const resetStreamingSegment = (): void => {
    streamingSegmentText = '';
  };
  const noteVisibleAssistantText = (delta: string): void => {
    if (/\S/.test(delta)) {
      turnVisibleAssistantTextSeen = true;
    }
  };
  const flushStreamingMarkdown = (): void => {
    try {
      if (scrollRegion.isActive() && scrollRegion.isContentStreaming()) {
        // Footer/prompt redraws (e.g. typing while the turn is busy) leave the
        // real cursor inside the footer, so anchor back before writing the tail.
        scrollRegion.positionCursorAtContentCursor();
      }
      // Row/column bookkeeping already happened during the write via the
      // newline and column-advance callbacks; recomputing it here would
      // overwrite exact values with a second, less precise wrap model.
      mdRenderer.flush();
    } finally {
      resetStreamingSegment();
    }
  };

  // 收集历史消息用于稍后打印（在欢迎页之后）
  const historyMessages = persistedSession?.messages ?? [];
  let welcomeVisible = historyMessages.length === 0 && !opts.dryRun;

  let contentRows = 0; // tracks how many rows of content have been written
  let resizeTimeout: NodeJS.Timeout | null = null;
  let handleResize: (() => void) | null = null;

  suspendInteractiveUi = (
    context: string,
    error: unknown,
    fallbackStream: 'stdout' | 'stderr' | null = null,
  ): void => {
    if (terminalUiSuspended) {
      return;
    }

    log.warn('UI suspended', { context, fallbackStream });
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
      } catch {}
      if (!isBrokenPipe) {
        try {
          if (fallbackStream === 'stdout') {
            originalStdoutWrite(rawMessage);
          } else {
            originalStderrWrite(rawMessage);
          }
        } catch {}
      }
    }

    try {
      stopActivity();
    } catch {}
    try {
      statusBar.destroy();
    } catch {}
    try {
      scrollRegion.end();
    } catch (e) { log.warn('scrollRegion.end failed in suspendInteractiveUi', (e as Error).message) }
  };

  const runtimeState = new TuiRuntimeState({
    statusBar,
    scrollRegion,
    onSuspendInteractiveUi: (context: string, error: unknown) => {
      suspendInteractiveUi(context, error);
    },
    isTerminalUiSuspended: () => terminalUiSuspended,
  });

  const beginActivity = (label: string, restart = false, startedAt = Date.now()): void => {
    runtimeState.beginActivity(label, restart, startedAt);
  };

  const scheduleActivityResume = (label: string, delayMs = 180): void => {
    runtimeState.scheduleActivityResume(label, delayMs);
  };

  const scheduleActivityPause = (delayMs = 180): void => {
    runtimeState.scheduleActivityPause(delayMs);
  };

  const pauseActivity = (): void => {
    runtimeState.pauseActivity();
  };

  const stopLiveActivityTimer = (): void => {
    runtimeState.stopLiveActivityTimer();
  };

  const withPausedLiveActivity = async <T>(action: () => Promise<T>): Promise<T> => (
    runtimeState.withPausedLiveActivity(action)
  );

  function ensureBusyInputCapture(): void {
    if (terminalUiSuspended || !scrollRegion.isActive()) {
      return;
    }
    if (activeBusyCapture?.isActive()) {
      return;
    }
    activeBusyCapture?.stop();
    activeBusyCapture = inputReader.startBusyCapture({
      placeholder: getFooterInputPrompt(),
      onAbortRequest: requestCurrentTurnAbort,
    });
  }

  let askUserQuestionPromptActive = false;

  const enterAskUserQuestionPrompt = (): void => {
    stopBusyCapture();
    if (!askUserQuestionPromptActive) {
      askUserQuestionPromptActive = true;
      runtimeState.enterInteractivePrompt();
    }
    if (scrollRegion.isActive()) {
      scrollRegion.clearActivityLine();
      scrollRegion.positionCursorAtContentCursor();
    }
  };

  const exitAskUserQuestionPrompt = (): void => {
    if (askUserQuestionPromptActive) {
      askUserQuestionPromptActive = false;
      runtimeState.exitInteractivePrompt();
    }
    ensureBusyInputCapture();
    runtimeState.beginActivity(describeLiveActivity('AskUserQuestion', {}), true);
  };

  // Wire up lazy callbacks for AskUserQuestion interactive prompt.
  askUserOnEnter = enterAskUserQuestionPrompt;
  askUserOnExit = exitAskUserQuestionPrompt;
  askUserRenderFrame = (lines: string[]): boolean => {
    if (terminalUiSuspended || !scrollRegion.isActive()) {
      return false;
    }
    scrollRegion.renderPromptFrame({
      inputValue: '',
      cursor: 0,
      placeholder: getFooterInputPrompt(),
      summaryLine: getCurrentIntentSummaryLine(),
      statusLine: statusBar.getStatusLine(),
      overlayLines: lines,
      overlayKind: 'question',
      owner: 'renderer',
    });
    return true;
  };
  askUserClearFrame = (): void => {
    if (terminalUiSuspended || !scrollRegion.isActive()) {
      return;
    }
    scrollRegion.renderPromptFrame({
      inputValue: '',
      cursor: 0,
      placeholder: getFooterInputPrompt(),
      summaryLine: getCurrentIntentSummaryLine(),
      statusLine: statusBar.getStatusLine(),
      overlayLines: [],
      owner: 'renderer',
    });
    scrollRegion.positionCursorAtContentCursor();
  };

  const stopActivity = (): void => {
    runtimeState.stopActivity();
  };

  const resetTurnChrome = (): void => {
    stopActivity();
    toolExplorer.reset();
    turnLayout.reset();
    mdRenderer.reset();
    resetStreamingSegment();
  };

  const handleTurnFailure = (error: unknown): void => {
    endStreamingPhaseForInterrupt();
    runtimeState.markInputReady();
    resetTurnChrome();
    const errorText = `\x1b[31mError:\x1b[0m ${formatErrorText(String(error))}`;
    if (scrollRegion.isActive() && !terminalUiSuspended) {
      try {
        scrollRegion.writeAtContentCursor(errorText + '\n');
      } catch (uiError) {
        suspendInteractiveUi('handle_turn_failure', uiError);
        writeError(String(error));
      }
    } else {
      writeError(String(error));
    }
    renderFooterChrome();
  };

  const handleTurnAbort = (): void => {
    endStreamingPhaseForInterrupt();
    runtimeState.markInputReady();
    resetTurnChrome();
    const noticeText = yellow('- Request cancelled');
    if (scrollRegion.isActive() && !terminalUiSuspended) {
      try {
        scrollRegion.writeAtContentCursor(noticeText + '\n');
      } catch (uiError) {
        suspendInteractiveUi('handle_turn_abort', uiError);
        process.stderr.write(noticeText + '\n');
      }
    } else {
      process.stderr.write(noticeText + '\n');
    }
    renderFooterChrome();
  };

  const getFooterInputPrompt = (): string => runtimeState.getFooterInputPrompt();

  const renderFooterChrome = (): void => {
    if (!scrollRegion.isActive()) {
      return;
    }

    try {
      flushStreamingMarkdown();
      const footerOptions = {
        inputPrompt: getFooterInputPrompt(),
        summaryLine: getCurrentIntentSummaryLine(),
        statusLine: statusBar.getStatusLine(),
      };

      renderFooterChromeInOrder({
        scrollRegion,
        replRenderer,
        mdRenderer,
      }, footerOptions);
    } catch (error) {
      suspendInteractiveUi('render_footer_chrome', error);
    }
  };

  const endStreamingPhaseForInterrupt = (): void => {
    if (!scrollRegion.isActive() || !scrollRegion.isContentStreaming()) {
      return;
    }

    try {
      flushStreamingMarkdown();
      const footerOptions = {
        inputPrompt: getFooterInputPrompt(),
        summaryLine: getCurrentIntentSummaryLine(),
        statusLine: statusBar.getStatusLine(),
      };

      endStreamingPhaseForInterruptInOrder({
        scrollRegion,
        runtimeState,
        mdRenderer,
      }, footerOptions);
      replRenderer.prepareForInput();
    } catch (error) {
      suspendInteractiveUi('end_streaming_interrupt', error);
    }
  };

  const ensureStreamingPhase = (): void => {
    ensureStreamingPhaseInOrder({
      scrollRegion,
      runtimeState,
      turnLayout,
      mdRenderer,
      stopLiveActivityTimer,
      writeFallback: (text) => {
        process.stdout.write(text);
      },
    });
  };

  const handleAssistantTextChunk = (
    delta: string,
    appendText: (delta: string) => void,
  ): void => {
    writeAssistantTextChunkInOrder(delta, {
      noteVisibleAssistantText,
      appendAssistantText: appendText,
      appendStreamingSegment: (text) => {
        streamingSegmentText += text;
      },
      ensureStreamingPhase,
      writeMarkdown: (text) => {
        mdRenderer.write(text);
      },
    });
  };

  let interactiveRuntimeTurnSequence = 0;
  const createInteractiveRuntimeTurnRequest = <Input>(
    input: Input,
    signal?: AbortSignal,
  ): InteractiveRuntimeTurnRequest<Input> => ({
    turnToken: `${sessionId}:interactive:${++interactiveRuntimeTurnSequence}`,
    sessionId,
    cwd,
    source: 'chat',
    input,
    ...(signal ? { signal } : {}),
  });

  const createInteractiveTurnChunkHandlers = (
    appendAssistantText: (delta: string) => void,
  ): InteractiveTurnChunkHandlers => ({
    writeAssistantText(delta) {
      handleAssistantTextChunk(delta, appendAssistantText);
    },
    updateUsage(usage) {
      statusBar.update(usage as UsageStats);
      scrollRegion.updateStatusLine(statusBar.getStatusLine());
      if (activeRuntimeTurnId) {
        const draft = goalTurnDrafts.get(activeRuntimeTurnId);
        if (draft) {
          const typedUsage = usage as UsageStats;
          draft.usageTokens = typedUsage.inputTokens + typedUsage.outputTokens;
        }
      }
    },
  });

  const getCurrentIntentSummaryLine = (): string => {
    let source: TuiSummarySource = 'none';
    let line = '';
    const intentTurnSnapshot = intentTurnState.getSnapshot();

    if (currentGoalState) {
      source = 'goal';
      line = formatGoalSummaryLine(currentGoalState);
    } else if (intentTurnSnapshot.currentTurnIntentPlan) {
      source = 'turn';
      line = getCurrentTurnSummaryLine();
    } else if (intentTurnSnapshot.completedTurnIntentSummaryLine) {
      source = 'completed_turn';
      line = intentTurnSnapshot.completedTurnIntentSummaryLine;
    } else if (
      currentIntentLedger.activeIntentId
      && currentIntentLedger.intents.find((intent) => (
        intent.intentId === currentIntentLedger.activeIntentId
        && intent.overallStatus === 'waiting_user'
      ))
    ) {
      source = 'waiting_user';
      line = formatCurrentIntentSummaryLine(currentIntentLedger, instanceId);
    }

    runtimeState.setSummarySource(source);
    return line;
  };

  function writeProgressTranscriptNote(note: string): void {
    if (!note) {
      return;
    }

    const block = formatProgressNote(note);
    endStreamingPhaseForInterrupt();
    if (scrollRegion.isActive()) {
      try {
        scrollRegion.writeAtContentCursor(block);
      } catch (error) {
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

  const maybeWriteThinkingOnlyToolNotice = (): void => {
    if (turnVisibleAssistantTextSeen || turnThinkingOnlyToolNoticeWritten) {
      return;
    }

    if (thinkingOnlyToolNoticeTimer) {
      clearTimeout(thinkingOnlyToolNoticeTimer);
      thinkingOnlyToolNoticeTimer = null;
    }

    if (!turnVisibleAssistantTextSeen && !turnThinkingOnlyToolNoticeWritten) {
      turnThinkingOnlyToolNoticeWritten = true;
      turnLayout.noteProgressNote();
      writeProgressTranscriptNote(THINKING_ONLY_TOOL_TURN_NOTICE);
      return;
    }
  };

  const isTerminalIntentStatus = (
    status: IntentLedgerRecord['overallStatus'] | undefined,
  ): boolean => status === 'completed' || status === 'failed' || status === 'cancelled';

  const refreshIntentLedger = async (): Promise<void> => {
    currentIntentLedger = await intentLedgerStore.load(sessionId) ?? currentIntentLedger;
  };

  const refreshSkillEvalState = async (): Promise<void> => {
    currentSkillEvalState = await skillEvalStore.load(sessionId) ?? currentSkillEvalState;
  };

  const runStrictContinuationTurn = async (input: string): Promise<string> => {
    let continuationText = '';
    await maybePrepareFreshContextHandoff();
    const continuationResult = await runInteractiveRuntimeTurn(
      runRuntimeTurn,
      createInteractiveRuntimeTurnRequest(input),
      createInteractiveTurnChunkHandlers((delta) => {
        continuationText += delta;
      }),
    );
    continuationText = continuationResult.assistantText;
    flushStreamingMarkdown();
    await finalizeCurrentTurnIntentIfNeeded();
    return continuationText;
  };

  const strictSkillAdherenceFlow = createStrictSkillAdherenceFlow({
    getTrackedInvocation: () => getTrackedInvocation(),
    getInvocationById: (invocationId) => getInvocationById(invocationId),
    getSkillExecutionState: () => currentSkillExecutionState,
    setSkillExecutionState: (nextState) => {
      currentSkillExecutionState = nextState;
    },
    continuationRunner: { runContinuation: runStrictContinuationTurn },
    adherenceStore: skillAdherenceStore,
    writeProgressTranscriptNote,
  });
  const maybeRunStrictCompletionLoop = strictSkillAdherenceFlow.maybeRunStrictCompletionLoop;

  const renderIntentSummaryLine = (): void => {
    if (!scrollRegion.isActive() || scrollRegion.isContentStreaming()) {
      return;
    }

    try {
      scrollRegion.renderFooter({
        inputPrompt: getFooterInputPrompt(),
        summaryLine: getCurrentIntentSummaryLine(),
        statusLine: statusBar.getStatusLine(),
      });
    } catch (error) {
      suspendInteractiveUi('render_intent_summary', error);
    }
  };

  const hasContinuationCue = (input: string): boolean => (
    /^(继续|继续做|继续写|继续生成|再改一版|基于(刚才|上一个|上一版|刚才那个)|按(刚才|上一个|上一版)|重新生成同一件事)/u
  ).test(input.trim());

  const isSupplementOrClarification = (input: string): boolean => (
    /^(补充|补一下|补一个|再补充|这里还有|答案是|是|不是|可以|不可以|用中文|用英文|好的，继续|继续吧)/u
  ).test(input.trim());

  const getWaitingUserIntentForInput = (input: string): IntentLedgerRecord | undefined => {
    if (!currentIntentLedger.activeIntentId) {
      return undefined;
    }

    const activeIntent = currentIntentLedger.intents.find((intent) => (
      intent.intentId === currentIntentLedger.activeIntentId
      && intent.overallStatus === 'waiting_user'
    ));
    if (!activeIntent) {
      return undefined;
    }

    if (!hasContinuationCue(input) && !isSupplementOrClarification(input)) {
      return undefined;
    }

    return activeIntent;
  };

  const resetCurrentTurnSummary = (): void => {
    const snapshot = intentTurnState.getSnapshot();
    if (snapshot.activeTurnToken) {
      intentTurnState.setPlan(snapshot.activeTurnToken, snapshot.currentTurnIntentPlan);
    }
    currentTurnStageObservedSkillNames = new Map<number, Set<string>>();
  };

  const normalizeStageMatchText = (value: string): string => value.toLowerCase();

  const stageLooksLikeReport = (value: string): boolean => /(报告|report|brief|document|doc)/iu.test(value);
  const stageLooksLikeSlides = (value: string): boolean => /(幻灯片|slide|slides|deck|ppt|presentation)/iu.test(value);
  const stageLooksLikeMarkdown = (value: string): boolean => /(^|[^a-z])md([^a-z]|$)|markdown|提取\s*markdown/iu.test(value);

  const scoreStageForSkillName = (
    stage: IntentPlanDraft['stages'][number],
    skillName: string,
  ): number => {
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

  const scoreStageForToolInput = (
    stage: IntentPlanDraft['stages'][number],
    toolName: string,
    toolInput: Record<string, unknown>,
  ): number => {
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
    if (
      stageLooksLikeMarkdown(stageText)
      && /(markdown|merged_md|提取\s*markdown|\.md["'\s,}])/iu.test(toolText)
      && !/\.report\.md/iu.test(toolText)
    ) {
      score += 8;
    }
    return score;
  };

  const findBestMatchingStageIndex = (
    scoreStage: (stage: IntentPlanDraft['stages'][number]) => number,
  ): number => {
    const plan = intentTurnState.getSnapshot().currentTurnIntentPlan;
    if (!plan) {
      return -1;
    }

    let bestIndex = -1;
    let bestScore = 0;
    plan.stages.forEach((stage, index) => {
      const score = scoreStage(stage);
      if (score > bestScore || (score === bestScore && score > 0 && index > bestIndex)) {
        bestIndex = index;
        bestScore = score;
      }
    });
    return bestScore > 0 ? bestIndex : -1;
  };

  const inferStageIndexForSkillName = (skillName: string): number => (
    findBestMatchingStageIndex((stage) => scoreStageForSkillName(stage, skillName))
  );

  const inferStageIndexForTool = (
    toolName: string,
    toolInput: Record<string, unknown>,
  ): number => (
    findBestMatchingStageIndex((stage) => scoreStageForToolInput(stage, toolName, toolInput))
  );

  const advanceCurrentTurnStage = (turnToken: string, stageIndex: number, announce = false): void => {
    const snapshot = intentTurnState.getSnapshot();
    const plan = snapshot.currentTurnIntentPlan;
    if (
      !intentTurnState.isActiveTurn(turnToken)
      || !plan
      || stageIndex < 0
      || stageIndex >= plan.stages.length
    ) {
      return;
    }

    if (stageIndex > snapshot.currentTurnStageIndex) {
      intentTurnState.noteStageActivated(turnToken, stageIndex);
      if (announce) {
        const stage = plan.stages[stageIndex];
        if (stage) {
          writeOrchestrationBlock(formatStageActivatedTranscriptBlock({
            order: stage.order,
            totalStages: plan.stages.length,
            label: stage.label,
          }));
        }
      }
    }
  };

  const getStageSkillNames = (stage: IntentPlanDraft['stages'][number]): string[] => (
    [...(currentTurnStageObservedSkillNames.get(stage.order) ?? [])]
  );

  const recordCurrentTurnStageSkill = (turnToken: string, stageIndex: number, skillName: string): void => {
    const normalized = skillName.trim();
    const plan = intentTurnState.getSnapshot().currentTurnIntentPlan;
    if (
      !intentTurnState.isActiveTurn(turnToken)
      || !plan
      || stageIndex < 0
      || stageIndex >= plan.stages.length
      || !normalized
      || normalized.startsWith('generic_llm::')
    ) {
      return;
    }
    const current = currentTurnStageObservedSkillNames.get(stageIndex) ?? new Set<string>();
    current.add(normalized);
    currentTurnStageObservedSkillNames.set(stageIndex, current);
  };

  const maybeAdvanceCurrentTurnStageForTool = (
    turnToken: string,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): void => {
    if (!intentTurnState.isActiveTurn(turnToken) || !intentTurnState.getSnapshot().currentTurnIntentPlan) {
      return;
    }

    if (toolName !== 'skill') {
      advanceCurrentTurnStage(turnToken, inferStageIndexForTool(toolName, toolInput), true);
      intentTurnState.noteStepRunning(turnToken);
      return;
    }

    const skillName = typeof toolInput.name === 'string' ? toolInput.name.trim() : '';
    if (!skillName) {
      intentTurnState.noteStepRunning(turnToken);
      return;
    }

    const stageIndex = inferStageIndexForSkillName(skillName);
    advanceCurrentTurnStage(turnToken, stageIndex, true);
    recordCurrentTurnStageSkill(turnToken, stageIndex, skillName);
    intentTurnState.noteStepRunning(turnToken);
  };

  const getCurrentTurnSummaryLine = (): string => {
    const snapshot = intentTurnState.getSnapshot();
    const plan = snapshot.currentTurnIntentPlan;
    if (!plan) {
      return '';
    }

    const stages = plan.stages;
    const stage = stages[Math.min(snapshot.currentTurnStageIndex, Math.max(stages.length - 1, 0))];
    if (!stage) {
      return '';
    }

    return formatCurrentTurnIntentSummaryLine({
      deliverable: plan.deliverable,
      stageOrder: stage.order,
      totalStages: stages.length,
      stageLabel: stage.label,
      skillNames: getStageSkillNames(stage),
      status: snapshot.currentTurnStageStatus,
    });
  };

  const getCurrentTurnStageSummaryBlock = (): string => {
    const snapshot = intentTurnState.getSnapshot();
    const plan = snapshot.currentTurnIntentPlan;
    if (!plan || plan.stages.length <= 1) {
      return '';
    }

    const totalStages = plan.stages.length;
    return formatIntentStageSummaryTranscriptBlock({
      deliverable: plan.deliverable,
      stages: plan.stages.map((stage) => ({
        order: stage.order,
        totalStages,
        label: stage.label,
        skillNames: getStageSkillNames(stage),
        status: stage.order <= snapshot.currentTurnStageIndex ? 'Completed' : 'Skipped',
      })),
    });
  };

  const finalizeCurrentTurnIntentIfNeeded = async (): Promise<void> => {
    const intentId = intentTurnState.getSnapshot().currentTurnIntentPlan?.intentId;
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

  const createConfiguredIntentBoundaryResolver = (): ReturnType<IntentBoundaryResolverFactory> => {
    const boundaryConfig = config.intentBoundary ?? DEFAULT_INTENT_BOUNDARY_CONFIG;
    const resolverFactory = intentBoundaryResolverFactoryForTests ?? createIntentBoundaryResolver;
    return resolverFactory({
      config: boundaryConfig,
      llmClassify: boundaryConfig.llmClassifier === 'off'
        ? undefined
        : async (boundaryInput, ruleDecision) => classifyBoundaryWithLlm(
            {
              input: boundaryInput.input,
              sessionId: boundaryInput.sessionId,
              instanceId: boundaryInput.instanceId,
              cwd: boundaryInput.cwd,
              providedSourcePaths: [],
              ruleDecision,
            },
            createAdapterBoundaryInvoker(adapter, boundaryConfig),
          ),
      emitDebug: (event) => {
        log.info('intent_boundary_decision', event);
      },
    });
  };

  let intentBoundaryResolver = createConfiguredIntentBoundaryResolver();

  const prepareIntentReminderForInput = async (input: string): Promise<void> => {
    const turnToken = beginPreparedIntentTurnContext();
    const activeIntent = getWaitingUserIntentForInput(input);

    const decision = await intentBoundaryResolver.resolve({
      instanceId,
      sessionId,
      input,
      cwd,
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

    intentTurnState.setPlan(turnToken, decision.kind === 'intent' ? decision.plan : undefined);

    const plan = intentTurnState.getSnapshot().currentTurnIntentPlan;
    if (plan?.continuationMode === 'continue_active') {
      intentTurnState.setActiveIntentReminderBlock(turnToken, buildIntentReminderBlock(currentIntentLedger, instanceId));
      return;
    }

    intentTurnState.setActiveIntentReminderBlock(turnToken, undefined);
  };

  const clearTurnIntentContext = (): void => {
    intentTurnState.clearTurnContextPreservingCompletedSummary();
    currentTurnStageObservedSkillNames = new Map<number, Set<string>>();
  };

  // Stage executor debug analysis
  const runStageAnalysis = async (userInput: string): Promise<StageOutput> => {
    const stages = analyzeStageIntent(userInput, skills, cwd);

    const debugEvents: DebugEvent[] = [];
    debugEvents.push({
      timestamp: Date.now(),
      phase: 'intent_analysis',
      detail: `Detected ${stages.length} stages: ${stages.map(s => s.title).join(', ')}`,
      durationMs: 1,
      level: 'info',
    });

    const currentTokens = agent?.getUsage().inputTokens ?? 0;
    const usageRate = modelCapabilities.contextLimit > 0 ? Math.round(currentTokens / modelCapabilities.contextLimit * 100) : 0;

    const results = stages.map(stage => {
      const skill = skills.find(s => s.name === stage.skill);
      const skillSize = skill?.content.length ?? 0;
      const refsSize = skill ? skill.referencesManifest.reduce((sum, r) => sum + r.size, 0) : 0;
      const needsSubagent = usageRate > 60;

      return {
        stage,
        status: 'completed' as const,
        timing: {
          totalMs: 0,
          contextCheckMs: 0,
          subagentSpawnMs: needsSubagent ? 1 : 0,
          subagentExecMs: 0,
          skillLoadMs: Math.ceil((skillSize + refsSize) / 1000) * 100,
          skillExecMs: 0,
          artifactReadMs: 0,
        },
        debugEvents: [],
        contextCheck: {
          usagePercent: usageRate,
          estimatedNeeded: Math.ceil((skillSize + refsSize) / 4) + 4000,
          available: modelCapabilities.contextLimit - currentTokens,
          needsSubagent,
        },
      };
    });

    return { stages, results, debugEvents };
  };

  const primeTurnIntentPlan = async (renderTranscriptBlock = false): Promise<void> => {
    const snapshot = intentTurnState.getSnapshot();
    const turnIntentPlan = snapshot.currentTurnIntentPlan;
    const turnToken = snapshot.activeTurnToken;
    if (!turnIntentPlan || !turnToken) {
      return;
    }

    const beforeIntentCount = currentIntentLedger.intents.length;
    currentIntentLedger = await bootstrapTurnIntentPlan(
      intentLedgerStore,
      sessionId,
      currentIntentLedger,
      turnIntentPlan,
    );

    if (turnIntentPlan.continuationMode === 'new_intent') {
      intentTurnState.setActiveIntentReminderBlock(turnToken, buildIntentReminderBlock(currentIntentLedger, instanceId));
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
    const turnToken = intentTurnState.getSnapshot().activeTurnToken;
    if (turnToken) {
      intentTurnState.setActiveIntentReminderBlock(turnToken, buildIntentReminderBlock(currentIntentLedger, instanceId));
    }
    await persistSession();
  };

  const writeOrchestrationBlock = (block: string): void => {
    if (!block) {
      return;
    }

    endStreamingPhaseForInterrupt();
    if (scrollRegion.isActive()) {
      scrollRegion.clearActivity();
    }
    const separatedBlock = block.startsWith('\n') ? block : `\n${block}`;
    if (scrollRegion.isActive()) {
      try {
        scrollRegion.writeAtContentCursor(separatedBlock);
      } catch (error) {
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

  const persistSession = async (options: {
    refreshIntentLedger?: boolean;
    refreshSkillEvalState?: boolean;
  } = {}): Promise<void> => {
    if (options.refreshIntentLedger ?? true) {
      await refreshIntentLedger();
    }
    if (options.refreshSkillEvalState ?? true) {
      await refreshSkillEvalState();
    }
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

  const pauseCurrentGoalForInterruption = async (
    reason: string,
    requestSource: 'user' | 'runtime',
  ): Promise<void> => {
    try {
      if (isGoalArmed() && currentGoalState?.status === 'active') {
        currentGoalState = await goalService.pause(goalMutationContext(requestSource), reason);
      }
    } catch (error) {
      log.warn('goal pause failed', { reason, error: String(error) });
    } finally {
      pendingGoalCompleteSummary = null;
      pendingGoalBlockedClaim = null;
      disarmGoal();
    }
  };

  const handleGoalCommitFailure = (error: unknown): void => {
    const reason = error instanceof GoalTamperDetectedError
      ? 'tamper_detected'
      : 'goal_state_flush_failed';
    if (currentGoalState?.status === 'active') {
      currentGoalState = {
        ...currentGoalState,
        status: 'paused',
        terminalReason: reason,
      };
    }
    pendingGoalCompleteSummary = null;
    pendingGoalBlockedClaim = null;
    disarmGoal();
    writeProgressTranscriptNote(`Goal 已暂停：${reason}`);
  };

  const finalizeSettledGoalTurns = async (lastAssistantText: string): Promise<void> => {
    if (settledGoalTurns.length === 0) return;
    const drafts = settledGoalTurns.splice(0);
    const lastCompleted = [...drafts].reverse().find(item => item.outcome === 'completed');

    try {
      for (const draft of drafts) {
        if (
          !currentGoalState
          || !isGoalArmed()
          || currentGoalState.status !== 'active'
          || draft.goalId !== currentGoalState.goalId
          || draft.epoch !== currentGoalState.epoch
        ) {
          continue;
        }
        if (draft.outcome !== 'completed') {
          await pauseCurrentGoalForInterruption(
            draft.outcome === 'aborted' ? 'user_aborted' : 'runtime_error',
            draft.outcome === 'aborted' ? 'user' : 'runtime',
          );
          return;
        }

        const evidence = draft.collector.flush().map(item => item.record);
        if (draft === lastCompleted && lastAssistantText.trim()) {
          evidence.push({
            ownerKind: 'goal',
            ownerId: currentGoalState.goalId,
            kind: 'answer',
            summary: 'Goal turn produced a non-empty final response',
            metadata: { responseId: draft.turnId },
          });
        }
        let terminalDecision: Parameters<GoalService['settleTurn']>[1]['terminalDecision'] = { kind: 'none' };
        let missingCompletionKinds: string[] = [];
        if (draft === lastCompleted && pendingGoalCompleteSummary) {
          const document = await goalService.load(sessionId);
          if (!document) throw new Error('Goal document disappeared before completion evaluation');
          const proposedEvidence = evidence.map((record, index) => ({
            goalId: currentGoalState!.goalId,
            epoch: currentGoalState!.epoch,
            goalTurnId: draft.turnId,
            evidenceId: `pending_${draft.turnId}_${index}`,
            record,
            recordedAt: Date.now(),
          }));
          const evaluation = new GoalCompletionEvaluator().evaluate(
            currentGoalState,
            [...document.evidence, ...proposedEvidence],
          );
          if (evaluation.ok) {
            terminalDecision = { kind: 'complete', reason: pendingGoalCompleteSummary };
          } else {
            missingCompletionKinds = evaluation.missingKinds;
          }
          pendingGoalCompleteSummary = null;
        }
        currentGoalState = await goalService.settleTurn(goalMutationContext('runtime'), {
          turnId: draft.turnId,
          tokensUsed: draft.usageTokens ?? 0,
          activeWallClockMs: Math.max(0, Date.now() - draft.startedAt),
          evidence,
          terminalDecision,
        });
        if (currentGoalState.status === 'complete') {
          disarmGoal();
          writeProgressTranscriptNote('Goal 已完成。');
          return;
        }
        if (missingCompletionKinds.length > 0) {
          writeProgressTranscriptNote(`Goal 尚缺完成证据：${missingCompletionKinds.join(', ')}`);
        }
        if (currentGoalState.status !== 'active') {
          disarmGoal();
          writeProgressTranscriptNote(`Goal 已停止：${currentGoalState.terminalReason ?? currentGoalState.status}`);
          return;
        }
      }

      if (!currentGoalState || currentGoalState.status !== 'active' || !isGoalArmed()) return;

      if (pendingGoalBlockedClaim) {
        const claim = pendingGoalBlockedClaim;
        pendingGoalBlockedClaim = null;
        currentGoalState = await goalService.noteBlockedClaim(goalMutationContext('runtime'), claim);
        if (currentGoalState.status === 'blocked') {
          disarmGoal();
          writeProgressTranscriptNote(`Goal blocked：${claim.reason}`);
          return;
        }
      }

    } catch (error) {
      handleGoalCommitFailure(error);
    }
  };

  const releaseSessionOwnershipForExit = async (): Promise<void> => {
    disarmGoal();
    await refreshIntentLedger();
    const ownerInstanceId = currentIntentLedger.ownership.ownerInstanceId;
    if (ownerInstanceId !== instanceId) {
      return;
    }

    currentIntentLedger = releaseSessionOwnership(currentIntentLedger, instanceId, Date.now());
    await persistSession({ refreshIntentLedger: false });
  };

  const wrapOverlayText = (text: string, maxWidth: number): string[] => {
    const safeWidth = Math.max(1, maxWidth);
    const rawLines = stripAnsi(text).split(/\r?\n/u);
    const wrappedLines: string[] = [];

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

  type FeedbackPromptResult =
    | { outcome: 'positive' | 'negative' | 'skip'; deferredInput?: undefined; exitRequested?: false }
    | { outcome: 'skip'; deferredInput: string; exitRequested?: false }
    | { outcome: 'skip'; deferredInput?: undefined; exitRequested: true };

  type CompletedIntentFeedbackResult = {
    deferredInput: string | null;
    exitRequested: boolean;
  };

  const promptFeedbackChoice = async (
    message: string,
  ): Promise<FeedbackPromptResult> => withPausedLiveActivity(async () => {
    runtimeState.enterWaitingFeedback();
    try {
      const feedbackLine = `[xiaok] ${message}`;
      const feedbackOverlayLines = wrapOverlayText(
        feedbackLine,
        Math.max(1, (process.stdout.columns ?? 80) - 2),
      );

      if (!scrollRegion.isActive()) {
        const note = `\n${feedbackLine}\n`;
        process.stdout.write(note);
      }

      while (true) {
        const answer = await inputReader.read(
          '> ',
          scrollRegion.isActive() ? { overlayLines: feedbackOverlayLines, overlayKind: 'feedback' } : undefined,
        );
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
    } finally {
      runtimeState.markInputReady();
      renderIntentSummaryLine();
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

  const maybeCollectCompletedIntentFeedback = async (): Promise<CompletedIntentFeedbackResult> => {
    const noFeedbackResult: CompletedIntentFeedbackResult = { deferredInput: null, exitRequested: false };
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

    const relevantObservations = currentSkillEvalState.observations.filter((observation) => (
      observation.intentId === activeIntent.intentId && Boolean(observation.actualSkillName)
    ));
    currentSkillEvalState = await skillEvalStore.markPromptedIntent(sessionId, activeIntent.intentId);

    if (relevantObservations.length === 0) {
      return noFeedbackResult;
    }

    const observationIds = relevantObservations.map((observation) => observation.observationId);
    const pendingFeedback: SkillFeedbackRecord[] = [];

    const outcome = await promptFeedbackChoice(
      '这次结果是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过',
    );
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
  if (branch) statusBar.updateBranch(branch);
  statusBar.update({ inputTokens: 0, outputTokens: 0 });

  if (!initialInput && currentGoalState && ['active', 'paused', 'blocked'].includes(currentGoalState.status)) {
    process.stdout.write(`${dim('Goal 已保留但未自动继续；输入 /goal resume 明确恢复。')}\n`);
  }

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
      await platform.mcpReady;
      const capabilityHealthNotice = buildCapabilityHealthNotice(platform.health);
      if (capabilityHealthNotice) {
        process.stderr.write(`${capabilityHealthNotice}\n`);
      }
      await refreshSkills();
      await refreshIntentLedger();
      await prepareIntentReminderForInput(initialInput);

      // Stage executor debug output (when --skill-debug is enabled)
      if (skillDebugEnabled) {
        const stageOutput = await runStageAnalysis(initialInput);
        process.stdout.write(formatDebugOutput(stageOutput) + '\n\n');
      }

      await primeTurnIntentPlan();
      await maybePrepareFreshContextHandoff();
      const turnTimeoutMs = resolveTurnTimeoutMs();
      const turnWatchdog = createTurnActivityWatchdog(turnTimeoutMs);
      try {
        await runRuntimeTurn({
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
            if (chunk.name === 'AskUserQuestion' || chunk.name === 'ask_user') {
              askUserCalls += 1;
            }
          }
          if (chunk.type === 'usage') {
            statusBar.update(chunk.usage);
          }
        }, turnWatchdog.signal, () => turnWatchdog.noteActivity());
      } catch (turnError) {
        if (turnWatchdog.didTimeout()) {
          const partialText = printChunks.join('');
          process.stderr.write(`xiaok: turn made no progress for ${turnTimeoutMs}ms (set XIAOK_TURN_TIMEOUT_MS=0 to disable)\n`);
          if (opts.print || opts.json) {
            process.stdout.write(formatPrintOutput({
              sessionId,
              text: partialText,
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
          await flushStandardStreams();
          clearTurnIntentContext();
          await releaseSessionOwnershipForExit();
          await cleanupRuntimeResourcesWithTimeout();
          process.exit(124);
        }
        throw turnError;
      } finally {
        turnWatchdog.dispose();
      }
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
      await cleanupRuntimeResourcesWithTimeout();
    }
    if (!opts.print && !opts.json) {
      process.stdout.write('\n');
    }
    await flushStandardStreams();
    process.exit(0);
    return;
  }

  // 交互模式 - 显示欢迎界面
  const getActiveProviderLabel = (): string => {
    const providerId = config.defaultProvider;
    const profile = getProviderProfile(providerId);
    return (profile?.label ?? providerId).toLowerCase();
  };
  // 首次使用引导：没有任何可用 provider key 时，在欢迎页下方提示 xiaok login
  const hasAnyProviderKey = listProviderProfiles().some(
    (profile) => resolveProviderApiKey(config, profile.id) !== '',
  );
  inputReader.setTranscriptLogger(transcriptLogger);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const isBrokenPipeError = (error: unknown): boolean => (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'EPIPE'
  );
  const activateStdoutFallback = (error: unknown): boolean => {
    if (!isBrokenPipeError(error)) {
      return false;
    }
    stdoutFallbackToStderr = true;
    terminalUiFallbackStream = 'stderr';
    return true;
  };
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
      const writer = stdoutFallbackToStderr ? originalStderrWrite : originalStdoutWrite;
      return writer(chunk, ...args);
    } catch (error) {
      if (activateStdoutFallback(error)) {
        try {
          return originalStderrWrite(chunk, ...args);
        } catch {
          return true;
        }
      }
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

    // First-run guidance: no provider key at all -> point at `xiaok login`
    if (!hasAnyProviderKey) {
      const loginHint = `${boldCyan('🔑')} ${dim('尚未配置任何 AI provider 的 API key，运行')} ${boldCyan('xiaok login')} ${dim('完成配置')}`;
      if (scrollRegion.isActive()) {
        scrollRegion.writeAtContentCursor(`  ${loginHint}\n`);
      } else {
        process.stdout.write(`  ${loginHint}\n`);
      }
    }

    // Async update check — show hint below welcome if newer version exists
    checkForUpdate(cliVersion).then((result) => {
      if (result?.hasUpdate && !terminalUiSuspended) {
        const hint = `${boldCyan('⬆')} ${dim(`有新版本可用: ${result.latest} (当前 ${result.current})，运行`)} ${boldCyan('npm i -g xiaokcode')} ${dim('更新')}`;
        if (scrollRegion.isActive()) {
          scrollRegion.writeAtContentCursor(`  ${hint}\n`);
        } else {
          process.stdout.write(`  ${hint}\n`);
        }
      }
    }).catch(() => {});

    // 设置初始 usage
    statusBar.update({ inputTokens: 0, outputTokens: 0 });

    if (opts.dryRun) process.stdout.write(`${dim('[dry-run 模式] 工具调用不会实际执行')}\n\n`);

    // 打印历史消息（session resume）- 在欢迎页之后
    const recordHistoryBlockInBuffer = (role: 'user' | 'assistant', block: MessageBlock): void => {
      if (block.type === 'text') {
        if (!block.text || block.text.startsWith('<system-reminder>')) return;
        transcriptBuffer.record({ kind: role, text: block.text });
        return;
      }
      if (block.type === 'thinking') {
        transcriptBuffer.record({ kind: 'thinking', text: block.thinking });
        return;
      }
      if (block.type === 'tool_use') {
        transcriptBuffer.record({
          kind: 'tool_use',
          agentId: 'main',
          name: block.name,
          summary: JSON.stringify(block.input),
        });
        return;
      }
      if (block.type === 'tool_result') {
        transcriptBuffer.record({
          kind: 'tool_result',
          agentId: 'main',
          name: block.tool_use_id,
          content: block.content,
          isError: block.is_error === true,
        });
        return;
      }
      const dims = readImageDimensions(Buffer.from(block.source.data, 'base64'));
      transcriptBuffer.record({
        kind: 'image',
        mediaType: block.source.media_type,
        ...(dims ? { width: dims.width, height: dims.height } : {}),
      });
    };

    if (historyMessages.length > 0) {
      const historyColumns = process.stdout.columns ?? 80;
      let replayedRows = 0;
      const writeHistoryChunk = (chunk: string): void => {
        if (!chunk) return;
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
            recordHistoryBlockInBuffer('user', block);
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
            recordHistoryBlockInBuffer('assistant', block);
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
      if (!scrollRegion.isActive()) {
        scrollRegion.advanceContentCursor(replayedRows);
      }
    }

    const dismissWelcomeScreen = (): void => {
      if (!welcomeVisible || !scrollRegion.isActive()) return;
      // Keep the welcome card in the scroll region as a visual separator from
      // terminal scrollback. Submitted input will append below and scroll it
      // away naturally as the conversation grows.
      welcomeVisible = false;
    };

    const writeCommandOutput = (commandText: string, output: string): void => {
      transcriptBuffer.record({ kind: 'command_output', command: commandText, output });
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

    const renderSubmittedImageBlocks = (blocks: MessageBlock[]): void => {
      const images = blocks.filter((block): block is Extract<MessageBlock, { type: 'image' }> => block.type === 'image');
      if (images.length === 0) return;

      const protocol = detectImageProtocol();
      for (const block of images) {
        const data = Buffer.from(block.source.data, 'base64');
        const dims = readImageDimensions(data);
        transcriptBuffer.record({
          kind: 'image',
          mediaType: block.source.media_type,
          ...(dims ? { width: dims.width, height: dims.height } : {}),
        });

        if (terminalUiSuspended) continue;

        const rendered = renderImageLines({
          data,
          mediaType: block.source.media_type,
          protocol,
          columns: process.stdout.columns ?? 80,
          imageId: nextInlineImageId++,
        });
        const placeholder = formatImageFallbackLine(dims);

        try {
          if (rendered.protocol === null) {
            const line = `${rendered.lines[0]}\n`;
            if (scrollRegion.isActive()) {
              scrollRegion.writeAtContentCursor(line);
            } else {
              process.stdout.write(line);
            }
            continue;
          }
          scrollRegion.writeRawBlock(`${rendered.lines.join('\n')}\n`, rendered.rows, {
            logger: transcriptLogger,
            placeholder,
          });
        } catch (error) {
          suspendInteractiveUi('render_inline_image', error);
        }
      }
    };

    const formatShellCommandResult = (result: ShellCommandResult): string => {
      if (result.error) {
        return '\n[xiaok] 本地命令启动失败：' + result.error + '\n';
      }
      if (result.signal) {
        return '\n[xiaok] 本地命令被信号中止：' + result.signal + '\n';
      }
      if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
        return '\n[xiaok] 本地命令退出：exit ' + result.exitCode + '\n';
      }
      return '\n[xiaok] 本地命令已完成。\n';
    };

    const restoreTerminalAfterShellCommand = (): void => {
      if (terminalUiSuspended) {
        return;
      }
      try {
        runtimeState.markInputReady();
        scrollRegion.resumeAfterExternalCommand({
          inputPrompt: getFooterInputPrompt(),
          summaryLine: getCurrentIntentSummaryLine(),
          statusLine: statusBar.getStatusLine(),
        });
        replRenderer.prepareForInput();
      } catch (error) {
        suspendInteractiveUi('restore_shell_escape_footer', error);
      }
    };

    const lookupPagerBinary = (name: string): string | null => {
      if (!name) {
        return null;
      }
      if (name.includes('/') || name.includes('\\')) {
        return existsSync(name) ? name : null;
      }
      const searchPath = process.env.PATH ?? '';
      for (const dir of searchPath.split(delimiter)) {
        if (!dir) {
          continue;
        }
        const candidate = join(dir, name);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
      return null;
    };

    const getTranscriptPagerStatus = (): TranscriptPagerStatus => {
      const snapshot = runtimeState.getSnapshot();
      switch (snapshot.turnSurfaceState) {
        case 'streaming_content':
        case 'compat_streaming':
          return 'streaming';
        case 'tool_interrupt':
        case 'waiting_feedback':
          return 'permission';
        case 'busy_finishing':
          return 'busy';
        default:
          return 'idle';
      }
    };

    inputReader.setToggleTranscriptHandler(async () => {
      await openTranscriptPager({
        buffer: transcriptBuffer,
        host: {
          getStatus: getTranscriptPagerStatus,
          getPager: () => process.env.PAGER,
          getPlatform: () => process.platform,
          lookupBinary: lookupPagerBinary,
          suspendInput: () => inputReader.suspendForExternalProcess(),
          endScrollRegion: () => {
            scrollRegion.end();
          },
          resumeScrollRegion: restoreTerminalAfterShellCommand,
          spawnPager: spawnPagerProcess,
          writeStdout: (chunk) => {
            process.stdout.write(chunk);
          },
          logDebug: (message) => log.debug('transcript_pager', message),
        },
      });
    });

    const replayShellCommandOutput = (output: string): void => {
      if (!output) {
        return;
      }
      if (terminalUiSuspended || !scrollRegion.isActive()) {
        process.stdout.write(output);
        return;
      }
      try {
        scrollRegion.writeAtContentCursor(output);
        replRenderer.prepareForInput();
      } catch (error) {
        suspendInteractiveUi('replay_shell_escape_output', error);
      }
    };

    const runLocalShellEscape = async (command: string, commandText: string): Promise<void> => {
      dismissWelcomeScreen();
      stopBusyCapture();
      stopActivity();
      runtimeState.markInputReady();

      try {
        if (scrollRegion.isActive()) {
          scrollRegion.clearLastInput({ renderFooter: false, inputPrompt: getFooterInputPrompt() });
          scrollRegion.writeSubmittedInput(formatSubmittedInput(commandText));
          scrollRegion.end();
        } else {
          process.stdout.write(formatSubmittedInput(commandText));
        }
      } catch (error) {
        suspendInteractiveUi('release_shell_escape_terminal', error);
      }

      try {
        if (process.stdin.isTTY) {
          const ttyStdin = process.stdin as typeof process.stdin & { setRawMode?: (value: boolean) => void };
          ttyStdin.setRawMode?.(false);
        }
      } catch {}

      const executor = shellEscapeExecutorForTests
        ?? ((input: { command: string; cwd: string }) => runInteractiveShellCommand(input.command, { cwd: input.cwd }));
      const result = await executor({ command, cwd });
      const replayOutput = (result.output ?? '') + formatShellCommandResult(result);
      restoreTerminalAfterShellCommand();
      replayShellCommandOutput(replayOutput);
    };

    setStreamErrorHandler((error, stream) => {
      log.error('stream_error', JSON.stringify({ stream: stream?.constructor?.name, error: String(error) }));
      if (stream !== process.stdout && stream !== process.stderr) {
        return false;
      }
      if (stream === process.stdout && activateStdoutFallback(error)) {
        return true;
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

  let deferredInput: string | null = null;
  let deferredInputKind: 'user' | 'broker' | 'goal' = 'user';
  let pendingQueuedInput: string | null = null;
  let normalTurnChromePrimed = false;
  let turnHadAskUserQuestion = false;

  stopBusyCapture = (): void => {
    activeBusyCapture?.stop();
    activeBusyCapture = null;
  };

  const stashQueuedInputIfAny = (options?: { stopCapture?: boolean }): void => {
    const queuedInput = activeBusyCapture?.consumeQueued() ?? null;
    if (options?.stopCapture !== false) {
      stopBusyCapture();
    }
    if (queuedInput !== null && queuedInput.trim().length > 0) {
      pendingQueuedInput = queuedInput;
    }
  };

  const beginNormalInputTurnChrome = (submittedInput: string): void => {
    turnHadAskUserQuestion = false;
    runtimeState.beginTurn('Thinking', { deferActivity: true });
    ensureBusyInputCapture();

    if (submittedInput.length > 0) {
      transcriptBuffer.record({ kind: 'user', text: submittedInput });
    }

    if (!terminalUiSuspended) {
      scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() });
    }

    if (submittedInput.length > 0 && scrollRegion.isActive() && !terminalUiSuspended) {
      scrollRegion.writeSubmittedInput(formatSubmittedInput(submittedInput));
    }
    beginActivity('Thinking', true);
  };

  runtimeHooks.on('turn_started', (e) => {
    log.debug('turn_started', JSON.stringify({ turnId: e?.turnId }));
    activeRuntimeTurnId = e.turnId;
    currentOuterTurnId ??= e.turnId;
    if (
      goalTurnAdmissionEnabled
      && isGoalArmed()
      && currentGoalState?.status === 'active'
    ) {
      goalTurnDrafts.set(e.turnId, {
        turnId: e.turnId,
        goalId: currentGoalState.goalId,
        epoch: currentGoalState.epoch,
        startedAt: Date.now(),
        usageTokens: null,
        collector: new GoalEvidenceCollector({
          goalId: currentGoalState.goalId,
          epoch: currentGoalState.epoch,
          goalTurnId: e.turnId,
        }),
      });
    }
    carryPreparedIntentContextToRuntimeTurn(e.turnId);
    toolExplorer.reset();
    turnLayout.reset();
    resetStreamingSegment();
    turnVisibleAssistantTextSeen = false;
    turnThinkingOnlyToolNoticeWritten = false;
    if (thinkingOnlyToolNoticeTimer) {
      clearTimeout(thinkingOnlyToolNoticeTimer);
      thinkingOnlyToolNoticeTimer = null;
    }
    if (!normalTurnChromePrimed) {
      beginNormalInputTurnChrome('');
    }
  });

  runtimeHooks.on('tool_started', (e) => {
    log.debug('tool_started', JSON.stringify({ tool: (e as any)?.toolName }));
    const transcriptSummary = summarizeToolInputForTranscript(e.toolInput);
    transcriptBuffer.record({
      kind: 'tool_use',
      // This hook is emitted only by the main runtime facade. Subagent tool
      // observations use onToolObserved and retain their own agentId there.
      agentId: 'main',
      name: e.toolName,
      summary: transcriptSummary,
    });
    endStreamingPhaseForInterrupt();
    if (e.toolName === 'AskUserQuestion' || e.toolName === 'ask_user') {
      turnHadAskUserQuestion = true;
      enterAskUserQuestionPrompt();
      maybeAdvanceCurrentTurnStageForTool(e.turnId, e.toolName, e.toolInput);
      return;
    }
    runtimeState.enterToolInterrupt();
    beginActivity(describeLiveActivity(e.toolName, e.toolInput));
    maybeAdvanceCurrentTurnStageForTool(e.turnId, e.toolName, e.toolInput);
    maybeWriteThinkingOnlyToolNotice();
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
      mdRenderer.beginNewSegment();
      resetStreamingSegment();
      beginActivity(describeLiveActivity(e.toolName, e.toolInput), true);
      renderIntentSummaryLine();
    }
  });

  runtimeHooks.on('tool_finished', (_e) => {
    log.debug('tool_finished', JSON.stringify({ tool: (_e as any)?.toolName, ok: (_e as any)?.ok }));
    goalTurnDrafts.get(_e.turnId)?.collector.accept(_e);
    scheduleActivityResume('Thinking', 160);
  });

  runtimeHooks.on('tool_execution_fact', (event) => {
    goalTurnDrafts.get(event.turnId)?.collector.accept(event);
  });

  runtimeHooks.on('intent_created', async (event) => {
    await refreshIntentLedger();
    writeOrchestrationBlock(formatIntentCreatedTranscriptBlock(currentIntentLedger, event.intentId));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('stage_activated', async (event) => {
    await refreshIntentLedger();
    intentTurnState.noteStageActivated(event.turnId, event.order);
    writeOrchestrationBlock(formatStageActivatedTranscriptBlock({
      order: event.order,
      totalStages: event.totalStages,
      label: event.label,
    }));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('step_activated', async (event) => {
    await refreshIntentLedger();
    intentTurnState.noteStepRunning(event.turnId);
    writeOrchestrationBlock(formatProgressTranscriptBlock({
      stepId: event.stepId,
      status: 'running',
      message: `Active step moved to ${event.stepId.split(':step:')[1] ?? event.stepId}`,
    }));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('breadcrumb_emitted', async (event) => {
    await refreshIntentLedger();
    intentTurnState.noteBreadcrumbStatus(event.turnId, event.status);
    writeOrchestrationBlock(formatProgressTranscriptBlock({
      stepId: event.stepId,
      status: event.status,
      message: event.message,
    }));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('receipt_emitted', async (event) => {
    await refreshIntentLedger();
    intentTurnState.setStageCompleted(event.turnId, intentTurnState.getSnapshot().currentTurnIntentPlan?.stages.length ?? 1);
    writeOrchestrationBlock(formatReceiptTranscriptBlock(event.note));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('salvage_emitted', async (event) => {
    await refreshIntentLedger();
    writeOrchestrationBlock(formatSalvageTranscriptBlock(event.summary, event.reason));
    renderIntentSummaryLine();
  });

  runtimeHooks.on('turn_completed', (event) => {
    activeRuntimeTurnId = null;
    const goalDraft = goalTurnDrafts.get(event.turnId);
    if (goalDraft) {
      goalDraft.outcome = 'completed';
      goalDraft.collector.settleTurn();
      goalTurnDrafts.delete(event.turnId);
      settledGoalTurns.push(goalDraft);
    }
    stashQueuedInputIfAny({ stopCapture: turnHadAskUserQuestion });
    turnHadAskUserQuestion = false;
    toolExplorer.reset();
    const turnPlan = intentTurnState.getSnapshot().currentTurnIntentPlan;
    if (turnPlan?.stages.length) {
      intentTurnState.setStageCompleted(event.turnId, turnPlan.stages.length);
      const completedSummaryLine = getCurrentTurnSummaryLine();
      intentTurnState.captureCompletedSummary(event.turnId, completedSummaryLine);
      const stageSummaryBlock = getCurrentTurnStageSummaryBlock();
      if (stageSummaryBlock) {
        if (scrollRegion.isActive() && scrollRegion.isContentStreaming() && !terminalUiSuspended) {
          flushStreamingMarkdown();
          scrollRegion.endContentStreaming({
            inputPrompt: getFooterInputPrompt(),
            summaryLine: '',
            statusLine: statusBar.getStatusLine(),
          });
          mdRenderer.beginNewSegment();
          resetStreamingSegment();
        }
        if (scrollRegion.isActive() && !terminalUiSuspended) {
          scrollRegion.renderFooter({
            inputPrompt: getFooterInputPrompt(),
            summaryLine: '',
            statusLine: statusBar.getStatusLine(),
          });
        }
        writeOrchestrationBlock(stageSummaryBlock);
      }
    }
    runtimeState.markBusyFinishing();
    stopActivity();
    void refreshIntentLedger().then(renderIntentSummaryLine);
  });

  runtimeHooks.on('turn_failed', (event) => {
    activeRuntimeTurnId = null;
    const goalDraft = goalTurnDrafts.get(event.turnId);
    if (goalDraft) {
      goalDraft.outcome = 'failed';
      goalDraft.collector.settleTurn();
      goalTurnDrafts.delete(event.turnId);
      settledGoalTurns.push(goalDraft);
    }
    turnHadAskUserQuestion = false;
    intentTurnState.clearTurnContext(event.turnId);
    currentTurnStageObservedSkillNames = new Map<number, Set<string>>();
    // Flush before resetTurnChrome(), which discards the renderer buffer.
    endStreamingPhaseForInterrupt();
    runtimeState.markInputReady();
    resetTurnChrome();
    void refreshIntentLedger().then(renderIntentSummaryLine);
  });

  runtimeHooks.on('turn_aborted', (event) => {
    activeRuntimeTurnId = null;
    const goalDraft = goalTurnDrafts.get(event.turnId);
    if (goalDraft) {
      goalDraft.outcome = 'aborted';
      goalDraft.collector.settleTurn();
      goalTurnDrafts.delete(event.turnId);
      settledGoalTurns.push(goalDraft);
    }
    turnHadAskUserQuestion = false;
    intentTurnState.clearTurnContext(event.turnId);
    currentTurnStageObservedSkillNames = new Map<number, Set<string>>();
    endStreamingPhaseForInterrupt();
    runtimeState.markInputReady();
    resetTurnChrome();
    void refreshIntentLedger().then(renderIntentSummaryLine);
  });

  runtimeHooks.on('turn_stop', (event) => {
    if (event.reason === 'user_aborted') {
      abortedRuntimeTurnIds.add(event.turnId);
    }
  });

  // Context 压缩通知
  runtimeHooks.on('compact_triggered', () => {
    log.info('compact_triggered');
    beginActivity('Compacting context');
    turnLayout.noteProgressNote();
    pauseActivity();
    writeProgressTranscriptNote('⚠ 上下文已压缩，保留最近对话');
  });

  runtimeHooks.on('compact_failed', (e) => {
    log.warn('compact_failed', { error: (e as any)?.error });
    writeProgressTranscriptNote(`⚠ 上下文压缩失败: ${(e as any)?.error ?? '未知错误'}`);
  });

  // 处理终端窗口大小调整
  handleResize = () => {
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
      stopBusyCapture();
      stopActivity();
      if (handleResize) {
        process.stdout.off('resize', handleResize);
      }
      skillCatalogWatcher?.close();
      clearTurnIntentContext();
      await releaseSessionOwnershipForExit();
      await lifecycleHooks.runHooks('SessionEnd', { reason: 'sigint' });
      await cleanupRuntimeResourcesWithTimeout();
      statusBar.destroy();
      process.stdout.write(`\n已退出。${dim(` 继续上次工作：xiaok -c  或  xiaok --resume ${sessionId}`)}\n`);
      process.exit(0);
    })();
  });

  const handleCompletedIntentFeedbackResult = async (
    result: CompletedIntentFeedbackResult,
  ): Promise<boolean> => {
    stashQueuedInputIfAny({ stopCapture: result.deferredInput !== null || result.exitRequested });
    if (result.deferredInput !== null) {
      if (scrollRegion.isActive()) {
        scrollRegion.clearOverlayPromptState();
      }
      runtimeState.markInputReady();
      renderFooterChrome();
      deferredInput = result.deferredInput;
      deferredInputKind = 'user';
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
      stashQueuedInputIfAny({ stopCapture: false });

      let input: string | null;
      let inputKind: 'user' | 'broker' | 'goal' = 'user';
      if (deferredInput !== null) {
        stopBusyCapture();
        input = deferredInput;
        inputKind = deferredInputKind;
        deferredInput = null;
        deferredInputKind = 'user';
      } else if (pendingQueuedInput !== null) {
        stopBusyCapture();
        input = pendingQueuedInput;
        pendingQueuedInput = null;
      } else {
        // 输入前的分隔线 — scroll region 激活后跳过，由 footer 处理
        if (!scrollRegion.isActive() && !terminalUiSuspended) {
          renderInputSeparator();
        }
        runtimeState.markInputReady();
        input = await inputReader.read('> ');
      }

    if (input === null || input.trim() === '/exit') {
      stopBusyCapture();
      clearTurnIntentContext();
      await releaseSessionOwnershipForExit();
      scrollRegion.end();
      statusBar.destroy();
      log.info('chat exited', { sessionId });
      process.stdout.write(`\n再见！${dim(` 继续上次工作：xiaok -c  或  xiaok --resume ${sessionId}`)}\n`);
      break;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    if (intentTurnState.getSnapshot().completedTurnIntentSummaryLine) {
      intentTurnState.clearCompletedSummary();
      renderFooterChrome();
    }

    const shellEscape = parseShellEscapeInput(trimmed);
    const shouldPrimeNormalTurnChrome = inputKind !== 'goal' && shellEscape === null && !trimmed.startsWith('/');
    let normalInputTurnChromeStarted = false;
    if (shouldPrimeNormalTurnChrome) {
      mdRenderer.reset();
      resetStreamingSegment();
      beginNormalInputTurnChrome(trimmed);
      normalInputTurnChromeStarted = true;
      normalTurnChromePrimed = true;
    }

    await refreshSkills();

    if (shellEscape?.kind === 'usage') {
      dismissWelcomeScreen();
      writeCommandOutput(trimmed, '用法：! <command>\n\n');
      continue;
    }
    if (shellEscape?.kind === 'command') {
      await runLocalShellEscape(shellEscape.command, trimmed);
      continue;
    }

    // 处理内置命令
    if (trimmed === '/clear') {
      // /clear clears the conversation context, not just the screen: the
      // agent session history, usage counters and the persisted snapshot for
      // this session are reset so the status bar context reflects reality.
      // Goal state and the transcript audit file are intentionally kept.
      agent.clearHistory();
      runtimeFacade?.resetSkillTracking();
      statusBar.update({ inputTokens: 0, outputTokens: 0 });
      await persistSession();
      scrollRegion.end();
      // Mirror the startup sequence exactly: begin() performs its own
      // \x1b[2J\x1b[H full clear, so the welcome screen MUST be rendered
      // AFTER begin() — rendering it before (with a manual clear) gets the
      // card immediately wiped by begin()'s own clear.
      scrollRegion.begin();
      contentRows = renderWelcomeScreen({
        model: getActiveProviderLabel(),
        cwd: process.cwd(),
        sessionId,
        mode: opts.auto ? 'auto' : opts.dryRun ? 'dry-run' : 'default',
        version: cliVersion,
      });
      scrollRegion.setWelcomeRows(contentRows);
      welcomeVisible = true;
      continue;
    }

    dismissWelcomeScreen();

    if (trimmed === '/help') {
      writeCommandOutput(trimmed, buildChatHelpText(skills));
      continue;
    }

    const goalCommand = parseGoalSlashCommand(trimmed);
    if (goalCommand) {
      if (goalCommand.kind === 'help') {
        writeCommandOutput(trimmed, `${GOAL_COMMAND_HELP}\n\n`);
        continue;
      }
      if (goalCommand.kind === 'invalid') {
        writeCommandOutput(trimmed, `${goalCommand.message}\n\n`);
        continue;
      }
      if (goalCommand.kind === 'status') {
        writeCommandOutput(trimmed, currentGoalState
          ? `${formatGoalStatus(currentGoalState)}\nActivation：${goalActivation}\n\n`
          : '当前会话没有 Goal。\n\n');
        continue;
      }

      try {
        if (goalCommand.kind === 'pause') {
          if (!currentGoalState) {
            writeCommandOutput(trimmed, '当前会话没有 Goal。\n\n');
            continue;
          }
          if (currentGoalState.status === 'paused') {
            disarmGoal();
            writeCommandOutput(trimmed, 'Goal 已处于 paused。\n\n');
            continue;
          }
          if (currentGoalState.status !== 'active') {
            writeCommandOutput(trimmed, `当前 Goal 状态为 ${currentGoalState.status}，不能 pause。\n\n`);
            continue;
          }
          if (!isGoalArmed()) armGoal(true);
          currentGoalState = await goalService.pause(goalMutationContext('user'), 'user_paused');
          disarmGoal();
          writeCommandOutput(trimmed, 'Goal 已暂停。\n\n');
          renderIntentSummaryLine();
          continue;
        }

        if (goalCommand.kind === 'resume') {
          if (!currentGoalState) {
            writeCommandOutput(trimmed, '当前会话没有 Goal。\n\n');
            continue;
          }
          if (currentGoalState.status === 'complete' || currentGoalState.status === 'cancelled') {
            writeCommandOutput(trimmed, `当前 Goal 已 ${currentGoalState.status}，请创建或 replace。\n\n`);
            continue;
          }
          if (!isGoalArmed()) armGoal(true);
          if (currentGoalState.status === 'paused' || currentGoalState.status === 'blocked') {
            currentGoalState = await goalService.resume(
              goalMutationContext('user'),
              { turnLimit: goalCommand.turnLimit },
            );
          }
          deferredInput = buildGoalContinuationInput(currentGoalState).prompt;
          deferredInputKind = 'goal';
          writeCommandOutput(trimmed, 'Goal 已恢复，将继续执行。\n\n');
          renderIntentSummaryLine();
          continue;
        }

        if (goalCommand.kind === 'cancel') {
          if (!currentGoalState) {
            writeCommandOutput(trimmed, '当前会话没有 Goal。\n\n');
            continue;
          }
          if (currentGoalState.status === 'complete' || currentGoalState.status === 'cancelled') {
            writeCommandOutput(trimmed, `当前 Goal 已 ${currentGoalState.status}。\n\n`);
            continue;
          }
          if (!isGoalArmed()) armGoal(true);
          currentGoalState = await goalService.cancel(goalMutationContext('user'), 'user_cancelled');
          disarmGoal();
          writeCommandOutput(trimmed, 'Goal 已取消。\n\n');
          renderIntentSummaryLine();
          continue;
        }

        const replacing = goalCommand.kind === 'replace';
        if (!replacing && currentGoalState && !['complete', 'cancelled'].includes(currentGoalState.status)) {
          writeCommandOutput(trimmed, '当前会话已有 Goal；请使用 /goal replace <objective>。\n\n');
          continue;
        }
        if (replacing && !currentGoalState) {
          writeCommandOutput(trimmed, '当前会话没有可替换的 Goal。\n\n');
          continue;
        }
        const goalInput = inferGoalInput(goalCommand.objective);
        writeCommandOutput(trimmed, `${formatGoalPreview(goalInput, replacing)}\n\n`);
        const confirmation = await inputReader.read('确认？输入 yes：');
        if (confirmation?.trim().toLowerCase() !== 'yes') {
          writeCommandOutput(trimmed, '已取消，Goal 未变更。\n\n');
          continue;
        }
        if (!isGoalArmed()) armGoal(replacing);
        currentGoalState = replacing
          ? await goalService.replace(goalMutationContext('user'), goalInput)
          : await goalService.create(goalMutationContext('user'), goalInput);
        pendingGoalCompleteSummary = null;
        pendingGoalBlockedClaim = null;
        deferredInput = currentGoalState.objective;
        deferredInputKind = 'user';
        writeCommandOutput(trimmed, replacing ? 'Goal 已替换并启动。\n\n' : 'Goal 已创建并启动。\n\n');
        renderIntentSummaryLine();
      } catch (error) {
        disarmGoal();
        writeCommandOutput(trimmed, `Goal 操作失败：${formatErrorText(String(error))}\n\n`);
      }
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

    if (trimmed === '/skill-debug' || trimmed.startsWith('/skill-debug ')) {
      const arg = trimmed.replace('/skill-debug', '').trim().toLowerCase();
      if (arg === 'on' || arg === '1' || arg === 'true') {
        skillDebugEnabled = true;
      } else if (arg === 'off' || arg === '0' || arg === 'false') {
        skillDebugEnabled = false;
      } else {
        skillDebugEnabled = !skillDebugEnabled;
      }
      writeCommandOutput(trimmed, `Skill debug mode: ${skillDebugEnabled ? 'ON' : 'OFF'}\n每次输入将显示 stage 分析（intent、context 检查、耗时预估）。\n\n`);
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

      permissionManager.setMode(requestedMode as 'default' | 'auto' | 'plan');
      statusBar.updateMode(requestedMode);
      writeCommandOutput(trimmed, `权限模式已切换为 ${requestedMode}\n\n`);
      continue;
    }

    if (trimmed === '/compact') {
      const compaction = agent.forceCompact();
      statusBar.update(agent.getUsage()); // 立即更新 statusline 显示
      if (compaction) {
        writeCommandOutput(
          trimmed,
          `${dim(`已压缩较早对话，保留最近上下文（折叠 ${compaction.replacedMessages} 条历史消息）。`)}\n\n`,
        );
      } else {
        writeCommandOutput(trimmed, `${dim('当前历史很短，暂时无需压缩。')}\n\n`);
      }
      continue;
    }

    if (trimmed === '/models') {
      if (scrollRegion.isActive() && !terminalUiSuspended) {
        scrollRegion.clearOverlayPromptState();
        replRenderer.prepareForInput();
      }
      const selected = await selectModel(config, { renderer: replRenderer });
      if (selected) {
        // 如果选的是 provider 目录里的模型（尚未在 config.models 中），自动注册
        const providerProfile = getProviderProfile(selected.provider);
        const variant = providerProfile?.availableModels?.find(v => v.modelId === selected.modelId);
        const selectedProvider = config.providers[selected.provider];
        const catalogRuntimeEligible = selected.provider !== 'kimi'
          || variant?.model !== 'k3'
          || (
            selectedProvider?.protocol === 'openai_legacy'
            && isOfficialKimiK3OpenAIEndpoint(selectedProvider.baseUrl)
          );
        const variantRuntimeOptions = variant && selectedProvider && catalogRuntimeEligible
          ? resolveModelRuntimeOptions({
              protocol: selectedProvider.protocol,
              baseUrl: selectedProvider.baseUrl,
              wireModel: variant.model,
              catalogOptions: variant.runtimeOptions,
              catalogConstraints: variant.runtimeConstraints,
            }).runtimeOptions
          : undefined;
        const nextModels = config.models[selected.modelId]
          ? config.models
          : {
              ...config.models,
              [selected.modelId]: {
                provider: selected.provider,
                model: variant?.model ?? selected.model,
                label: variant?.label ?? selected.label,
                capabilities: variant?.capabilities,
                runtimeOptions: variantRuntimeOptions ? { ...variantRuntimeOptions } : undefined,
              },
            };
        const newConfig = {
          ...config,
          models: nextModels,
          defaultProvider: selected.provider,
          defaultModelId: selected.modelId,
        };
        try {
          const nextAdapter = createAdapter(newConfig);
          const currentProfile = resolveRegisteredStrictKimiK3Profile(adapter);
          const nextProfile = resolveRegisteredStrictKimiK3Profile(nextAdapter);
          assertKimiK3SessionModelSwitchSupported(
            currentProfile,
            nextProfile,
            agent.exportSession().messages.length,
          );
          const nextModelCapabilities = resolveModelCapabilities(nextAdapter);
          await saveConfig(newConfig);
          adapter = nextAdapter;
          modelCapabilities = nextModelCapabilities;
          config = newConfig;
          intentBoundaryResolver = createConfiguredIntentBoundaryResolver();
          agent.setAdapter(adapter);
          memoryStore.setLLMFn?.(createLLMFromAdapter(adapter));
          statusBar.updateModel(adapter.getModelName(), modelCapabilities.contextLimit);
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
    if (!scrollRegion.isActive() && inputKind !== 'goal') {
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
          const invocation = activateTrackedSkillPlan(
            plan,
            plan.strategy === 'fork' && primaryStep?.agent ? primaryStep.agent : 'main',
          );
          const activeTurnToken = intentTurnState.getSnapshot().activeTurnToken;
          if (activeTurnToken) {
            intentTurnState.setActiveIntentReminderBlock(activeTurnToken, undefined);
          }

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
                taskId: sessionId,
                session: agent.exportSession(),
                messages: agent.exportSession().messages,
                systemPrompt: await buildPrompt(skills),
                toolDefinitions: registry.getToolDefinitions(),
              },
            });
            if (invocation.strictMode) {
              result = await maybeRunStrictCompletionLoop(result);
            }
            {
              // Not a streaming phase: render to lines and land them at the
              // content cursor instead of feeding the streaming renderer,
              // whose buffer would stay invisible until an unrelated flush.
              const block = `${MarkdownRenderer.renderToLines(result).join('\n')}\n`;
              if (scrollRegion.isActive() && !terminalUiSuspended) {
                scrollRegion.writeAtContentCursor(block);
              } else {
                process.stdout.write(block);
              }
            }
          } else {
            const userMsg = slash.rest
              ? `执行 skill plan "${plan.primarySkill}"，用户补充说明：${slash.rest}\n\n${JSON.stringify(plan, null, 2)}`
              : `执行 skill plan：\n\n${JSON.stringify(plan, null, 2)}`;
            let slashAssistantText = '';

            clearTurnIntentContext();
            if (!terminalUiSuspended) {
              scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() });
            }

            await maybePrepareFreshContextHandoff();
            await runRuntimeTurn({
              sessionId,
              cwd,
              source: 'chat',
              input: userMsg,
            }, (chunk) => {
              if (chunk.type === 'text') {
                handleAssistantTextChunk(chunk.delta, (delta) => {
                  slashAssistantText += delta;
                });
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
          }

          if (!scrollRegion.isActive()) {
            process.stdout.write('\n');
          }
        } catch (e) {
          if (isAbortError(e)) {
            handleTurnAbort();
          } else {
            stashQueuedInputIfAny();
            handleTurnFailure(e);
          }
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
    resetStreamingSegment();
    try {
      if (!normalInputTurnChromeStarted) {
        beginNormalInputTurnChrome(inputKind === 'goal' ? '' : trimmed);
        normalTurnChromePrimed = true;
      }

      // UserPromptSubmit hook — broker 可在此注入额外上下文
      const promptHookResult = inputKind === 'goal'
        ? { additionalContext: undefined }
        : await lifecycleHooks.runHooks('UserPromptSubmit', { prompt: trimmed });
      let effectiveInput = trimmed;
      if (promptHookResult.additionalContext) {
        effectiveInput = `${promptHookResult.additionalContext}\n\n${trimmed}`;
      }

      const inputBlocks = await parseInputBlocks(
        effectiveInput,
        resolveModelCapabilities(adapter).supportsImageInput,
      );
      renderSubmittedImageBlocks(inputBlocks);
      clearPastedImagePaths();
      await refreshIntentLedger();
      await prepareIntentReminderForInput(trimmed);

      // Stage executor debug output (when --skill-debug is enabled)
      if (skillDebugEnabled) {
        const stageOutput = await runStageAnalysis(trimmed);
        const debugText = formatDebugOutput(stageOutput);
        if (scrollRegion.isActive() && !terminalUiSuspended) {
          scrollRegion.writeAtContentCursor(debugText + '\n');
        } else {
          process.stdout.write(debugText + '\n');
        }
      }

      let lastAssistantText = '';
      currentOuterTurnId = null;
      await primeTurnIntentPlan(true);

      await maybePrepareFreshContextHandoff();
      goalTurnAdmissionEnabled = isGoalArmed();
      const turnResult = await runInteractiveRuntimeTurn(
        runRuntimeTurn,
        createInteractiveRuntimeTurnRequest(inputBlocks),
        createInteractiveTurnChunkHandlers((delta) => {
          lastAssistantText += delta;
        }),
      );
      lastAssistantText = turnResult.assistantText;
      flushStreamingMarkdown();
      lastAssistantText = await maybeRunStrictCompletionLoop(lastAssistantText);
      goalTurnAdmissionEnabled = false;
      if (lastAssistantText.trim().length > 0) {
        transcriptBuffer.record({ kind: 'assistant', text: lastAssistantText });
      }
      await finalizeCurrentTurnIntentIfNeeded();
      await persistSession();
      await finalizeSettledGoalTurns(lastAssistantText);
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
      if (!scrollRegion.isActive()) {
        process.stdout.write('\n');
      }

      // Busy 时到达的用户输入先于所有自动续轮；旧 broker candidate 不缓存，
      // 用户 turn settled 后由 Stop hook 从最新状态重新计算。
      stashQueuedInputIfAny({ stopCapture: false });
      if (pendingQueuedInput !== null) {
        continue interactiveLoop;
      }

      let brokerContinuation: string | null = null;
      const outerTurnWasAborted = currentOuterTurnId !== null
        && abortedRuntimeTurnIds.has(currentOuterTurnId);
      if (!outerTurnWasAborted) {
        try {
          const stopResult = await lifecycleHooks.runHooks('Stop', {
            stopHookActive: true,
            lastAssistantMessage: lastAssistantText,
          });
          brokerContinuation = stopResult.preventContinuation && stopResult.message
            ? stopResult.message
            : null;
        } catch (stopError) {
          await lifecycleHooks.runHooks('StopFailure', {
            error: stopError instanceof Error ? stopError.message : String(stopError),
            lastAssistantMessage: lastAssistantText,
          });
        }
      }

      const goalContinuation = (
        !outerTurnWasAborted
        && isGoalArmed()
        && currentGoalState?.status === 'active'
      ) ? buildGoalContinuationInput(currentGoalState).prompt : null;
      const continuation = continuationArbiter.select({
        queuedUserInput: pendingQueuedInput,
        brokerContinuation,
        goalContinuation,
      });
      if (continuation) {
        deferredInput = continuation.input;
        deferredInputKind = continuation.kind;
        continue interactiveLoop;
      }

    } catch (e) {
      goalTurnAdmissionEnabled = false;
      await finalizeSettledGoalTurns('');
      if (isGoalArmed() && currentGoalState?.status === 'active') {
        await pauseCurrentGoalForInterruption(
          isAbortError(e) ? 'user_aborted' : 'runtime_error',
          isAbortError(e) ? 'user' : 'runtime',
        );
      }
      clearTurnIntentContext();
      if (isAbortError(e)) {
        handleTurnAbort();
      } else {
        stashQueuedInputIfAny();
        handleTurnFailure(e);
      }
    }
    runtimeState.deactivateTurn();
    stopActivity();
    if (deferredInput === null && scrollRegion.isActive()) {
      scrollRegion.clearActivityState();
      renderFooterChrome();
    }
    normalTurnChromePrimed = false;
    // Live activity is stopped when content streaming starts, so do not clear
    // the activity row again here; that row may now contain assistant text.
    }
  } finally {
    disarmGoal();
    stopBusyCapture();
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
    } catch {}
    try {
      scrollRegion.end();
    } catch (e) { log.warn('scrollRegion.end failed in post-loop cleanup', (e as Error).message) }
    setStreamErrorHandler(null);
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    stopIntentRuntimeSync();
    stopSkillEvalRuntimeSync();
    skillCatalogWatcher?.close();
    await lifecycleHooks.runHooks('SessionEnd', { reason: 'exit' });
    await cleanupRuntimeResourcesWithTimeout();
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
    .description('启动 AI skill 任务交付工作台（默认命令）')
    .option('--auto', '自动批准低风险工具调用，高风险命令仍需确认或被阻断')
    .option('--dry-run', '打印工具调用但不执行')
    .option('-p, --print', '以纯文本模式输出单次结果')
    .option('--json', '以 JSON 模式输出单次结果')
    .option('--resume <id>', '恢复已保存会话')
    .option('--takeover <id>', '显式接管仍被其他实例持有的会话')
    .option('--confirm-high-risk-takeover', '确认接管处于高风险步骤的会话')
    .option('-c, --continue', '恢复上一次会话')
    .option('--fork-session <id>', '从已有会话分叉一个新会话')
    .option('--skill-debug', '显示 skill 执行详情（stage、context 检查、耗时）')
    .argument('[input]', '单次任务描述（省略则进入交互模式）')
    .action(async (input: string | undefined, opts: ChatOptions) => {
      setCrashContext({ command: 'chat', args: process.argv.slice(2), cwd: process.cwd() });
      try {
        await runChat(input, opts);
      } catch (error) {
        if (error instanceof KimiK3DurableResumeUnsupportedError) {
          writeError(error.code);
          process.exit(1);
        }
        const { reportCrash } = await import('../utils/crash-reporter.js');
        const path = await reportCrash(error);
        writeError(`运行中断，崩溃报告已保存: ${path}`);
        process.exit(1);
      }
    });
}
export function summarizeToolInputForTranscript(input: unknown): string {
  try {
    return JSON.stringify(input) ?? String(input);
  } catch {
    return String(input);
  }
}
