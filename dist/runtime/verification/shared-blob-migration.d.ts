import type { Database } from 'better-sqlite3';
import type { BlobReservationProposal } from './blob-budget.js';
export interface MigratedBlobBinding {
    sessionKey: string;
    producerKey: string;
    ownerKey: string;
    scopeDigest: string;
    authorityId: string;
    bytes: number;
    engineBinding: {
        engineId: string;
        incarnation: string;
    };
}
/** Reads only original protected database facts. It creates no execution grant. */
export declare function inspectLegacyBlobInventory(db: Database, authorityId: string): {
    digest: string;
    entries: {
        allocation: BlobReservationProposal;
        binding: MigratedBlobBinding;
    }[];
    released: {
        resourceId: any;
        allocationHash: any;
    }[];
};
