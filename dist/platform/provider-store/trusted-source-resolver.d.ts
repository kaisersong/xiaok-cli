/**
 * Trusted bundled source resolver (design v58 §4.4; R25-02, R26-02, R29-01,
 * R38-01, R39-03).
 *
 * The threat this closes: `~/.xiaok/plugins/<name>` is user-writable and its
 * `manifest.source === 'bundled'` proves nothing, so a reserved provider must
 * never run from whatever happens to sit at that path. Only four inputs are
 * admissible, in this order:
 *
 *   1. a valid v2 active pointer      → use its immutable managed snapshot;
 *   2. an *invalid* v2 pointer        → fail closed (`blocked_manifest`), never
 *                                       silently fall back and mask corruption;
 *   3. no v2 pointer but a valid v1   → one-time migration input only, fully
 *      pointer                          re-verified and atomically committed;
 *   4. neither                        → the current app packaged (or dev) root is
 *                                       a *materialisation input only*, promoted
 *                                       through the triple-Merkle check.
 *
 * Everything else — a legacy same-name directory, a higher-version unmanaged
 * copy, a forged `source: 'bundled'` — is rejected. The v2 store lives under a
 * reserved dot-directory so an older CLI's plugin enumeration cannot treat it as
 * a plugin.
 */
export declare const PROVIDER_STORE_V2_DIRNAME = ".provider-store-v2";
/** Directory names the plugin loader/list/Skill scan must skip entirely. */
export declare const RESERVED_PLUGIN_DIR_NAMES: readonly string[];
/** The only plugin names allowed to become trusted reserved providers. */
export declare const RESERVED_PLUGIN_NAMES: readonly string[];
export declare const RESERVED_MCP_SERVER_NAMES: readonly string[];
export type TrustedSourceMode = 'v2-pointer' | 'v1-migration' | 'packaged-input' | 'dev-input';
export interface TrustedProviderSource {
    readonly pluginName: string;
    readonly mode: TrustedSourceMode;
    /** Always a path inside the v2 managed store, never the app bundle. */
    readonly sourceSnapshotPath: string;
    readonly sourceDigest: string;
}
export type ResolveOutcome = {
    kind: 'trusted';
    source: TrustedProviderSource;
} | {
    kind: 'materialise';
    from: {
        path: string;
        mode: 'packaged-input' | 'dev-input';
    };
} | {
    kind: 'migrate';
    from: {
        path: string;
        revision: number;
    };
} | {
    kind: 'blocked';
    code: string;
    diagnostic: string;
};
export interface V2Pointer {
    readonly sourceDigest: string;
    readonly targetPath: string;
    /** False when the pointer is unreadable, schema-invalid or checksum-broken. */
    readonly valid: boolean;
    /** False when the digest directory it names is missing. */
    readonly targetExists: boolean;
}
export interface V1Pointer {
    readonly targetPath: string;
    readonly revision: number;
    readonly valid: boolean;
}
export interface ResolverInputs {
    readonly storeRoot: string;
    readonly v2Pointer: V2Pointer | null;
    readonly v1Pointer: V1Pointer | null;
    /** Current app packaged root, or an explicitly injected dev/test root. */
    readonly packagedInput: {
        path: string;
        mode: 'packaged-input' | 'dev-input';
    } | null;
    /** Manifest facts read from the candidate; used only to reject, never to trust. */
    readonly candidateManifest?: {
        readonly pluginName: string;
        readonly declaredSource?: string;
        readonly version?: string;
    };
}
export declare function isReservedPluginName(name: string): boolean;
export declare function isReservedServerName(name: string): boolean;
export declare function v2ManagedSnapshotPath(storeRoot: string, pluginName: string, sourceDigest: string): string;
/**
 * Pure decision function: it never touches the filesystem, so the ordering rules
 * can be frozen by tests without simulating an installer.
 */
export declare function resolveTrustedProviderSource(pluginName: string, inputs: ResolverInputs): ResolveOutcome;
/**
 * Admission for the generic MCP loader (design §4.4, R9-02). Normalisation must
 * match `getCanonicalToolId()` so a case/whitespace variant cannot slip past.
 */
export type ServerAdmission = {
    kind: 'admit';
} | {
    kind: 'reject';
    code: 'reserved_mcp_server_name_conflict';
    diagnostic: string;
} | {
    kind: 'reject';
    code: 'reserved_provider_uses_runtime_owner';
    diagnostic: string;
};
export declare function admitGenericServer(input: {
    pluginName: string;
    serverName: string;
}): ServerAdmission;
/** Skill/plugin enumeration must skip the internal store roots entirely. */
export declare function isReservedPluginDirName(name: string): boolean;
