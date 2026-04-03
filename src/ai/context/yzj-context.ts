import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import type { DevAppIdentity } from '../../auth/identity.js';
import type { ToolDefinition } from '../../types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { SkillMeta } from '../skills/loader.js';
import type { LoadedContext } from '../runtime/context-loader.js';
import { formatLoadedContext, loadAutoContext } from '../runtime/context-loader.js';
import { formatSkillsContext } from '../skills/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_OVERVIEW_PATH = join(__dirname, '../../../data/yzj-api-overview.md');

export interface ContextOptions {
  enterpriseId: string | null;
  devApp: DevAppIdentity | null;
  cwd: string;
  budget: number; // token budget (1 token ≈ 4 chars)
  skills?: SkillMeta[];
  deferredTools?: Array<Pick<ToolDefinition, 'name' | 'description'>>;
  agents?: Array<Pick<CustomAgentDef, 'name' | 'model' | 'allowedTools'>>;
  pluginCommands?: string[];
  lspDiagnostics?: string;
  autoContext?: LoadedContext;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...(已截断)';
}

function loadYzjHelp(): string {
  const result = spawnSync('yzj', ['--help'], { encoding: 'utf-8', timeout: 3000 });
  if (result.error || result.status !== 0) return '';
  return result.stdout?.trim() ?? '';
}

export async function renderPromptSections(opts: ContextOptions): Promise<string[]> {
  const sections: string[] = [];

  // 1. 角色定义
  sections.push(`你是 xiaok，面向金蝶(kingdee.com)与云之家（yunzhijia.com）开发者的 AI 编程助手。你擅长金蝶苍穹、云之家开放平台 API 集成、轻应用开发、Webhook 配置等场景。`);
  sections.push(
    '除非用户明确要求查看执行细节，否则不要向用户逐条展示 read、glob、tool_search、skill、task_create、task_update 等内部工具流水账，也不要直接复述原始 shell 命令。改用 1-2 句自然语言概括你在做什么、为什么这样做。',
  );
  sections.push(
    '当任务是介绍产品、代码库、生成报告、生成幻灯片或导出交付物时，必须先阅读真实源码、README、设计文档、已有产物与目录结构，再基于这些事实写作。输出必须引用实际模块、命令、路径、能力或工作流，不要写 [数据待填写]、占位 KPI、空泛套话或看起来像模板拼接的内容。',
  );
  sections.push(
    '优先复用现有 skill、模板、参考文件和现成脚本。只有在现有能力不足时才编写辅助脚本，而且脚本必须服务于真实产物质量，而不是为了绕过现有工作流。',
  );

  // 2. 当前会话上下文
  const ctxLines = [`当前工作目录：${opts.cwd}`];
  if (opts.enterpriseId) ctxLines.push(`登录企业 ID：${opts.enterpriseId}`);
  if (opts.devApp) ctxLines.push(`开发者应用：appKey=${opts.devApp.appKey}`);
  sections.push(ctxLines.join('\n'));

  // 3. Skills 列表（若有）
  if (opts.skills && opts.skills.length > 0) {
    sections.push(formatSkillsContext(opts.skills));
  }

  // Skill listing 通过每 turn 的 system-reminder 消息注入（见 RuntimeFacade），不放 system prompt。

  sections.push(
    '当用户要求安装 skill、扩展技能，或提到一个本地不存在的 skill 时，不要只检查本地 catalog 后放弃。先用 web_search / web_fetch 到 GitHub、ClawHub 等来源定位可靠的 skill Markdown 文件，再调用 install_skill 安装到 project 或 global scope。',
  );
  sections.push(
    '当用户要求删除、卸载某个已安装 skill 时，优先调用 uninstall_skill；卸载后如果还需要继续使用，应重新检查当前 catalog，而不是假设旧 skill 仍然存在。',
  );

  if (opts.deferredTools && opts.deferredTools.length > 0) {
    const deferredToolSummary = opts.deferredTools
      .slice(0, 20)
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    sections.push(`可按需发现的工具（通过 tool_search 查询完整 schema）：\n${deferredToolSummary}`);
  }

  if (opts.agents && opts.agents.length > 0) {
    const agentSummary = opts.agents
      .slice(0, 20)
      .map((agent) => `- @${agent.name}${agent.model ? ` (${agent.model})` : ''}${agent.allowedTools?.length ? ` tools=${agent.allowedTools.join(',')}` : ''}`)
      .join('\n');
    sections.push(`可用自定义 agents：\n${agentSummary}`);
  }

  if (opts.pluginCommands && opts.pluginCommands.length > 0) {
    sections.push(`可用插件命令声明：\n${opts.pluginCommands.slice(0, 20).map((command) => `- ${command}`).join('\n')}`);
  }

  if (opts.lspDiagnostics) {
    sections.push(`当前 LSP 诊断摘要：\n${opts.lspDiagnostics}`);
  }

  const autoContext = opts.autoContext ?? await loadAutoContext({
    cwd: opts.cwd,
    maxChars: Math.max(1_200, opts.budget * 2),
  });
  const autoContextSection = formatLoadedContext(autoContext);
  if (autoContextSection) {
    sections.push(autoContextSection);
  }

  // 4. 云之家 API 概览（内置文档）
  let apiOverview = '';
  if (existsSync(API_OVERVIEW_PATH)) {
    apiOverview = readFileSync(API_OVERVIEW_PATH, 'utf-8');
  }

  // 5. yzj CLI 帮助（动态加载）
  const yzjHelp = loadYzjHelp();

  // 组装并按预算裁剪
  // 优先级：API 概览 > yzj 帮助（超出时先截断 yzj，再截断 API）
  const base = sections.join('\n\n');
  let remaining = opts.budget - estimateTokens(base);

  let apiSection = '';
  if (apiOverview && remaining > 50) {
    // API 概览优先：保留 yzj 最少 100 tokens 的空间（若 yzj 可用），其余全给 API
    const reserveForYzj = yzjHelp ? 100 : 0;
    const maxApiTokens = Math.max(0, remaining - reserveForYzj);
    apiSection = truncateToTokens(apiOverview, maxApiTokens);
    remaining -= estimateTokens(apiSection);
  }

  let yzjSection = '';
  if (yzjHelp && remaining > 0) {
    yzjSection = truncateToTokens(`## yzj CLI 用法\n${yzjHelp}`, remaining);
  }

  // Split static (role definition) from dynamic (session context + rest).
  // sections[0..3] are static role rules, sections[4] onward are dynamic (cwd, agents, etc.).
  // Actually sections layout:
  //   [0] 角色定义
  //   [1] 行为规范（不展示工具流水账）
  //   [2] 写作规范（读真实源码）
  //   [3] 复用规范
  //   [4] 当前工作目录 ctxLines  ← dynamic starts here
  //   [5+] skill install/uninstall rules, deferredTools, agents, etc.
  const STATIC_SECTION_COUNT = 4;
  const staticText = sections.slice(0, STATIC_SECTION_COUNT).join('\n\n');
  const dynamicParts = sections.slice(STATIC_SECTION_COUNT);
  if (apiSection) dynamicParts.push(apiSection);
  if (yzjSection) dynamicParts.push(yzjSection);
  const dynamicText = dynamicParts.filter(Boolean).join('\n\n');

  return [staticText, dynamicText].filter(Boolean);
}

export async function buildSystemPrompt(opts: ContextOptions): Promise<string> {
  return (await renderPromptSections(opts)).join('\n\n');
}
