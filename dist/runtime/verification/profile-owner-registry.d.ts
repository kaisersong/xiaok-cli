import { type KSwarmHostSubject } from './kswarm-host-subject.js';
import type { Database } from 'better-sqlite3';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ValidationMaterialInvocation } from './product-material-authorization.js';
import type { VerificationOwner } from './proof-authority.js';
import { type IntentContractEnrollment } from './intent-contract-enrollment.js';
import { type LoopHostSubject } from './loop-host-subject.js';
export interface ProfilePrincipal {
    uid: number;
    accountId: string;
}
export interface PublicProfileIndex extends ProfilePrincipal {
    version: 1;
    authorityId: string;
    profileId: string;
}
export interface OwnerEnrollment {
    ownerKind: VerificationOwner['ownerKind'];
    ownerId: string;
    invocations: readonly ValidationMaterialInvocation[];
    kswarmSubject?: Readonly<KSwarmHostSubject>;
    goalSessionId?: string;
    loopSubject?: Readonly<LoopHostSubject>;
    intentContract?: Readonly<IntentContractEnrollment>;
}
export interface EnrollmentContext {
    peer: ControllerPeer;
    requestSource: 'user' | 'agent' | 'scheduler';
    authorization: object;
}
export interface ProfileCapacityOwnerFacts {
    readonly authorityId: string;
    readonly profileId: string;
    readonly ownerKey: string;
    readonly sessionKey: string;
    readonly invocation: Readonly<ValidationMaterialInvocation>;
}
export declare function readProfileCapacityOwnerBinding(binding: object, database: Database): Readonly<ProfileCapacityOwnerFacts>;
export declare function parseOwnerEnrollment(raw: OwnerEnrollment): Readonly<OwnerEnrollment>;
/** Private service composition only. Native OS identity, authorization and fixed-path
 * durable publication ports must be supplied by the installed authority. */
export declare function createProfileOwnerRegistry(options: {
    database: Database;
    authorityId: string;
    resolvePrincipal(peer: ControllerPeer): ProfilePrincipal;
    assertEnrollmentAuthorization(proposal: Readonly<OwnerEnrollment>, context: Readonly<EnrollmentContext>): void;
    assertEnrollmentCurrent(proposal: Readonly<OwnerEnrollment>, context: Readonly<EnrollmentContext>): void;
    publishProfile(index: Readonly<PublicProfileIndex>): void;
    assertProfilePublished(index: Readonly<PublicProfileIndex>): void;
    commitEnrollment?(owner: Readonly<VerificationOwner>, proposal: Readonly<OwnerEnrollment>, context: Readonly<EnrollmentContext>): void;
    assertInvocationCommitted?(owner: Readonly<VerificationOwner>, invocation: Readonly<ValidationMaterialInvocation>, peer: ControllerPeer): void | (() => void);
    assertEnrollmentFinal?(owner: Readonly<VerificationOwner>, proposal: Readonly<OwnerEnrollment>, context: Readonly<EnrollmentContext>): void;
}): Readonly<{
    enroll(raw: OwnerEnrollment, rawContext: EnrollmentContext): Readonly<VerificationOwner>;
    createCapacityOwnerBinding(rawPeer: ControllerPeer, rawInvocation: ValidationMaterialInvocation): object;
    resolveOwnerKey(rawPeer: ControllerPeer, rawInvocation: ValidationMaterialInvocation): string;
    resolveOwner(rawPeer: ControllerPeer, raw: Pick<VerificationOwner, "ownerKind" | "ownerId">): Readonly<VerificationOwner>;
    getProfile(rawPeer: ControllerPeer): Readonly<PublicProfileIndex>;
}>;
