import { type MaterialRequestObservation } from './material-request.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
import type { Database } from 'better-sqlite3';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
import { type ValidationMaterialReview, type PrivateMaterialHandle, type ValidationMaterialInvocation } from './product-material-authorization.js';
import { type MaterialDeadline } from './material-deadline.js';
import type { HostIssuedMountPlan } from '../isolated-execution/execution-port.js';
export declare function readMaterialAuthorityCapacityFacts(authority: object, grant: object, database: Database): {
    ownerKey: string;
    peer: ControllerPeer;
    review: ValidationMaterialReview;
    executableFiles: Array<{
        path: string;
        executable: boolean;
    }>;
};
export type MaterialMountPlanHandoffFacts = {
    readonly authorizationId: string;
    readonly handoffId: string;
    readonly ownerKey: string;
    readonly invocation: Readonly<ValidationMaterialInvocation>;
    readonly scopeDigest: string;
    readonly resourceId: string;
} & ({
    readonly state: 'claimed';
} | {
    readonly state: 'attached';
    readonly expected: Readonly<QuiescenceExpectation>;
});
/** A local handoff identity, not an attached consumer or physical cleanup receipt. */
export declare function readMaterialMountPlanHandoff(ticket: object, authority: object, database: Database): Readonly<MaterialMountPlanHandoffFacts>;
/** Burn the original handoff ticket before any authority callback. */
export declare function attachMaterialMountPlanHandoff(ticket: object, authority: object, database: Database, transaction: object, expected: QuiescenceExpectation): void;
/** Service-private composition, not an OS issuer on its own. Installed factory
 * supplies kernel peer, protected clock, caller-rights reads and native approval. */
export declare function createMaterialAuthority(options: {
    database: Database;
    engineBinding: {
        engineId: string;
        incarnation: string;
    };
    clock(): ReceiverClockEvidence;
    wallNow(): number;
    resolveOwnerKey?(peer: ControllerPeer, invocation: ValidationMaterialInvocation): string;
    inspectFile(peer: ControllerPeer, file: {
        path: string;
        byteLimit: number;
    }, signal: AbortSignal): Promise<{
        sha256: string;
        size: number;
        executable: boolean;
    }>;
    approve(peer: ControllerPeer, review: ValidationMaterialReview, signal: AbortSignal, deadline: Readonly<MaterialDeadline>): Promise<{
        reviewHash: string;
        uid: number;
        auditSessionId: number;
    }>;
    stage(grant: object, review: ValidationMaterialReview, signal: AbortSignal): Promise<HostIssuedMountPlan>;
    acceptPlan(plan: HostIssuedMountPlan): void;
    discardPlan(plan: HostIssuedMountPlan): void;
}): Readonly<{
    prepareRequest: (raw: unknown, peerInput: ControllerPeer, signal: AbortSignal) => Promise<import("./material-request.js").MaterialPrepareResult>;
    lookupRequest: (raw: unknown, peerInput: ControllerPeer) => MaterialRequestObservation;
    retireRequest: (raw: unknown, peerInput: ControllerPeer) => MaterialRequestObservation;
    prepare(raw: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        challengeId: string;
        canonicalReview: ValidationMaterialReview;
    }>>;
    authorize(id: string, peerInput: ControllerPeer, signal: AbortSignal): Promise<PrivateMaterialHandle>;
    stage(input: {
        grantHandle: PrivateMaterialHandle;
        invocation: ValidationMaterialInvocation;
    }, peerInput: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        mountPlanHandle: {
            id: `${string}-${string}-${string}-${string}-${string}`;
            secret: string;
        };
        command: {
            argv: string[];
            cwdRelative: string;
        };
        scopeDigest: string;
        invocation: ValidationMaterialInvocation;
    }>>;
    consumeMountPlan(handle: PrivateMaterialHandle, peerInput: ControllerPeer): Readonly<{
        plan: HostIssuedMountPlan;
        review: ValidationMaterialReview;
        deadline: Readonly<MaterialDeadline>;
        handoff: Readonly<{}>;
    }>;
    inspectMountPlanHandoff: (raw: {
        authorizationId: string;
    }, rawPeer: ControllerPeer) => Readonly<MaterialMountPlanHandoffFacts> | Readonly<{
        state: "unclaimed";
        authorizationId: string;
    }>;
    /** Private cleanup gate: observed expiry is durably retired before it can
     * justify deletion. A later wall-clock rollback cannot revive this ticket. */
    assertScopeInactive(scopeDigest: string): void;
    assertGrant(grant: object): void;
    getGrantFacts(grant: object): {
        ownerKey: string;
        peer: ControllerPeer;
        review: ValidationMaterialReview;
        executableFiles: {
            path: string;
            executable: boolean;
        }[];
    };
    getGrantReview(grant: object): ValidationMaterialReview;
    revoke(id: string, peer: ControllerPeer): void;
}>;
