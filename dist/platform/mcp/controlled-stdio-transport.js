/**
 * ControlledStdioClientTransport (design v58 §1.2 item 7, §3.4, §5.5).
 *
 * Why Xiaok owns this instead of the SDK's StdioClientTransport: the SDK close
 * path only guards its delayed SIGTERM/SIGKILL with `exitCode === null`, never
 * looks at `signalCode` or descendants, and returns before the child is proven
 * gone — so a background kill can still fire later. Reserved bundled providers
 * need exactly one owner for stdin close, TERM, KILL, exit observation and
 * idempotent close.
 *
 * Frozen behaviours:
 *  - `finalEnv` is the complete, final spawn environment. It is passed verbatim;
 *    `process.env` and SDK defaults are never merged in.
 *  - The startup abort listener is installed synchronously in the constructor,
 *    before `start()`/spawn, so a caller/runtime abort during spawn, modern
 *    `server/discover` or legacy initialize enters the same idempotent close.
 *  - Close order and budget: mark expected → `stdin.end()` + 1s → guard →
 *    SIGTERM + 1s → guard → SIGKILL + 1s. Total 3s. Any signal must pass the
 *    construction-time ForceKillGuard; a refusing guard produces a typed
 *    cleanup failure and never a background delayed kill.
 *  - The raw close handle, the final connection and `Client.close()` share one
 *    close promise and one state machine.
 *  - `closed` resolves exactly once and distinguishes host-expected close from
 *    unexpected child exit.
 *  - `stderr`/`pid` are exposed so the SDK classifies this as a stdio probe
 *    transport (design v56/v58: `detectProbeTransportKind`).
 */
import spawn from 'cross-spawn';
export const DEFAULT_CONTROLLED_CLOSE_BUDGET = Object.freeze({
    stdinGraceMs: 1_000,
    termGraceMs: 1_000,
    killGraceMs: 1_000,
});
export class ControlledStdioClientTransport {
    options;
    onclose;
    onerror;
    onmessage;
    child = null;
    state = 'open';
    closePromise = null;
    readBuffer = '';
    expectedClose = false;
    closedResolved = false;
    resolveClosed = () => { };
    cleanup = null;
    startupAborted = false;
    /** Resolves once: host-expected close or unexpected child exit. */
    closed;
    budget;
    constructor(options) {
        this.options = options;
        this.budget = options.closeBudget ?? DEFAULT_CONTROLLED_CLOSE_BUDGET;
        this.closed = new Promise((resolve) => {
            this.resolveClosed = (outcome) => {
                if (this.closedResolved)
                    return;
                this.closedResolved = true;
                resolve(outcome);
            };
        });
        // Installed synchronously, before any spawn can happen.
        const signal = options.startupSignal;
        if (signal) {
            if (signal.aborted)
                this.startupAborted = true;
            else {
                signal.addEventListener('abort', () => {
                    this.startupAborted = true;
                    void this.close();
                }, { once: true });
            }
        }
    }
    /** Dynamic lookup; never a PID snapshot captured before connect. */
    getChildPid() {
        return this.child?.pid ?? null;
    }
    /** Exposed so the SDK classifies this transport as stdio (probe kind). */
    get pid() {
        return this.getChildPid();
    }
    get stderr() {
        return this.child?.stderr ?? null;
    }
    get cleanupStatus() {
        return this.cleanup;
    }
    async start() {
        if (this.state !== 'open')
            throw new Error(`transport already ${this.state}`);
        if (this.startupAborted) {
            await this.close();
            throw new Error('startup aborted before spawn');
        }
        if (this.child)
            throw new Error('transport already started');
        const spawnFn = this.options.spawnImpl ?? spawn;
        const child = spawnFn(this.options.command, [...(this.options.args ?? [])], {
            env: this.options.finalEnv,
            cwd: this.options.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
        });
        this.child = child;
        child.on('error', (error) => {
            this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        });
        child.on('exit', (code, signal) => {
            const outcome = { expected: this.expectedClose, exitCode: code, signal };
            this.resolveClosed(outcome);
            if (!this.expectedClose) {
                this.state = 'closed';
                this.onclose?.();
            }
        });
        child.stdout?.on('data', (chunk) => this.ingest(chunk.toString()));
        // The startup signal may have fired between the checks above and spawn.
        if (this.startupAborted) {
            await this.close();
            throw new Error('startup aborted during spawn');
        }
    }
    async send(message) {
        if (this.state !== 'open')
            throw new Error('transport is not open');
        const stdin = this.child?.stdin;
        if (!stdin)
            throw new Error('transport is not connected');
        await new Promise((resolve, reject) => {
            stdin.write(`${JSON.stringify(message)}\n`, (error) => (error ? reject(error) : resolve()));
        });
    }
    /** Idempotent: every entry point shares this promise and state machine. */
    async close() {
        if (this.closePromise)
            return this.closePromise;
        this.closePromise = this.runControlledClose();
        return this.closePromise;
    }
    async runControlledClose() {
        if (this.state === 'closed')
            return;
        this.state = 'closing';
        this.expectedClose = true; // atomic marker: no further sends
        const child = this.child;
        if (!child) {
            this.state = 'closed';
            this.cleanup = { ok: true, escalation: 'already-exited' };
            this.resolveClosed({ expected: true, exitCode: null, signal: null });
            this.onclose?.();
            return;
        }
        if (child.exitCode !== null || child.signalCode !== null) {
            this.state = 'closed';
            this.cleanup = { ok: true, escalation: 'already-exited' };
            this.resolveClosed({ expected: true, exitCode: child.exitCode, signal: child.signalCode });
            this.onclose?.();
            return;
        }
        const exited = new Promise((resolve) => { child.once('exit', () => resolve()); });
        try {
            child.stdin?.end();
        }
        catch { /* already gone */ }
        if (await this.raceExit(exited, this.budget.stdinGraceMs)) {
            this.finishClose(child, { ok: true, escalation: 'stdin' });
            return;
        }
        const term = await this.escalate(child, 'SIGTERM');
        if (!term.ok) {
            this.finishClose(child, term);
            return;
        }
        if (await this.raceExit(exited, this.budget.termGraceMs)) {
            this.finishClose(child, { ok: true, escalation: 'sigterm' });
            return;
        }
        const kill = await this.escalate(child, 'SIGKILL');
        if (!kill.ok) {
            this.finishClose(child, kill);
            return;
        }
        if (await this.raceExit(exited, this.budget.killGraceMs)) {
            this.finishClose(child, { ok: true, escalation: 'sigkill' });
            return;
        }
        // No further signals: the host never leaves a delayed background kill.
        this.finishClose(child, {
            ok: false,
            reason: 'no_exit',
            diagnostic: `child ${child.pid ?? 'unknown'} still alive after controlled close budget`,
        });
    }
    async escalate(child, signal) {
        const childPid = child.pid;
        if (childPid === undefined) {
            return { ok: false, reason: 'no_exit', diagnostic: 'child pid unavailable; refusing to signal' };
        }
        let allowed;
        try {
            allowed = await this.options.forceKillGuard.canForceKill({ childPid, resourceId: this.options.resourceId });
        }
        catch (error) {
            return {
                ok: false,
                reason: 'guard_threw',
                diagnostic: `force kill guard threw before ${signal}: ${error.message}`,
            };
        }
        if (!allowed) {
            return { ok: false, reason: 'guard_refused', diagnostic: `force kill guard refused ${signal}` };
        }
        try {
            child.kill(signal);
        }
        catch { /* raced with exit */ }
        return { ok: true, escalation: signal === 'SIGTERM' ? 'sigterm' : 'sigkill' };
    }
    async raceExit(exited, ms) {
        const setTimer = this.options.setTimer ?? ((fn, t) => setTimeout(fn, t));
        const clearTimer = this.options.clearTimer ?? ((t) => clearTimeout(t));
        let timer = null;
        const timeout = new Promise((resolve) => {
            timer = setTimer(() => resolve(false), ms);
        });
        const result = await Promise.race([exited.then(() => true), timeout]);
        if (timer)
            clearTimer(timer);
        return result;
    }
    finishClose(child, status) {
        this.cleanup = status;
        this.state = 'closed';
        this.resolveClosed({ expected: true, exitCode: child.exitCode, signal: child.signalCode });
        this.onclose?.();
    }
    ingest(text) {
        this.readBuffer += text;
        let index = this.readBuffer.indexOf('\n');
        while (index >= 0) {
            const line = this.readBuffer.slice(0, index).trim();
            this.readBuffer = this.readBuffer.slice(index + 1);
            if (line) {
                try {
                    this.onmessage?.(JSON.parse(line));
                }
                catch (error) {
                    this.onerror?.(error instanceof Error ? error : new Error(String(error)));
                }
            }
            index = this.readBuffer.indexOf('\n');
        }
    }
}
