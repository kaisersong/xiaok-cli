/** A local resource lifetime; this contract conveys no SDK/native authority. */
export interface AttachmentClosable {
    close(): Promise<void>;
}
export interface AttachmentLifecycle<T extends AttachmentClosable> {
    readonly initial: Promise<T | undefined>;
    readonly settled: Promise<T | undefined>;
    close(): Promise<void>;
}
/** The caller creates its one actual pending attachment before entering here. */
export declare function ownAttachmentLifecycle<T extends AttachmentClosable>(settled: Promise<T | undefined>, budget: {
    waitMs: number;
    onDeferred?(): void;
}): AttachmentLifecycle<T>;
