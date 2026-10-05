export declare const COMPOUND_DOMAIN_RESERVED_BYTES: number;
/** Budget accounting only; existence is never authorization or recovery evidence.
 * Unknown files remain untouched and prevent claiming this bounded reservation. */
export declare function reserveCompoundDomainBytes(profileRoot: string, requested?: boolean, additionalBytes?: number): number;
