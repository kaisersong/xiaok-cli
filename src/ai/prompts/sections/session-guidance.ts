import type { MemoryRecord } from '../../memory/store.js';

/**
 * Dynamic: Session-specific guidance — injected based on current session state.
 */
export interface SessionGuidanceOptions {
  permissionMode?: 'default' | 'auto' | 'plan';
  allowedToolsActive?: string[];
  toolCount?: number;
  mcpInstructions?: string;
  memories?: MemoryRecord[];
  currentTokenUsage?: number;
  contextLimit?: number;
}

export function getSessionGuidanceSection(opts: SessionGuidanceOptions): string {
  const parts: string[] = [];

  if (opts.permissionMode) {
    parts.push(`Current permission mode: ${opts.permissionMode}`);
  }

  if (opts.allowedToolsActive && opts.allowedToolsActive.length > 0) {
    parts.push(`Active tool restriction: only ${opts.allowedToolsActive.join(', ')} are allowed in current skill context.`);
  }

  if (opts.toolCount !== undefined) {
    parts.push(`${opts.toolCount} tools available in this session.`);
  }

  // === 新增：权限拒绝处理指导 ===
  parts.push('If you do not understand why the user has denied a tool call, use AskUserQuestion to ask them.');

  // === 新增：交互式命令执行指导 ===
  parts.push('If you need the user to run a shell command themselves (e.g., an interactive login like `gcloud auth login`), suggest they type `! <command>` in the prompt — the `!` prefix runs the command in this session so its output lands directly in the conversation.');

  // === 新增：!/command 快捷用法 ===
  parts.push('If the user types `!/skillname args` or `!/command args`, they want you to execute that skill/command immediately with the given arguments. Treat it as a shortcut for running the skill without confirmation.');

  if (opts.mcpInstructions) {
    parts.push(`# MCP Server Instructions\n${opts.mcpInstructions}`);
  }

  if (opts.memories && opts.memories.length > 0) {
    const memLines = opts.memories.map((m) => `- ${m.title}: ${m.summary}`).join('\n');
    parts.push(`# Relevant Memory\n${memLines}`);
  }

  if (opts.currentTokenUsage !== undefined && opts.contextLimit !== undefined) {
    const remaining = opts.contextLimit - opts.currentTokenUsage;
    const pct = Math.round((opts.currentTokenUsage / opts.contextLimit) * 100);
    parts.push(`Context window: ${pct}% used (${remaining} tokens remaining). When remaining < 1000, simplify responses.`);
  }

  return parts.join('\n\n');
}
