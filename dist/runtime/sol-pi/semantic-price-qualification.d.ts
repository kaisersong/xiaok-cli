import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
export interface SemanticPriceBinding {
    operationId: string;
    serializedBody: string;
    model: string;
    priceRevision: string;
    inputTokenUpperBound: number;
    outputTokenUpperBound: number;
    expiresAt: number;
}
export interface SemanticPriceQualification {
    readonly opaqueSemanticPriceQualification: never;
}
export declare function assertSemanticPriceQualification(value: SemanticPriceQualification, binding: SemanticPriceBinding): void;
/** Public fixed-origin GET: no credentials, caller headers, redirects, proxy or body. */
export declare function semanticPriceEvidenceRevision(value: SemanticPriceQualification, binding: SemanticPriceBinding): string;
export declare function qualifySemanticPrice(binding: SemanticPriceBinding, lease: SessionExecutionLease, signal?: AbortSignal): Promise<SemanticPriceQualification>;
