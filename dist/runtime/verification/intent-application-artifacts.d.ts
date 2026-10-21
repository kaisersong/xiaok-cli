import { type PublishedArtifactIndex } from './published-artifact-index.js';
import type { VerificationOwner } from './proof-authority.js';
import { type IntentApplicationBinding } from './intent-application-binding.js';
/** Compare declared candidate artifacts with actual exported verification bytes.
 * This content check grants neither read access nor completion authority. */
export declare function assertIntentApplicationArtifacts(applicationOwner: Readonly<VerificationOwner>, raw: Readonly<IntentApplicationBinding>, payloadOwner: Readonly<VerificationOwner>, sections: readonly unknown[]): void;
export declare function assertIndexedIntentApplicationArtifacts(applicationOwner: Readonly<VerificationOwner>, raw: Readonly<IntentApplicationBinding>, payloadOwner: Readonly<VerificationOwner>, index: PublishedArtifactIndex): void;
