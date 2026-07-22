const KIMI_K3_OPENAI_ENDPOINT = 'https://api.kimi.com/coding/v1';
const KIMI_K3_RUNTIME_OPTIONS = {
    contextLimit: 262_144,
    reasoningEffort: 'high',
};
const KIMI_K3_RUNTIME_CONSTRAINTS = {
    maxContextLimit: 1_048_576,
    reasoningEfforts: ['low', 'high', 'max'],
};
const MODEL_REASONING_EFFORTS = ['low', 'high', 'max'];
export function isOfficialKimiK3OpenAIEndpoint(baseUrl) {
    if (!baseUrl || baseUrl.includes('?') || baseUrl.includes('#'))
        return false;
    try {
        const endpoint = new URL(baseUrl);
        return endpoint.protocol === 'https:'
            && endpoint.hostname === 'api.kimi.com'
            && endpoint.port === ''
            && endpoint.username === ''
            && endpoint.password === ''
            && (endpoint.pathname === '/coding/v1' || endpoint.pathname === '/coding/v1/');
    }
    catch {
        return false;
    }
}
function cloneConstraints(constraints) {
    return {
        ...constraints,
        ...(constraints.reasoningEfforts
            ? { reasoningEfforts: [...constraints.reasoningEfforts] }
            : {}),
    };
}
function mergeConstraints(fallback, catalog) {
    if (!fallback)
        return catalog ? cloneConstraints(catalog) : undefined;
    if (!catalog)
        return cloneConstraints(fallback);
    const maxContextLimit = fallback.maxContextLimit === undefined
        ? catalog.maxContextLimit
        : catalog.maxContextLimit === undefined
            ? fallback.maxContextLimit
            : Math.min(fallback.maxContextLimit, catalog.maxContextLimit);
    const reasoningEfforts = fallback.reasoningEfforts === undefined
        ? catalog.reasoningEfforts
        : catalog.reasoningEfforts === undefined
            ? fallback.reasoningEfforts
            : fallback.reasoningEfforts.filter((effort) => catalog.reasoningEfforts?.includes(effort));
    return {
        ...(maxContextLimit !== undefined ? { maxContextLimit } : {}),
        ...(reasoningEfforts ? { reasoningEfforts: [...reasoningEfforts] } : {}),
    };
}
function validateRuntimeOptions(options, constraints) {
    if (options.contextLimit !== undefined) {
        if (!Number.isInteger(options.contextLimit) || options.contextLimit <= 0) {
            throw new Error('contextLimit must be a positive integer');
        }
        if (constraints?.maxContextLimit !== undefined
            && options.contextLimit > constraints.maxContextLimit) {
            throw new Error(`contextLimit must not exceed ${constraints.maxContextLimit}`);
        }
    }
    if (options.reasoningEffort !== undefined) {
        if (!MODEL_REASONING_EFFORTS.includes(options.reasoningEffort)) {
            throw new Error(`reasoningEffort is invalid: ${options.reasoningEffort}`);
        }
        if (constraints?.reasoningEfforts
            && !constraints.reasoningEfforts.includes(options.reasoningEffort)) {
            throw new Error(`reasoningEffort is not allowed: ${options.reasoningEffort}`);
        }
    }
}
export function resolveModelRuntimeOptions(input) {
    const useKimiK3Fallback = input.protocol === 'openai_legacy'
        && input.wireModel === 'k3'
        && isOfficialKimiK3OpenAIEndpoint(input.baseUrl);
    const fallbackOptions = useKimiK3Fallback ? KIMI_K3_RUNTIME_OPTIONS : undefined;
    const fallbackConstraints = useKimiK3Fallback ? KIMI_K3_RUNTIME_CONSTRAINTS : undefined;
    const runtimeOptions = fallbackOptions || input.catalogOptions || input.configuredOptions
        ? {
            ...fallbackOptions,
            ...input.catalogOptions,
            ...input.configuredOptions,
        }
        : undefined;
    const runtimeConstraints = mergeConstraints(fallbackConstraints, input.catalogConstraints);
    if (runtimeOptions) {
        validateRuntimeOptions(runtimeOptions, runtimeConstraints);
    }
    return {
        ...(runtimeOptions ? { runtimeOptions } : {}),
        ...(runtimeConstraints ? { runtimeConstraints } : {}),
    };
}
