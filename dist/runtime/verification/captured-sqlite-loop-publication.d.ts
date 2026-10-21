import type { CapturedLoopRow, CapturedLoopSourceReader } from './captured-sqlite-loop-reader.js';
import { parseLoopPublicationConfiguration } from '../loop/publication-config.js';
import { parseLoopApplicationBinding } from './loop-application-binding.js';
import type { LoopNativeAttemptTarget, LoopVerificationSession } from '../loop/producer-types.js';
export declare const capturedLoopBasisHash: (raw: string) => string;
export interface CapturedLoopRunBasis {
    readonly value: Record<string, unknown>;
    readonly configuration: ReturnType<typeof parseLoopPublicationConfiguration>;
}
/** Historical configuration ownership; current deletion never erases the old binding. */
export declare function assertCapturedLoopConfigurationOwner(loopId: string, definition: Readonly<Record<string, unknown>>, contract: ReturnType<typeof parseLoopPublicationConfiguration>['contract'], hasTemplate: boolean, allowDeletedTemplate?: boolean): void;
export declare function readCapturedLoopRunBasis(reader: CapturedLoopSourceReader, current: CapturedLoopRow): CapturedLoopRunBasis | undefined;
export declare function readCapturedLoopBinding(reader: CapturedLoopSourceReader, item: CapturedLoopRow, run: CapturedLoopRow, basis: CapturedLoopRunBasis): Readonly<import("./loop-application-binding.js").LoopApplicationBinding>;
export declare function readCapturedLoopNativeTarget(item: CapturedLoopRow, candidate: CapturedLoopRow, binding: ReturnType<typeof parseLoopApplicationBinding>, basis: CapturedLoopRunBasis): Readonly<LoopNativeAttemptTarget>;
export declare function readCapturedLoopVerificationSession(item: CapturedLoopRow, target: Readonly<LoopNativeAttemptTarget>): LoopVerificationSession;
export declare function validateCapturedLoopCandidateHistory(reader: CapturedLoopSourceReader, candidate: CapturedLoopRow, binding: ReturnType<typeof parseLoopApplicationBinding>, basis: CapturedLoopRunBasis): void;
/** Publication subpass only. Full source/row/end integrity also requires the
 * ordinary, result/projection and final declaration passes. */
export declare function validateCapturedLoopPublicationPass(reader: CapturedLoopSourceReader): void;
