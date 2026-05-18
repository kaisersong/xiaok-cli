export interface AheLiteEvalResult {
    evalId: string;
    ok: boolean;
    expectedFailureCategory: string;
    actualFailureCategory: string;
    primaryFinding: string;
    evidenceIds: string[];
    traceBundlePath: string;
    baselineHash: string;
    durationMs: number;
    environment: {
        mode: 'deterministic' | 'live';
        failureClass?: 'product' | 'infra' | 'timeout' | 'skipped';
    };
}
export declare function validateAheLiteEvalResult(input: unknown, options: {
    baselinePath: string;
}): {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
