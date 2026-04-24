import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import type { DevAppIdentity } from '../../auth/identity.js';
import type { ToolDefinition } from '../../types.js';
import type { PromptSegment } from './types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { SkillMeta } from '../skills/loader.js';
import type { LoadedContext } from '../runtime/context-loader.js';
import type { MemoryRecord } from '../memory/store.js';
import { formatLoadedContext, loadAutoContext } from '../runtime/context-loader.js';
import { formatSkillsContext } from '../skills/loader.js';
import {
  getIntroSection,
  getSystemSection,
  getDoingTasksSection,
  getIntentDelegationSection,
  getActionsSection,
  getUsingToolsSection,
  getToneAndStyleSection,
  getOutputEfficiencySection,
  getSessionGuidanceSection,
} from './sections/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_OVERVIEW_PATH = join(__dirname, '../../../data/yzj-api-overview.md');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AssemblerOptions {
  channel?: 'chat' | 'yzj';
  enterpriseId: string | null;
  devApp: DevAppIdentity | null;
  cwd: string;
  budget: number;
  skills?: SkillMeta[];
  deferredTools?: Array<Pick<ToolDefinition, 'name' | 'description'>>;
  agents?: Array<Pick<CustomAgentDef, 'name' | 'model' | 'allowedTools'>>;
  pluginCommands?: string[];
  lspDiagnostics?: string;
  autoContext?: LoadedContext;
  // New dynamic section inputs
  mcpInstructions?: string;
  memories?: MemoryRecord[];
  currentTokenUsage?: number;
  contextLimit?: number;
  allowedToolsActive?: string[];
  permissionMode?: 'default' | 'auto' | 'plan';
  toolCount?: number;
  // Approval detection context
  lastAssistantMessage?: string;
  lastUserMessage?: string;
}

export interface AssembledPrompt {
  staticText: string;
  dynamicText: string;
  rendered: string;
  segments: PromptSegment[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...(truncated)';
}

function loadYzjHelp(): string {
  const result = spawnSync('yzj', ['--help'], { encoding: 'utf-8', timeout: 3000 });
  if (result.error || result.status !== 0) return '';
  return result.stdout?.trim() ?? '';
}

function shouldInjectYzjContext(opts: AssemblerOptions): boolean {
  if (opts.channel === 'yzj') {
    return true;
  }

  if (opts.devApp) {
    return true;
  }

  const recentContext = [
    opts.lastUserMessage,
    opts.lastAssistantMessage,
    opts.lspDiagnostics,
  ].filter(Boolean).join('\n');

  return /(云之家|yunzhijia|\byzj\b|轻应用|webhook|workflow|审批|open\s*api|appkey|sendmsgurl|message\/send)/i.test(recentContext);
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/**
 * Assemble the system prompt from static sections (cacheable) and dynamic
 * sections (per-turn). Mirrors Claude Code's 7-layer static prefix +
 * dynamic suffix architecture.
 */
export async function assembleSystemPrompt(opts: AssemblerOptions): Promise<AssembledPrompt> {
  // -----------------------------------------------------------------------
  // STATIC PREFIX — stable across turns, cache-friendly
  // -----------------------------------------------------------------------
  const staticSections = [
    getIntroSection(),
    getSystemSection(),
    getDoingTasksSection(),
    getIntentDelegationSection(),
    getActionsSection(),
    getUsingToolsSection(),
    getToneAndStyleSection(),
    getOutputEfficiencySection(),
  ];
  const staticText = staticSections.join('\n\n');
  const segments: PromptSegment[] = [{
    key: 'static_identity',
    title: 'Static Identity',
    text: staticText,
    cacheable: true,
    kind: 'system_rule',
  }];

  // -----------------------------------------------------------------------
  // SYSTEM_PROMPT_DYNAMIC_BOUNDARY
  // Everything below changes per-turn and should NOT be cached.
  // -----------------------------------------------------------------------
  const dynamicSections: string[] = [];

  // 1. Session context (cwd, enterprise, devApp)
  const ctxLines = [`当前工作目录：${opts.cwd}`];
  if (opts.enterpriseId) ctxLines.push(`登录企业 ID：${opts.enterpriseId}`);
  if (opts.devApp) ctxLines.push(`开发者应用：appKey=${opts.devApp.appKey}`);
  dynamicSections.push(ctxLines.join('\n'));

  // 2. Skills list
  if (opts.skills && opts.skills.length > 0) {
    dynamicSections.push(formatSkillsContext(opts.skills));
  }

  // 3. Skill install/uninstall rules
  dynamicSections.push(
    'When the user asks to install a skill or mentions one that is not locally available, search GitHub/ClawHub via web_search/web_fetch to locate a reliable skill Markdown file, then call install_skill.',
  );
  dynamicSections.push(
    'When the user asks to uninstall a skill, call uninstall_skill. After uninstalling, re-check the current catalog.',
  );

  // 4. Session guidance (dynamic based on current state)
  const guidance = getSessionGuidanceSection({
    permissionMode: opts.permissionMode,
    allowedToolsActive: opts.allowedToolsActive,
    toolCount: opts.toolCount,
    mcpInstructions: opts.mcpInstructions,
    currentTokenUsage: opts.currentTokenUsage,
    contextLimit: opts.contextLimit,
    lastAssistantMessage: opts.lastAssistantMessage,
    lastUserMessage: opts.lastUserMessage,
  });
  if (guidance) dynamicSections.push(guidance);

  // 5. Deferred tools
  if (opts.deferredTools && opts.deferredTools.length > 0) {
    const summary = opts.deferredTools
      .slice(0, 20)
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');
    dynamicSections.push(`Discoverable tools (use tool_search for full schema):\n${summary}`);
  }

  // 6. Custom agents
  if (opts.agents && opts.agents.length > 0) {
    const summary = opts.agents
      .slice(0, 20)
      .map((a) => `- @${a.name}${a.model ? ` (${a.model})` : ''}${a.allowedTools?.length ? ` tools=${a.allowedTools.join(',')}` : ''}`)
      .join('\n');
    dynamicSections.push(`Available agents:\n${summary}`);
  }

  // 7. Plugin commands
  if (opts.pluginCommands && opts.pluginCommands.length > 0) {
    dynamicSections.push(`Plugin commands:\n${opts.pluginCommands.slice(0, 20).map((c) => `- ${c}`).join('\n')}`);
  }

  // 8. LSP diagnostics
  if (opts.lspDiagnostics) {
    dynamicSections.push(`LSP diagnostics:\n${opts.lspDiagnostics}`);
  }

  // 9. Auto context (CLAUDE.md, AGENTS.md, git)
  const autoContext = opts.autoContext ?? await loadAutoContext({
    cwd: opts.cwd,
    maxChars: Math.max(1_200, opts.budget * 2),
  });
  const autoContextSection = formatLoadedContext(autoContext);

  // 10. Yunzhijia API overview (budget-managed)
  const base = [staticText, ...dynamicSections].join('\n\n');
  let remaining = opts.budget - estimateTokens(base);

  let apiOverview = '';
  if (existsSync(API_OVERVIEW_PATH)) {
    apiOverview = readFileSync(API_OVERVIEW_PATH, 'utf-8');
  }
  const yzjHelp = loadYzjHelp();

  const includeYzjContext = shouldInjectYzjContext(opts);

  if (includeYzjContext && apiOverview && remaining > 50) {
    const reserveForYzj = yzjHelp ? 100 : 0;
    const maxApiTokens = Math.max(0, remaining - reserveForYzj);
    const truncated = truncateToTokens(apiOverview, maxApiTokens);
    dynamicSections.push(truncated);
    remaining -= estimateTokens(truncated);
  }

  // 11. yzj CLI help
  if (includeYzjContext && yzjHelp && remaining > 0) {
    dynamicSections.push(truncateToTokens(`## yzj CLI usage\n${yzjHelp}`, remaining));
  }

  const dynamicText = dynamicSections.filter(Boolean).join('\n\n');
  if (dynamicText) {
    segments.push({
      key: 'dynamic_context',
      title: 'Dynamic Context',
      text: dynamicText,
      cacheable: false,
      kind: 'background_context',
    });
  }

  if (autoContextSection) {
    segments.push({
      key: 'workspace_context',
      title: 'Workspace Context',
      text: `Workspace context:\n${autoContextSection}`,
      cacheable: false,
      kind: 'background_context',
    });
  }

  if (opts.memories && opts.memories.length > 0) {
    const memoryText = opts.memories
      .slice(0, 10)
      .map((memory) => `- ${memory.title}: ${memory.summary}`)
      .join('\n');
    segments.push({
      key: 'memory_summary',
      title: 'Background Memory',
      text: `Background memory:\n${memoryText}`,
      cacheable: false,
      kind: 'background_context',
    });
  }

  const rendered = segments
    .map((segment) => segment.text)
    .filter(Boolean)
    .join('\n\n');
  const dynamicRenderedText = segments
    .filter((segment) => segment.key !== 'static_identity')
    .map((segment) => segment.text)
    .filter(Boolean)
    .join('\n\n');

  return { staticText, dynamicText: dynamicRenderedText, rendered, segments };
}
