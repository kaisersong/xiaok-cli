import { type BusinessApplicationObservation } from './business-application-binding.js';
import type { VerificationOwner } from './proof-authority.js';
import type { ValidationMaterialInvocation } from './product-material-authorization.js';
export interface VerificationObligationQuery {
    invocation: Readonly<ValidationMaterialInvocation>;
    obligationId: string;
}
export interface VerificationObligationObservation {
    owner: Readonly<VerificationOwner>;
    obligationId: string;
    definitionHash: string;
    attemptEpoch: number;
    activeAttemptId: string | null;
    application: Readonly<BusinessApplicationObservation>;
}
export declare function parseVerificationObligationQuery(raw: unknown): Readonly<VerificationObligationQuery>;
/** A current optimistic-CAS input, never proof, approval or execution authority. */
export declare function parseVerificationObligationObservation(raw: unknown): Readonly<VerificationObligationObservation>;
