export declare function computeBaselineHash(input: unknown): string;
export declare function validateBaselineUpdate(input: {
    oldBaseline: unknown;
    newBaseline: unknown;
    manifestOverride?: {
        actor: string;
        reason: string;
    };
}): {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
