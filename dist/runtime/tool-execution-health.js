import { createExecutionHealthMonitor, resolveExecutionIdleMs } from './execution-health.js';
/** Cancellation requests do not settle this promise; the actual tool must exit. */
export async function runMonitoredTool(options) {
    const { context } = options;
    const owned = new AbortController();
    let active = true;
    const idleMs = resolveExecutionIdleMs(options.idleMs === undefined ? process.env.XIAOK_TOOL_IDLE_TIMEOUT_MS : String(options.idleMs));
    const health = createExecutionHealthMonitor({ idleMs,
        onState: state => { if (context?.onExecutionHealth)
            context.onExecutionHealth(state);
        else if (state === 'cleanup_pending')
            console.warn(`[tool-health] ${options.name}: waiting for actual execution settlement`); },
        onStalled: () => owned.abort(new Error(`TOOL_IDLE_TIMEOUT: ${options.name}; cancellation requested; waiting for execution to settle`)),
    });
    const observe = (callback) => { try {
        callback();
    }
    catch (error) {
        console.warn('[tool-health] progress observer failed', error instanceof Error ? error.message : 'unknown');
    } };
    const onAbort = () => health.cancel();
    context?.signal?.addEventListener('abort', onAbort, { once: true });
    if (context?.signal?.aborted)
        onAbort();
    try {
        try {
            context?.onExecutionHealth?.('running');
        }
        catch (error) {
            console.warn('[tool-health] status observer failed', error instanceof Error ? error.message : 'unknown');
        }
        if (options.waitsForUser)
            health.wait('user');
        context?.signal?.throwIfAborted();
        const monitoredContext = context ? { ...context,
            signal: context.signal ? AbortSignal.any([context.signal, owned.signal]) : owned.signal,
            executionProgress: { progress: () => { if (active) {
                    health.progress();
                    observe(() => context.executionProgress?.progress());
                } },
                wait: id => { if (active) {
                    health.wait(id);
                    observe(() => context.executionProgress?.wait(id));
                } },
                resume: id => { if (active) {
                    health.resume(id);
                    observe(() => context.executionProgress?.resume(id));
                } } },
        } : undefined;
        // The strict provider projection freezes its public snapshot. Trusted
        // monitoring may add callbacks/signal composition, not thaw that contract.
        if (monitoredContext && Object.isFrozen(context))
            Object.freeze(monitoredContext);
        const result = await options.run(monitoredContext);
        owned.signal.throwIfAborted();
        context?.signal?.throwIfAborted();
        return result;
    }
    catch (error) {
        owned.signal.throwIfAborted();
        throw error;
    }
    finally {
        active = false;
        health.dispose();
        context?.signal?.removeEventListener('abort', onAbort);
    }
}
