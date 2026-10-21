import { type MigrationMarker } from './migration-markers.js';
import type { VerificationOwner } from './proof-authority.js';
export type InstalledCurrentOwner = {
    kind: 'ordinary';
} | {
    kind: 'unavailable';
    reason: 'migration_authority_unavailable';
} | {
    kind: 'protected-unregistered';
    authorityId: string;
    owner: Readonly<VerificationOwner>;
} | {
    kind: 'pending' | 'migrated';
    authorityId: string;
    owner: Readonly<VerificationOwner>;
    marker: Readonly<MigrationMarker>;
};
/** Public product lookup has no profile/root override. A fixed OS profile index
 * remains protected even before owner enrollment or migration marker publication. */
export declare function readInstalledCurrentOwner(raw: Pick<VerificationOwner, 'ownerKind' | 'ownerId'>): Readonly<InstalledCurrentOwner>;
