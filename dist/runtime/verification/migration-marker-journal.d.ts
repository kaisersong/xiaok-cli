import type { Database } from 'better-sqlite3';
import { type MigrationMarker } from './migration-markers.js';
/** Private filesystem journal, NOT OS qualification. The sole installed controller
 * owns the namespace and database; its wrapper must check real service identity and
 * actual native authorization/import+source-fence facts before authorizing a token.
 */
export declare function createMigrationMarkerJournal(input: {
    root: string;
    database: Database;
    authorityId: string;
    assertCurrent(): void;
    assertAuthorized(token: object, marker: Readonly<MigrationMarker>): void;
}): Readonly<{
    publishPending(marker: Extract<MigrationMarker, {
        state: "pending";
    }>, token: object): Readonly<MigrationMarker>;
    publishMigrated(marker: Extract<MigrationMarker, {
        state: "migrated";
    }>, token: object): Readonly<MigrationMarker>;
}>;
