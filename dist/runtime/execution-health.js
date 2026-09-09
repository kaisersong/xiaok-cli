export function resolveExecutionIdleMs(raw, fallback = 30 * 60_000) {
    if (raw === undefined)
        return fallback;
    const value = Number(raw);
    if (!raw.trim() || !Number.isSafeInteger(value) || value < 0 || value > 2 ** 31 - 1)
        throw new Error('Invalid execution idle timeout: expected integer milliseconds >= 0');
    return value;
}
export function createExecutionHealthMonitor(options) {
    let timer;
    let stopped = false;
    let state = 'running';
    const waiting = new Set();
    const publish = (next) => { if (state !== next) {
        state = next;
        try {
            options.onState?.(next);
        }
        catch (error) {
            console.warn('[execution-health] status observer failed', error instanceof Error ? error.message : 'unknown');
        }
    } };
    const arm = () => {
        clearTimeout(timer);
        if (stopped || waiting.size || options.idleMs === 0)
            return;
        timer = setTimeout(() => { stopped = true; publish('cleanup_pending'); options.onStalled(); }, options.idleMs);
        timer.unref?.();
    };
    arm();
    return {
        progress(recovering = false) { if (!stopped) {
            if (!waiting.size)
                publish(recovering ? 'recovering' : 'running');
            arm();
        } },
        delegate(id) { if (!stopped) {
            waiting.add(id);
            clearTimeout(timer);
        } },
        wait(id) { if (!stopped) {
            waiting.add(id);
            clearTimeout(timer);
            publish('waiting');
        } },
        resume(id) { if (!stopped && waiting.delete(id) && !waiting.size) {
            publish('running');
            arm();
        } },
        cancel() { if (!stopped) {
            stopped = true;
            clearTimeout(timer);
            publish('cleanup_pending');
        } },
        dispose() { stopped = true; clearTimeout(timer); waiting.clear(); },
    };
}
