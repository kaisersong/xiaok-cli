import type { Database } from 'better-sqlite3';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
export interface InstalledMetadataOwnerSessions {
    readonly uid: number;
    readonly accountId: string;
    readonly profileId: string;
    readonly ownerKind: 'task' | 'goal' | 'intent' | 'loop' | 'project' | 'kswarm';
    readonly ownerId: string;
    readonly sessionIdentities: readonly string[];
}
/** Actual controller lifetime is the sole issuer; no caller-provided path/session/partition. */
export declare function createInstalledControllerMetadataSource(lifetime: InstalledControllerLifetime): object;
export declare function readInstalledMetadataSource(handle: object, database: Database, authorityId: string): Readonly<{
    kind: "controller";
    writerGeneration: string;
    resourceId: string;
    physicalIdentity: string;
    beneficiaryCensusHash: string;
    owner: Readonly<{}>;
    beneficiaries: readonly Readonly<{}>[];
    pageSize: number;
    pageCount: number;
}>;
export declare function readInstalledMetadataOwner(handle: object, database: Database, authorityId: string): Readonly<{
    sessionKey: string;
    producerKey: string;
}>;
/** Fresh full Source census at one checkpoint, never a cross-call facts cache. */
export declare function readInstalledMetadataOwners(handles: readonly object[], database: Database, authorityId: string): readonly Readonly<{
    sessionKey: string;
    producerKey: string;
}>[];
/** Snapshot facts only: these objects are never accepted as capacity owners.
 * Empty owner sessions remain unresolved until the full source collector has
 * joined original ordinary sources and retained historical associations. */
export declare function readInstalledMetadataSessions(handle: object, database: Database, authorityId: string): Readonly<{
    version: 1;
    sourceCensusHash: string;
    ownerSessions: readonly Readonly<InstalledMetadataOwnerSessions>[];
}>;
/** Original native facts only. No caller DB/session DTO, capacity owner, drain,
 * retirement approval, legacy completeness or target write permission. */
export declare function readInstalledMetadataSessionFacts(lifetime: InstalledControllerLifetime, handle: object): Readonly<{
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
        masterCells: readonly Readonly<Record<string, import("./source-sqlite-cell.js").CapturedSqliteCell>>[];
    }> | Readonly<{
        table: "obligations" | "verification_profiles" | "verification_registered_owners" | "verification_registered_invocations" | "owner_enrollment_invocation_receipts" | "owner_enrollment_goal_sessions" | "owner_enrollment_intents" | "owner_enrollment_loop_subjects" | "owner_enrollment_intent_contracts" | "owner_enrollment_kswarm_subjects" | "verification_storage_features" | "owner_enrollment_challenges" | "owner_enrollment_requests" | "verification_owners" | "mandatory_observation_checks" | "verification_owner_dependencies" | "owner" | "dependencies" | "registered" | "profile" | "invocations" | "receipts" | "subject" | "storageFeature";
        present: true;
        masterCells: readonly Readonly<Record<string, import("./source-sqlite-cell.js").CapturedSqliteCell>>[];
        schema: readonly {
            [k: string]: unknown;
        }[];
        schemaCells: readonly Readonly<Record<string, import("./source-sqlite-cell.js").CapturedSqliteCell>>[];
        columns: readonly {
            [k: string]: unknown;
        }[];
        columnCells: readonly Readonly<Record<string, import("./source-sqlite-cell.js").CapturedSqliteCell>>[];
        rows: readonly {
            [k: string]: unknown;
        }[];
        cellRows: readonly Readonly<Record<string, import("./source-sqlite-cell.js").CapturedSqliteCell>>[];
    }>)[];
    unresolvedEnrollments: readonly Readonly<{
        [k: string]: unknown;
    }>[];
    ownerSessions: readonly Readonly<InstalledMetadataOwnerSessions>[];
}>;
