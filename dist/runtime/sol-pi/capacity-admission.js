import { isFrozenDeepSeekCounter, countDeepSeekSerializedRequest } from './deepseek-capacity-profile.js';
import { createTransportAuthorizationError } from './transport-lease.js';
const profiles = new WeakMap();
function fail(reason = 'CAPACITY_NOT_READY') {
    const error = createTransportAuthorizationError();
    error.message += `:${reason}`;
    throw error;
}
function integer(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
/** Explicit host-frozen official recipe only; no automatic dependency provisioning. */
export function resolveProductionCapacityProfile(identity) {
    if (!['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/v1/chat/completions'].includes(identity.destination)
        || identity.model !== 'deepseek-flash' || identity.protocol !== 'openai_legacy' || identity.profileId !== 'generic-openai'
        || !isFrozenDeepSeekCounter(identity.counter))
        return undefined;
    const counter = identity.counter;
    const cap = Object.freeze(Object.create(null));
    profiles.set(cap, Object.freeze({ qualification: 'official-deepseek-recipe', destination: identity.destination, model: identity.model,
        windowTokens: 1_000_000, outputLimitField: 'max_tokens', defaultOutputTokens: 393216, safetyMarginTokens: 4096,
        countSerializedInput: (body) => countDeepSeekSerializedRequest(counter, body) }));
    return cap;
}
/** HOST TEST HARNESS ONLY. This registers a controlled-protocol fixture, not a
 * verified real-provider profile. Never select this factory in product config or
 * live eval. The trust boundary is host code capability, not NODE_ENV/evidenceId. */
export function createTestOnlyCapacityProfile(input) {
    if (!input.destination || !input.model || !integer(input.windowTokens) || input.windowTokens === 0
        || !integer(input.safetyMarginTokens) || input.safetyMarginTokens === 0 || !input.outputLimitField
        || typeof input.countSerializedInput !== 'function'
        || (input.defaultOutputTokens !== undefined && (!integer(input.defaultOutputTokens) || input.defaultOutputTokens === 0)))
        fail();
    const cap = Object.freeze(Object.create(null));
    profiles.set(cap, Object.freeze({ ...input, qualification: 'test-fixture' }));
    return cap;
}
export function assertCapacityProfileReady(profile, destination, model) {
    const value = profile && profiles.get(profile);
    if (!value || value.destination !== destination || value.model !== model)
        fail();
}
export function measureRequestCapacity(profile, input) {
    assertCapacityProfileReady(profile, input.destination, input.model);
    const value = profiles.get(profile);
    let parsed;
    try {
        const candidate = JSON.parse(input.serializedBody);
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            fail();
        parsed = candidate;
    }
    catch {
        fail();
    }
    if (parsed.model !== value.model)
        fail();
    // Competing output-limit dialects are not interchangeable. A profile may not
    // reserve one field while the provider obeys another larger field.
    for (const field of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) {
        if (field !== value.outputLimitField && Object.hasOwn(parsed, field))
            fail();
    }
    const output = Object.hasOwn(parsed, value.outputLimitField) ? parsed[value.outputLimitField] : value.defaultOutputTokens;
    if (!integer(output) || output === 0)
        fail();
    let count;
    try {
        count = value.countSerializedInput(input.serializedBody);
    }
    catch {
        fail();
    }
    if (!integer(count)) {
        // A mistaken async host counter must not leak a rejected promise.
        if (count instanceof Promise)
            void count.catch(() => { });
        fail();
    }
    const total = count + output + value.safetyMarginTokens;
    if (!integer(total))
        fail();
    return { inputTokenUpperBound: count, actualOutputReserve: output, totalTokenUpperBound: total, qualification: value.qualification };
}
export function getCapacityProfileBudget(profile) {
    const value = profiles.get(profile);
    if (!value)
        fail();
    return { windowTokens: value.windowTokens, outputLimitField: value.outputLimitField,
        defaultOutputTokens: value.defaultOutputTokens, safetyMarginTokens: value.safetyMarginTokens };
}
export function checkRequestCapacity(profile, input) {
    const result = measureRequestCapacity(profile, input);
    if (result.totalTokenUpperBound > getCapacityProfileBudget(profile).windowTokens)
        fail('CONTEXT_BUDGET_EXCEEDED');
    return result;
}
