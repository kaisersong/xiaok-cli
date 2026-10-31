/** The caller creates its one actual pending attachment before entering here. */
export function ownAttachmentLifecycle(settled, budget) {
    let closing = false;
    let closePromise;
    const timedOut = Symbol('activity_startup_timeout');
    const initial = (async () => {
        let timer;
        try {
            const result = await Promise.race([
                settled,
                new Promise(resolve => {
                    timer = setTimeout(() => resolve(timedOut), budget.waitMs);
                    timer.unref?.();
                }),
            ]);
            if (result === timedOut) {
                budget.onDeferred?.();
                return undefined;
            }
            return closing ? undefined : result;
        }
        finally {
            clearTimeout(timer);
        }
    })();
    return {
        initial,
        settled,
        close() {
            closing = true;
            return closePromise ??= settled.then(async (instance) => {
                if (instance)
                    await instance.close();
            });
        },
    };
}
