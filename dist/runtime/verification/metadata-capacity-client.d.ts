import { type AuthenticatedMetadataCapacityTransport } from './metadata-capacity-protocol.js';
/** Authenticated allocation facts only; the private Main owner must separately
 * bind actual custody/census and apply the actual connection cap before writing. */
export declare function createMetadataCapacityClient(transport: AuthenticatedMetadataCapacityTransport): Readonly<{
    prepare(raw: unknown, signal?: AbortSignal): Promise<Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>>;
    prepareSync(raw: unknown): Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>;
    confirm(raw: unknown, signal?: AbortSignal): Promise<Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>>;
    confirmSync(raw: unknown): Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>;
    query(raw: unknown, signal?: AbortSignal): Promise<Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>>;
    querySync(raw: unknown): Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>;
}>;
