import type { Command } from 'commander';
import type { ModelAdapter } from '../types.js';
import { loadConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { loadCustomAgents } from '../ai/agents/loader.js';
import { PermissionManager } from '../ai/permissions/manager.js';
import { ToolRegistry, buildToolList } from '../ai/tools/index.js';
import { createAskUserTool } from '../ai/tools/ask-user.js';
import { createTaskTools } from '../ai/tools/tasks.js';
import { createHooksRunner } from '../runtime/hooks-runner.js';
import { buildSystemPrompt } from '../ai/context/yzj-context.js';
import { Agent } from '../ai/agent.js';
import { createRuntimeHooks } from '../runtime/hooks.js';
import { SessionTaskBoard } from '../runtime/tasking/board.js';
import { writeError, isTTY } from '../utils/ui.js';
import { showPermissionPrompt } from '../ui/permission-prompt.js';
import { addAllowRule } from '../ai/permissions/settings.js';
import { createSkillCatalog, parseSlashCommand } from '../ai/skills/loader.js';
import { createSkillTool, formatSkillPayload } from '../ai/skills/tool.js';
import { resolveModelCapabilities } from '../ai/runtime/model-capabilities.js';
import { FileSessionStore, type PersistedSessionSnapshot } from '../ai/runtime/session-store.js';
import { formatPrintOutput } from './chat-print-mode.js';
import { MarkdownRenderer } from '../ui/markdown.js';
import { StatusBar } from '../ui/statusbar.js';
import { renderWelcomeScreen, renderInputSeparator, renderInputPrompt, renderUserInput, dim, startSpinner } from '../ui/render.js';
import { InputReader } from '../ui/input.js';
import { parseInputBlocks } from '../ui/image-input.js';
import { selectModel } from '../ui/model-selector.js';
import { getCurrentBranch } from '../utils/git.js';
import { runCommitCommand } from './commit.js';
import { runReviewCommand } from './review.js';
import { runPrCommand } from './pr.js';

interface ChatOptions {
  auto: boolean;
  dryRun: boolean;
  print?: boolean;
  json?: boolean;
  resume?: string;
  forkSession?: string;
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
  const customAgents = await loadCustomAgents();
  const sessionStore = new FileSessionStore();
  let persistedSession: PersistedSessionSnapshot | null = null;

  if (opts.resume) {
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

  // 加载 skills
  const skillCatalog = createSkillCatalog();
  let skills = await skillCatalog.reload();
  const inputReader = new InputReader();
  const skillTool = createSkillTool(skillCatalog);
  const taskBoard = new SessionTaskBoard('cli');
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
  ];
  const tools = buildToolList(skillTool, { cwd: process.cwd() }, workflowTools);

  // 构建系统提示
  const buildPrompt = async (nextSkills = skills) => buildSystemPrompt({
    enterpriseId: creds?.enterpriseId ?? null,
    devApp,
    cwd: process.cwd(),
    budget: config.contextBudget,
    skills: nextSkills,
    agents: customAgents.map((agent) => ({
      name: agent.name,
      model: agent.model,
      allowedTools: agent.allowedTools,
    })),
  });
  const systemPrompt = await buildPrompt();

  const permissionManager = new PermissionManager({ mode: autoMode ? 'auto' : 'default' });
  inputReader.setModeCycleHandler(() => {
    const nextMode = PermissionManager.nextMode(permissionManager.getMode());
    permissionManager.setMode(nextMode);
    statusBar.updateMode(nextMode);
    return nextMode;
  });

  const cwd = process.cwd();

  const registry = new ToolRegistry({
    permissionManager,
    dryRun: opts.dryRun,
    hooksRunner: createHooksRunner(),
    onPrompt: async (name, input) => {
      const choice = await showPermissionPrompt(name, input);

      // 处理不同的选择
      if (choice.action === 'deny') {
        return false;
      }

      if (choice.action === 'allow_once') {
        return true;
      }

      if (choice.action === 'allow_session') {
        // 添加到会话规则（内存中）
        permissionManager.addSessionRule(choice.rule);
        return true;
      }

      if (choice.action === 'allow_project') {
        // 保存到项目 settings.json
        await addAllowRule('project', choice.rule, cwd);
        permissionManager.addSessionRule(choice.rule);
        return true;
      }

      if (choice.action === 'allow_global') {
        // 保存到全局 settings.json
        await addAllowRule('global', choice.rule, cwd);
        permissionManager.addSessionRule(choice.rule);
        return true;
      }

      return false;
    },
  }, tools);

  const runtimeHooks = createRuntimeHooks();
  const agent = new Agent(adapter, registry, systemPrompt, { hooks: runtimeHooks });

  if (persistedSession) {
    agent.restoreSession({
      messages: persistedSession.messages,
      usage: persistedSession.usage,
    });
  }

  // 创建 UI 组件
  const mdRenderer = new MarkdownRenderer();
  const statusBar = new StatusBar();

  const persistSession = async (): Promise<void> => {
    const snapshot = agent.exportSession();
    await sessionStore.save({
      sessionId,
      cwd: process.cwd(),
      model: adapter.getModelName(),
      createdAt: sessionCreatedAt,
      updatedAt: Date.now(),
      forkedFromSessionId,
      messages: snapshot.messages,
      usage: snapshot.usage,
    });
  };

  const refreshSkills = async (): Promise<void> => {
    skills = await skillCatalog.reload();
    inputReader.setSkills(skills);
    agent.setSystemPrompt(await buildPrompt(skills));
  };

  // 初始化状态栏（在单次任务模式之前）
  const fullModelName = adapter.getModelName();
  statusBar.init(fullModelName, sessionId, process.cwd(), opts.dryRun ? 'dry-run' : permissionManager.getMode());
  const branch = await getCurrentBranch(process.cwd());
  if (branch) statusBar.updateBranch(branch);
  statusBar.update({ inputTokens: 0, outputTokens: 0, budget: config.contextBudget });

  // 单次任务模式
  if (initialInput) {
    const inputBlocks = await parseInputBlocks(
      initialInput,
      resolveModelCapabilities(adapter).supportsImageInput,
    );
    const printChunks: string[] = [];
    if (!opts.print && !opts.json) {
      process.stdout.write('\n');
    }
    try {
      await refreshSkills();
      await agent.runTurn(inputBlocks, (chunk) => {
        if (chunk.type === 'text') {
          printChunks.push(chunk.delta);
          if (!opts.print && !opts.json) {
            mdRenderer.write(chunk.delta);
          }
        }
        if (chunk.type === 'usage') {
          statusBar.update({ ...chunk.usage, budget: config.contextBudget });
        }
      });
      await persistSession();
      if (opts.print || opts.json) {
        process.stdout.write(formatPrintOutput({
          sessionId,
          text: printChunks.join(''),
          usage: agent.getUsage(),
        }, Boolean(opts.json)) + '\n');
      } else {
        mdRenderer.flush();
        process.stdout.write('\n');
        const statusLine = statusBar.getStatusLine();
        if (statusLine) process.stdout.write(statusLine + '\n');
      }
    } catch (e) {
      writeError(String(e));
      process.exit(1);
    }
    if (!opts.print && !opts.json) {
      process.stdout.write('\n');
    }
    return;
  }

  // 交互模式 - 显示欢迎界面
  const provider = config.defaultModel ?? 'claude';

  // 显示欢迎界面（不清屏，让它可以滚动）
  renderWelcomeScreen({
    model: provider,
    cwd: process.cwd(),
    sessionId,
    mode: opts.auto ? 'auto' : opts.dryRun ? 'dry-run' : 'default',
  });

  // 设置初始 usage
  statusBar.update({ inputTokens: 0, outputTokens: 0, budget: config.contextBudget });

  if (opts.dryRun) process.stdout.write(`${dim('[dry-run 模式] 工具调用不会实际执行')}\n\n`);

  // 创建输入读取器
  inputReader.setSkills(skills);

  // 工具调用可视化 — 用 startSpinner
  const activeSpinners = new Map<string, () => void>();

  runtimeHooks.on('tool_started', (e) => {
    const displayValue = extractToolDisplay(e.toolInput);
    const msg = displayValue ? `${e.toolName}(${displayValue})` : e.toolName;
    const stopSpinner = startSpinner(msg);
    activeSpinners.set(e.toolName, stopSpinner);
  });

  runtimeHooks.on('tool_finished', (e) => {
    const stop = activeSpinners.get(e.toolName);
    if (stop) {
      stop();
      activeSpinners.delete(e.toolName);
    }
    const icon = e.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    process.stdout.write(`  ${icon} ${e.toolName}\n`);
  });

  // Context 压缩通知
  runtimeHooks.on('compact_triggered', () => {
    process.stdout.write(`\n  ${dim('⚠ 上下文已压缩，保留最近对话')}\n\n`);
  });

  // Helper: 从工具输入提取展示值
  function extractToolDisplay(input: Record<string, unknown>): string {
    if (typeof input.command === 'string') return input.command.slice(0, 40);
    if (typeof input.file_path === 'string') return input.file_path;
    if (typeof input.path === 'string') return input.path;
    if (typeof input.pattern === 'string') return input.pattern;
    return '';
  }

  // 处理终端窗口大小调整
  let resizeTimeout: NodeJS.Timeout | null = null;
  const handleResize = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // 普通文档流模式下不做底部重绘，后续输出自然适配新尺寸
    }, 100);
  };
  process.stdout.on('resize', handleResize);

  // SIGINT 处理
  process.on('SIGINT', () => {
    process.stdout.off('resize', handleResize);
    statusBar.destroy();
    process.stdout.write('\n已退出。\n');
    process.exit(0);
  });

  // 交互循环
  while (true) {
    await refreshSkills();

    renderInputSeparator();
    renderInputPrompt();

    const input = await inputReader.read('');

    if (input === null || input.trim() === '/exit') {
      statusBar.destroy();
      process.stdout.write('\n再见！\n');
      break;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    await refreshSkills();

    // 处理内置命令
    if (trimmed === '/clear') {
      process.stdout.write('\x1b[2J\x1b[H');
      renderWelcomeScreen({
        model: provider,
        cwd: process.cwd(),
        sessionId,
        mode: opts.auto ? 'auto' : opts.dryRun ? 'dry-run' : 'default',
      });
      statusBar.render();
      continue;
    }

    if (trimmed === '/help') {
      process.stdout.write('\n可用命令：\n');
      process.stdout.write('  /exit    - 退出\n');
      process.stdout.write('  /clear   - 清屏\n');
      process.stdout.write('  /commit [message] - 提交已暂存改动\n');
      process.stdout.write('  /review  - 查看当前 git 改动概览\n');
      process.stdout.write('  /pr      - 创建或预览 PR\n');
      process.stdout.write('  /models  - 切换模型\n');
      process.stdout.write('  /mode [default|auto|plan] - 查看或切换权限模式\n');
      process.stdout.write('  /tasks   - 查看当前会话任务\n');
      process.stdout.write('  /task <id> - 查看任务详情\n');
      process.stdout.write('  /compact - 手动压缩上下文\n');
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

    // 输入后的分隔线
    renderInputSeparator();

    // 显示用户输入（带背景色）
    process.stdout.write('\n');
    renderUserInput(trimmed);
    process.stdout.write('\n');

    // 斜杠命令：直接触发对应 skill
    const slash = parseSlashCommand(trimmed);
    if (slash) {
      let skill = skills.find(s => s.name === slash.skillName);
      if (!skill) {
        await refreshSkills();
        skill = skills.find(s => s.name === slash.skillName);
      }
      if (skill) {
        const skillPayload = formatSkillPayload(skill);
        const userMsg = slash.rest
          ? `执行 skill "${skill.name}"，用户补充说明：${slash.rest}\n\n${skillPayload}`
          : `执行 skill：\n\n${skillPayload}`;
        process.stdout.write('\n');
        mdRenderer.reset();
        try {
          await agent.runTurn(userMsg, (chunk) => {
            if (chunk.type === 'text') mdRenderer.write(chunk.delta);
            if (chunk.type === 'usage') {
              statusBar.update({ ...chunk.usage, budget: config.contextBudget });
            }
          });
          await persistSession();
          mdRenderer.flush();
          process.stdout.write('\n');
          // 状态栏作为一行文本输出，不使用固定定位
          const statusLine = statusBar.getStatusLine();
          if (statusLine) process.stdout.write(statusLine + '\n');
        } catch (e) {
          writeError(String(e));
        }
        process.stdout.write('\n');
      } else {
        process.stdout.write(`找不到 skill "${slash.skillName}"。可用 skills：${skills.map(s => '/' + s.name).join(', ') || '（无）'}\n`);
      }
      continue;
    }

    // 普通输入
    process.stdout.write('\n');
    mdRenderer.reset();
    try {
      const inputBlocks = await parseInputBlocks(
        trimmed,
        resolveModelCapabilities(adapter).supportsImageInput,
      );

      await agent.runTurn(inputBlocks, (chunk) => {
        if (chunk.type === 'text') mdRenderer.write(chunk.delta);
        if (chunk.type === 'usage') {
          statusBar.update({ ...chunk.usage, budget: config.contextBudget });
        }
      });
      await persistSession();
      mdRenderer.flush();
      process.stdout.write('\n');
      const statusLine = statusBar.getStatusLine();
      if (statusLine) process.stdout.write(statusLine + '\n');
    } catch (e) {
      writeError(String(e));
    }
    process.stdout.write('\n');
  }
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
    .option('--fork-session <id>', '从已有会话分叉一个新会话')
    .argument('[input]', '单次任务描述（省略则进入交互模式）')
    .action(async (input: string | undefined, opts: ChatOptions) => {
      await runChat(input, opts);
    });
}
