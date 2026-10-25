import { type ValidationMaterialDraft, type ValidationMaterialInvocation } from './product-material-authorization.js';
/** Pure request capture; request IDs locate durable facts and never authorize work. */
export declare function captureMaterialRequestValue(raw: unknown): any;
export declare function parseMaterialRequestQuery(raw: unknown, retire?: boolean): {
    requestId: string;
    invocation: ValidationMaterialInvocation;
    requestSource?: 'user' | 'scheduler';
};
export declare function parseMaterialPrepareRequest(raw: unknown): {
    requestId: string;
    requestSource: 'user';
    draft: ValidationMaterialDraft;
};
export interface MaterialRequestObservation {
    readonly requestId: string;
    readonly state: 'absent' | 'preparing' | 'mapped' | 'retired' | 'not_prepared';
    readonly challengeId?: string;
    readonly challengePhase?: string;
    readonly resources?: ReadonlyArray<{
        resourceId: string;
        state: string;
    }>;
    readonly handoff?: import('./material-authority.js').MaterialMountPlanHandoffFacts;
}
/** Strict wire facts; no returned value is a grant or a physical-stop receipt. */
export declare function parseMaterialRequestObservation(raw: unknown): Readonly<MaterialRequestObservation>;
export type MaterialPrepareResult = Readonly<MaterialRequestObservation & ({
    created: false;
} | {
    created: true;
    canonicalReview: import('./product-material-authorization.js').ValidationMaterialReview;
})>;
export declare function parseMaterialPrepareResult(raw: unknown): MaterialPrepareResult;
