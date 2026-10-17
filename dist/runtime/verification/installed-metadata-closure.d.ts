import type { InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type CapturedProfileEvent } from './captured-profile-mapper.js';
import type { CapturedSqliteCell } from './source-sqlite-cell.js';
import { type CapturedProfileOrigin } from './captured-profile-relations.js';
type Family = Extract<CapturedProfileEvent, {
    kind: 'family-fact';
}>['family'];
interface Session {
    sourceId: string;
    family: Family;
    recordKind: 'session';
    originalRecordKey: string;
    sessionId: string;
    origin: CapturedProfileOrigin;
}
interface Unresolved {
    reason: string;
    origin: CapturedProfileOrigin;
    detail?: unknown;
}
interface Dependency {
    namespace: string;
    id: string;
    origin: CapturedProfileOrigin;
    scope?: unknown;
}
interface Entity {
    sourceId: string;
    family: Family;
    recordKind: 'session' | 'task' | 'goal' | 'loop' | 'loop_run' | 'loop_stage' | 'loop-embedded-task' | 'codex-session' | 'codex-thread' | 'codex-route' | 'group' | 'group-agent' | 'groups-row' | 'artifact-workspace' | 'artifact-lineage' | 'artifact-version' | 'artifact-row' | 'intent' | 'intent-stage' | 'intent-native-contract' | 'loop-row' | 'kswarm-row';
    originalRecordKey: string;
    origin: CapturedProfileOrigin;
    original: unknown;
    dependencies: Dependency[];
    sessions: Session[];
    unresolved: Unresolved[];
}
/** Four original objects only; never an iterable, session DTO or checker. */
export declare function collectInstalledMetadataClosure(lifetime: InstalledControllerLifetime, owner: object, token: object, source: object): Promise<object>;
/** Synchronous facts require the original lifetime and source population; a
 * later physical await must additionally use the actual async CHECK. */
export declare function readInstalledMetadataClosure(lifetime: InstalledControllerLifetime, handle: object): Readonly<{
    version: 1;
    kind: "installed-metadata-closure-facts";
    capture: Readonly<{
        facts: Readonly<import("./profile-source-capture.js").ProfileCaptureFacts>;
        review: Readonly<import("./profile-source-review.js").ProfileSourceReview>;
        manifestHash: string;
        manifestBytes: number;
        capturedBytes: number;
    }>;
    native: Readonly<{
        version: 1;
        authorityId: string;
        resourceId: string;
        physicalIdentity: string;
        writerGeneration: string;
        sourceCensusHash: string;
        profiles: readonly Readonly<{
            uid: number;
            accountId: string;
            profileId: string;
            state: "active";
        }>[];
        enrollmentPopulation: readonly (Readonly<{
            table: "obligations" | "verification_profiles" | "verification_registered_owners" | "verification_registered_invocations" | "owner_enrollment_invocation_receipts" | "owner_enrollment_goal_sessions" | "owner_enrollment_intents" | "owner_enrollment_loop_subjects" | "owner_enrollment_intent_contracts" | "owner_enrollment_kswarm_subjects" | "verification_storage_features" | "owner_enrollment_challenges" | "owner_enrollment_requests" | "verification_owners" | "mandatory_observation_checks" | "verification_owner_dependencies" | "owner" | "dependencies" | "registered" | "profile" | "invocations" | "receipts" | "subject" | "storageFeature";
            present: false;
            masterCells: readonly Readonly<Record<string, CapturedSqliteCell>>[];
        }> | Readonly<{
            table: "obligations" | "verification_profiles" | "verification_registered_owners" | "verification_registered_invocations" | "owner_enrollment_invocation_receipts" | "owner_enrollment_goal_sessions" | "owner_enrollment_intents" | "owner_enrollment_loop_subjects" | "owner_enrollment_intent_contracts" | "owner_enrollment_kswarm_subjects" | "verification_storage_features" | "owner_enrollment_challenges" | "owner_enrollment_requests" | "verification_owners" | "mandatory_observation_checks" | "verification_owner_dependencies" | "owner" | "dependencies" | "registered" | "profile" | "invocations" | "receipts" | "subject" | "storageFeature";
            present: true;
            masterCells: readonly Readonly<Record<string, CapturedSqliteCell>>[];
            schema: readonly {
                [k: string]: unknown;
            }[];
            schemaCells: readonly Readonly<Record<string, CapturedSqliteCell>>[];
            columns: readonly {
                [k: string]: unknown;
            }[];
            columnCells: readonly Readonly<Record<string, CapturedSqliteCell>>[];
            rows: readonly {
                [k: string]: unknown;
            }[];
            cellRows: readonly Readonly<Record<string, CapturedSqliteCell>>[];
        }>)[];
        unresolvedEnrollments: readonly Readonly<{
            [k: string]: unknown;
        }>[];
        ownerSessions: readonly Readonly<import("./installed-metadata-source.js").InstalledMetadataOwnerSessions>[];
    }>;
    mapper: {
        events: readonly CapturedProfileEvent[];
        complete: Readonly<{
            kind: "complete";
            enumerationComplete: true;
            sources: readonly Readonly<{
                sourceId: string;
                snapshotHash: string;
                family: "file" | "goal" | "loop" | "kswarm" | "groups" | "session" | "artifact" | "writer-lock" | "codex";
            }>[];
            digest: string;
            relationCount: number;
            gapCount: number;
            occurrenceCount: number;
            verifiedInputSlots: number;
        }>;
    };
    sources: {
        sourceId: string;
        snapshotHash: string;
        family: Family;
        sessions: Session[];
    }[];
    entities: Entity[];
    nativeOwners: {
        owner: Readonly<import("./installed-metadata-source.js").InstalledMetadataOwnerSessions>;
        sessions: Session[];
        unresolved: Unresolved[];
    }[];
    unresolved: Unresolved[];
}>;
export declare function checkInstalledMetadataClosure(lifetime: InstalledControllerLifetime, handle: object): Promise<void>;
export {};
