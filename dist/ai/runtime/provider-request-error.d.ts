declare const KIMI_REQUEST_FAILED = "KIMI_K3_PROVIDER_REQUEST_FAILED";
export interface KimiProviderRequestDiagnostic {
    code: typeof KIMI_REQUEST_FAILED;
    retryable: boolean;
    status?: number;
    failureKind: string;
    transportCode?: string;
    providerCode?: string;
}
/** Extract only fixed-vocabulary diagnostics. Never retain the original error or its cause/body. */
export declare function createKimiProviderRequestError(raw: unknown, retryable: boolean): Error & KimiProviderRequestDiagnostic;
/** Revalidate fields at the diagnostic sink; never spread an arbitrary exception into logs/UI. */
export declare function getKimiProviderRequestDiagnostic(error: unknown): KimiProviderRequestDiagnostic | undefined;
export declare function formatKimiProviderRequestError(diagnostic: KimiProviderRequestDiagnostic): string;
export {};
