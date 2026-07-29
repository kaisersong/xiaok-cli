import { OpenAIAdapter } from '../adapters/openai.js';
export function resolveRegisteredModelHarnessProfile(adapter) {
    return adapter instanceof OpenAIAdapter
        ? adapter.getOwnedHarnessProfileId()
        : undefined;
}
export function resolveRegisteredStrictKimiK3Profile(adapter) {
    const profileId = resolveRegisteredModelHarnessProfile(adapter);
    return profileId === 'kimi-k3-coding-openai'
        || profileId === 'kimi-k3-256k-coding-openai'
        ? profileId
        : undefined;
}
export function assertKimiK3SessionModelSwitchSupported(currentProfile, nextProfile, messageCount) {
    if (messageCount > 0
        && (currentProfile !== undefined || nextProfile !== undefined)
        && currentProfile !== nextProfile) {
        throw new Error('KIMI_K3_SESSION_MODEL_SWITCH_UNSUPPORTED：请新建会话后再切换模型');
    }
}
