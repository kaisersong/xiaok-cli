import type { StrictKimiK3ProfileId } from './provider-transcript-digest.js';
export type RegisteredModelHarnessProfileId = StrictKimiK3ProfileId | 'generic-openai';
export declare function resolveRegisteredModelHarnessProfile(adapter: object): RegisteredModelHarnessProfileId | undefined;
export declare function resolveRegisteredStrictKimiK3Profile(adapter: object): StrictKimiK3ProfileId | undefined;
export declare function assertKimiK3SessionModelSwitchSupported(currentProfile: StrictKimiK3ProfileId | undefined, nextProfile: StrictKimiK3ProfileId | undefined, messageCount: number): void;
