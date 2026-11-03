/** Exact Coding Plan wires; profile IDs also separate signed histories on model switch. */
export const KIMI_CODING_PROFILES = Object.freeze({
    'k3': 'kimi-k3-coding-openai',
    'k3-256k': 'kimi-k3-256k-coding-openai',
    'k3.1-pro': 'kimi-k3.1-pro-coding-openai',
    'k3.1-pro-highspeed': 'kimi-k3.1-pro-highspeed-coding-openai',
});
export function isKimiCodingModel(model) {
    return typeof model === 'string' && Object.hasOwn(KIMI_CODING_PROFILES, model);
}
export function isStrictKimiK3ProfileId(profileId) {
    return Object.values(KIMI_CODING_PROFILES).some((id) => id === profileId);
}
