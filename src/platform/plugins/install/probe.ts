import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createMcpClientConnection,
  getMcpConnectionStderrTail,
  resolveMcpCatalogTimeoutMs,
  type McpClientConnection,
} from '../../mcp/transport.js';
import type { McpServerConfig, PluginManifestMcpServer } from '../../mcp/types.js';
import { parsePluginManifest, type PluginManifest } from '../manifest.js';
import type { TrustedRegistryPlugin } from './registry.js';

/** Installing a plugin build is slower than a warm runtime connect. */
export const INSTALL_PROBE_STARTUP_TIMEOUT_MS = 15_000;
export const INSTALL_PROBE_CATALOG_TIMEOUT_MS = 15_000;

export function validateCandidatePlugin(entry: TrustedRegistryPlugin, pluginDir: string): PluginManifest {
  const manifestPath = join(pluginDir, 'plugin.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Candidate plugin is missing plugin.json at ${manifestPath}`);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Candidate plugin.json is not valid JSON: ${(error as Error).message}`);
  }

  const manifest = parsePluginManifest(raw, pluginDir);

  if (manifest.name !== entry.name) {
    throw new Error(`Candidate manifest name "${manifest.name}" does not match registry name "${entry.name}"`);
  }
  if (manifest.version !== entry.version) {
    throw new Error(
      `Candidate manifest version "${manifest.version}" does not match registry version "${entry.version}"`,
    );
  }

  return manifest;
}

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

export type McpConnectFn = (
  serverName: string,
  config: McpServerConfig,
  options: { cwd: string; clientName: string },
) => Promise<McpClientConnection>;

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

function withProbeTimeouts(server: PluginManifestMcpServer, pythonCommand?: string): McpServerConfig {
  const config = { ...server } as PluginManifestMcpServer;
  config.timeout = {
    ...config.timeout,
    startup: Math.max(config.timeout?.startup ?? 0, INSTALL_PROBE_STARTUP_TIMEOUT_MS),
    catalog: Math.max(config.timeout?.catalog ?? 0, INSTALL_PROBE_CATALOG_TIMEOUT_MS),
  };
  if (
    pythonCommand &&
    config.type === 'stdio' &&
    (config.command === 'python' || config.command === 'python3')
  ) {
    config.command = pythonCommand;
  }
  return config;
}

export async function probePluginMcpServers(options: ProbePluginMcpServersOptions): Promise<ProbeResult> {
  const platform = options.platform ?? process.platform;
  const connect = options.connect ?? createMcpClientConnection;
  const skipped = new Set(options.skipServerNames ?? []);
  const servers = options.manifest.mcpServers ?? [];
  const platformSupported =
    !options.manifest.platforms?.length || options.manifest.platforms.includes(platform);
  const catalogTimeoutMs = Math.max(
    options.catalogTimeoutMs ?? resolveMcpCatalogTimeoutMs(),
    INSTALL_PROBE_CATALOG_TIMEOUT_MS,
  );

  const outcomes: ProbeOutcome[] = [];
  let connected = 0;

  for (const server of servers) {
    if (!platformSupported) {
      outcomes.push({ serverName: server.name, status: 'skipped', reason: 'unsupportedPlatform' });
      continue;
    }
    if ((server as { requiresUserActivation?: boolean }).requiresUserActivation === true) {
      outcomes.push({ serverName: server.name, status: 'skipped', reason: 'requiresUserActivation' });
      continue;
    }
    if (skipped.has(server.name)) {
      outcomes.push({ serverName: server.name, status: 'skipped', reason: 'externalDependency' });
      continue;
    }

    let connection: McpClientConnection;
    try {
      connection = await connect(server.name, withProbeTimeouts(server, options.pythonCommand), {
        cwd: options.pluginDir,
        clientName: 'xiaok-plugin-install-probe',
      });
    } catch (error) {
      const stderrTail = getMcpConnectionStderrTail(error);
      throw new Error(
        `MCP server "${server.name}" failed to start during install verification: ${(error as Error).message}` +
          (stderrTail ? `\n${stderrTail.trim()}` : ''),
      );
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
    } catch (error) {
      throw new Error(
        `MCP server "${server.name}" failed tools/list during install verification: ${(error as Error).message}`,
      );
    } finally {
      await connection.close();
    }
  }

  return { status: connected > 0 ? 'verified' : 'unverified', outcomes };
}
