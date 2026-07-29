export declare const CANONICAL_JSON_V1_ENCODER_ID = "xiaok-canonical-json-direct-v1";
export declare const CANONICAL_JSON_V1_LIMITS: Readonly<{
    maxCanonicalDepth: 128;
    maxCanonicalContainerEntries: 100000;
    maxCanonicalTotalNodes: 1000000;
    maxCanonicalUtf16CodeUnits: 16777216;
}>;
export declare function canonicalJsonV1(value: unknown): string;
