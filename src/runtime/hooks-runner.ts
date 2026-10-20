import { spawn } from 'child_process';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { win32 } from 'node:path';

// ---------------------------------------------------------------------------
// Hook event types — aligned with Claude Code hook_event_name schema
// ---------------------------------------------------------------------------

export type HookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'StopFailure';

const VALID_HOOKS: ReadonlySet<string> = new Set<HookEventName>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
]);

export function isKnownHookEvent(name: string): name is HookEventName {
  return VALID_HOOKS.has(name);
}

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
  /** Opt in to strictly validated synchronous JSON control output. */
  outputFormat?: 'json';
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
  /** Bound by the lifecycle host; checked after original work drains. No tool admission. */
  finalHookAdmission?: () => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;
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
  /** Machine-readable rejection for malformed declared control output. */
  errorCode?: 'hook_invalid_json_output';
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
  /** Seal admission and drain original transports, preserving unknown failures. */
  closeAndDrain(): Promise<void>;
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
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'PermissionRequest',
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
  StopFailure: 'error',
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
  if (raw.outputFormat !== undefined && raw.outputFormat !== 'json') throw new Error('hook_output_format_invalid');
  if (raw.outputFormat === 'json' && raw.async) throw new Error('hook_json_async_unsupported');
  const config = !raw.type ? ({ ...raw, type: 'command' } as CommandHookConfig) : raw;
  if (config.events && config.events.length > 0) {
    const filtered = config.events.filter((event) => {
      if (isKnownHookEvent(event)) return true;
      console.warn(
        `[hooks-runner] ignoring unknown hook event "${event}". Supported events: ${[...VALID_HOOKS].join(', ')}`,
      );
      return false;
    });
    config.events = (filtered.length > 0
      ? filtered
      : ['__none__']) as HookEventName[];
  }
  return config;
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
  config: HookConfig,
): Partial<HookRunResult> {
  // Parse structured JSON from stdout
  const trimmed = result.stdout.trim();
  let parsed: Record<string, unknown> = {};
  if (config.outputFormat === 'json') {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object');
      parsed = value as Record<string, unknown>;
      const fields: Array<[string, (field: unknown) => boolean]> = [
        ['updatedInput', field => field !== null && typeof field === 'object' && !Array.isArray(field)],
        ['preventContinuation', field => typeof field === 'boolean'],
        ['additionalContext', field => typeof field === 'string'],
        ['message', field => typeof field === 'string'],
        ['reason', field => typeof field === 'string'],
        ['decision', field => field === 'allow' || field === 'deny'],
        ['ok', field => typeof field === 'boolean'],
      ];
      for (const [key, valid] of fields) {
        if (Object.hasOwn(parsed, key) && !valid(parsed[key])) throw new Error('invalid field');
      }
    } catch {
      if (BLOCKING_EVENTS.has(eventName)) return {
        ok: false, preventContinuation: true, decision: 'deny',
        errorCode: 'hook_invalid_json_output', message: 'hook_invalid_json_output',
      };
      return { message: 'hook_invalid_json_output' };
    }
    // Prompt control is consumed only after the declared output is validated.
    if (config.type === 'prompt' && parsed['ok'] === false) {
      result = { ...result, exitCode: 2, stderr: parsed['reason'] as string | undefined ?? 'Blocked by prompt hook' };
    }
  } else if (trimmed.startsWith('{')) {
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

function executeCommand(
  config: CommandHookConfig,
  timeoutMs: number,
  payloadJson: string,
  signal: AbortSignal,
  extraEnv?: Record<string, string>,
): Promise<CommandResult> {
  signal.throwIfAborted();
  return new Promise<CommandResult>((resolve, reject) => {
    let stdout = '', stderr = '';
    const errors = new Set<unknown>();
    const child = spawn(config.command, [], {
      shell: config.shell || true,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: { ...process.env, ...extraEnv, XIAOK_HOOK_PAYLOAD: payloadJson },
      stdio: 'pipe',
    });
    const remember = (error: unknown) => { errors.add(error); };
    let rootExited = false, treeTerminationRequested = false, treePending = false, settled = false;
    let terminal: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    const finish = () => {
      const closed = terminal;
      if (!closed || treePending || settled) return;
      settled = true;
      if (closed.signal && !errors.size) remember(new Error(`hook terminated by ${closed.signal}`));
      const unknown = [...errors].filter(error => !signal.aborted || error !== signal.reason);
      if (unknown.length) reject(unknown.length === 1 ? unknown[0] : new AggregateError(unknown, 'hook_transport_failed'));
      else if (errors.size) reject(signal.reason);
      else resolve({ exitCode: closed.code ?? 1, stdout, stderr });
    };
    const terminate = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else if (process.platform !== 'win32') child.kill('SIGTERM');
        else {
          if (treeTerminationRequested) return;
          treeTerminationRequested = true;
          // A completed shell PID cannot identify an extant descendant tree.
          if (rootExited || child.exitCode != null || child.signalCode != null) {
            remember(new Error('hook_windows_process_tree_unconfirmed'));
            return;
          }
          const pid = child.pid, systemRoot = process.env.SystemRoot;
          // A failed spawn has no PID/tree; still join its original close/error.
          if (pid === undefined) { child.kill('SIGTERM'); return; }
          if (!Number.isSafeInteger(pid) || pid <= 0 || !systemRoot || !win32.isAbsolute(systemRoot)) {
            remember(new Error('hook_windows_process_tree_identity_unconfirmed'));
            child.kill('SIGTERM');
            return;
          }
          // Only this original, still-live shell PID is addressed. No shell,
          // image-name matching, caller environment override, or detached killer.
          treePending = true;
          try {
            const killer = spawn(win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
              shell: false, stdio: 'ignore', windowsHide: true,
            });
            killer.on('error', remember);
            killer.once('close', code => {
              if (code !== 0) remember(new Error(`hook_windows_tree_termination_failed:${String(code)}`));
              treePending = false;
              finish();
            });
          } catch (error) {
            treePending = false;
            remember(error);
            finish();
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') remember(error);
      }
    };
    const abort = () => { remember(signal.reason); terminate(); };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { remember(new Error(`hook timeout after ${timeoutMs}ms`)); terminate(); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') remember(error); });
    child.on('error', remember);
    child.once('exit', () => { rootExited = true; });
    // exit does not prove stdio or descendants have ended.
    child.once('close', (code, terminationSignal) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 0); remember(new Error('hook_process_group_unconfirmed')); }
        catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') remember(error); }
      }
      terminal = { code, signal: terminationSignal };
      finish();
    });
    child.stdin.end(payloadJson);
    if (signal.aborted) abort();
  });
}

function executeHttp(config: HttpHookConfig, timeoutMs: number, payloadJson: string, signal: AbortSignal): Promise<CommandResult> {
  signal.throwIfAborted();
  return new Promise<CommandResult>((resolve, reject) => {
    const url = new URL(config.url), isHttps = url.protocol === 'https:';
    let body = '', statusCode = 500, requestClosed = false, responseClosed = true, responseEnded = false;
    let response: import('node:http').IncomingMessage | undefined;
    const errors = new Set<unknown>();
    const finish = () => {
      if (!requestClosed || !responseClosed) return;
      const unknown = [...errors].filter(error => !signal.aborted || error !== signal.reason);
      if (unknown.length) reject(unknown.length === 1 ? unknown[0] : new AggregateError(unknown, 'HTTP_hook_transport_failed'));
      else if (errors.size) reject(signal.reason);
      else if (!responseEnded) reject(new Error('HTTP hook response incomplete'));
      else resolve({ exitCode: statusCode >= 200 && statusCode < 300 ? 0 : 1, stdout: body, stderr: statusCode >= 400 ? `HTTP ${statusCode}` : '' });
    };
    const req = (isHttps ? httpsRequest : httpRequest)({
      hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname + url.search, method: 'POST',
      agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payloadJson)), ...(config.headers ?? {}) },
    }, res => {
      response = res; responseClosed = false; statusCode = res.statusCode ?? 500;
      res.on('data', chunk => { body += chunk.toString(); });
      res.on('end', () => { responseEnded = true; });
      res.on('error', error => { errors.add(error); });
      res.once('close', () => { responseClosed = true; finish(); });
    });
    const abort = () => { errors.add(signal.reason); response?.destroy(signal.reason); req.destroy(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { const error = new Error(`HTTP hook timeout after ${timeoutMs}ms`); errors.add(error); response?.destroy(error); req.destroy(error); }, timeoutMs);
    req.on('error', error => { errors.add(error); });
    req.once('close', () => { clearTimeout(timer); signal.removeEventListener('abort', abort); requestClosed = true; finish(); });
    req.end(payloadJson);
    if (signal.aborted) abort();
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
  {
    const response = await promptExecutor(fullPrompt, config.model);
    const trimmed = response.trim();
    if (config.outputFormat === 'json') return { exitCode: 0, stdout: trimmed, stderr: '' };

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
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const emptyConfiguredRunners = new WeakSet<object>();
/** Host factory fact, never a plugin-provided declaration. Callers may omit this
 * genuinely empty runner entirely; this does not qualify any executable hook. */
export function isEmptyConfiguredHooksRunner(runner: HooksRunner): boolean {
  return emptyConfiguredRunners.has(runner);
}

export function createHooksRunner(config: HooksRunnerConfig = {}): HooksRunner {
  const defaultTimeout = config.timeoutMs ?? 10000;
  const ctx: Partial<HookSharedContext> = config.context ?? {};
  const executedOnce = new Set<string>();
  let closed = false, closing: Promise<void> | undefined;
  const closeReason = new Error('hook_owner_closed');
  const controllers = new Set<AbortController>();
  const pending = new Set<Promise<unknown>>(), failures = new Set<unknown>();
  const own = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work);
    void work.then(() => pending.delete(work), error => {
      pending.delete(work); if (error !== closeReason) failures.add(error);
    });
    return work;
  };

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

  function runHooks(eventName: HookEventName, payload: Record<string, unknown>): Promise<HookRunResult> {
    if (closed) return Promise.resolve({ ok: false, message: 'hook_owner_closed' });
    return runOwned(eventName, payload);
  }
  function runOwned(eventName: HookEventName, payload: Record<string, unknown>): Promise<HookRunResult> {
    const controller = new AbortController(); controllers.add(controller);
    const rawWork = new Set<Promise<unknown>>();
    const ownRaw = <T>(raw: Promise<T>): Promise<T> => { rawWork.add(raw); return own(raw); };
    const work = own(Promise.resolve().then(() => executeHooks(eventName, payload, controller.signal, ownRaw)));
    const retire = async () => { await Promise.allSettled([...rawWork]); controllers.delete(controller); };
    void work.then(retire, retire);
    return work;
  }
  async function executeHooks(eventName: HookEventName, payload: Record<string, unknown>, signal: AbortSignal, ownRaw: <T>(work: Promise<T>) => Promise<T>): Promise<HookRunResult> {
    const merged: HookRunResult = { ok: true };
    let permissionHookFailed = false;
    if (!isKnownHookEvent(eventName)) {
      console.warn(
        `[hooks-runner] runHooks called with unknown event "${eventName}"; ignoring.`,
      );
      return merged;
    }
    const payloadJson = buildPayload(eventName, payload, ctx);
    const extraEnv: Record<string, string> = {};
    if (ctx.session_id) {
      extraEnv['XIAOK_CODE_SESSION_ID'] = ctx.session_id;
    }

    for (const hook of allHooks) {
      if (signal.aborted) return { ok: false, message: String(signal.reason) };
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
        const raw = ownRaw(executeCommand(cmdConfig, timeout, payloadJson, signal, extraEnv));
        void ownRaw(raw.then(result => {
          if (!closed && cmdConfig.asyncRewake && result.exitCode === 2) config.onAsyncRewake?.(eventName, payload);
        }, () => {}));
        merged.async = true;
        continue;
      }

      try {
        let result: CommandResult;
        const hookType = hook.type ?? 'command';

        if (hookType === 'http') {
          result = await ownRaw(executeHttp(hook as HttpHookConfig, timeout, payloadJson, signal));
        } else if (hookType === 'prompt') {
          result = await ownRaw(executePrompt(hook as PromptHookConfig, payloadJson, config.promptExecutor)).catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }));
        } else {
          result = await ownRaw(executeCommand(hook as CommandHookConfig, timeout, payloadJson, signal, extraEnv));
        }

        const interpreted = interpretExitCode(result, eventName, hook);

        if (interpreted.ok === false || (eventName === 'PermissionRequest' && interpreted.decision === 'deny')) {
          // Blocking result — return immediately
          return {
            ok: false,
            message: interpreted.message,
            preventContinuation: true,
            decision: interpreted.decision,
            ...(interpreted.errorCode ? { errorCode: interpreted.errorCode } : {}),
          };
        }

        if (eventName === 'PermissionRequest' && result.exitCode !== 0) permissionHookFailed = true;

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
        if (eventName === 'PermissionRequest') {
          // A failed approval bridge has no decision. The registry must still
          // ask locally; keep running later hooks so an explicit deny wins.
          permissionHookFailed = true;
        } else if (BLOCKING_EVENTS.has(eventName)) {
          return { ok: false, message: String(error) };
        }
        merged.message = merged.message
          ? `${merged.message}\n${String(error)}`
          : String(error);
      }
    }

    // Never use an allow from another hook to bypass local confirmation when
    // part of the approval chain failed. Explicit denies already returned.
    if (permissionHookFailed) delete merged.decision;
    return merged;
  }

  const runner: HooksRunner = {
    runHooks,
    closeAndDrain() {
      if (closing) return closing;
      closed = true;
      closing = Promise.resolve().then(async () => {
        // An accepted run can register its raw transport in the next microtask.
        while (pending.size) await Promise.allSettled([...pending]);
        try {
          const payload = await config.finalHookAdmission?.();
          if (payload !== undefined) {
            await runOwned('SessionEnd', payload);
            while (pending.size) await Promise.allSettled([...pending]);
          }
        } catch (error) { if (error !== closeReason) failures.add(error); }
        if (failures.size) throw new AggregateError([...failures], 'hook_physical_drain_unconfirmed');
      });
      for (const controller of controllers) controller.abort(closeReason);
      return closing;
    },

    async runPreHooks(toolName, input) {
      return runHooks('PreToolUse', { tool_name: toolName, tool_input: input });
    },

    async runPostHooks(toolName, input) {
      const result = await runHooks('PostToolUse', { tool_name: toolName, tool_input: input });
      if (result.errorCode === 'hook_invalid_json_output') throw new Error(result.errorCode);
      return result.message ? [result.message] : [];
    },
  };
  if (allHooks.length === 0) emptyConfiguredRunners.add(runner);
  return runner;
}
