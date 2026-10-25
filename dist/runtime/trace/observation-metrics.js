import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { dirname, join } from 'node:path';
const context = new AsyncLocalStorage();
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const tokens = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const family = (name) => ['bash', 'read', 'edit', 'write'].includes(name) ? name : 'other';
class Measurement {
    surface;
    parentRunId;
    limit;
    runId = randomUUID();
    started = performance.now();
    events = [];
    ids = new Map();
    requests = 0;
    closed = false;
    incomplete = false;
    droppedEvents = 0;
    openStreams = 0;
    onStreamsIdle;
    constructor(surface, parentRunId, limit) {
        this.surface = surface;
        this.parentRunId = parentRunId;
        this.limit = limit;
    }
    emit(event) {
        if (this.closed)
            return;
        if (this.events.length >= this.limit) {
            this.droppedEvents++;
            this.incomplete = true;
            return;
        }
        this.events.push(event);
    }
    toolId(raw) {
        if (!raw) {
            this.incomplete = true;
            return null;
        }
        const known = this.ids.get(raw);
        if (known !== undefined)
            return known;
        if (this.ids.size >= 10000) {
            this.incomplete = true;
            return null;
        }
        const id = this.ids.size + 1;
        this.ids.set(raw, id);
        return id;
    }
    requestId() {
        if (this.requests >= 10000) {
            this.incomplete = true;
            return null;
        }
        return ++this.requests;
    }
}
/** Bound our wait even when a filesystem never responds; late errors are consumed. */
async function bounded(action, timeoutMs = 250) {
    const deadline = performance.now() + timeoutMs;
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); });
    try {
        return await Promise.race([action(() => performance.now() >= deadline).catch(() => undefined), timeout]);
    }
    finally {
        clearTimeout(timer);
    }
}
async function hasSafeMacAcl(paths) {
    if (process.platform !== 'darwin')
        return true;
    return new Promise(resolve => {
        childProcess.execFile('/bin/ls', ['-lde', '--', ...paths], {
            timeout: 200, maxBuffer: 64 * 1024, encoding: 'utf8', env: { LC_ALL: 'C' },
        }, (error, stdout) => {
            if (error || !stdout) {
                resolve(false);
                return;
            }
            // ACL lines have numbered ACEs. Only explicit deny entries are harmless.
            const lines = stdout.split('\n');
            if (lines.filter(line => /^d[-rwxstST]{9}[+@ ]/.test(line)).length !== paths.length) {
                resolve(false);
                return;
            }
            const entries = lines.filter(line => /^\s*\d+:/.test(line));
            resolve(entries.every(line => /\sdeny\s+[a-z_,]+\s*$/.test(line)));
        });
    });
}
/** Host-only opt-in. Never an agent tool or a model-visible option. */
export function withObservationMetrics(surface, action, options) {
    const directory = options?.directory ?? process.env['XIAOK_METRICS_DIR'];
    if (!directory || typeof process.getuid !== 'function') {
        try {
            return context.run(undefined, action);
        }
        catch (error) {
            return Promise.reject(error);
        }
    }
    const validateDirectory = () => bounded(async (expired) => {
        if (typeof process.getuid !== 'function')
            return undefined;
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
            return undefined;
        const resolved = await fs.realpath(directory);
        let current = resolved;
        const ancestors = [];
        while (!expired()) {
            const entry = await fs.lstat(current);
            if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.uid !== process.getuid() && entry.uid !== 0))
                return undefined;
            const protectedSticky = entry.uid === 0 && (entry.mode & 0o1000) !== 0;
            if ((entry.mode & 0o022) !== 0 && !protectedSticky)
                return undefined;
            ancestors.push(current);
            const parent = dirname(current);
            if (parent === current)
                return !expired() && await hasSafeMacAcl(ancestors) ? resolved : undefined;
            current = parent;
        }
        return undefined;
    });
    const limit = Number.isSafeInteger(options?.maxEvents) ? Math.max(1, Math.min(10000, options.maxEvents)) : 10000;
    const measurement = new Measurement(surface, context.getStore()?.runId ?? null, limit);
    return context.run(measurement, async () => {
        let outcome = 'rejected';
        let directoryValidation;
        try {
            const pending = action();
            directoryValidation = validateDirectory();
            const result = await pending;
            outcome = 'resolved';
            return result;
        }
        finally {
            const durationMs = performance.now() - measurement.started;
            if (measurement.openStreams > 0) {
                await bounded(() => new Promise(resolve => { measurement.onStreamsIdle = resolve; }), 50);
                measurement.onStreamsIdle = undefined;
            }
            measurement.closed = true;
            const outputRoot = await (directoryValidation ?? validateDirectory());
            if (outputRoot) {
                const report = { schemaVersion: 1, runId: measurement.runId, parentRunId: measurement.parentRunId,
                    surface, durationMs, outcome,
                    complete: !measurement.incomplete && measurement.openStreams === 0,
                    openStreams: measurement.openStreams, droppedEvents: measurement.droppedEvents,
                    events: measurement.events, admission: 'inconclusive',
                    missing: ['transport_attempts', 'wire_payload', 'model_config', 'actual_cost', 'initial_snapshot', 'independent_acceptance'],
                };
                // Metrics are best-effort and cannot replace the task's result/error.
                await bounded(async (expired) => {
                    const temporary = join(outputRoot, `.metrics-${measurement.runId}.tmp`);
                    let created = false;
                    try {
                        const file = await fs.open(temporary, 'wx', 0o600);
                        created = true;
                        try {
                            if (!expired())
                                await file.writeFile(`${JSON.stringify(report)}\n`, 'utf8');
                        }
                        finally {
                            await file.close();
                        }
                        // A closed file becomes visible atomically, without replacing any destination.
                        if (!expired())
                            await fs.link(temporary, join(outputRoot, `metrics-${measurement.runId}.json`));
                    }
                    finally {
                        if (created) {
                            try {
                                await fs.unlink(temporary);
                            }
                            catch { /* Consumers ignore .tmp files. */ }
                        }
                    }
                });
            }
        }
    });
}
export function observationMetricsEnabled() {
    const run = context.getStore();
    return run !== undefined && !run.closed;
}
export function measureToolResult(stage, invocationId, tool, text) {
    const run = context.getStore();
    if (!run || run.closed)
        return;
    try {
        if (!['registry_visible', 'registry_return', 'history_result'].includes(stage)) {
            run.incomplete = true;
            return;
        }
        run.emit({ kind: stage, toolId: run.toolId(invocationId), family: family(tool), bytes: Buffer.byteLength(text, 'utf8'), units: text.length });
    }
    catch {
        run.incomplete = true;
    }
}
export function measureCollector(input) {
    const run = context.getStore();
    if (!run || run.closed)
        return;
    try {
        run.emit({ kind: 'collector', toolId: run.toolId(input.invocationId), family: 'bash',
            bytes: number(input.bytes), chunks: number(input.chunks), durationMs: number(input.durationMs),
            terminalExited: input.terminalExited === true, interrupted: input.interrupted === true,
            complete: input.terminalExited === true && input.interrupted === false });
    }
    catch {
        run.incomplete = true;
    }
}
/** Observes the adapter call, not SDK-internal HTTP attempts or wire payloads. */
export function measureProviderStream(input, openStream) {
    const run = context.getStore();
    if (!run || run.closed)
        return openStream();
    const started = performance.now();
    const requestId = run.requestId();
    let ended = false;
    let usageOrdinal = 0;
    run.openStreams++;
    const end = (status) => {
        if (ended)
            return;
        ended = true;
        run.openStreams--;
        if (run.openStreams === 0)
            run.onStreamsIdle?.();
        run.emit({ kind: 'provider_end', requestId, status, durationMs: performance.now() - started });
    };
    try {
        let bytes = 0;
        let count = 0;
        let unknown = 0;
        for (const message of input.messages)
            for (const block of message.content)
                if (block.type === 'tool_result') {
                    count++;
                    if (typeof block.content === 'string')
                        bytes += Buffer.byteLength(block.content, 'utf8');
                    else
                        unknown++;
                }
        const surface = ['desktop-task', 'cli-chat-task', 'cli-subagent', 'cli-compaction', 'stateless-fresh-side-call'].includes(input.surface) ? input.surface : 'other';
        run.emit({ kind: 'adapter_request', requestId, surface, toolResultBytes: bytes, toolResultCount: count, unknownResults: unknown });
    }
    catch {
        run.incomplete = true;
    }
    let source;
    try {
        source = openStream();
    }
    catch (error) {
        end('rejected');
        throw error;
    }
    return {
        [Symbol.asyncIterator]() {
            let iterator;
            try {
                iterator = source[Symbol.asyncIterator]();
            }
            catch (error) {
                end('rejected');
                throw error;
            }
            const observe = (result, finalStatus) => {
                if (ended)
                    return result;
                if (result.done) {
                    end(finalStatus);
                    return result;
                }
                const chunk = result.value;
                try {
                    if (chunk.type === 'usage') {
                        const usage = chunk.usage;
                        run.emit({ kind: 'provider_usage', requestId, ordinal: ++usageOrdinal,
                            inputTokens: tokens(usage?.inputTokens), outputTokens: tokens(usage?.outputTokens),
                            cacheReadTokens: tokens(usage?.cacheReadInputTokens), cacheWriteTokens: tokens(usage?.cacheCreationInputTokens) });
                    }
                }
                catch {
                    run.incomplete = true;
                }
                return result;
            };
            const forward = (invoke, finalStatus) => {
                let pending;
                try {
                    pending = invoke();
                }
                catch (error) {
                    end('rejected');
                    throw error;
                }
                return Promise.resolve(pending).then(result => observe(result, finalStatus), error => { end('rejected'); throw error; });
            };
            // Do not serialize calls: recovery must be able to return a pending reader.
            return {
                next: (...args) => forward(() => iterator.next(...args), 'completed'),
                return: (...args) => forward(() => {
                    const close = iterator.return;
                    return close ? close.apply(iterator, args) : Promise.resolve({ done: true, value: args[0] });
                }, 'closed'),
                throw: (...args) => forward(() => {
                    const fail = iterator.throw;
                    return fail ? fail.apply(iterator, args) : Promise.reject(args[0]);
                }, 'rejected'),
            };
        },
    };
}
