import type { OrdinaryProfileSources } from './ordinary-profile-source-registry.js';
export declare const ORDINARY_REGISTRY_STORAGE_MAX_BYTES: number;
export declare const ORDINARY_REGISTRY_DECODED_MAX_BYTES: number;
/** Accepts old objects unchanged; callers MUST retain the full original DTO validator. */
export declare function decodeOrdinaryProfileSourceStorage(raw: unknown): unknown;
/** Input is the original fully validated public DTO. No deduplication or record removal. */
export declare function encodeOrdinaryProfileSourceStorage(facts: Readonly<OrdinaryProfileSources>): unknown;
/** Keep existing flat bytes until they no longer fit; never rewrite on a read or no-op registration. */
export declare function serializeOrdinaryProfileSourceStorage(facts: Readonly<OrdinaryProfileSources>): string;
