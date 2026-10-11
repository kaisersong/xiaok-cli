import type { Database } from 'better-sqlite3';
export declare const REGISTRATION_TABLE_KEYS: Readonly<{
    readonly verification_owner_dependencies: "parent_key";
    readonly owner_enrollment_intents: "logical_owner_key";
    readonly verification_registered_owners: "owner_key";
    readonly verification_owners: "owner_key";
    readonly mandatory_observation_checks: "owner_key";
    readonly verification_registered_invocations: "owner_key";
    readonly owner_enrollment_invocation_receipts: "owner_key";
    readonly owner_enrollment_goal_sessions: "owner_key";
    readonly owner_enrollment_loop_subjects: "owner_key";
    readonly owner_enrollment_intent_contracts: "owner_key";
    readonly owner_enrollment_kswarm_subjects: "logical_owner_key";
    readonly migration_publication_intents: "owner_key";
    readonly verification_application_pointers: "owner_key";
    readonly verification_application_history: "owner_key";
    readonly verification_application_transitions: "owner_key";
}>;
/** Per-call full SQL census only. No row/permission/clock/current result crosses a checkpoint. */
export declare function createRegistrationCensusDatabase(db: Database): Readonly<{
    begin(): {
        evidence: {
            master: Record<string, any>[];
            columns: Record<string, Record<string, any>[]>;
        };
        has: (table: string) => boolean;
        records: (sql: string, args?: unknown[]) => Record<string, any>[];
        groups(table: keyof typeof REGISTRATION_TABLE_KEYS, lookups: readonly string[]): Map<string, Record<string, any>[]>;
        finish(): void;
    };
}> | undefined;
