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

  parts.push('For commands requiring genuine interactive input that Bash cannot provide (password prompts or full-screen programs), ask the user to run `! <command>` in their terminal. Do not start a command that will hang waiting for stdin. Execute non-interactive commands yourself within the authorized scope.');

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
