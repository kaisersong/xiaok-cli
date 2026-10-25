import type { Database } from 'better-sqlite3';
import type { PublicProfileIndex } from './profile-owner-registry.js';
export declare function parsePublicProfileIndex(raw: unknown): Readonly<PublicProfileIndex>;
/** Private durable filesystem port. Its installed wrapper must supply the fixed
 * protected namespace and real service identity; this factory alone is not that proof. */
export declare function createProfileIndexPublisher(input: {
    root: string;
    database: Database;
    authorityId: string;
    assertCurrent(): void;
}): Readonly<{
    publish(raw: Readonly<PublicProfileIndex>): void;
    assertPublished(raw: Readonly<PublicProfileIndex>): void;
}>;
