import type { Database } from 'better-sqlite3';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import type { BlobReservationProposal } from './blob-budget.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
export interface InstalledCleanupCommandFacts {
    readonly source: object;
    readonly database: Database;
    readonly kind: 'raw' | 'material' | 'probe';
    readonly resourceId: string;
    readonly expected: QuiescenceExpectation | null;
    readonly allocations: readonly Readonly<BlobReservationProposal>[];
    readonly action: 'request' | 'ack';
    readonly evidence?: string;
}
interface Target {
    kind: 'raw' | 'material' | 'probe';
    resourceId: string;
    expected: QuiescenceExpectation | null;
    allocations: readonly Readonly<BlobReservationProposal>[];
    issuers: readonly object[];
}
/** Only original producers issue commands. This commits before their irreversible I/O. */
export declare function persistInstalledMaintenanceRequest(command: object): void;
/** Lost return is not permission: only the still-live original private command
 * can verify its exact committed request, without minting or mutating anything. */
export declare function assertInstalledMaintenanceRequestRecorded(command: object): void;
/** Only a real drained normal stack can seal its already accepted requests. */
export declare function sealInstalledMaintenanceRequests(lifetime: InstalledControllerLifetime, stack: object): void;
/** New actual lifetime / unique installed lock is required; it proves no guest fact. */
export declare function claimInstalledMaintenanceBatch(lifetime: InstalledControllerLifetime): object | undefined;
export declare function readInstalledMaintenanceBatch(token: object, lifetime: InstalledControllerLifetime): readonly Readonly<Target>[];
export declare function finishInstalledMaintenanceBatch(token: object, lifetime: InstalledControllerLifetime, failed: boolean): void;
export {};
