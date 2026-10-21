import { type PublishedArtifactIndex } from './published-artifact-index.js';
import type { VerificationOwner } from './proof-authority.js';
import { type LoopApplicationBinding } from './loop-application-binding.js';
/** Compare declared candidate artifacts with actual exported verification bytes.
 * This content check grants neither read access nor completion authority. */
export declare function assertLoopApplicationArtifacts(applicationOwner: Readonly<VerificationOwner>, raw: Readonly<LoopApplicationBinding>, payloadOwner: Readonly<VerificationOwner>, sections: readonly unknown[]): void;
export declare function assertIndexedLoopApplicationArtifacts(applicationOwner: Readonly<VerificationOwner>, raw: Readonly<LoopApplicationBinding>, payloadOwner: Readonly<VerificationOwner>, index: PublishedArtifactIndex): void;
