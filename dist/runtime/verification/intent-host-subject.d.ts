/** Identity of an original intent or one of its stages. This value is neither
 * enrollment, execution evidence, native approval nor business completion. */
export interface IntentHostSubject {
    readonly version: 1;
    readonly sessionId: string;
    readonly intentId: string;
    readonly stageId: string | null;
}
export declare function parseIntentHostSubject(raw: unknown): Readonly<IntentHostSubject>;
export declare function intentHostSubjectHash(raw: unknown): string;
/** Full subject mapping only; no raw intentId fallback and no registry writes. */
export declare function intentHostSubjectOwner(raw: unknown): Readonly<{
    ownerKind: 'intent';
    ownerId: string;
}>;
