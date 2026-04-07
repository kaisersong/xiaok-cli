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

  // === 新增：交互式命令执行指导（仅限真正需要用户交互的场景） ===
  parts.push('IMPORTANT: Only ask the user to run `! <command>` for commands that require genuine interactive input (e.g., `gcloud auth login` needs password entry, `sudo` needs password, interactive TUI apps like `vim`). For all other commands (package installs, file operations, non-interactive CLI tools), YOU execute them directly via Bash tool.');

  // === 新增：用户授权后的执行指导 ===
  parts.push('CRITICAL: When the user says "允许", "确认", "好的", "行", "yes", "do it", or any other approval, EXECUTE IMMEDIATELY. Do not ask them to type a specific command format. Do not ask for additional confirmation. Their approval means you should call the Bash tool and run the command NOW.');

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
