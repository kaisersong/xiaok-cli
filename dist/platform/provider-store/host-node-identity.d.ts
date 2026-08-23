/**
 * HostNodeRuntimeIdentity (design v58 §4.4; R54-01, R54-03, R55-01, R56-02).
 *
 * The report renderer deliberately ships no Node artifact: it runs on the app's
 * own Electron Node. That is only sound if a pinned generation can prove the
 * interpreter did not change underneath it, so activation freezes an identity and
 * every spawn re-checks it.
 *
 * What the identity must cover, learned the hard way during review:
 *  - `process.execPath` resolved through realpath, plus its content hash;
 *  - on macOS the **dereferenced** interpreter input set inside
 *    `Electron Framework.framework/Versions/A/`: the main Mach-O, the V8 context
 *    snapshot, `icudtl.dat` and the bundled dylibs. The framework's top-level
 *    entry is a 35-byte symlink, so a no-follow tree hash would only cover the
 *    link text; and the snapshot/ICU files are plain data that dyld does not
 *    validate, so replacing them changes behaviour without changing any version.
 *  - the node/modules/v8 version triple and the app version.
 *
 * This is an explicit under-approximation: it covers interpreter inputs, not the
 * child's full image. Auxiliary frameworks and resources are out of scope because
 * a legitimate app update always touches the set above, and same-uid tampering
 * with arbitrary files is outside this design's (non-sandbox) boundary.
 */
export declare const HOST_NODE_IDENTITY_SCHEMA = "xiaok-host-node-identity-v1";
/** Full re-hash cadence for the fast metadata gate (design R55-03). */
export declare const HOST_IDENTITY_REHASH_INTERVAL_MS = 300000;
export interface SupportedHostNodeRange {
    readonly minNodeMajor: number;
    readonly maxNodeMajorExclusive: number;
    readonly moduleAbis: readonly string[];
}
/** Frozen for Electron 39, whose bundled Node is 22.22.1 with module ABI 140. */
export declare const SUPPORTED_HOST_NODE_RANGE: SupportedHostNodeRange;
export interface HostInterpreterInput {
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ino: number;
}
export interface HostNodeRuntimeIdentity {
    readonly schema: typeof HOST_NODE_IDENTITY_SCHEMA;
    readonly platform: string;
    readonly appBundleRoot: string;
    readonly execPathRealpath: string;
    readonly nodeVersion: string;
    readonly moduleAbi: string;
    readonly v8Version: string;
    readonly appVersion: string;
    readonly inputs: readonly HostInterpreterInput[];
    readonly digest: string;
}
export declare class HostRuntimeBlockedError extends Error {
    readonly code = "blocked_external";
    constructor(detail: string);
}
export declare class HostRuntimeIdentityDriftError extends Error {
    readonly field: string;
    readonly code = "host_runtime_identity_drift";
    constructor(field: string);
}
export interface ResolveIdentityInput {
    readonly execPath: string;
    readonly platform: string;
    readonly nodeVersion: string;
    readonly moduleAbi: string;
    readonly v8Version: string;
    readonly appVersion: string;
}
/**
 * macOS: `<app>.app/Contents/MacOS/<exe>` → the app bundle root.
 * Windows/Linux: the directory containing the executable.
 */
export declare function deriveAppBundleRoot(execPathRealpath: string, platform: string): string;
/** The exact interpreter input set, per platform. */
export declare function interpreterInputPaths(execPathRealpath: string, appBundleRoot: string, platform: string): string[];
export declare function resolveHostNodeIdentity(input: ResolveIdentityInput): HostNodeRuntimeIdentity;
export declare function assertSupportedHostNode(identity: Pick<HostNodeRuntimeIdentity, 'nodeVersion' | 'moduleAbi'>, range?: SupportedHostNodeRange): void;
export type SpawnGateResult = {
    kind: 'reuse';
} | {
    kind: 'drift';
    field: string;
};
/**
 * Fast pre-spawn gate. Metadata comparison covers **every** input, and a full
 * re-hash is forced on the first check, on any metadata difference, and whenever
 * the rehash interval has elapsed — so the 300s window can never hide a change
 * that also moved size/mtime/inode.
 */
export declare function checkHostIdentityBeforeSpawn(frozen: HostNodeRuntimeIdentity, now: number, lastFullHashAt: number, live: Pick<ResolveIdentityInput, 'execPath' | 'platform' | 'nodeVersion' | 'moduleAbi' | 'v8Version' | 'appVersion'>): SpawnGateResult;
