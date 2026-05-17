export function resolveConfiguredModelBinding(config, requestedModelId = config.defaultModelId) {
    const modelEntry = config.models[requestedModelId];
    if (!modelEntry) {
        throw new Error(`未找到默认模型: ${requestedModelId}`);
    }
    const providerId = modelEntry.provider;
    const providerConfig = config.providers[providerId];
    if (!providerConfig) {
        throw new Error(`未找到模型对应的 provider: ${providerId}`);
    }
    return {
        modelId: requestedModelId,
        providerId,
        modelEntry,
        providerConfig,
    };
}
