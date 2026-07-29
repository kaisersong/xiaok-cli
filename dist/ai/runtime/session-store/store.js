export const KIMI_K3_DURABLE_RESUME_UNSUPPORTED = 'KIMI_K3_DURABLE_RESUME_UNSUPPORTED';
export class KimiK3DurableResumeUnsupportedError extends Error {
    code = KIMI_K3_DURABLE_RESUME_UNSUPPORTED;
    constructor() {
        super(KIMI_K3_DURABLE_RESUME_UNSUPPORTED);
        this.name = 'KimiK3DurableResumeUnsupportedError';
    }
}
export function isKimiK3DurableModel(model) {
    return model === 'k3' || model === 'k3-256k';
}
export function toDurableSessionSnapshot(snapshot) {
    const messages = structuredClone(snapshot.messages);
    const strictKimiModel = isKimiK3DurableModel(snapshot.model);
    return {
        ...snapshot,
        messages: messages.map((message) => ({
            ...message,
            content: message.content.flatMap((block) => {
                const officialKimiReasoning = block.type === 'thinking'
                    && block.reasoningProvenance?.captureVersion === 1
                    && block.reasoningProvenance.source === 'reasoning_content';
                if (block.type === 'thinking'
                    && (strictKimiModel || officialKimiReasoning)) {
                    return [];
                }
                if (!strictKimiModel) {
                    return [block];
                }
                const durableBlock = block;
                delete durableBlock.reasoningProvenance;
                return [durableBlock];
            }),
        })),
    };
}
export function assertKimiK3DurableResumeSupported(snapshot) {
    if (isKimiK3DurableModel(snapshot.model)
        && snapshot.messages.some((message) => message.role === 'assistant')) {
        throw new KimiK3DurableResumeUnsupportedError();
    }
}
export function assertKimiK3TargetResumeSupported(strictKimiTarget, snapshot) {
    if ((strictKimiTarget || isKimiK3DurableModel(snapshot.model))
        && snapshot.messages.some((message) => message.role === 'assistant')) {
        throw new KimiK3DurableResumeUnsupportedError();
    }
}
