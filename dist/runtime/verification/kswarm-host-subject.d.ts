/** Original business identity data. Neither this value nor its hash is an
 * enrollment, a controller owner, native approval, or publication permission. */
export interface KSwarmHostSubject {
    readonly version: 1;
    readonly projectId: string;
    readonly taskId: string | null;
}
export declare function parseKSwarmHostSubject(raw: unknown): Readonly<KSwarmHostSubject>;
export declare function kswarmHostSubjectHash(raw: unknown): string;
/** A distinct data namespace. This mapping does not register or activate it. */
export declare function kswarmHostSubjectOwner(raw: unknown): Readonly<{
    ownerKind: 'kswarm';
    ownerId: string;
}>;
export declare function isKSwarmOwnerIdentity(value: {
    ownerKind?: unknown;
    ownerId?: unknown;
}): boolean;
