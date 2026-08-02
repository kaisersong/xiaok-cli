import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpClientConnection, getMcpConnectionStderrTail, resolveMcpCatalogTimeoutMs, } from '../../mcp/transport.js';
import { parsePluginManifest } from '../manifest.js';
/** Installing a plugin build is slower than a warm runtime connect. */
export const INSTALL_PROBE_STARTUP_TIMEOUT_MS = 15_000;
export const INSTALL_PROBE_CATALOG_TIMEOUT_MS = 15_000;
export function validateCandidatePlugin(entry, pluginDir) {
    const manifestPath = join(pluginDir, 'plugin.json');
    if (!existsSync(manifestPath)) {
        throw new Error(`Candidate plugin is missing plugin.json at ${manifestPath}`);
    }
    let raw;
    try {
        raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    }
    catch (error) {
        throw new Error(`Candidate plugin.json is not valid JSON: ${error.message}`);
    }
    const manifest = parsePluginManifest(raw, pluginDir);
    if (manifest.name !== entry.name) {
        throw new Error(`Candidate manifest name "${manifest.name}" does not match registry name "${entry.name}"`);
    }
    if (manifest.version !== entry.version) {
        throw new Error(`Candidate manifest version "${manifest.version}" does not match registry version "${entry.version}"`);
    }
    return manifest;
}
function withProbeTimeouts(server, pythonCommand) {
    const config = { ...server };
    config.timeout = {
        ...config.timeout,
        startup: Math.max(config.timeout?.startup ?? 0, INSTALL_PROBE_STARTUP_TIMEOUT_MS),
        catalog: Math.max(config.timeout?.catalog ?? 0, INSTALL_PROBE_CATALOG_TIMEOUT_MS),
    };
    if (pythonCommand &&
        config.type === 'stdio' &&
        (config.command === 'python' || config.command === 'python3')) {
        config.command = pythonCommand;
    }
    return config;
}
export async function probePluginMcpServers(options) {
    const platform = options.platform ?? process.platform;
    const connect = options.connect ?? createMcpClientConnection;
    const skipped = new Set(options.skipServerNames ?? []);
    const servers = options.manifest.mcpServers ?? [];
    const platformSupported = !options.manifest.platforms?.length || options.manifest.platforms.includes(platform);
    const catalogTimeoutMs = Math.max(options.catalogTimeoutMs ?? resolveMcpCatalogTimeoutMs(), INSTALL_PROBE_CATALOG_TIMEOUT_MS);
    const outcomes = [];
    let connected = 0;
    for (const server of servers) {
        if (!platformSupported) {
            outcomes.push({ serverName: server.name, status: 'skipped', reason: 'unsupportedPlatform' });
            continue;
        }
        if (server.requiresUserActivation === true) {
            outcomes.push({ serverName: server.name, status: 'skipped', reason: 'requiresUserActivation' });
            continue;
        }
        if (skipped.has(server.name)) {
            outcomes.push({ serverName: server.name, status: 'skipped', reason: 'externalDependency' });
            continue;
        }
        let connection;
        try {
            connection = await connect(server.name, withProbeTimeouts(server, options.pythonCommand), {
                cwd: options.pluginDir,
                clientName: 'xiaok-plugin-install-probe',
            });
        }
        catch (error) {
            const stderrTail = getMcpConnectionStderrTail(error);
            throw new Error(`MCP server "${server.name}" failed to start during install verification: ${error.message}` +
                (stderrTail ? `\n${stderrTail.trim()}` : ''));
        }
        try {
            const catalog = await connection.client.listTools(undefined, { timeout: catalogTimeoutMs });
            outcomes.push({
                serverName: server.name,
                status: 'connected',
                protocolEra: connection.protocolEra,
                toolCount: catalog.tools?.length ?? 0,
            });
            connected += 1;
        }
        catch (error) {
            throw new Error(`MCP server "${server.name}" failed tools/list during install verification: ${error.message}`);
        }
        finally {
            await connection.close();
        }
    }
    return { status: connected > 0 ? 'verified' : 'unverified', outcomes };
}
