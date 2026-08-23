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
import { join } from 'node:path';
export const PROVIDER_STORE_V2_DIRNAME = '.provider-store-v2';
/** Directory names the plugin loader/list/Skill scan must skip entirely. */
export const RESERVED_PLUGIN_DIR_NAMES = Object.freeze([
    PROVIDER_STORE_V2_DIRNAME,
    '.active',
    '.managed',
    '.runtimes',
    '.locks',
    '.pins',
]);
/** The only plugin names allowed to become trusted reserved providers. */
export const RESERVED_PLUGIN_NAMES = Object.freeze([
    'cua-computer-use',
    'kai-report-creator',
    'kai-slide-creator',
]);
export const RESERVED_MCP_SERVER_NAMES = Object.freeze([
    'cua-driver',
    'report-renderer',
    'slide-renderer',
]);
export function isReservedPluginName(name) {
    return RESERVED_PLUGIN_NAMES.includes(name.trim().toLowerCase());
}
export function isReservedServerName(name) {
    return RESERVED_MCP_SERVER_NAMES.includes(name.trim().toLowerCase());
}
export function v2ManagedSnapshotPath(storeRoot, pluginName, sourceDigest) {
    return join(storeRoot, PROVIDER_STORE_V2_DIRNAME, 'managed', pluginName, sourceDigest, 'repo');
}
/**
 * Pure decision function: it never touches the filesystem, so the ordering rules
 * can be frozen by tests without simulating an installer.
 */
export function resolveTrustedProviderSource(pluginName, inputs) {
    if (!isReservedPluginName(pluginName)) {
        return {
            kind: 'blocked',
            code: 'not_a_reserved_provider',
            diagnostic: `${pluginName} is not one of ${RESERVED_PLUGIN_NAMES.join(', ')}`,
        };
    }
    if (inputs.candidateManifest && inputs.candidateManifest.pluginName !== pluginName) {
        return {
            kind: 'blocked',
            code: 'manifest_plugin_name_mismatch',
            diagnostic: `manifest declares ${inputs.candidateManifest.pluginName}`,
        };
    }
    const v2 = inputs.v2Pointer;
    if (v2) {
        if (!v2.valid) {
            return {
                kind: 'blocked',
                code: 'blocked_manifest',
                diagnostic: 'v2 active pointer is invalid; refusing to fall back and mask corruption',
            };
        }
        if (!v2.targetExists) {
            return {
                kind: 'blocked',
                code: 'blocked_manifest',
                diagnostic: `v2 pointer target missing for digest ${v2.sourceDigest}`,
            };
        }
        return {
            kind: 'trusted',
            source: {
                pluginName,
                mode: 'v2-pointer',
                sourceSnapshotPath: v2.targetPath,
                sourceDigest: v2.sourceDigest,
            },
        };
    }
    if (inputs.v1Pointer) {
        if (!inputs.v1Pointer.valid) {
            return {
                kind: 'blocked',
                code: 'blocked_manifest',
                diagnostic: 'legacy v1 pointer is invalid; explicit repair required',
            };
        }
        return {
            kind: 'migrate',
            from: { path: inputs.v1Pointer.targetPath, revision: inputs.v1Pointer.revision },
        };
    }
    if (inputs.packagedInput) {
        return { kind: 'materialise', from: inputs.packagedInput };
    }
    return {
        kind: 'blocked',
        code: 'no_trusted_source_available',
        diagnostic: 'no v2 pointer, no v1 pointer and no packaged input',
    };
}
export function admitGenericServer(input) {
    const plugin = input.pluginName.trim().toLowerCase();
    const server = input.serverName.trim().toLowerCase();
    const reservedTuple = (plugin === 'cua-computer-use' && server === 'cua-driver')
        || (plugin === 'kai-report-creator' && server === 'report-renderer')
        || (plugin === 'kai-slide-creator' && server === 'slide-renderer');
    if (reservedTuple) {
        return {
            kind: 'reject',
            code: 'reserved_provider_uses_runtime_owner',
            diagnostic: `${plugin}/${server} is owned by PluginProviderRuntime; generic loader must not register it`,
        };
    }
    if (RESERVED_MCP_SERVER_NAMES.includes(server)) {
        return {
            kind: 'reject',
            code: 'reserved_mcp_server_name_conflict',
            diagnostic: `${input.pluginName} may not declare reserved server name "${input.serverName}"`,
        };
    }
    return { kind: 'admit' };
}
/** Skill/plugin enumeration must skip the internal store roots entirely. */
export function isReservedPluginDirName(name) {
    return RESERVED_PLUGIN_DIR_NAMES.includes(name);
}
