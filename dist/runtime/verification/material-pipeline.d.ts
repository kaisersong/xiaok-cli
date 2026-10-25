import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
import type { Database } from 'better-sqlite3';
import { type createVerificationBlobBudget } from './blob-budget.js';
import type { createInstalledRootBrokerClient } from './root-broker-client.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import { type ValidationMaterialInvocation } from './product-material-authorization.js';
export declare function assertControllerMaterialPipelineDatabase(pipeline: object, database: Database): void;
export declare function assertMaterialPipelineDeleted(pipeline: object, database: Database, proof: object, proposal: Readonly<import('./blob-budget.js').BlobReservationProposal>): void;
/** Private production composition. The installed daemon supplies its fixed root
 * broker client and current owner registry. This factory does not qualify mocks. */
export declare function createControllerMaterialPipeline(input: {
    root: string;
    database: Database;
    budget: ReturnType<typeof createVerificationBlobBudget>;
    engineBinding: {
        engineId: string;
        incarnation: string;
    };
    broker: Pick<ReturnType<typeof createInstalledRootBrokerClient>, 'clock' | 'inspectMaterial' | 'authorizeMaterials' | 'readMaterialPage'>;
    assertCurrent(): void;
    assertCleanup(resourceId: string): void;
    resolveOwnerKey(peer: ControllerPeer, invocation: ValidationMaterialInvocation): string;
    createCapacityOwnerBinding?(peer: ControllerPeer, invocation: ValidationMaterialInvocation): object;
    wallNow?(): number;
}): Readonly<{
    prepareRequest: (raw: unknown, peerInput: ControllerPeer, signal: AbortSignal) => Promise<import("./material-request.js").MaterialPrepareResult>;
    lookupRequest: (raw: unknown, peerInput: ControllerPeer) => import("./material-request.js").MaterialRequestObservation;
    retireRequest: (raw: unknown, peerInput: ControllerPeer) => import("./material-request.js").MaterialRequestObservation;
    stager: Readonly<{
        deletionAuthority: Readonly<{
            assertDeleted(proof: object, proposal: Readonly<import("./blob-budget.js").BlobReservationProposal>): void;
        }>;
        deleteResource(resourceId: string): void;
        acceptPlan(plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan): void;
        discardUnpublishedPlan(plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan): void;
        prepareValidationInput(input: {
            grant: object;
            ownerKey: string;
            signal: AbortSignal;
            capacityBinding?: object;
        }): Promise<Readonly<{
            materializedInput: import("../isolated-execution/execution-port.js").HostIssuedMountPlan;
            command: {
                argv: string[];
                cwdRelative: string;
            };
            scopeDigest: string;
        }>>;
        getManifest(plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan): import("../isolated-execution/broker-staging.js").BrokerStagingManifest;
        readFile(plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan, path: string): Buffer;
    }>;
    assertScopeInactive: (scopeDigest: string) => void;
    prepare(raw: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        challengeId: string;
        canonicalReview: import("./product-material-authorization.js").ValidationMaterialReview;
    }>>;
    authorize: (id: string, peerInput: ControllerPeer, signal: AbortSignal) => Promise<import("./product-material-authorization.js").PrivateMaterialHandle>;
    stage: (input: {
        grantHandle: import("./product-material-authorization.js").PrivateMaterialHandle;
        invocation: ValidationMaterialInvocation;
    }, peerInput: ControllerPeer, signal: AbortSignal) => Promise<Readonly<{
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
    consumeMountPlan: (handle: import("./product-material-authorization.js").PrivateMaterialHandle, peerInput: ControllerPeer) => Readonly<{
        plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan;
        review: import("./product-material-authorization.js").ValidationMaterialReview;
        deadline: Readonly<import("./material-deadline.js").MaterialDeadline>;
        handoff: Readonly<{}>;
    }>;
    inspectMountPlanHandoff: (raw: {
        authorizationId: string;
    }, rawPeer: ControllerPeer) => Readonly<import("./material-authority.js").MaterialMountPlanHandoffFacts> | Readonly<{
        state: "unclaimed";
        authorizationId: string;
    }>;
    readMountPlanHandoff: (ticket: object) => Readonly<import("./material-authority.js").MaterialMountPlanHandoffFacts>;
    attachMountPlanHandoff: (ticket: object, transaction: object, expected: QuiescenceExpectation) => void;
    revoke: (id: string, peer: ControllerPeer) => void;
}>;
