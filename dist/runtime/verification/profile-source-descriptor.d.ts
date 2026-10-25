/** Wire data for native review. These interfaces are not custody capabilities.
 * Parsing, original inventory membership, native authorization and descriptor-
 * relative physical identity checks are all required at the broker boundary. */
export interface ProfileSourceDirectory {
    readonly canonicalPath: string;
    /** Canonical decimal uint64 values, not JS number conversions. */
    readonly device: string;
    readonly inode: string;
}
interface ProfileSourceBase {
    readonly sourceId: string;
    readonly namespaceId: string;
    readonly directory: Readonly<ProfileSourceDirectory>;
    /** Hash of the complete versioned source snapshot reviewed by the user.
     * It is not a directory stat digest. SQLite uses its consistent snapshot. */
    readonly reviewedSnapshotSha256: string;
}
export type ProfileSourceDescriptor = Readonly<ProfileSourceBase & {
    readonly kind: 'profile-registry';
    readonly snapshotFormat: 'profile-source-registry-v1';
}> | Readonly<ProfileSourceBase & {
    readonly kind: 'session-alias-holder';
    readonly snapshotFormat: 'session-alias-holder-v1';
}> | Readonly<ProfileSourceBase & {
    readonly kind: 'session-root';
    readonly snapshotFormat: 'session-root-v1';
}> | Readonly<ProfileSourceBase & {
    readonly kind: 'task-root';
    readonly snapshotFormat: 'task-root-v1';
}> | Readonly<ProfileSourceBase & {
    readonly kind: 'goal-file-root';
    readonly snapshotFormat: 'goal-file-root-v1';
}> | Readonly<ProfileSourceBase & {
    readonly kind: 'sqlite-db';
    readonly snapshotFormat: 'session-sqlite-v1' | 'loop-sqlite-v1' | 'goal-sqlite-v1' | 'writer-lock-sqlite-v1' | 'codex-native-sqlite-v1' | 'codex-routes-sqlite-v1' | 'artifact-workspace-sqlite-v1' | 'kswarm-state-sqlite-v1' | 'multi-agent-groups-sqlite-v1';
    readonly database: Readonly<{
        readonly basename: string;
        readonly device: string;
        readonly inode: string;
    }>;
}>;
export interface ProfileSourceDescriptorSet {
    readonly schemaVersion: 1;
    readonly authorityId: string;
    readonly profileId: string;
    readonly uid: number;
    readonly accountId: string;
    /** Durable inventory revision, canonical decimal uint64. */
    readonly inventoryGeneration: string;
    readonly sources: readonly ProfileSourceDescriptor[];
}
/** Fixed semantics shared by original review and actual capture admission. */
export declare const PROFILE_DIRECTORY_SOURCE_FORMATS: Readonly<Record<string, string>>;
export {};
