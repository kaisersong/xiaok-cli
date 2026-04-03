import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// Hook event types — aligned with Claude Code hook_event_name schema
// ---------------------------------------------------------------------------

export type HookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'Setup'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'FileChanged';

// Shared context injected into every hook payload
export interface HookSharedContext {
  session_id: string;
  cwd: string;
  transcript_path?: string;
  agent_id?: string;
  agent_type?: string;
}

// ---------------------------------------------------------------------------
// Hook configuration
// ---------------------------------------------------------------------------

export interface HookConfig {
  /** Shell command to execute */
  command: string;
  /**
   * Which hook events this hook responds to.
   * Omit or pass an empty array to match ALL events.
   */
  events?: HookEventName[];
  /**
   * Tool name filter — only applies for tool-related events
   * (PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied).
   * Supports '*' wildcard and regex patterns (wrapped in '/pattern/flags').
   * Omit to match all tools.
   */
  tools?: string[];
  /** Timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number;
}

// Legacy format — plain command strings (pre-hook only, all tools)
export type HookConfigOrCommand = HookConfig | string;

export interface HooksRunnerConfig {
  hooks?: HookConfigOrCommand[];
  /** Backward-compat: plain pre-hook commands */
  pre?: Array<{ command: string; tools?: string[] }>;
  /** Backward-compat: plain post-hook commands */
  post?: Array<{ command: string; tools?: string[] }>;
  /** Default timeout in ms if not specified per-hook */
  timeoutMs?: number;
  /** Shared context injected into all hook payloads */
  context?: Partial<HookSharedContext>;
}

// ---------------------------------------------------------------------------
// Hook execution results
// ---------------------------------------------------------------------------

export interface HookRunResult {
  ok: boolean;
  message?: string;
  /** PreToolUse: modified tool input to pass to the tool instead of the original */
  updatedInput?: Record<string, unknown>;
  /** PreToolUse: if true, abort the tool call and return an error */
  preventContinuation?: boolean;
  /** Additional context text to prepend to the tool result */
  additionalContext?: string;
  /** Permission decision — 'allow' or 'deny' (for PermissionRequest hooks) */
  decision?: 'allow' | 'deny';
}

// ---------------------------------------------------------------------------
// Main runner interface
// ---------------------------------------------------------------------------

export interface HooksRunner {
  /**
   * Run hooks registered for a specific event.
   * Payload is sent to the hook's stdin as JSON.
   * Returns merged result from all matching hooks.
   */
  runHooks(eventName: HookEventName, payload: Record<string, unknown>): Promise<HookRunResult>;

  /** Convenience: run PreToolUse hooks */
  runPreHooks(toolName: string, input: Record<string, unknown>): Promise<HookRunResult>;

  /** Convenience: run PostToolUse hooks (non-blocking — errors become warnings) */
  runPostHooks(toolName: string, input: Record<string, unknown>): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL_EVENTS = new Set<HookEventName>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
]);

function matchesEvent(config: HookConfig, eventName: HookEventName): boolean {
  if (!config.events || config.events.length === 0) return true;
  return config.events.includes(eventName);
}

function matchesTool(filter: string[] | undefined, toolName: string): boolean {
  if (!filter || filter.length === 0) return true;
  return filter.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      // regex pattern: /pattern/flags
      const lastSlash = pattern.lastIndexOf('/');
      const body = pattern.slice(1, lastSlash);
      const flags = pattern.slice(lastSlash + 1);
      try {
        return new RegExp(body, flags).test(toolName);
      } catch {
        return false;
      }
    }
    return pattern === toolName;
  });
}

function normalizeConfig(raw: HookConfigOrCommand): HookConfig {
  if (typeof raw === 'string') return { command: raw };
  return raw;
}

function buildPayload(
  eventName: HookEventName,
  data: Record<string, unknown>,
  ctx: Partial<HookSharedContext>,
): string {
  return JSON.stringify({
    hook_event_name: eventName,
    session_id: ctx.session_id ?? '',
    cwd: ctx.cwd ?? process.cwd(),
    ...(ctx.transcript_path ? { transcript_path: ctx.transcript_path } : {}),
    ...(ctx.agent_id ? { agent_id: ctx.agent_id } : {}),
    ...(ctx.agent_type ? { agent_type: ctx.agent_type } : {}),
    ...data,
  });
}

async function runCommand(
  command: string,
  timeoutMs: number,
  payloadJson: string,
): Promise<Partial<HookRunResult>> {
  return new Promise<Partial<HookRunResult>>((resolve, reject) => {
    let stdout = '';

    const child = exec(command, {
      env: {
        ...process.env,
        XIAOK_HOOK_PAYLOAD: payloadJson,
      },
    }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      const trimmed = stdout.trim();
      if (trimmed.startsWith('{')) {
        try {
          resolve(JSON.parse(trimmed) as Partial<HookRunResult>);
          return;
        } catch {
          // not JSON — ignore stdout, treat as success
        }
      }
      resolve({});
    });

    if (child.stdout) {
      child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    }

    // Send payload via stdin then close it
    if (child.stdin) {
      child.stdin.write(payloadJson);
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`hook timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on?.('exit', () => clearTimeout(timer));
    child.on?.('error', () => clearTimeout(timer));
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHooksRunner(config: HooksRunnerConfig = {}): HooksRunner {
  const defaultTimeout = config.timeoutMs ?? 10000;
  const ctx: Partial<HookSharedContext> = config.context ?? {};

  // Normalize all hook sources into unified HookConfig[]
  const allHooks: HookConfig[] = [
    ...(config.hooks ?? []).map(normalizeConfig),
    ...(config.pre ?? []).map((h) => ({ command: h.command, events: ['PreToolUse' as HookEventName], tools: h.tools })),
    ...(config.post ?? []).map((h) => ({ command: h.command, events: ['PostToolUse' as HookEventName], tools: h.tools })),
  ];

  async function runHooks(eventName: HookEventName, payload: Record<string, unknown>): Promise<HookRunResult> {
    const merged: HookRunResult = { ok: true };
    const payloadJson = buildPayload(eventName, payload, ctx);
    const toolName = (payload['tool_name'] as string | undefined) ?? '';

    for (const hook of allHooks) {
      if (!matchesEvent(hook, eventName)) continue;
      if (TOOL_EVENTS.has(eventName) && toolName && !matchesTool(hook.tools, toolName)) continue;

      const timeout = hook.timeoutMs ?? defaultTimeout;
      try {
        const result = await runCommand(hook.command, timeout, payloadJson);
        if (result.updatedInput) merged.updatedInput = { ...(merged.updatedInput ?? {}), ...result.updatedInput };
        if (result.preventContinuation) merged.preventContinuation = true;
        if (result.additionalContext) {
          merged.additionalContext = merged.additionalContext
            ? `${merged.additionalContext}\n${result.additionalContext}`
            : result.additionalContext;
        }
        if (result.decision) merged.decision = result.decision;
        if (result.message) merged.message = result.message;
      } catch (error) {
        // Blocking events: propagate error
        if (eventName === 'PreToolUse' || eventName === 'PermissionRequest') {
          return { ok: false, message: String(error) };
        }
        // Non-blocking events: record warning, continue
        merged.message = merged.message
          ? `${merged.message}\n${String(error)}`
          : String(error);
      }
    }

    return merged;
  }

  return {
    runHooks,

    async runPreHooks(toolName, input) {
      return runHooks('PreToolUse', { tool_name: toolName, tool_input: input });
    },

    async runPostHooks(toolName, input) {
      const result = await runHooks('PostToolUse', { tool_name: toolName, tool_input: input });
      return result.message ? [result.message] : [];
    },
  };
}

