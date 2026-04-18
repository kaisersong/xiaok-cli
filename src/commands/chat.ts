import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { ModelAdapter, MessageBlock } from '../types.js';
import { loadConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { PermissionManager } from '../ai/permissions/manager.js';
import { ToolRegistry } from '../ai/tools/index.js';
import { createAskUserTool } from '../ai/tools/ask-user.js';
import { createAskUserQuestionTool } from '../ai/tools/ask-user-question.js';
import { createTaskTools } from '../ai/tools/tasks.js';
import { Agent } from '../ai/agent.js';
import { PromptBuilder } from '../ai/prompts/builder.js';
import { createRuntimeHooks } from '../runtime/hooks.js';
import { createHooksRunner } from '../runtime/hooks-runner.js';
import { SessionTaskBoard } from '../runtime/tasking/board.js';
import { writeError, isTTY } from '../utils/ui.js';
import { showPermissionPrompt } from '../ui/permission-prompt.js';
import { addAllowRule } from '../ai/permissions/settings.js';
import { loadSettings, mergeRules } from '../ai/permissions/settings.js';
import { createSkillCatalog, parseSlashCommand, formatSkillsContext, toSkillEntries } from '../ai/skills/loader.js';
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
import { InputReader } from '../ui/input.js';
import { ReplRenderer } from '../ui/repl-renderer.js';
import { ToolExplorer } from '../ui/tool-explorer.js';
import { TurnLayout } from '../ui/turn-layout.js';
import { parseInputBlocks, clearPastedImagePaths } from '../ui/image-input.js';
import { selectModel } from '../ui/model-selector.js';
import { getCurrentBranch } from '../utils/git.js';
import { runCommitCommand } from './commit.js';
import { runReviewCommand } from './review.js';
import { runPrCommand } from './pr.js';
import { runDoctorCommand } from './doctor.js';
import { runInitCommand } from './init.js';
import { createPlatformRuntimeContext } from '../platform/runtime/context.js';
import { createPlatformRegistryFactory } from '../platform/runtime/registry-factory.js';
import { FileTranscriptLogger } from '../ui/transcript.js';
import { createInstallSkillTool } from '../ai/tools/install-skill.js';
import { createUninstallSkillTool } from '../ai/tools/uninstall-skill.js';
import { executeNamedSubAgent } from '../ai/agents/subagent-executor.js';
import { RuntimeFacade } from '../ai/runtime/runtime-facade.js';
import { EmbeddedYZJChannel } from '../channels/embedded-yzj.js';
import { selectYZJChannel } from '../ui/channel-selector.js';
import { resolveYZJConfig } from '../channels/yzj.js';
import { YZJTransport } from '../channels/yzj-transport.js';
import { InMemoryApprovalStore } from '../channels/approval-store.js';

const { version: cliVersion } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

interface ChatOptions {
  auto: boolean;
  dryRun: boolean;
  print?: boolean;
  json?: boolean;
  resume?: string;
  forkSession?: string;
  continue?: boolean;
}

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

async function runChat(initialInput: string | undefined, opts: ChatOptions): Promise<void> {
  if ((opts.print || opts.json) && !initialInput) {
    writeError('print/json 模式需要提供单次输入');
    process.exit(1);
  }

  // 检测 CI 环境
  const autoMode = opts.auto || !isTTY();
  if (!isTTY() && !opts.auto) {
    console.warn('\x1b[33m[警告]\x1b[0m stdin 非 TTY，自动切换为 --auto 模式');
  }

  // 加载配置和凭据
  const config = await loadConfig();

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
  } else if (opts.forkSession) {
    persistedSession = await sessionStore.fork(opts.forkSession);
  }

  const sessionId = persistedSession?.sessionId ?? sessionStore.createSessionId();
  const sessionCreatedAt = persistedSession?.createdAt ?? Date.now();
  const forkedFromSessionId = persistedSession?.forkedFromSessionId;
  const sessionLineage = persistedSession?.lineage ?? [sessionId];
  const transcriptLogger = new FileTranscriptLogger(sessionId);

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
  const taskBoard = new SessionTaskBoard('cli');
  const promptBuilder = new PromptBuilder();
  let agent: Agent | undefined;
  let runtimeFacade: RuntimeFacade | undefined;

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

        process.stdout.write(`\n${dim('Agent question:')} ${question}\n`);
        const answer = await inputReader.read(placeholder ? `${placeholder}: ` : 'Answer: ');
        if (answer === null) {
          throw new Error('用户取消了问题输入');
        }
        return answer;
      },
    }),
    ...createTaskTools({ board: taskBoard, sessionId }),
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
        // 停止 live activity 定时器，避免权限确认时滚动输出
        stopLiveActivityTimer();
        const choice = await showPermissionPrompt(name, input, { transcriptLogger, renderer: replRenderer });
        if (choice.action === 'deny') return false;
        if (choice.action === 'allow_once') return true;
        if (choice.action === 'allow_session') { permissionManager.addSessionRule(choice.rule); return true; }
        if (choice.action === 'allow_project') { await addAllowRule('project', choice.rule, cwd); permissionManager.addSessionRule(choice.rule); return true; }
        if (choice.action === 'allow_global') { await addAllowRule('global', choice.rule, cwd); permissionManager.addSessionRule(choice.rule); return true; }
        return false;
      };
      if (embeddedChannels.length > 0) {
        return embeddedChannels[0]!.makeOnPrompt(tuiDecide)(name, input);
      }
      return tuiDecide();
    },
    onSandboxDenied: async (deniedPath: string, toolName: string) => {
      stopLiveActivityTimer();
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
        platform.sandboxPolicy.expandAllowedPaths([deniedPath]);
        permissionManager.addSessionRule(choice.rule);
        return { shouldProceed: true };
      }
      if (choice.action === 'allow_project') {
        platform.sandboxPolicy.expandAllowedPaths([deniedPath]);
        await addAllowRule('project', choice.rule, cwd);
        permissionManager.addSessionRule(choice.rule);
        return { shouldProceed: true };
      }
      if (choice.action === 'allow_global') {
        platform.sandboxPolicy.expandAllowedPaths([deniedPath]);
        await addAllowRule('global', choice.rule, cwd);
        permissionManager.addSessionRule(choice.rule);
        return { shouldProceed: true };
      }
      return { shouldProceed: false };
    },
    buildSystemPrompt: async (promptCwd) => buildPrompt(skills, promptCwd),
    notifyBackgroundJob: async (job) => {
      process.stdout.write(`\n[background] ${job.jobId} ${job.status}${job.resultSummary ? `: ${job.resultSummary}` : ''}\n`);
    },
  });
  const registry = registryFactory.createRegistry(cwd);

  // Top-level hooks runner for lifecycle events (SessionStart / UserPromptSubmit / Stop)
  const lifecycleHooks = createHooksRunner({
    hooks: pluginRuntime.hookConfigs,
    context: {
      session_id: sessionId,
      cwd,
      transcript_path: transcriptLogger.path,
    },
  });

  const runtimeHooks = createRuntimeHooks();
  agent = new Agent(adapter, registry, initialPromptSnapshot.rendered, { hooks: runtimeHooks });
  agent.getSessionState().attachPromptSnapshot(initialPromptSnapshot.id, initialPromptSnapshot.memoryRefs);
  agent.setPromptSnapshot(initialPromptSnapshot);
  runtimeFacade = new RuntimeFacade({
    promptBuilder,
    getPromptInput: async (promptCwd) => getPromptInput(promptCwd, skills),
    agent,
    getSkillEntries: () => toSkillEntries(skills),
  });

  if (persistedSession) {
    agent.restoreSession(persistedSession);
  }

  // 触发 SessionStart hook
  void lifecycleHooks.runHooks('SessionStart', {
    source: opts.continue ? 'resume' : opts.resume ? 'resume' : 'startup',
  });

  // 创建 UI 组件
  const mdRenderer = new MarkdownRenderer();
  const statusBar = new StatusBar();
  const scrollRegion = new ScrollRegionManager();
  replRenderer.setScrollRegion(scrollRegion);

  inputReader.setStatusLineProvider(() => {
    const line = statusBar.getStatusLine();
    return line ? [line] : [];
  });
  inputReader.setScrollPromptRenderer((frame) => {
    if (!scrollRegion.isActive()) return;
    scrollRegion.renderPromptFrame({
      inputValue: frame.inputValue,
      cursor: frame.cursor,
      placeholder: 'Type your message...',
      statusLine: frame.statusLine,
      overlayLines: frame.overlayLines,
    });
  });
  const flushStreamingMarkdown = (): void => {
    const flushedRows = mdRenderer.flush();
    if (flushedRows > 0 && scrollRegion.isActive() && scrollRegion.isContentStreaming()) {
      scrollRegion.advanceContentCursor(flushedRows);
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
    scrollRegion.renderActivity(line);
  };

  const beginActivity = (label: string, restart = false): void => {
    // Don't start new activity after the turn has ended —
    // a scheduled resumeActivityTimer may fire after stopActivity().
    if (!turnActive && liveActivityTimer) return;
    if (resumeActivityTimer) {
      clearTimeout(resumeActivityTimer);
      resumeActivityTimer = null;
    }

    if (restart || !liveActivityTimer) {
      statusBar.beginActivity(label, Date.now());
    } else {
      statusBar.updateActivity(label);
    }

    // Skip footer render when content is actively streaming —
    // renderFooter() moves cursor to input bar, which disrupts content position.
    if (!scrollRegion.isContentStreaming()) {
      scrollRegion.renderFooter({
        statusLine: statusBar.getStatusLine(),
      });
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
    if (liveActivityTimer) {
      clearInterval(liveActivityTimer);
      liveActivityTimer = null;
    }
    if (liveActivityVisible) {
      statusBar.clearLive();
      liveActivityVisible = false;
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

  const persistSession = async (): Promise<void> => {
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
    });
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
      await platform.dispose();
    }
    if (!opts.print && !opts.json) {
      process.stdout.write('\n');
    }
    return;
  }

  // 交互模式 - 显示欢迎界面
  const provider = config.defaultModel ?? 'claude';
  inputReader.setTranscriptLogger(transcriptLogger);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: any, ...args: any[]) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    transcriptLogger.recordOutput('stdout', text);
    return originalStdoutWrite(chunk, ...args);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: any, ...args: any[]) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    transcriptLogger.recordOutput('stderr', text);
    return originalStderrWrite(chunk, ...args);
  }) as typeof process.stderr.write;

  try {
    // 激活 scroll region（必须在欢迎屏幕之前）
    // 这样欢迎内容自然填充到 scroll region 内，footer 固定在底部
    scrollRegion.begin();

    // 显示欢迎界面
    contentRows = renderWelcomeScreen({
      model: provider,
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
      process.stdout.write('\n');
      for (const msg of historyMessages) {
        if (msg.role === 'user') {
          for (const block of msg.content) {
            if (block.type === 'text') {
              const text = block.text;
              // Skip system-reminder content
              if (text && !text.startsWith('<system-reminder>')) {
                process.stdout.write(formatHistoryBlock(block));
              }
            } else {
              process.stdout.write(formatHistoryBlock(block));
            }
          }
        } else if (msg.role === 'assistant') {
          mdRenderer.reset();
          for (const block of msg.content) {
            if (block.type === 'text') {
              mdRenderer.write(block.text);
              mdRenderer.flush();
              process.stdout.write('\n');
            } else {
              process.stdout.write(formatHistoryBlock(block));
            }
          }
        }
      }
      process.stdout.write('\n');
    }

    const dismissWelcomeScreen = (): void => {
      if (!welcomeVisible || !scrollRegion.isActive()) return;
      // Keep the welcome card in the scroll region as a visual separator from
      // terminal scrollback. Submitted input will append below and scroll it
      // away naturally as the conversation grows.
      welcomeVisible = false;
    };

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

  runtimeHooks.on('turn_completed', () => {
    toolExplorer.reset();
    stopActivity();
  });

  runtimeHooks.on('turn_failed', () => {
    resetTurnChrome();
  });

  runtimeHooks.on('turn_aborted', () => {
    resetTurnChrome();
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
      scrollRegion.updateSize(rows, cols);
      // 普通文档流模式下不做底部重绘，后续输出自然适配新尺寸
    }, 100);
  };
  process.stdout.on('resize', handleResize);

  // SIGINT 处理
  process.on('SIGINT', () => {
    stopActivity();
    void platform.dispose();
    for (const ch of embeddedChannels) {
      void ch.cleanup();
    }
    process.stdout.off('resize', handleResize);
    statusBar.destroy();
    process.stdout.write(`\n已退出。${dim(` 继续上次工作：xiaok -c  或  xiaok --resume ${sessionId}`)}\n`);
    process.exit(0);
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
        model: provider,
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
      process.stdout.write('\n可用命令：\n');
      process.stdout.write('  /exit    - 退出\n');
      process.stdout.write('  /clear   - 清屏\n');
      process.stdout.write('  /commit [message] - 提交已暂存改动\n');
      process.stdout.write('  /context - 查看当前加载的仓库上下文\n');
      process.stdout.write('  /doctor  - 检查本地 CLI 环境\n');
      process.stdout.write('  /init    - 初始化项目配置\n');
      process.stdout.write('  /review  - 查看当前 git 改动概览\n');
      process.stdout.write('  /pr      - 创建或预览 PR\n');
      process.stdout.write('  /models  - 切换模型\n');
      process.stdout.write('  /mode [default|auto|plan] - 查看或切换权限模式\n');
      process.stdout.write('  /settings - 查看当前生效配置\n');
      process.stdout.write('  /tasks   - 查看当前会话任务\n');
      process.stdout.write('  /task <id> - 查看任务详情\n');
      process.stdout.write('  /compact - 手动压缩上下文\n');
      process.stdout.write('  /skills-reload - 刷新 skill 目录（安装后无需重启即可使用）\n');
      process.stdout.write('  /yzjchannel - 连接云之家 channel（嵌入式，关闭 chat 即断开）\n');
      process.stdout.write('  /help    - 显示帮助\n');
      if (skills.length > 0) {
        process.stdout.write('\n可用 skills：\n');
        for (const skill of skills) {
          process.stdout.write(`  /${skill.name} - ${skill.description}\n`);
        }
      }
      process.stdout.write('\n');
      continue;
    }

    if (trimmed === '/skills-reload') {
      const prevCount = skills.length;
      await refreshSkills();
      const newCount = skills.length;
      inputReader.setSkills(skills);
      const diff = newCount - prevCount;
      if (diff > 0) {
        process.stdout.write(`已刷新 skill 目录，新增 ${diff} 个 skill，当前共 ${newCount} 个。\n\n`);
      } else if (diff < 0) {
        process.stdout.write(`已刷新 skill 目录，移除 ${-diff} 个 skill，当前共 ${newCount} 个。\n\n`);
      } else {
        process.stdout.write(`已刷新 skill 目录，当前共 ${newCount} 个 skill。\n\n`);
      }
      continue;
    }

    if (trimmed === '/yzjchannel') {
      if (embeddedChannels.length > 0) {
        process.stdout.write('已有活跃的云之家 channel，请先关闭当前 chat 进程再重新连接。\n\n');
        continue;
      }
      const yzjConfig = (() => {
        try {
          return resolveYZJConfig(config);
        } catch {
          process.stdout.write('YZJ 未配置，请先运行 xiaok yzjchannel config set-webhook-url <url>\n\n');
          return null;
        }
      })();
      if (!yzjConfig) continue;

      const namedChannels = config.channels?.yzj?.namedChannels ?? [];
      const selectedChannel = await selectYZJChannel(namedChannels);
      if (!selectedChannel) {
        process.stdout.write('已取消。\n\n');
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
        process.stdout.write(`当前权限模式：${permissionManager.getMode()}\n\n`);
        continue;
      }

      if (!['default', 'auto', 'plan'].includes(requestedMode)) {
        process.stdout.write('用法：/mode [default|auto|plan]\n\n');
        continue;
      }

      permissionManager.setMode(requestedMode as 'default' | 'auto' | 'plan');
      statusBar.updateMode(requestedMode);
      process.stdout.write(`权限模式已切换为 ${requestedMode}\n\n`);
      continue;
    }

    if (trimmed === '/tasks') {
      const tasks = taskBoard.list(sessionId);
      if (tasks.length === 0) {
        process.stdout.write('当前会话还没有任务。\n\n');
        continue;
      }

      process.stdout.write('\n当前会话任务：\n');
      for (const task of tasks) {
        process.stdout.write(`  ${task.taskId} [${task.status}] ${task.title}\n`);
      }
      process.stdout.write('\n');
      continue;
    }

    if (trimmed.startsWith('/task ')) {
      const taskId = trimmed.slice('/task '.length).trim();
      if (!taskId) {
        process.stdout.write('用法：/task <taskId>\n\n');
        continue;
      }

      const task = taskBoard.get(sessionId, taskId);
      if (!task) {
        process.stdout.write(`未找到任务 ${taskId}\n\n`);
        continue;
      }

      process.stdout.write(`${JSON.stringify(task, null, 2)}\n\n`);
      continue;
    }

    if (trimmed === '/compact') {
      agent.forceCompact();
      process.stdout.write(`${dim('上下文已压缩。')}\n\n`);
      continue;
    }

    if (trimmed === '/models') {
      const selected = await selectModel(config);
      if (selected) {
        const newConfig = { ...config, defaultModel: selected.provider };
        if (selected.provider === 'claude') {
          newConfig.models.claude = { ...newConfig.models.claude!, model: selected.model };
        } else if (selected.provider === 'openai') {
          newConfig.models.openai = { ...newConfig.models.openai!, model: selected.model };
        }
        try {
          adapter = createAdapter(newConfig);
          agent.setAdapter(adapter);
          statusBar.updateModel(selected.model);
          process.stdout.write(`已切换到：[${selected.provider}] ${selected.model}\n\n`);
        } catch (e) {
          process.stdout.write(`切换失败：${String(e)}\n\n`);
        }
      } else {
        process.stdout.write('已取消\n\n');
      }
      continue;
    }

    if (trimmed.startsWith('/commit')) {
      const message = trimmed.slice('/commit'.length).trim() || undefined;
      try {
        process.stdout.write(`${await runCommitCommand(cwd, message)}\n\n`);
      } catch (e) {
        writeError(String(e));
      }
      continue;
    }

    if (trimmed === '/review') {
      try {
        process.stdout.write(`${await runReviewCommand(cwd)}\n\n`);
      } catch (e) {
        writeError(String(e));
      }
      continue;
    }

    if (trimmed === '/pr') {
      try {
        process.stdout.write(`${await runPrCommand(cwd)}\n\n`);
      } catch (e) {
        writeError(String(e));
      }
      continue;
    }

    if (trimmed === '/doctor') {
      try {
        process.stdout.write(`${await runDoctorCommand(cwd)}\n\n`);
      } catch (e) {
        writeError(String(e));
      }
      continue;
    }

    if (trimmed === '/init') {
      try {
        process.stdout.write(`${await runInitCommand(cwd)}\n\n`);
      } catch (e) {
        writeError(String(e));
      }
      continue;
    }

    if (trimmed === '/settings') {
      try {
        const settings = await loadSettings(cwd);
        const rules = mergeRules(settings);
        process.stdout.write(`${JSON.stringify({
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
        process.stdout.write(`${formatLoadedContext(context) || '当前没有可展示的仓库上下文。'}\n\n`);
      } catch (e) {
        writeError(String(e));
      }
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
      let skill = skills.find(s => s.name === slash.skillName);
      if (!skill) {
        await refreshSkills();
        skill = skills.find(s => s.name === slash.skillName);
      }
      if (skill) {
        try {
          const plan = buildSkillExecutionPlan([skill.name], skills);
          const primaryStep = plan.resolved[plan.resolved.length - 1];

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

            scrollRegion.clearLastInput();
            beginActivity('Thinking', true);

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
        process.stdout.write(`找不到 skill "${slash.skillName}"。可用 skills：${skills.map(s => '/' + s.name).join(', ') || '（无）'}\n`);
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

      let lastAssistantText = '';

      // Clear previously typed input so footer shows placeholder during turn
      scrollRegion.clearLastInput();

      // Re-display user input in the content area (after screen clear)
      if (scrollRegion.isActive()) {
        scrollRegion.writeSubmittedInput(formatSubmittedInput(trimmed));
      }
      beginActivity('Thinking', true);

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
        scrollRegion.clearLastInput();
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
        flushStreamingMarkdown();
        if (!scrollRegion.isActive()) {
          process.stdout.write('\n');
        }
      }
    } catch (e) {
      handleTurnFailure(e);
    }
    // Restore footer after streaming
    if (scrollRegion.isActive()) {
      scrollRegion.endContentStreaming({
        inputPrompt: 'Type your message...',
        statusLine: statusBar.getStatusLine(),
      });
      // Ensure next TerminalRenderer render uses cursor movement (\x1b[1B)
      // instead of newlines (\n), which would scroll the footer up.
      replRenderer.prepareForInput();
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
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    await platform.dispose();
    for (const ch of embeddedChannels) {
      await ch.cleanup();
    }
  }
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
    .option('-c, --continue', '恢复上一次会话')
    .option('--fork-session <id>', '从已有会话分叉一个新会话')
    .argument('[input]', '单次任务描述（省略则进入交互模式）')
    .action(async (input: string | undefined, opts: ChatOptions) => {
      await runChat(input, opts);
    });
}
