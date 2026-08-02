import { type McpClientConnection } from '../../mcp/transport.js';
import type { McpServerConfig } from '../../mcp/types.js';
import { type PluginManifest } from '../manifest.js';
import type { TrustedRegistryPlugin } from './registry.js';
/** Installing a plugin build is slower than a warm runtime connect. */
export declare const INSTALL_PROBE_STARTUP_TIMEOUT_MS = 15000;
export declare const INSTALL_PROBE_CATALOG_TIMEOUT_MS = 15000;
export declare function validateCandidatePlugin(entry: TrustedRegistryPlugin, pluginDir: string): PluginManifest;
export type ProbeSkipReason = 'requiresUserActivation' | 'unsupportedPlatform' | 'externalDependency';
export interface ProbeOutcome {
    serverName: string;
    status: 'connected' | 'skipped';
    reason?: ProbeSkipReason;
    protocolEra?: string;
    toolCount?: number;
}
export interface ProbeResult {
    status: 'verified' | 'unverified';
    outcomes: ProbeOutcome[];
}
export type McpConnectFn = (serverName: string, config: McpServerConfig, options: {
    cwd: string;
    clientName: string;
}) => Promise<McpClientConnection>;
export interface ProbePluginMcpServersOptions {
    pluginDir: string;
    manifest: PluginManifest;
    platform?: NodeJS.Platform;
    skipServerNames?: string[];
    connect?: McpConnectFn;
    catalogTimeoutMs?: number;
    /** Interpreter from a python_requirements step's isolated runtime. */
    pythonCommand?: string;
}
export declare function probePluginMcpServers(options: ProbePluginMcpServersOptions): Promise<ProbeResult>;
