import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import type { Database } from 'better-sqlite3';
import { type MigrationMarker } from './migration-markers.js';
import type { PublicProfileIndex } from './profile-owner-registry.js';
export declare function createInstalledMigrationMarkerPublisher(input: {
    database: Database;
    assertAuthorized(token: object, marker: Readonly<MigrationMarker>): void;
}): Readonly<{
    publishPending(marker: Extract<MigrationMarker, {
        state: "pending";
    }>, token: object): Readonly<MigrationMarker>;
    publishMigrated(marker: Extract<MigrationMarker, {
        state: "migrated";
    }>, token: object): Readonly<MigrationMarker>;
}>;
export declare function createInstalledProfileIndexPublisher(input: {
    lifetime: Readonly<InstalledControllerLifetime>;
}): Readonly<{
    publish(raw: Readonly<PublicProfileIndex>): void;
    assertPublished(raw: Readonly<PublicProfileIndex>): void;
}>;
