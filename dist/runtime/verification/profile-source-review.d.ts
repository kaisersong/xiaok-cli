import { type ProfileSourceDescriptorSet } from './profile-source-descriptor.js';
export interface ProfileSourceReview {
    readonly version: 1;
    readonly purpose: 'profile-source-custody';
    readonly authorityId: string;
    readonly challengeId: string;
    readonly principal: Readonly<{
        uid: number;
        accountGeneration: string;
        auditSessionId: number;
    }>;
    readonly requestSource: 'user';
    readonly sourceSet: Readonly<ProfileSourceDescriptorSet>;
    readonly inventoryHash: string;
    readonly deadline: Readonly<{
        domainId: string;
        qualificationEpoch: number;
        notBefore: number;
        validUntil: number;
    }>;
}
/** Pure full-review parser. Neither its output nor any caller-provided hash is
 * a complete source census, native approval, holder or metadata capacity owner. */
export declare function parseProfileSourceReview(raw: unknown): Readonly<ProfileSourceReview>;
/** Native stdin only: canonical UTF-8 review is <=512KiB over the unchanged
 * 1MiB broker RPC; escaped ASCII is <=3MiB and fits the existing 7MiB panel. */
export declare function profileSourceReviewBytes(raw: unknown): Buffer;
