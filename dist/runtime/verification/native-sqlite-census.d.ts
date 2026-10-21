import type { Database } from 'better-sqlite3';
import { type CapturedSqliteCell } from './source-sqlite-cell.js';
declare const inventoryTables: readonly ["verification_profiles", "verification_registered_owners", "verification_registered_invocations", "owner_enrollment_invocation_receipts", "owner_enrollment_goal_sessions", "owner_enrollment_intents", "owner_enrollment_loop_subjects", "owner_enrollment_intent_contracts", "owner_enrollment_kswarm_subjects", "verification_storage_features", "owner_enrollment_challenges", "owner_enrollment_requests"];
type InventoryTable = typeof inventoryTables[number];
declare const scopedQueries: {
    readonly owner: {
        readonly table: "verification_owners";
        readonly where: "owner_key";
    };
    readonly obligations: {
        readonly table: "mandatory_observation_checks";
        readonly where: "owner_key";
        readonly order: "obligation_id";
    };
    readonly dependencies: {
        readonly table: "verification_owner_dependencies";
        readonly where: "parent_key";
        readonly order: "child_key";
    };
    readonly registered: {
        readonly table: "verification_registered_owners";
        readonly where: "owner_key";
    };
    readonly profile: {
        readonly table: "verification_profiles";
        readonly where: "profile_id";
    };
    readonly invocations: {
        readonly table: "verification_registered_invocations";
        readonly where: "owner_key";
        readonly order: "invocation_json";
    };
    readonly receipts: {
        readonly table: "owner_enrollment_invocation_receipts";
        readonly where: "owner_key";
        readonly order: "invocation_json";
    };
    readonly subject: {
        readonly table: "owner_enrollment_kswarm_subjects";
        readonly where: "owner_key";
    };
    readonly storageFeature: {
        readonly table: "verification_storage_features";
        readonly where: "feature";
    };
};
/** Fixed native producer namespaces cannot resolve to virtual modules or computed data. */
export declare function assertNativeSqliteProducerTableKinds(database: Database): void;
/** Call after the producer kind guard, before a semantic SELECT. Missing tables remain absent. */
export declare function assertNativeSqliteStoredProducerColumns(database: Database, table: string): void;
type ScopedQuery = keyof typeof scopedQueries;
/** Pure encoding of already-issued immutable facts, never an authority. */
export declare function canonicalNativeCensusPopulation(frames: readonly object[]): string;
/** Readonly original facts; no source brand, callbacks or write grant. */
export declare function readNativeSqliteCensus(database: Database, query: InventoryTable | ScopedQuery, argument?: string): Readonly<{
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
}>;
/** Fixed population, with one context for this synchronous transaction only. */
export declare function readNativeEnrollmentCensus(database: Database): readonly (Readonly<{
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
export declare function readNativeKSwarmCensus(database: Database, ownerKey: string, profileId: string): Readonly<{
    [k: string]: Readonly<{
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
    }>;
}>;
export {};
