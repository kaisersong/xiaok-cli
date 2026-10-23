import { type ProfileCaptureTransfer } from './profile-capture-transfer.js';
import type { ProfileSourceApprovalReceipt } from './profile-source-authorization.js';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import type { MaterialDeadline } from './material-deadline.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
export declare function assertInstalledRootBrokerClient(client: object, lifetime: InstalledControllerLifetime): void;
/** Fixed protected-service -> root broker channel. Not available to ordinary P1
 * identities, and never registered as a public model/renderer tool. */
export declare function createInstalledRootBrokerClient(): Readonly<{
    authorizeProfileSources(input: {
        requestSource: "user" | "agent" | "scheduler";
        review: unknown;
    }, signal?: AbortSignal): Promise<Readonly<ProfileSourceApprovalReceipt>>;
    captureProfileSources(receipt: Readonly<ProfileSourceApprovalReceipt>, signal?: AbortSignal): Promise<Readonly<{}>>;
    describeProfileCapture(handle: object): Readonly<{
        review: Readonly<import("./profile-source-review.js").ProfileSourceReview>;
        manifestHash: string;
        manifestBytes: number;
        capturedBytes: number;
    }>;
    readProfileManifest(handle: object, offset: number, length: number, signal?: AbortSignal): Promise<Buffer<ArrayBuffer>>;
    loadProfileCaptureManifest(handle: object, signal?: AbortSignal): Promise<Readonly<ProfileCaptureTransfer>>;
    readProfileFile(handle: object, sourceId: string, entryIndex: number, offset: number, length: number, signal?: AbortSignal): Promise<Buffer<ArrayBuffer>>;
    readProfileSqlitePage(handle: object, sourceId: string, pageNo: number, signal?: AbortSignal): Promise<Buffer<ArrayBuffer>>;
    checkProfileCapture(handle: object, signal?: AbortSignal): Promise<void>;
    releaseProfileCapture(handle: object, signal?: AbortSignal): Promise<void>;
    authorizePublicationOperation(raw: unknown, signal?: AbortSignal): Promise<Readonly<{
        version: 1;
        purpose: "completion-publication";
        authorityId: string;
        challengeId: string;
        uid: number;
        accountGeneration: string;
        auditSessionId: number;
        requestSource: "user" | "agent" | "scheduler";
        fullReviewHash: string;
    }>>;
    authorizeApplicationBinding(input: {
        requestSource: "user" | "agent" | "scheduler";
        review: unknown;
    }, signal?: AbortSignal): Promise<{
        uid: number;
        auditSessionId: number;
        reviewHash: string;
    }>;
    authorizeArchiveOperation(input: {
        requestSource: "user" | "agent" | "scheduler";
        review: unknown;
    }, signal?: AbortSignal): Promise<{
        uid: number;
        auditSessionId: number;
        reviewHash: string;
    }>;
    authorizeOwnerEnrollment(raw: unknown, signal?: AbortSignal): Promise<{
        uid: number;
        auditSessionId: number;
        reviewHash: string;
    }>;
    authorizeMaterials(input: {
        uid: number;
        auditSessionId: number;
        review: unknown;
        deadline: Readonly<MaterialDeadline>;
    }, signal?: AbortSignal): Promise<{
        uid: number;
        auditSessionId: number;
        reviewHash: string;
    }>;
    inspectMaterial(input: {
        uid: number;
        workspace: string;
        path: string;
        byteLimit: number;
    }, signal?: AbortSignal): Promise<{
        sha256: string;
        size: number;
        executable: boolean;
    }>;
    readMaterialPage(input: {
        uid: number;
        workspace: string;
        path: string;
        byteLimit: number;
        contentHash: string;
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<{
        contentHash: string;
        totalBytes: number;
        executable: boolean;
        offset: number;
        bytes: string;
    }>;
    resolvePrincipal(peer: Readonly<{
        uid: number;
        gid: number;
        auditSessionId: number;
    }>): Readonly<{
        uid: number;
        gid: number;
        auditSessionId: number;
        accountGeneration: string;
        source: "macos-local-generateduid";
    }>;
    clock(): Readonly<ReceiverClockEvidence>;
    dispose(): void;
}>;
