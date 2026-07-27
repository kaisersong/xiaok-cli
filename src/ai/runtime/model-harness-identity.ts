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

export function assertKimiK3SessionModelSwitchSupported(
  currentProfile: StrictKimiK3ProfileId | undefined,
  nextProfile: StrictKimiK3ProfileId | undefined,
  messageCount: number,
): void {
  if (
    messageCount > 0
    && (currentProfile !== undefined || nextProfile !== undefined)
    && currentProfile !== nextProfile
  ) {
    throw new Error(
      'KIMI_K3_SESSION_MODEL_SWITCH_UNSUPPORTED：请新建会话后再切换模型',
    );
  }
}
