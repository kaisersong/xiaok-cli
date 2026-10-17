import { createHash } from 'node:crypto';
export const SEMANTIC_PRICE_BOUNDS = Object.freeze({ inputMissUpper: 300000000, inputHitLower: 3000000, outputUpper: 1200000000 });
function invalid() { throw Error('SEMANTIC_POLICY_INVALID'); }
function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length
        || keys.some(key => !Object.hasOwn(value, key))
        || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d)))
        invalid();
}
function integer(value, min = 0) { return Number.isSafeInteger(value) && Number(value) >= min; }
/** Validates user supplied pricing bounds, not provider qualification or authorization. */
export function validateSemanticPolicy(value, now, parentExpiresAt) {
    exact(value, ['version', 'mode', 'currency', 'maxCalls', 'maxCostUnits', 'maxOutputTokens', 'expiresAt', 'pricing']);
    if (!integer(now) || !integer(parentExpiresAt) || value.version !== 1
        || !['automatic', 'mechanism-experiment'].includes(String(value.mode)) || value.currency !== 'USD'
        || !integer(value.maxCalls, 1) || value.maxCalls > 256 || !integer(value.maxCostUnits, 1)
        || !integer(value.maxOutputTokens, 1) || value.maxOutputTokens > 8192
        || !integer(value.expiresAt) || value.expiresAt <= now || value.expiresAt > parentExpiresAt)
        invalid();
    const price = value.pricing;
    exact(price, ['source', 'model', 'inputMissUnitsPerMillion', 'inputHitUnitsPerMillion', 'outputUnitsPerMillion', 'validUntil']);
    if (price.source !== 'https://api-docs.deepseek.com/quick_start/pricing' || price.model !== 'deepseek-flash'
        || !integer(price.inputMissUnitsPerMillion, 1) || !integer(price.inputHitUnitsPerMillion)
        || price.inputHitUnitsPerMillion > price.inputMissUnitsPerMillion || !integer(price.outputUnitsPerMillion, 1)
        || price.inputMissUnitsPerMillion < SEMANTIC_PRICE_BOUNDS.inputMissUpper || price.outputUnitsPerMillion < SEMANTIC_PRICE_BOUNDS.outputUpper
        || !integer(price.validUntil) || price.validUntil <= now || value.expiresAt > price.validUntil)
        invalid();
    const result = structuredClone(value);
    // Fixed field order makes semantically identical price policies have the same revision.
    const canonical = { source: price.source, model: price.model, currency: value.currency,
        inputMissUnitsPerMillion: price.inputMissUnitsPerMillion, inputHitUnitsPerMillion: price.inputHitUnitsPerMillion,
        outputUnitsPerMillion: price.outputUnitsPerMillion, validUntil: price.validUntil };
    return { ...result, priceRevision: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') };
}
/** Worst case uses cache miss for every input token; money is integer billionths. */
export function computeSemanticRequestCostUpperBound(policy, inputTokenUpperBound, outputTokenUpperBound) {
    if (!integer(inputTokenUpperBound) || !integer(outputTokenUpperBound, 1) || outputTokenUpperBound > policy.maxOutputTokens
        || !integer(policy.pricing.inputMissUnitsPerMillion, 1) || !integer(policy.pricing.outputUnitsPerMillion, 1))
        invalid();
    const numerator = BigInt(inputTokenUpperBound) * BigInt(policy.pricing.inputMissUnitsPerMillion)
        + BigInt(outputTokenUpperBound) * BigInt(policy.pricing.outputUnitsPerMillion);
    const units = (numerator + 999999n) / 1000000n;
    if (units > BigInt(Number.MAX_SAFE_INTEGER))
        invalid();
    return Number(units);
}
