import { type FrozenDeepSeekCounter } from './deepseek-capacity-profile.js';
export interface VerifiedCapacityProfile {
    readonly opaqueCapacityProfile: never;
}
interface Profile {
    readonly qualification: 'test-fixture' | 'official-deepseek-recipe';
    readonly destination: string;
    readonly model: string;
    readonly windowTokens: number;
    readonly outputLimitField: string;
    readonly defaultOutputTokens?: number;
    readonly safetyMarginTokens: number;
    readonly countSerializedInput: (body: string) => number;
}
/** Explicit host-frozen official recipe only; no automatic dependency provisioning. */
export declare function resolveProductionCapacityProfile(identity: {
    destination: string;
    model: string;
    protocol?: string;
    profileId?: string;
    counter?: FrozenDeepSeekCounter;
}): VerifiedCapacityProfile | undefined;
/** HOST TEST HARNESS ONLY. This registers a controlled-protocol fixture, not a
 * verified real-provider profile. Never select this factory in product config or
 * live eval. The trust boundary is host code capability, not NODE_ENV/evidenceId. */
export declare function createTestOnlyCapacityProfile(input: Omit<Profile, 'qualification'>): VerifiedCapacityProfile;
export declare function assertCapacityProfileReady(profile: VerifiedCapacityProfile | undefined, destination: string, model: string): void;
export declare function measureRequestCapacity(profile: VerifiedCapacityProfile | undefined, input: {
    destination: string;
    model: string;
    serializedBody: string;
}): {
    inputTokenUpperBound: number;
    actualOutputReserve: number;
    totalTokenUpperBound: number;
    qualification: 'test-fixture' | 'official-deepseek-recipe';
};
export declare function getCapacityProfileBudget(profile: VerifiedCapacityProfile): {
    windowTokens: number;
    outputLimitField: string;
    defaultOutputTokens?: number;
    safetyMarginTokens: number;
};
export declare function checkRequestCapacity(profile: VerifiedCapacityProfile | undefined, input: {
    destination: string;
    model: string;
    serializedBody: string;
}): ReturnType<typeof measureRequestCapacity>;
export {};
