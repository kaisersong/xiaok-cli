import { exec, spawn, type ChildProcess } from 'child_process';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

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
// Hook types — aligned with Claude Code (command | http | prompt)
// ---------------------------------------------------------------------------

export type HookType = 'command' | 'http' | 'prompt';

export interface HookConfigBase {
  /** Hook type. Defaults to 'command'. */
  type?: HookType;
  /** Which hook events this hook responds to. Omit to match ALL events. */
  events?: HookEventName[];
  /**
   * Matcher for the per-event query field.
   * - For tool events: matches tool_name
   * - For SessionStart: matches source
   * - For Notification: matches notification_type
   * Supports: exact string, pipe-separated OR ('Bash|Edit'), /regex/flags, '*' wildcard.
   * Omit to match all.
   */
  matcher?: string;
  /**
   * @deprecated Use matcher. Tool name filter for tool-related events only.
   * Kept for backward compat.
   */
  tools?: string[];
  /** Timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number;
  /** If true, run in background (non-blocking). Defaults to false. */
  async?: boolean;
  /**
   * If true AND async is true, exit code 2 from background hook
   * re-wakes the model. Defaults to false.
   */
  asyncRewake?: boolean;
  /** If true, run only once per session. Defaults to false. */
  once?: boolean;
  /** Status message shown while hook is running. */
  statusMessage?: string;
}

export interface CommandHookConfig extends HookConfigBase {
  type?: 'command';
  /** Shell command to execute */
  command: string;
  /** Shell to use. Defaults to system shell. */
  shell?: string;
}

export interface HttpHookConfig extends HookConfigBase {
  type: 'http';
  /** URL to POST the payload to */
  url: string;
  /** Extra HTTP headers */
  headers?: Record<string, string>;
}

export interface PromptHookConfig extends HookConfigBase {
  type: 'prompt';
  /** LLM prompt text. Use $ARGUMENTS as placeholder for JSON payload. */
  prompt: string;
  /** Model to use for the LLM call. */
  model?: string;
}

export type HookConfig = CommandHookConfig | HttpHookConfig | PromptHookConfig;

/** Legacy format — plain command strings */
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
  /** Callback for prompt-type hooks (sends prompt to LLM, returns response) */
  promptExecutor?: (prompt: string, model?: string) => Promise<string>;
  /** Callback invoked when an asyncRewake hook completes with exit code 2 */
  onAsyncRewake?: (eventName: HookEventName, payload: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Hook execution results
// ---------------------------------------------------------------------------

export interface HookRunResult {
  ok: boolean;
  message?: string;
  /** PreToolUse: modified tool input to pass to the tool */
  updatedInput?: Record<string, unknown>;
  /** PreToolUse: if true, abort the tool call */
  preventContinuation?: boolean;
  /** Additional context text to prepend to the tool result */
  additionalContext?: string;
  /** Permission decision — 'allow' or 'deny' (for PermissionRequest hooks) */
  decision?: 'allow' | 'deny';
  /** Whether the hook ran asynchronously (fire-and-forget) */
  async?: boolean;
}

// ---------------------------------------------------------------------------
// Main runner interface
// ---------------------------------------------------------------------------

export interface HooksRunner {
  /** Run hooks registered for a specific event. */
  runHooks(eventName: HookEventName, payload: Record<string, unknown>): Promise<HookRunResult>;
  /** Convenience: run PreToolUse hooks */
  runPreHooks(toolName: string, input: Record<string, unknown>): Promise<HookRunResult>;
  /** Convenience: run PostToolUse hooks */
  runPostHooks(toolName: string, input: Record<string, unknown>): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOL_EVENTS = new Set<HookEventName>([
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
]);

/** Events where exit code 2 blocks execution */
const BLOCKING_EVENTS = new Set<HookEventName>([
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop',
  'PreCompact', 'PermissionRequest', 'TaskCreated', 'TaskCompleted',
]);

/** Per-event: which field the matcher runs against */
const MATCHER_FIELD: Partial<Record<HookEventName, string>> = {
  PreToolUse: 'tool_name',
  PostToolUse: 'tool_name',
  PostToolUseFailure: 'tool_name',
  PermissionRequest: 'tool_name',
  PermissionDenied: 'tool_name',
  SessionStart: 'source',
  SessionEnd: 'reason',
  Setup: 'trigger',
  PreCompact: 'trigger',
  PostCompact: 'trigger',
  Notification: 'notification_type',
  StopFailure: 'error',
  SubagentStart: 'agent_type',
  SubagentStop: 'agent_type',
  FileChanged: 'file_path',
};

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

function matchesEvent(config: HookConfig, eventName: HookEventName): boolean {
  if (!config.events || config.events.length === 0) return true;
  return config.events.includes(eventName);
}

/**
 * Matcher logic aligned with Claude Code:
 * - null / '*' → always matches
 * - letters/digits/underscores/pipes only → pipe-separated OR (e.g. 'Bash|Edit')
 * - otherwise → regex
 */
function matchesMatcher(matcher: string | undefined, value: string): boolean {
  if (!matcher || matcher === '*') return true;
  if (/^[a-zA-Z0-9_|]+$/.test(matcher)) {
    return matcher.split('|').includes(value);
  }
  try {
    return new RegExp(matcher).test(value);
  } catch {
    return matcher === value;
  }
}

/** Legacy tools array check (backward compat) */
function matchesToolsList(filter: string[] | undefined, toolName: string): boolean {
  if (!filter || filter.length === 0) return true;
  return filter.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      const lastSlash = pattern.lastIndexOf('/');
      try { return new RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash + 1)).test(toolName); } catch { return false; }
    }
    return pattern === toolName;
  });
}

function shouldMatch(config: HookConfig, eventName: HookEventName, payload: Record<string, unknown>): boolean {
  if (!matchesEvent(config, eventName)) return false;

  // Determine the query value for matcher
  const fieldKey = MATCHER_FIELD[eventName];
  const queryValue = fieldKey ? String(payload[fieldKey] ?? '') : '';

  // New-style matcher
  if (config.matcher) {
    return matchesMatcher(config.matcher, queryValue);
  }

  // Legacy tools filter (only for tool events)
  if (config.tools && TOOL_EVENTS.has(eventName) && queryValue) {
    return matchesToolsList(config.tools, queryValue);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Normalize config
// ---------------------------------------------------------------------------

function normalizeConfig(raw: HookConfigOrCommand): HookConfig {
  if (typeof raw === 'string') return { type: 'command', command: raw };
  if (!raw.type) return { ...raw, type: 'command' } as CommandHookConfig;
  return raw;
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exit code semantics (aligned with Claude Code)
// ---------------------------------------------------------------------------

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function interpretExitCode(
  result: CommandResult,
  eventName: HookEventName,
): Partial<HookRunResult> {
  // Parse structured JSON from stdout
  const trimmed = result.stdout.trim();
  let parsed: Record<string, unknown> = {};
  if (trimmed.startsWith('{')) {
    try { parsed = JSON.parse(trimmed) as Record<string, unknown>; } catch { /* ignore */ }
  }

  // Exit code 0 → success
  if (result.exitCode === 0) {
    return {
      updatedInput: parsed['updatedInput'] as Record<string, unknown> | undefined,
      preventContinuation: parsed['preventContinuation'] as boolean | undefined,
      additionalContext: parsed['additionalContext'] as string | undefined,
      decision: parsed['decision'] as 'allow' | 'deny' | undefined,
      message: parsed['message'] as string | undefined,
    };
  }

  // Exit code 2 → blocking error (for blocking events)
  if (result.exitCode === 2 && BLOCKING_EVENTS.has(eventName)) {
    const reason = result.stderr.trim() || parsed['reason'] as string || 'Blocked by hook';
    return {
      ok: false,
      preventContinuation: true,
      message: reason,
      decision: 'deny',
    };
  }

  // Other non-zero → non-blocking warning
  return {
    message: result.stderr.trim() || `Hook exited with code ${result.exitCode}`,
  };
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

async function executeCommand(
  config: CommandHookConfig,
  timeoutMs: number,
  payloadJson: string,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = exec(config.command, {
      shell: config.shell || undefined,
      env: {
        ...process.env,
        XIAOK_HOOK_PAYLOAD: payloadJson,
      },
    });

    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

    // Send payload via stdin
    if (child.stdin) {
      child.stdin.write(payloadJson);
      child.stdin.end();
    }

    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill();
      reject(new Error(`hook timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function executeCommandAsync(
  config: CommandHookConfig,
  payloadJson: string,
  onRewake?: () => void,
): void {
  const child = exec(config.command, {
    shell: config.shell || undefined,
    env: {
      ...process.env,
      XIAOK_HOOK_PAYLOAD: payloadJson,
    },
  });

  if (child.stdin) {
    child.stdin.write(payloadJson);
    child.stdin.end();
  }

  // For asyncRewake, listen for exit code 2
  if (config.asyncRewake && onRewake) {
    child.on('exit', (code) => {
      if (code === 2) onRewake();
    });
  }

  // Detach — don't let it hold the process
  child.unref();
}

async function executeHttp(
  config: HttpHookConfig,
  timeoutMs: number,
  payloadJson: string,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const url = new URL(config.url);
    const isHttps = url.protocol === 'https:';
    const reqFn = isHttps ? httpsRequest : httpRequest;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payloadJson)),
      ...(config.headers ?? {}),
    };

    const req = reqFn(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 500;
          resolve({
            exitCode: statusCode >= 200 && statusCode < 300 ? 0 : 1,
            stdout: body,
            stderr: statusCode >= 400 ? `HTTP ${statusCode}` : '',
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP hook timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(payloadJson);
    req.end();
  });
}

async function executePrompt(
  config: PromptHookConfig,
  payloadJson: string,
  promptExecutor?: (prompt: string, model?: string) => Promise<string>,
): Promise<CommandResult> {
  if (!promptExecutor) {
    return { exitCode: 1, stdout: '', stderr: 'No promptExecutor configured for prompt-type hooks' };
  }

  const fullPrompt = config.prompt.replace('$ARGUMENTS', payloadJson);
  try {
    const response = await promptExecutor(fullPrompt, config.model);
    const trimmed = response.trim();

    // Parse LLM response — expect {ok: true} or {ok: false, reason: "..."}
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed['ok'] === false) {
          return { exitCode: 2, stdout: trimmed, stderr: (parsed['reason'] as string) ?? 'Blocked by prompt hook' };
        }
        return { exitCode: 0, stdout: trimmed, stderr: '' };
      } catch { /* fall through */ }
    }

    return { exitCode: 0, stdout: trimmed, stderr: '' };
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: String(error) };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHooksRunner(config: HooksRunnerConfig = {}): HooksRunner {
  const defaultTimeout = config.timeoutMs ?? 10000;
  const ctx: Partial<HookSharedContext> = config.context ?? {};
  const executedOnce = new Set<string>();

  // Normalize all hook sources into unified HookConfig[]
  const allHooks: HookConfig[] = [
    ...(config.hooks ?? []).map(normalizeConfig),
    ...(config.pre ?? []).map((h): CommandHookConfig => ({
      type: 'command', command: h.command, events: ['PreToolUse'], tools: h.tools,
    })),
    ...(config.post ?? []).map((h): CommandHookConfig => ({
      type: 'command', command: h.command, events: ['PostToolUse'], tools: h.tools,
    })),
  ];

  async function runHooks(eventName: HookEventName, payload: Record<string, unknown>): Promise<HookRunResult> {
    const merged: HookRunResult = { ok: true };
    const payloadJson = buildPayload(eventName, payload, ctx);

    for (const hook of allHooks) {
      if (!shouldMatch(hook, eventName, payload)) continue;

      // Once-per-session check
      const hookKey = `${(hook as CommandHookConfig).command || (hook as HttpHookConfig).url || (hook as PromptHookConfig).prompt}::${eventName}`;
      if (hook.once) {
        if (executedOnce.has(hookKey)) continue;
        executedOnce.add(hookKey);
      }

      const timeout = hook.timeoutMs ?? defaultTimeout;

      // Async (fire-and-forget) mode
      if (hook.async && hook.type !== 'http' && hook.type !== 'prompt') {
        const cmdConfig = hook as CommandHookConfig;
        executeCommandAsync(cmdConfig, payloadJson, hook.asyncRewake
          ? () => config.onAsyncRewake?.(eventName, payload)
          : undefined,
        );
        merged.async = true;
        continue;
      }

      try {
        let result: CommandResult;
        const hookType = hook.type ?? 'command';

        if (hookType === 'http') {
          result = await executeHttp(hook as HttpHookConfig, timeout, payloadJson);
        } else if (hookType === 'prompt') {
          result = await executePrompt(hook as PromptHookConfig, payloadJson, config.promptExecutor);
        } else {
          result = await executeCommand(hook as CommandHookConfig, timeout, payloadJson);
        }

        const interpreted = interpretExitCode(result, eventName);

        if (interpreted.ok === false) {
          // Blocking result — return immediately
          return {
            ok: false,
            message: interpreted.message,
            preventContinuation: true,
            decision: interpreted.decision,
          };
        }

        if (interpreted.updatedInput) merged.updatedInput = { ...(merged.updatedInput ?? {}), ...interpreted.updatedInput };
        if (interpreted.preventContinuation) merged.preventContinuation = true;
        if (interpreted.additionalContext) {
          merged.additionalContext = merged.additionalContext
            ? `${merged.additionalContext}\n${interpreted.additionalContext}`
            : interpreted.additionalContext;
        }
        if (interpreted.decision) merged.decision = interpreted.decision;
        if (interpreted.message) merged.message = interpreted.message;
      } catch (error) {
        if (BLOCKING_EVENTS.has(eventName)) {
          return { ok: false, message: String(error) };
        }
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
