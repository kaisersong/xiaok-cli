import type { PublicProfileIndex } from './profile-owner-registry.js';
import type { VerificationOwner } from './proof-authority.js';
interface MigrationIdentity extends VerificationOwner {
    version: 1;
    authorityId: string;
    migrationId: string;
    sourceSessionId: string;
    sourceStoreRevision: number;
    sourceSnapshotHash: string;
    migrationEpoch: number;
}
export type MigrationMarker = (MigrationIdentity & {
    state: 'pending';
}) | (MigrationIdentity & {
    state: 'migrated';
    importReceiptHash: string;
});
export type InstalledMigrationState = {
    kind: 'ordinary';
} | {
    kind: 'protected-unregistered';
    authorityId: string;
} | {
    kind: 'pending' | 'migrated';
    marker: Readonly<MigrationMarker>;
} | {
    kind: 'unavailable';
    reason: 'migration_authority_unavailable';
};
export declare function parseMigrationMarker(raw: unknown): Readonly<MigrationMarker>;
/** Actual POSIX ownership/ACL check; a parsed record or caller-supplied uid is not
 * an installed authority. The fixed reader obtains uid from the root-owned manifest.
 */
export declare function assertServiceProtectedMarkerPath(input: string, options: {
    root: string;
    serviceUid: number;
    kind: 'file' | 'directory';
}): void;
export declare function migrationOwnerFileName(raw: VerificationOwner): string;
export declare function migrationProfileDirectoryName(profileId: string): string;
/** Fresh fixed installation lookup. Pending/incomplete/malformed installs never
 * become ordinary; no endpoint/root/environment override is accepted.
 */
export declare function readInstalledMigrationOwner(raw: VerificationOwner): Readonly<InstalledMigrationState>;
export type InstalledCurrentProfile = {
    kind: 'ordinary';
} | {
    kind: 'protected';
    index: Readonly<PublicProfileIndex>;
} | {
    kind: 'unavailable';
    reason: 'migration_authority_unavailable';
};
/** Current OS account only; no model-selected profile, UID, root or helper override. */
export declare function readInstalledCurrentProfile(): Readonly<InstalledCurrentProfile>;
export {};
