import type { ReceiverClockEvidence } from './receiver-store.js';
/** Private ordering helper, not an approval issuer or OS qualifier. The installed
 * entry supplies the real broker and qualified owner; the original approval is
 * returned unchanged only while its original clock deadline still holds. */
export declare function refreshNativeApprovalQualification<T>(input: {
    approval: T;
    deadline: Readonly<{
        domainId: string;
        qualificationEpoch: number;
        notBefore: number;
        validUntil: number;
    }>;
    originalEngineBinding: string;
    ensureQualified(): Promise<void>;
    currentEngineBinding(): string;
    clock(): ReceiverClockEvidence;
    assertCurrent(): void;
}): Promise<T>;
/** The initial installed engine identity is captured once, before any requests. */
export declare function createStableQualificationRefresh(input: {
    ensureCurrent(signal?: AbortSignal): Promise<void>;
    readBinding(): object;
    assertCurrent(): void;
}): (signal?: AbortSignal) => Promise<void>;
