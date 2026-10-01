const KIMI_K3_OPENAI_ENDPOINT = 'https://api.kimi.com/coding/v1';
const KIMI_K3_RUNTIME_OPTIONS = {
    contextLimit: 262_144,
    reasoningEffort: 'high',
};
const KIMI_K3_RUNTIME_CONSTRAINTS = {
    maxContextLimit: 1_048_576,
    reasoningEfforts: ['low', 'high', 'max'],
};
const MODEL_REASONING_EFFORTS = [
    'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
];
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
export function canonicalizeOfficialKimiK3OpenAIEndpoint(baseUrl) {
    return isOfficialKimiK3OpenAIEndpoint(baseUrl)
        ? KIMI_K3_OPENAI_ENDPOINT
        : baseUrl;
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
/** Ordered native tiers; for an even count, choose the upper middle tier. */
export function getDefaultModelReasoningEffort(efforts) {
    return efforts[Math.floor(efforts.length / 2)];
}
export function resolveModelRuntimeOptions(input) {
    const useKimiK3Fallback = input.protocol === 'openai_legacy'
        && (input.wireModel === 'k3' || input.wireModel === 'k3-256k')
        && isOfficialKimiK3OpenAIEndpoint(input.baseUrl);
    const fallbackOptions = useKimiK3Fallback ? KIMI_K3_RUNTIME_OPTIONS : undefined;
    const fallbackConstraints = useKimiK3Fallback ? KIMI_K3_RUNTIME_CONSTRAINTS : undefined;
    let runtimeOptions = fallbackOptions || input.catalogOptions || input.configuredOptions
        ? {
            ...fallbackOptions,
            ...input.catalogOptions,
            ...input.configuredOptions,
        }
        : undefined;
    let runtimeConstraints = mergeConstraints(fallbackConstraints, input.catalogConstraints);
    if (input.reasoningEfforts !== undefined) {
        const defaultEffort = getDefaultModelReasoningEffort(input.reasoningEfforts);
        if (runtimeOptions) {
            const { reasoningEffort: _effort, ...otherOptions } = runtimeOptions;
            runtimeOptions = {
                ...otherOptions,
                ...(defaultEffort ? { reasoningEffort: input.configuredOptions?.reasoningEffort ?? defaultEffort } : {}),
            };
        }
        else if (defaultEffort) {
            runtimeOptions = { reasoningEffort: defaultEffort };
        }
        if (runtimeConstraints) {
            const { reasoningEfforts: _efforts, ...otherConstraints } = runtimeConstraints;
            runtimeConstraints = {
                ...otherConstraints,
                ...(defaultEffort ? { reasoningEfforts: [...input.reasoningEfforts] } : {}),
            };
        }
    }
    if (runtimeOptions) {
        validateRuntimeOptions(runtimeOptions, runtimeConstraints);
    }
    return {
        ...(runtimeOptions ? { runtimeOptions } : {}),
        ...(runtimeConstraints ? { runtimeConstraints } : {}),
    };
}
