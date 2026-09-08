import { type CompletionEvidenceInput, type EvidenceValidationResult } from './completion-evidence.js';
export interface EvidenceIoOptions {
    signal: AbortSignal;
    /** Host-owned absolute-deadline check, also at IO microtask boundaries. */
    assertActive?(): void;
    /** Receives the original SDK Promise, before any continuation/abort wrapper. */
    trackPending(raw: Promise<unknown>): void;
}
export declare function throwEvidenceAbort(signal: AbortSignal): void;
export declare function assertEvidenceActive(options: EvidenceIoOptions): void;
export declare function validateCompletionEvidenceAsync(input: CompletionEvidenceInput, options: EvidenceIoOptions): Promise<EvidenceValidationResult>;
