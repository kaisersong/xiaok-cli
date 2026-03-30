import * as readline from 'readline';
import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { loadCustomAgents } from '../ai/agents/loader.js';
import { PermissionManager } from '../ai/permissions/manager.js';
import { ToolRegistry, buildToolList } from '../ai/tools/index.js';
import { buildSystemPrompt } from '../ai/context/yzj-context.js';
import { Agent } from '../ai/agent.js';
import { createRuntimeHooks } from '../runtime/hooks.js';
import { writeError, isTTY } from '../utils/ui.js';
import { showPermissionPrompt } from '../ui/permission-prompt.js';
import { addAllowRule } from '../ai/permissions/settings.js';
import { createSkillCatalog, parseSlashCommand } from '../ai/skills/loader.js';
import { createSkillTool, formatSkillPayload } from '../ai/skills/tool.js';
import { MarkdownRenderer } from '../ui/markdown.js';
import { StatusBar } from '../ui/statusbar.js';
import { renderWelcomeScreen, renderInputSeparator, renderInputPrompt, renderUserInput, boldCyan, dim, startSpinner } from '../ui/render.js';
import { InputReader } from '../ui/input.js';
import { selectModel } from '../ui/model-selector.js';
import { getCurrentBranch } from '../utils/git.js';

interface ChatOptions {
  auto: boolean;
  dryRun: boolean;
}

async function runChat(initialInput: string | undefined, opts: ChatOptions): Promise<void> {

  // 检测 CI 环境
  const autoMode = opts.auto || !isTTY();
  if (!isTTY() && !opts.auto) {
    console.warn('\x1b[33m[警告]\x1b[0m stdin 非 TTY，自动切换为 --auto 模式');
  }

  // 加载配置和凭据
  const config = await loadConfig();

  let adapter;
  try {
    adapter = createAdapter(config);
  } catch (e) {
    writeError(String(e));
    process.exit(1);
  }

  const creds = await loadCredentials();
  const devApp = await getDevAppIdentity();
  const customAgents = await loadCustomAgents();

  // 加载 skills
  const skillCatalog = createSkillCatalog();
  let skills = await skillCatalog.reload();
  const skillTool = createSkillTool(skillCatalog);
  const tools = buildToolList(skillTool, { cwd: process.cwd() });

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

  // 创建 registry
  // rl 在交互模式下赋值，confirm() 复用它避免 stdin 嵌套冲突；
  // 单次任务模式下 rl 保持未赋值，confirm() 内部会创建临时接口（仅作兜底）
  let rl!: readline.Interface;

  const permissionManager = new PermissionManager({ mode: autoMode ? 'auto' : 'default' });

  const cwd = process.cwd();

  const registry = new ToolRegistry({
    permissionManager,
    dryRun: opts.dryRun,
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

  // 创建 UI 组件
  const mdRenderer = new MarkdownRenderer();
  const statusBar = new StatusBar();
  const sessionId = Date.now().toString(36).slice(-6);
  const inputReader = new InputReader();

  const refreshSkills = async (): Promise<void> => {
    skills = await skillCatalog.reload();
    inputReader.setSkills(skills);
    agent.setSystemPrompt(await buildPrompt(skills));
  };

  // 单次任务模式
  if (initialInput) {
    process.stdout.write('\n');
    try {
      await refreshSkills();
      await agent.runTurn(initialInput, (chunk) => {
        if (chunk.type === 'text') mdRenderer.write(chunk.delta);
        if (chunk.type === 'usage') {
          statusBar.update({ ...chunk.usage, budget: config.contextBudget });
        }
      });
      mdRenderer.flush();
      process.stdout.write('\n');
      statusBar.render();
    } catch (e) {
      writeError(String(e));
      process.exit(1);
    }
    process.stdout.write('\n');
    return;
  }

  // 交互模式 - 显示欢迎界面
  const provider = config.defaultModel ?? 'claude';

  // 获取完整的模型名称用于状态栏显示
  const fullModelName = adapter.getModelName();

  // 显示欢迎界面（不清屏，让它可以滚动）
  const welcomeLines = renderWelcomeScreen({
    model: provider,
    cwd: process.cwd(),
    sessionId,
    mode: opts.auto ? 'auto' : opts.dryRun ? 'dry-run' : 'default',
  });

  // 初始化状态栏（在底部）
  statusBar.init(fullModelName, sessionId, process.cwd(), opts.auto ? 'auto' : opts.dryRun ? 'dry-run' : undefined);

  // 同步获取 git branch
  const branch = await getCurrentBranch(process.cwd());
  if (branch) statusBar.updateBranch(branch);

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
      const rows = process.stdout.rows ?? 24;
      // 重新设置滚动区域
      process.stderr.write('\x1b[r');
      process.stderr.write(`\x1b[1;${rows - 3}r`);
      // 清除并重新渲染状态栏
      process.stderr.write(`\x1b[${rows};1H\x1b[K`);
      statusBar.render();
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

    // 在固定位置渲染分割线和输入提示符
    const rows = process.stdout.rows ?? 24;

    // 移动到倒数第3行渲染分割线
    process.stderr.write(`\x1b[${rows - 2};1H\x1b[K`);
    const cols = process.stdout.columns ?? 80;
    const totalWidth = Math.min(cols - 2, 100);
    const line = dim("─".repeat(totalWidth));
    process.stderr.write(line);

    // 移动到倒数第2行准备输入
    process.stderr.write(`\x1b[${rows - 1};1H\x1b[K`);
    process.stderr.write(boldCyan('> '));

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
      process.stdout.write('  /models  - 切换模型\n');
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

    // 输入后，将光标移回滚动区域继续输出
    // 移动到滚动区域的最后一行
    const termRows = process.stdout.rows ?? 24;
    process.stdout.write(`\x1b[${termRows - 3};1H`);

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
          mdRenderer.flush();
          process.stdout.write('\n');
          statusBar.render();
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
      await agent.runTurn(trimmed, (chunk) => {
        if (chunk.type === 'text') mdRenderer.write(chunk.delta);
        if (chunk.type === 'usage') {
          statusBar.update({ ...chunk.usage, budget: config.contextBudget });
        }
      });
      mdRenderer.flush();
      process.stdout.write('\n');
      statusBar.render();
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
    .argument('[input]', '单次任务描述（省略则进入交互模式）')
    .action(async (input: string | undefined, opts: ChatOptions) => {
      await runChat(input, opts);
    });
}
