import { type VerificationObligationObservation } from '../verification/verification-obligation-observation.js';
import { type MaterialRequestObservation } from '../verification/material-request.js';
import { type VerificationOperationRequestObservation } from '../verification/verification-operation-request.js';
import type { ValidationMaterialRequestStep, AuthorizedProductValidationMaterials } from '../verification/product-material-authorization.js';
import type { IntentApplicationBinding } from '../verification/intent-application-binding.js';
import type { IntentVerificationExecution } from './verification-execution-journal.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
export interface IntentVerificationOperation {
    revision: number;
    phase: 'material_preparing' | 'material_authorizing' | 'material_staging' | 'preparing' | 'dispatching' | 'observing' | 'terminal' | 'retired';
    obligationObservation: null | {
        definitionHash: string;
        attemptEpoch: number;
        activeAttemptId: string | null;
        bindingHash: string;
        applicationRevision: number;
    };
    challengeId: string | null;
    materialReceipt: AuthorizedProductValidationMaterials['publicReceipt'] | null;
    operationId: string | null;
    attemptId: string | null;
    expected: Readonly<QuiescenceExpectation> | null;
    materialObservation: Readonly<MaterialRequestObservation> | null;
    verificationObservation: VerificationOperationRequestObservation | null;
}
export type IntentVerificationOperationAction = {
    kind: 'begin-materials';
    observation: VerificationObligationObservation;
} | {
    kind: 'material-step';
    step: ValidationMaterialRequestStep;
} | {
    kind: 'prepare';
    receipt: AuthorizedProductValidationMaterials['publicReceipt'];
} | {
    kind: 'dispatch';
    operationId: string;
    attemptId: string;
    attemptEpoch: number;
    observation: VerificationOperationRequestObservation;
    materialObservation: MaterialRequestObservation;
} | {
    kind: 'observe';
    materialObservation: MaterialRequestObservation;
    verificationObservation: VerificationOperationRequestObservation;
};
export declare function parseIntentVerificationOperation(raw: unknown, row: IntentVerificationExecution, binding: Readonly<IntentApplicationBinding>): IntentVerificationOperation | null;
export declare function applyIntentVerificationOperation(row: IntentVerificationExecution, binding: Readonly<IntentApplicationBinding>, raw: IntentVerificationOperationAction): IntentVerificationOperation;
