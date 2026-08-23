/**
 * StableProviderOutputFile + ProviderOutputStore (design v58 §4.4; R40-01,
 * R41-01, R42-01, R43-01).
 *
 * The problem: when `output_path` is omitted, the renderer writes into the
 * invocation workdir and returns a relative name. Checking that pathname and then
 * renaming it is not enough — the provider child (or anything else with the same
 * uid) can swap the pathname between the check and the commit, so `rename` would
 * publish a different inode than the one that was validated.
 *
 * The committed identity is therefore anchored to an *open handle*:
 *
 *   1. open candidate A with `O_NOFOLLOW` and record its stable file id;
 *   2. keep that handle open across the rename into a private staging dir;
 *   3. after the rename, re-`lstat` the intake path and open a second no-follow
 *      handle; the pre-rename fstat, the post-rename lstat and the intake fstat
 *      must all report the same device+inode, so an A→B swap fails even when B is
 *      itself a perfectly stable regular file;
 *   4. read A exactly once, hashing and writing the destination from the same
 *      bytes, then `fstat(A)` again and never read A afterwards;
 *   5. re-read only the destination and require size+hash to equal that single
 *      stream, then fsync and publish `DELIVERED.json`.
 */
export declare const PROVIDER_OUTPUT_STORE_DIRNAME = "provider-outputs-v1";
export declare const DELIVERED_MANIFEST = "DELIVERED.json";
export declare const MAX_DEFAULT_PROVIDER_OUTPUT_BYTES: number;
export declare class InvalidProviderOutputError extends Error {
    readonly code = "invalid_provider_output";
    constructor(detail: string);
}
export interface FileIdentity {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
}
export interface DeliveredOutput {
    readonly outputId: string;
    readonly absolutePath: string;
    readonly size: number;
    readonly sha256: string;
}
export interface PromoteRequest {
    /** The exact workdir this invocation used; nothing outside it is accepted. */
    readonly invocationWorkDir: string;
    /** Path the backend reported, absolute or relative to the workdir. */
    readonly backendOutputPath: string;
    readonly providerName: string;
    readonly sourceDigest: string;
    readonly runtimeContractDigest?: string;
    readonly maxBytes?: number;
    /** Test seam: runs while A's handle is open, before the rename. */
    readonly onBeforeRename?: () => void;
    /** Test seam: runs after the rename, before the single read stream. */
    readonly onBeforeStream?: () => void;
    /** Test seam: runs after the first chunk has been read from A. */
    readonly onMidStream?: () => void;
}
export declare class ProviderOutputStore {
    private readonly configDir;
    constructor(configDir: string);
    private get root();
    /**
     * Promotes a scratch artifact into the durable store, returning the only path
     * callers may use afterwards.
     */
    promote(request: PromoteRequest): DeliveredOutput;
}
