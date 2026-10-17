import { type MaterialRequestObservation } from '../verification/material-request.js';
import { type VerificationObligationObservation } from '../verification/verification-obligation-observation.js';
import { type VerificationOperationRequestObservation } from '../verification/verification-operation-request.js';
import type { ValidationMaterialDraft, ValidationMaterialInvocation } from '../verification/product-material-authorization.js';
import type { LoopNativeAttemptTarget, LoopVerificationSession } from './producer-types.js';
export type LoopVerificationExecutionPhase = 'selecting' | 'preparing_material' | 'authorizing_material' | 'staging_material' | 'preparing_verification' | 'dispatching' | 'observing' | 'terminal' | 'retired';
/** Main-owned historical progress, never native approval or current proof. */
export interface LoopVerificationExecution {
    id: string;
    sessionRecordId: string;
    nativeAttemptId: string;
    candidateId: string;
    obligationId: string;
    invocation: ValidationMaterialInvocation;
    exactCommand: ValidationMaterialDraft['exactCommand'];
    expiresAt: number;
    materialRequestId: string;
    verificationRequestId: string;
    phase: LoopVerificationExecutionPhase;
    revision: number;
    createdAt: number;
    updatedAt: number;
    draft: ValidationMaterialDraft | null;
    challengeId: string | null;
    obligationObservation: VerificationObligationObservation | null;
    operationId: string | null;
    attemptId: string | null;
    materialObservation: MaterialRequestObservation | null;
    verificationObservation: VerificationOperationRequestObservation | null;
}
export declare function executionIdentity(value: unknown): asserts value is string;
export declare function executionFields(value: unknown, keys: string[]): asserts value is Record<string, any>;
export declare function captureExecutionValue<T>(value: T): T;
export declare function parseLoopVerificationCommand(raw: unknown): ValidationMaterialDraft['exactCommand'];
type Target = Readonly<LoopNativeAttemptTarget>;
export declare function parseLoopVerificationObligationForTarget(raw: unknown, session: Readonly<LoopVerificationSession>, target: Target): Readonly<VerificationObligationObservation>;
export declare function parseLoopVerificationExecution(raw: unknown, session: Readonly<LoopVerificationSession>, target: Target): Readonly<LoopVerificationExecution>;
export {};
