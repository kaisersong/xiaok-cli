import type { OwnerEnrollment } from './profile-owner-registry.js';
import type { OwnerEnrollmentReview } from './owner-enrollment-review.js';
import type { VerificationOwner } from './proof-authority.js';
export interface OwnerEnrollmentRequest {
  readonly requestId: string;
  readonly enrollment: OwnerEnrollment;
  readonly registration: OwnerEnrollmentReview['registration'];
}
export interface OwnerEnrollmentChallenge {
  readonly challengeId: string;
  readonly canonicalReview: Readonly<OwnerEnrollmentReview>;
}
export type OwnerEnrollmentRequestObservation = Readonly<{ state: 'absent' }> | Readonly<{ state: 'not_prepared' }>
  | Readonly<{ state: 'mapped'; challenge: OwnerEnrollmentChallenge }> | Readonly<{ state: 'not_approved'; challenge: OwnerEnrollmentChallenge }>
  | Readonly<{ state: 'committed'; challenge: OwnerEnrollmentChallenge; owner: VerificationOwner }>;
export type OwnerEnrollmentRequestRecovery = Exclude<OwnerEnrollmentRequestObservation, { state: 'mapped' | 'absent' }>;
