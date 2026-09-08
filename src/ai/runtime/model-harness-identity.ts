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
  return profileId === 'kimi-k3-coding-openai'
    || profileId === 'kimi-k3-256k-coding-openai'
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
