import { type IndependentRecipeSpec } from '../verification/independent-recipes.js';
import type { OwnerEnrollmentReview } from '../verification/owner-enrollment-review.js';
export interface GoalVerificationDefinition {
    readonly version: 1;
    readonly obligations: readonly Readonly<{
        obligationId: string;
        predicateId: string;
        predicateVersion: string;
        semantics: 'current-subject' | 'specific-run' | 'cumulative';
        recipe: IndependentRecipeSpec;
    }>[];
}
/** Explicit user criteria only. Parsing neither approves an owner nor proves a
 * result. The assembled native review still applies its own full byte limit. */
export declare function parseGoalVerificationDefinition(raw: unknown): Readonly<GoalVerificationDefinition>;
export declare function goalVerificationRegistration(raw: unknown): OwnerEnrollmentReview['registration'];
/** Replacing the business target cannot weaken or reorder original obligations. */
export declare function assertGoalVerificationExtension(original: unknown, next: unknown): void;
