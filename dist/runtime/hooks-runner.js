import { exec } from 'child_process';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TOOL_EVENTS = new Set([
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
]);
/** Events where exit code 2 blocks execution */
const BLOCKING_EVENTS = new Set([
    'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop',
    'PreCompact', 'PermissionRequest', 'TaskCreated', 'TaskCompleted',
]);
/** Per-event: which field the matcher runs against */
const MATCHER_FIELD = {
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
function matchesEvent(config, eventName) {
    if (!config.events || config.events.length === 0)
        return true;
    return config.events.includes(eventName);
}
/**
 * Matcher logic aligned with Claude Code:
 * - null / '*' → always matches
 * - letters/digits/underscores/pipes only → pipe-separated OR (e.g. 'Bash|Edit')
 * - otherwise → regex
 */
function matchesMatcher(matcher, value) {
    if (!matcher || matcher === '*')
        return true;
    if (/^[a-zA-Z0-9_|]+$/.test(matcher)) {
        return matcher.split('|').includes(value);
    }
    try {
        return new RegExp(matcher).test(value);
    }
    catch {
        return matcher === value;
    }
}
/** Legacy tools array check (backward compat) */
function matchesToolsList(filter, toolName) {
    if (!filter || filter.length === 0)
        return true;
    return filter.some((pattern) => {
        if (pattern === '*')
            return true;
        if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
            const lastSlash = pattern.lastIndexOf('/');
            try {
                return new RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash + 1)).test(toolName);
            }
            catch {
                return false;
            }
        }
        return pattern === toolName;
    });
}
function shouldMatch(config, eventName, payload) {
    if (!matchesEvent(config, eventName))
        return false;
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
function normalizeConfig(raw) {
    if (typeof raw === 'string')
        return { type: 'command', command: raw };
    if (!raw.type)
        return { ...raw, type: 'command' };
    return raw;
}
// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------
function buildPayload(eventName, data, ctx) {
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
function interpretExitCode(result, eventName) {
    // Parse structured JSON from stdout
    const trimmed = result.stdout.trim();
    let parsed = {};
    if (trimmed.startsWith('{')) {
        try {
            parsed = JSON.parse(trimmed);
        }
        catch { /* ignore */ }
    }
    // Exit code 0 → success
    if (result.exitCode === 0) {
        return {
            updatedInput: parsed['updatedInput'],
            preventContinuation: parsed['preventContinuation'],
            additionalContext: parsed['additionalContext'],
            decision: parsed['decision'],
            message: parsed['message'],
        };
    }
    // Exit code 2 → blocking error (for blocking events)
    if (result.exitCode === 2 && BLOCKING_EVENTS.has(eventName)) {
        const reason = result.stderr.trim() || parsed['reason'] || 'Blocked by hook';
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
async function executeCommand(config, timeoutMs, payloadJson) {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const child = exec(config.command, {
            shell: config.shell || undefined,
            env: {
                ...process.env,
                XIAOK_HOOK_PAYLOAD: payloadJson,
            },
        });
        child.stdout?.on('data', (chunk) => { stdout += chunk; });
        child.stderr?.on('data', (chunk) => { stderr += chunk; });
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
function executeCommandAsync(config, payloadJson, onRewake) {
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
            if (code === 2)
                onRewake();
        });
    }
    // Detach — don't let it hold the process
    child.unref();
}
async function executeHttp(config, timeoutMs, payloadJson) {
    return new Promise((resolve, reject) => {
        const url = new URL(config.url);
        const isHttps = url.protocol === 'https:';
        const reqFn = isHttps ? httpsRequest : httpRequest;
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(payloadJson)),
            ...(config.headers ?? {}),
        };
        const req = reqFn({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers,
            timeout: timeoutMs,
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk.toString(); });
            res.on('end', () => {
                const statusCode = res.statusCode ?? 500;
                resolve({
                    exitCode: statusCode >= 200 && statusCode < 300 ? 0 : 1,
                    stdout: body,
                    stderr: statusCode >= 400 ? `HTTP ${statusCode}` : '',
                });
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`HTTP hook timeout after ${timeoutMs}ms`));
        });
        req.on('error', reject);
        req.write(payloadJson);
        req.end();
    });
}
async function executePrompt(config, payloadJson, promptExecutor) {
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
                const parsed = JSON.parse(trimmed);
                if (parsed['ok'] === false) {
                    return { exitCode: 2, stdout: trimmed, stderr: parsed['reason'] ?? 'Blocked by prompt hook' };
                }
                return { exitCode: 0, stdout: trimmed, stderr: '' };
            }
            catch { /* fall through */ }
        }
        return { exitCode: 0, stdout: trimmed, stderr: '' };
    }
    catch (error) {
        return { exitCode: 1, stdout: '', stderr: String(error) };
    }
}
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createHooksRunner(config = {}) {
    const defaultTimeout = config.timeoutMs ?? 10000;
    const ctx = config.context ?? {};
    const executedOnce = new Set();
    // Normalize all hook sources into unified HookConfig[]
    const allHooks = [
        ...(config.hooks ?? []).map(normalizeConfig),
        ...(config.pre ?? []).map((h) => ({
            type: 'command', command: h.command, events: ['PreToolUse'], tools: h.tools,
        })),
        ...(config.post ?? []).map((h) => ({
            type: 'command', command: h.command, events: ['PostToolUse'], tools: h.tools,
        })),
    ];
    async function runHooks(eventName, payload) {
        const merged = { ok: true };
        const payloadJson = buildPayload(eventName, payload, ctx);
        for (const hook of allHooks) {
            if (!shouldMatch(hook, eventName, payload))
                continue;
            // Once-per-session check
            const hookKey = `${hook.command || hook.url || hook.prompt}::${eventName}`;
            if (hook.once) {
                if (executedOnce.has(hookKey))
                    continue;
                executedOnce.add(hookKey);
            }
            const timeout = hook.timeoutMs ?? defaultTimeout;
            // Async (fire-and-forget) mode
            if (hook.async && hook.type !== 'http' && hook.type !== 'prompt') {
                const cmdConfig = hook;
                executeCommandAsync(cmdConfig, payloadJson, hook.asyncRewake
                    ? () => config.onAsyncRewake?.(eventName, payload)
                    : undefined);
                merged.async = true;
                continue;
            }
            try {
                let result;
                const hookType = hook.type ?? 'command';
                if (hookType === 'http') {
                    result = await executeHttp(hook, timeout, payloadJson);
                }
                else if (hookType === 'prompt') {
                    result = await executePrompt(hook, payloadJson, config.promptExecutor);
                }
                else {
                    result = await executeCommand(hook, timeout, payloadJson);
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
                if (interpreted.updatedInput)
                    merged.updatedInput = { ...(merged.updatedInput ?? {}), ...interpreted.updatedInput };
                if (interpreted.preventContinuation)
                    merged.preventContinuation = true;
                if (interpreted.additionalContext) {
                    merged.additionalContext = merged.additionalContext
                        ? `${merged.additionalContext}\n${interpreted.additionalContext}`
                        : interpreted.additionalContext;
                }
                if (interpreted.decision)
                    merged.decision = interpreted.decision;
                if (interpreted.message)
                    merged.message = interpreted.message;
            }
            catch (error) {
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
