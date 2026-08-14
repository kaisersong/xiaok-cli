const MAX_QUEUED_ASSISTANT_DELTA_CHARS = 16 * 1024;
export function createRuntimeFacadeTaskRunner(options) {
    return async (input) => {
        const queuedEvents = [];
        let drainPromise = null;
        let eventWriteError;
        const drainEvents = async () => {
            while (queuedEvents.length > 0) {
                const event = queuedEvents.shift();
                try {
                    await input.emitRuntimeEvent(event);
                }
                catch (error) {
                    eventWriteError ??= error;
                }
            }
            drainPromise = null;
        };
        const enqueueEvent = (event) => {
            const previous = queuedEvents[queuedEvents.length - 1];
            if (previous?.type === 'assistant_delta'
                && event.type === 'assistant_delta'
                && canMergeAssistantDeltas(previous, event)) {
                queuedEvents[queuedEvents.length - 1] = {
                    ...previous,
                    delta: previous.delta + event.delta,
                };
            }
            else {
                queuedEvents.push(event.type === 'assistant_delta' ? { ...event } : event);
            }
            drainPromise ??= drainEvents();
        };
        const unsubscribe = options.hooks.onAny((event) => {
            if (event.sessionId === input.sessionId) {
                enqueueEvent(event);
            }
        });
        let turnError;
        try {
            await options.runtimeFacade.runTurn({
                sessionId: input.sessionId,
                cwd: options.cwd,
                source: options.source,
                input: buildTaskRunnerInput(input),
            }, options.onChunk ?? (() => undefined), input.signal);
        }
        catch (error) {
            turnError = error;
        }
        finally {
            unsubscribe();
        }
        await drainPromise;
        if (turnError !== undefined) {
            throw turnError;
        }
        if (eventWriteError !== undefined) {
            throw eventWriteError;
        }
    };
}
function canMergeAssistantDeltas(previous, next) {
    return previous.sessionId === next.sessionId
        && previous.turnId === next.turnId
        && previous.intentId === next.intentId
        && previous.stepId === next.stepId
        && previous.delta.length + next.delta.length <= MAX_QUEUED_ASSISTANT_DELTA_CHARS;
}
function buildTaskRunnerInput(input) {
    return [{
            type: 'text',
            text: [
                `任务目标：${input.prompt}`,
                `任务类型：${input.understanding.taskType}`,
                `预期交付物：${input.understanding.deliverable}`,
                `汇报对象：${input.understanding.audience}`,
                '材料：',
                ...input.materials.map((material) => (`- ${material.materialId} | ${material.originalName} | ${material.role} | ${material.parseStatus}`)),
            ].join('\n'),
        }];
}
