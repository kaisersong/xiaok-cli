import type { Database } from 'better-sqlite3';
import type { BlobReservationProposal } from './blob-budget.js';
export type BlobIssuerKind = 'material' | 'raw' | 'qualification-mounted' | 'qualification-probe' | 'transcript' | 'run' | 'artifact-batch';
export interface BlobIssuerRecord {
    version: 1;
    resourceId: string;
    allocationHash: string;
    ownerKey: string;
    scopeDigest: string;
    bytes: number;
    issuerKind: BlobIssuerKind;
    producerResourceId: string;
    producerLineageHash: string;
}
/** Read-only original resource census. This does not mint a component or deletion receipt. */
export declare function inspectBlobCapacityIssuer(database: Database, p: Readonly<BlobReservationProposal>): Readonly<BlobIssuerRecord>;
export declare function readBlobCapacityIssuer(database: Database, p: Readonly<BlobReservationProposal>): Readonly<BlobIssuerRecord>;
