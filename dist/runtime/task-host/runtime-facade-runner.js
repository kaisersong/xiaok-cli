export function createRuntimeFacadeTaskRunner(options) {
    return async (input) => {
        const unsubscribe = options.hooks.onAny((event) => {
            if (event.sessionId === input.sessionId) {
                input.emitRuntimeEvent(event);
            }
        });
        try {
            await options.runtimeFacade.runTurn({
                sessionId: input.sessionId,
                cwd: options.cwd,
                source: options.source,
                input: buildTaskRunnerInput(input),
            }, options.onChunk ?? (() => undefined), input.signal);
        }
        finally {
            unsubscribe();
        }
    };
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
