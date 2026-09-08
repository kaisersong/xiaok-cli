export function resolveModelRecoveryPolicy(env = process.env) {
    const number = (raw, fallback) => raw?.trim() && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : fallback;
    return { windowMs: number(env.XIAOK_MODEL_RECOVERY_WINDOW_MS, 30 * 60_000),
        idleMs: number(env.XIAOK_TURN_TIMEOUT_MS, 4 * 60_000), initialDelayMs: 2000, maxDelayMs: 30_000 };
}
function recoverable(error) {
    if (!error || typeof error !== 'object')
        return false;
    const seen = new Set();
    let current = error;
    let transient = false;
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        const e = current;
        // A permanent cause always wins over a wrapper's generic network wording.
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)
            return false;
        if (e.name === 'AbortError')
            return false;
        transient ||= e.status === 408 || e.status === 429 || (e.status !== undefined && e.status >= 500)
            || e.name === 'TimeoutError'
            || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ERR_STREAM_PREMATURE_CLOSE|UND_ERR/i.test(e.code ?? '')
            || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|terminated|socket hang up|fetch failed|network|premature close|connection reset|timed?\s*out/i.test(e.message ?? '');
        current = e.cause;
    }
    return transient;
}
function wait(promise, signal, timeoutMs, onTimeout) {
    return new Promise((resolve, reject) => {
        let timer;
        let abortTimer;
        const cleanup = () => { clearTimeout(abortTimer); clearTimeout(timer); signal.removeEventListener('abort', abort); };
        // Allow already-produced final usage to drain, but never wait for a stuck reader.
        const abort = () => { abortTimer ??= setTimeout(() => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, 0); };
        if (signal.aborted)
            abort();
        signal.addEventListener('abort', abort, { once: true });
        if (Number.isFinite(timeoutMs))
            timer = setTimeout(() => {
                cleanup();
                onTimeout();
                reject(Object.assign(new Error('model stream idle timeout'), { code: 'ETIMEDOUT' }));
            }, Math.max(1, Math.min(timeoutMs, 2 ** 31 - 1)));
        promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
}
/** Retries only model reads. Callers never execute tools until a complete stream commits. */
export async function* recoverModelStream(input) {
    const policy = input.policy ?? resolveModelRecoveryPolicy();
    let recoveryStarted, attempt = 0;
    const exhausted = () => new Error('模型连接持续不可用，自动恢复窗口已耗尽；已完成的工作保留，可稍后继续。');
    while (true) {
        input.signal.throwIfAborted();
        const remaining = recoveryStarted === undefined ? Infinity : policy.windowMs - (Date.now() - recoveryStarted);
        if (remaining <= 0)
            throw exhausted();
        const owned = new AbortController();
        const signal = AbortSignal.any([input.signal, owned.signal]);
        let iterator;
        let completed = false;
        try {
            iterator = input.open(signal)[Symbol.asyncIterator]();
            while (true) {
                input.signal.throwIfAborted();
                const budget = recoveryStarted === undefined ? Infinity : policy.windowMs - (Date.now() - recoveryStarted);
                if (budget <= 0)
                    throw exhausted();
                const next = await wait(iterator.next(), input.signal, Math.min(policy.idleMs > 0 ? policy.idleMs : Infinity, budget), () => owned.abort());
                if (next.done || next.value.type !== 'usage')
                    input.signal.throwIfAborted();
                if (next.done) {
                    completed = true;
                    return;
                }
                if (next.value.type === 'done')
                    completed = true;
                yield next.value;
                if (next.value.type === 'done') {
                    completed = true;
                    return;
                }
            }
        }
        catch (error) {
            input.signal.throwIfAborted();
            if (!recoverable(error) || policy.windowMs === 0)
                throw error;
            recoveryStarted ??= Date.now();
            const remainingMs = policy.windowMs - (Date.now() - recoveryStarted);
            if (remainingMs <= 0)
                throw exhausted();
            const delayMs = Math.min(policy.initialDelayMs * 2 ** Math.min(attempt++, 10), policy.maxDelayMs, remainingMs);
            owned.abort();
            input.onRetry?.({ attempt, delayMs, remainingMs });
            let timer;
            try {
                await wait(new Promise(resolve => { timer = setTimeout(resolve, delayMs); }), input.signal, Infinity, () => { });
            }
            finally {
                clearTimeout(timer);
            }
        }
        finally {
            if (!completed)
                owned.abort();
            // An uncooperative model reader must not hold the retry owner forever.
            try {
                const closing = iterator?.return?.();
                if (closing)
                    void Promise.resolve(closing).catch(() => { });
            }
            catch { /* already failed */ }
        }
    }
}
