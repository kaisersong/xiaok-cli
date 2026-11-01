import { isStrictKimiK3ProfileId } from '../providers/kimi-models.js';
import { OpenAIAdapter } from '../adapters/openai.js';
import type { StrictKimiK3ProfileId } from './provider-transcript-digest.js';

export type RegisteredModelHarnessProfileId =
  | StrictKimiK3ProfileId
  | 'generic-openai';

export function resolveRegisteredModelHarnessProfile(
  adapter: object,
): RegisteredModelHarnessProfileId | undefined {
  return adapter instanceof OpenAIAdapter
    ? adapter.getOwnedHarnessProfileId()
    : undefined;
}

export function resolveRegisteredStrictKimiK3Profile(
  adapter: object,
): StrictKimiK3ProfileId | undefined {
  const profileId = resolveRegisteredModelHarnessProfile(adapter);
  return isStrictKimiK3ProfileId(profileId)
    ? profileId
    : undefined;
}

export function requiresKimiK3HistoryMigration(
  currentProfile: StrictKimiK3ProfileId | undefined,
  nextProfile: StrictKimiK3ProfileId | undefined,
  messageCount: number,
): boolean {
  return messageCount > 0 && currentProfile !== nextProfile;
}
