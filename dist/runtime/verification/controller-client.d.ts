import { type AuthenticatedMetadataCapacityTransport } from './metadata-capacity-protocol.js';
import { type AuthenticatedApplicationTransport } from './application-transport.js';
import { type AuthenticatedArchiveTransport } from './archive-transport.js';
import { type KeyObject } from 'node:crypto';
import { type AuthenticatedCompletionTransport } from './completion-transport.js';
import type { ValidationMaterialAuthorizationClient, PreparedValidationMaterials } from './product-material-authorization.js';
import type { HostIssuedMountPlan, IsolatedExecutionPort } from '../isolated-execution/execution-port.js';
export interface QualifiedExecutionFacts {
    authorityId: string;
    serviceEpoch: string;
    qualificationId: string;
    engineBinding: {
        engineId: string;
        incarnation: string;
    };
    deploymentPackageHash: string;
    isolationPolicyHash: string;
    clock: {
        domainId: string;
        qualificationEpoch: number;
        evidenceHash: string;
    };
    evidenceHashes: {
        osIdentity: string;
        engineInspection: string;
        escapeSuite: string;
    };
    /** Wall-derived display/preflight bound only; server authority uses continuous clock. */
    validUntil: number;
}
/** Signed protocol only. Production must use the fixed installed-manifest factory,
 * never accept a model-supplied key/socket or treat fixture signatures as OS qualification. */
export declare function createAuthenticatedControllerClient(options: {
    authorityId: string;
    publicKey: KeyObject;
    deploymentPackageHash?: string;
    isolationPolicyHash?: string;
    roundTrip(bytes: Buffer, signal?: AbortSignal): Promise<Buffer>;
    /** Real separate-process IPC; synchronous freshness check before a local P2 mutation boundary. */
    roundTripSync(bytes: Buffer): Buffer;
}): Readonly<{
    metadataCapacityTransport: AuthenticatedMetadataCapacityTransport;
    materialRequestTransport: Readonly<{
        call(method: 'materials.prepareRequest' | 'materials.lookupRequest' | 'materials.retireRequest', payload: unknown, signal?: AbortSignal): Promise<unknown>;
    }>;
    applicationTransport: AuthenticatedApplicationTransport;
    maintenanceTransport: Readonly<{
        call(method: 'maintenance.diagnose', payload: unknown, signal?: AbortSignal): Promise<unknown>;
    }>;
    archiveTransport: AuthenticatedArchiveTransport;
    publicationTransport: Readonly<{
        call(method: 'publication.prepareRequest' | 'publication.lookupRequest' | 'publication.recoverRequest' | 'publication.recoverUnapproved' | 'publication.prepare' | 'publication.approve' | 'publication.reconcile' | 'publication.recoverExpired' | 'publication.observeIntentCompletion' | 'publication.observeIntentDependencies' | 'publication.observeLoopSet' | 'publication.observeOwner' | 'publication.readOwnerPayload', payload: unknown, signal?: AbortSignal): Promise<unknown>;
    }>;
    verificationTransport: Readonly<{
        call(method: 'verification.inspectObligation' | 'verification.prepareRequest' | 'verification.lookupRequest' | 'verification.retireRequest' | 'verification.recoverRequest' | 'verification.prepare' | 'verification.dispatch', payload: unknown, signal?: AbortSignal): Promise<unknown>;
    }>;
    completionTransport: AuthenticatedCompletionTransport;
    materialAuthorization: ValidationMaterialAuthorizationClient;
    execution: IsolatedExecutionPort;
    requireQualifiedExecution(): Promise<Readonly<QualifiedExecutionFacts>>;
    wrapPreparedValidationInput(input: PreparedValidationMaterials): HostIssuedMountPlan;
    dispose(): void;
}>;
/** Fixed OS installation only: no caller-supplied endpoint, key, config path or environment override. */
export declare function createInstalledVerificationClient(): ReturnType<typeof createAuthenticatedControllerClient>;
