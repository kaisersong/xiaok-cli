export declare const SEMANTIC_PRICE_BOUNDS: Readonly<{
    inputMissUpper: 300000000;
    inputHitLower: 3000000;
    outputUpper: 1200000000;
}>;
export interface SemanticCompactionPolicy {
    version: 1;
    mode: 'automatic' | 'mechanism-experiment';
    currency: 'USD';
    maxCalls: number;
    maxCostUnits: number;
    maxOutputTokens: number;
    expiresAt: number;
    pricing: {
        source: string;
        model: 'deepseek-flash';
        inputMissUnitsPerMillion: number;
        inputHitUnitsPerMillion: number;
        outputUnitsPerMillion: number;
        validUntil: number;
    };
}
export interface ValidatedSemanticPolicy extends SemanticCompactionPolicy {
    priceRevision: string;
}
/** Validates user supplied pricing bounds, not provider qualification or authorization. */
export declare function validateSemanticPolicy(value: unknown, now: number, parentExpiresAt: number): ValidatedSemanticPolicy;
/** Worst case uses cache miss for every input token; money is integer billionths. */
export declare function computeSemanticRequestCostUpperBound(policy: ValidatedSemanticPolicy, inputTokenUpperBound: number, outputTokenUpperBound: number): number;
