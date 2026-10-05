/** Host-only provenance. A receipt proves exact segmentation, never disclosure permission. */
export interface FinalizedObservationProvenance {
    readonly hostInvocationId: string;
    readonly ownerGeneration: number;
    readonly wholeContent: string;
    readonly segments: Readonly<{
        before: string;
        native: string;
        after: string;
    }>;
}
export interface ObservationProvenanceReceipt {
    readonly kind: 'host-native-observation';
}
export interface NativeObservationProvenancePort {
    appendSuffix(suffix: string): void;
    observeTransform(value: {
        before: string;
        after: string;
    }): void;
    sealRegistry(finalResult: string): void;
    finalizeHistory(finalContent: string): ObservationProvenanceReceipt | undefined;
    invalidate(): void;
}
/** Only the exact host-created port can wrap a sealed body, once. No callbacks or property reads. */
export declare function wrapNativeObservationHistory(port: unknown, before: string, body: string, after: string): boolean;
export declare function readFinalizedObservationProvenance(receipt: unknown): FinalizedObservationProvenance | undefined;
export declare function createNativeObservationProvenance(input: {
    hostInvocationId: string;
    ownerGeneration: number;
    nativePreview: string;
}): NativeObservationProvenancePort;
