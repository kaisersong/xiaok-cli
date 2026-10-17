import { spawn } from 'child_process';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
const VALID_HOOKS = new Set([
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
export function isKnownHookEvent(name) {
    return VALID_HOOKS.has(name);
}
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TOOL_EVENTS = new Set([
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
]);
/** Events where exit code 2 blocks execution */
const BLOCKING_EVENTS = new Set([
    'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'PermissionRequest',
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
    StopFailure: 'error',
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
    const config = !raw.type ? { ...raw, type: 'command' } : raw;
    if (config.events && config.events.length > 0) {
        const filtered = config.events.filter((event) => {
            if (isKnownHookEvent(event))
                return true;
            console.warn(`[hooks-runner] ignoring unknown hook event "${event}". Supported events: ${[...VALID_HOOKS].join(', ')}`);
            return false;
        });
        config.events = (filtered.length > 0
            ? filtered
            : ['__none__']);
    }
    return config;
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
function executeCommand(config, timeoutMs, payloadJson, signal, extraEnv) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        let stdout = '', stderr = '';
        const errors = new Set();
        const child = spawn(config.command, [], {
            shell: config.shell || true,
            detached: process.platform !== 'win32',
            windowsHide: true,
            env: { ...process.env, ...extraEnv, XIAOK_HOOK_PAYLOAD: payloadJson },
            stdio: 'pipe',
        });
        const remember = (error) => { errors.add(error); };
        const terminate = () => {
            try {
                if (process.platform !== 'win32' && child.pid)
                    process.kill(-child.pid, 'SIGTERM');
                else
                    child.kill('SIGTERM');
            }
            catch (error) {
                if (error?.code !== 'ESRCH')
                    remember(error);
            }
        };
        const abort = () => { remember(signal.reason); terminate(); };
        signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => { remember(new Error(`hook timeout after ${timeoutMs}ms`)); terminate(); }, timeoutMs);
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.stdin.on('error', error => { if (error.code !== 'EPIPE')
            remember(error); });
        child.on('error', remember);
        // exit does not prove stdio or descendants have ended.
        child.once('close', (code, terminationSignal) => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            if (process.platform !== 'win32' && child.pid) {
                try {
                    process.kill(-child.pid, 0);
                    remember(new Error('hook_process_group_unconfirmed'));
                }
                catch (error) {
                    if (error?.code !== 'ESRCH')
                        remember(error);
                }
            }
            if (terminationSignal && !errors.size)
                remember(new Error(`hook terminated by ${terminationSignal}`));
            const unknown = [...errors].filter(error => !signal.aborted || error !== signal.reason);
            if (unknown.length)
                reject(unknown.length === 1 ? unknown[0] : new AggregateError(unknown, 'hook_transport_failed'));
            else if (errors.size)
                reject(signal.reason);
            else
                resolve({ exitCode: code ?? 1, stdout, stderr });
        });
        child.stdin.end(payloadJson);
        if (signal.aborted)
            abort();
    });
}
function executeHttp(config, timeoutMs, payloadJson, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const url = new URL(config.url), isHttps = url.protocol === 'https:';
        let body = '', statusCode = 500, requestClosed = false, responseClosed = true, responseEnded = false;
        let response;
        const errors = new Set();
        const finish = () => {
            if (!requestClosed || !responseClosed)
                return;
            const unknown = [...errors].filter(error => !signal.aborted || error !== signal.reason);
            if (unknown.length)
                reject(unknown.length === 1 ? unknown[0] : new AggregateError(unknown, 'HTTP_hook_transport_failed'));
            else if (errors.size)
                reject(signal.reason);
            else if (!responseEnded)
                reject(new Error('HTTP hook response incomplete'));
            else
                resolve({ exitCode: statusCode >= 200 && statusCode < 300 ? 0 : 1, stdout: body, stderr: statusCode >= 400 ? `HTTP ${statusCode}` : '' });
        };
        const req = (isHttps ? httpsRequest : httpRequest)({
            hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname + url.search, method: 'POST',
            agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payloadJson)), ...(config.headers ?? {}) },
        }, res => {
            response = res;
            responseClosed = false;
            statusCode = res.statusCode ?? 500;
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
        if (signal.aborted)
            abort();
    });
}
async function executePrompt(config, payloadJson, promptExecutor) {
    if (!promptExecutor) {
        return { exitCode: 1, stdout: '', stderr: 'No promptExecutor configured for prompt-type hooks' };
    }
    const fullPrompt = config.prompt.replace('$ARGUMENTS', payloadJson);
    {
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
}
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
const emptyConfiguredRunners = new WeakSet();
/** Host factory fact, never a plugin-provided declaration. Callers may omit this
 * genuinely empty runner entirely; this does not qualify any executable hook. */
export function isEmptyConfiguredHooksRunner(runner) {
    return emptyConfiguredRunners.has(runner);
}
export function createHooksRunner(config = {}) {
    const defaultTimeout = config.timeoutMs ?? 10000;
    const ctx = config.context ?? {};
    const executedOnce = new Set();
    let closed = false, closing;
    const closeReason = new Error('hook_owner_closed');
    const controllers = new Set();
    const pending = new Set(), failures = new Set();
    const own = (work) => {
        pending.add(work);
        void work.then(() => pending.delete(work), error => {
            pending.delete(work);
            if (error !== closeReason)
                failures.add(error);
        });
        return work;
    };
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
    function runHooks(eventName, payload) {
        if (closed)
            return Promise.resolve({ ok: false, message: 'hook_owner_closed' });
        return runOwned(eventName, payload);
    }
    function runOwned(eventName, payload) {
        const controller = new AbortController();
        controllers.add(controller);
        const rawWork = new Set();
        const ownRaw = (raw) => { rawWork.add(raw); return own(raw); };
        const work = own(Promise.resolve().then(() => executeHooks(eventName, payload, controller.signal, ownRaw)));
        const retire = async () => { await Promise.allSettled([...rawWork]); controllers.delete(controller); };
        void work.then(retire, retire);
        return work;
    }
    async function executeHooks(eventName, payload, signal, ownRaw) {
        const merged = { ok: true };
        let permissionHookFailed = false;
        if (!isKnownHookEvent(eventName)) {
            console.warn(`[hooks-runner] runHooks called with unknown event "${eventName}"; ignoring.`);
            return merged;
        }
        const payloadJson = buildPayload(eventName, payload, ctx);
        const extraEnv = {};
        if (ctx.session_id) {
            extraEnv['XIAOK_CODE_SESSION_ID'] = ctx.session_id;
        }
        for (const hook of allHooks) {
            if (signal.aborted)
                return { ok: false, message: String(signal.reason) };
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
                const raw = ownRaw(executeCommand(cmdConfig, timeout, payloadJson, signal, extraEnv));
                void ownRaw(raw.then(result => {
                    if (!closed && cmdConfig.asyncRewake && result.exitCode === 2)
                        config.onAsyncRewake?.(eventName, payload);
                }, () => { }));
                merged.async = true;
                continue;
            }
            try {
                let result;
                const hookType = hook.type ?? 'command';
                if (hookType === 'http') {
                    result = await ownRaw(executeHttp(hook, timeout, payloadJson, signal));
                }
                else if (hookType === 'prompt') {
                    result = await ownRaw(executePrompt(hook, payloadJson, config.promptExecutor)).catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }));
                }
                else {
                    result = await ownRaw(executeCommand(hook, timeout, payloadJson, signal, extraEnv));
                }
                const interpreted = interpretExitCode(result, eventName);
                if (interpreted.ok === false || (eventName === 'PermissionRequest' && interpreted.decision === 'deny')) {
                    // Blocking result — return immediately
                    return {
                        ok: false,
                        message: interpreted.message,
                        preventContinuation: true,
                        decision: interpreted.decision,
                    };
                }
                if (eventName === 'PermissionRequest' && result.exitCode !== 0)
                    permissionHookFailed = true;
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
                if (eventName === 'PermissionRequest') {
                    // A failed approval bridge has no decision. The registry must still
                    // ask locally; keep running later hooks so an explicit deny wins.
                    permissionHookFailed = true;
                }
                else if (BLOCKING_EVENTS.has(eventName)) {
                    return { ok: false, message: String(error) };
                }
                merged.message = merged.message
                    ? `${merged.message}\n${String(error)}`
                    : String(error);
            }
        }
        // Never use an allow from another hook to bypass local confirmation when
        // part of the approval chain failed. Explicit denies already returned.
        if (permissionHookFailed)
            delete merged.decision;
        return merged;
    }
    const runner = {
        runHooks,
        closeAndDrain() {
            if (closing)
                return closing;
            closed = true;
            closing = Promise.resolve().then(async () => {
                // An accepted run can register its raw transport in the next microtask.
                while (pending.size)
                    await Promise.allSettled([...pending]);
                try {
                    const payload = await config.finalHookAdmission?.();
                    if (payload !== undefined) {
                        await runOwned('SessionEnd', payload);
                        while (pending.size)
                            await Promise.allSettled([...pending]);
                    }
                }
                catch (error) {
                    if (error !== closeReason)
                        failures.add(error);
                }
                if (failures.size)
                    throw new AggregateError([...failures], 'hook_physical_drain_unconfirmed');
            });
            for (const controller of controllers)
                controller.abort(closeReason);
            return closing;
        },
        async runPreHooks(toolName, input) {
            return runHooks('PreToolUse', { tool_name: toolName, tool_input: input });
        },
        async runPostHooks(toolName, input) {
            const result = await runHooks('PostToolUse', { tool_name: toolName, tool_input: input });
            return result.message ? [result.message] : [];
        },
    };
    if (allHooks.length === 0)
        emptyConfiguredRunners.add(runner);
    return runner;
}
