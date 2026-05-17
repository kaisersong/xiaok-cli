export function wireTaskBoardToRuntimeSync(options) {
    const withActiveTask = (fn) => {
        const taskId = options.getActiveTaskId();
        if (!taskId) {
            return;
        }
        fn(taskId);
    };
    const unsubscribers = [
        options.hooks.on('tool_started', (event) => {
            if (event.sessionId !== options.sessionId) {
                return;
            }
            withActiveTask((taskId) => {
                options.board.update(options.sessionId, taskId, {
                    status: 'running',
                    lastToolName: event.toolName,
                    latestEvent: `executing ${event.toolName}`,
                    note: `tool:${event.toolName}`,
                });
            });
        }),
        options.hooks.on('tool_finished', (event) => {
            if (event.sessionId !== options.sessionId || event.ok) {
                return;
            }
            withActiveTask((taskId) => {
                options.board.update(options.sessionId, taskId, {
                    blockedReason: `tool ${event.toolName} returned an error`,
                    latestEvent: `${event.toolName} failed`,
                });
            });
        }),
        options.hooks.on('turn_failed', (event) => {
            if (event.sessionId !== options.sessionId) {
                return;
            }
            withActiveTask((taskId) => {
                options.board.update(options.sessionId, taskId, {
                    status: 'failed',
                    blockedReason: event.error.message,
                    latestEvent: 'turn failed',
                });
            });
        }),
        options.hooks.on('turn_aborted', (event) => {
            if (event.sessionId !== options.sessionId) {
                return;
            }
            withActiveTask((taskId) => {
                options.board.update(options.sessionId, taskId, {
                    status: 'cancelled',
                    latestEvent: 'turn aborted',
                });
            });
        }),
    ];
    return () => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
    };
}
