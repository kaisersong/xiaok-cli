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
export function requiresKimiK3HistoryMigration(currentProfile, nextProfile, messageCount) {
    return messageCount > 0 && currentProfile !== nextProfile;
}
