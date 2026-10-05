import type { Database } from 'better-sqlite3';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type createInstalledRootBrokerClient } from './root-broker-client.js';
import { type createSharedBlobCapacity } from './shared-blob-capacity.js';
import type { ControllerPeer } from './controller-public-daemon.js';
type PageRequest = {
    requestSource: 'user';
    ownerKind: string;
    ownerId: string;
    after: string | null;
    limit: number;
};
/** Read-only metadata projection, not an authorization issuer. The installed
 * facade resolves the kernel peer through the actual broker before calling it. */
export declare function readExistingMaintenancePage(db: Database, principal: {
    uid: number;
    accountGeneration: string;
}, request: PageRequest): Readonly<{
    inventoryDigest: string;
    items: readonly Readonly<{
        resourceId: string;
        kind: string;
        state: string;
        mapping: "mapped" | "unmapped";
        reason: "capacity_mapping_missing" | null;
    }>[];
    nextAfter: string | null;
}>;
export declare function createInstalledCapacityMaintenance(input: {
    lifetime: InstalledControllerLifetime;
    broker: ReturnType<typeof createInstalledRootBrokerClient>;
    capacity: ReturnType<typeof createSharedBlobCapacity>;
}): Readonly<{
    publicPort: Readonly<{
        diagnose(raw: unknown, peerInput: ControllerPeer, signal: AbortSignal): Readonly<{
            mode: "maintenance";
            items: readonly Readonly<{
                resourceId: string;
                kind: string;
                state: string;
                mapping: "mapped" | "unmapped";
                reason: "capacity_mapping_missing" | null;
            }>[];
            nextCursor: string | null;
            unmappedInventoryPresent: boolean;
        }>;
    }>;
    privateHost: Readonly<{
        retryMigration(): Readonly<{
            inventoryDigest: string;
            chargedResources: number;
            releasedResources: number;
        }>;
    }>;
    close(): Promise<void>;
}>;
export {};
