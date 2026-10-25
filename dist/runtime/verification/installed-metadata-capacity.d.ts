import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type createInstalledSharedCapacity } from './installed-shared-capacity.js';
import { type MetadataCapacityAllocation } from './metadata-capacity-protocol.js';
/** Fixed controller metadata owner. This exposes no arbitrary session/partition
 * issuer and does not make the unconnected Main/receiver writers protected. */
export declare function createInstalledMetadataCapacity(input: {
    lifetime: InstalledControllerLifetime;
    sharedCapacity: ReturnType<typeof createInstalledSharedCapacity>;
}): Readonly<{
    initializeController(): Readonly<MetadataCapacityAllocation>;
    close(): void;
}>;
