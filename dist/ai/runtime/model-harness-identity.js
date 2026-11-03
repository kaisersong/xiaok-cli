import { isStrictKimiK3ProfileId } from '../providers/kimi-models.js';
import { OpenAIAdapter } from '../adapters/openai.js';
export function resolveRegisteredModelHarnessProfile(adapter) {
    return adapter instanceof OpenAIAdapter
        ? adapter.getOwnedHarnessProfileId()
        : undefined;
}
export function resolveRegisteredStrictKimiK3Profile(adapter) {
    const profileId = resolveRegisteredModelHarnessProfile(adapter);
    return isStrictKimiK3ProfileId(profileId)
        ? profileId
        : undefined;
}
export function requiresKimiK3HistoryMigration(currentProfile, nextProfile, messageCount) {
    return messageCount > 0 && currentProfile !== nextProfile;
}
