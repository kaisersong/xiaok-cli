import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeGitTreeSha256, sha256Hex, type GitObjectEntry } from '../../../src/platform/plugins/install/integrity.js';
import { installPlugin } from '../../../src/platform/plugins/install/installer.js';
import { readActivePluginPointer } from '../../../src/platform/plugins/install/active-pointer.js';
import { resolveInstallPaths } from '../../../src/platform/plugins/install/source.js';
import { initFixtureRepo, type FixtureRepo } from './install-fixtures.js';

const LEGACY_SERVER = `
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.PROBE_REPORT, JSON.stringify({ cwd: process.cwd() }));
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\\n');
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'legacy-e2e', version: '1.0.0' },
        },
      }) + '\\n');
      continue;
    }
    if (message.method === 'tools/list') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: [
          { name: 'render_report', description: 'render', inputSchema: { type: 'object' } },
          { name: 'list_themes', description: 'themes', inputSchema: { type: 'object' } },
        ] },
      }) + '\\n');
      continue;
    }
    if (message.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n');
    }
  }
});
`;

const MODERN_SERVER = `
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.PROBE_REPORT, JSON.stringify({ cwd: process.cwd() }));
const { McpServer } = require('@modelcontextprotocol/server');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');
const server = new McpServer({ name: 'modern-e2e', version: '1.0.0' });
server.registerTool('render_slide', { description: 'render', inputSchema: {} }, async () => ({
  content: [{ type: 'text', text: 'ok' }],
}));
serveStdio(() => server);
`;

function entryFor(path: string, content: string): GitObjectEntry {
  return { mode: '100644', path, contentSha256: sha256Hex(Buffer.from(content)) };
}

describe('plugin install end to end', () => {
  let root: string;
  let repo: FixtureRepo;
  let pluginsDir: string;
  let legacyReport: string;
  let modernReport: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-install-e2e-'));
    repo = initFixtureRepo(join(root, 'origin'));
    pluginsDir = join(root, 'plugins-home');
    legacyReport = join(root, 'legacy-report.json');
    modernReport = join(root, 'modern-report.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('installs and probes both a legacy and a modern MCP plugin from a local registry', async () => {
    const legacyManifest = `${JSON.stringify({
      name: 'legacy-plugin',
      version: '1.0.0',
      mcpServers: [{
        name: 'legacy-renderer',
        type: 'stdio',
        command: process.execPath,
        args: ['server.cjs'],
        protocol: { mode: 'legacy' },
        env: { PROBE_REPORT: legacyReport },
      }],
    }, null, 2)}\n`;
    const modernManifest = `${JSON.stringify({
      name: 'modern-plugin',
      version: '2.0.0',
      mcpServers: [{
        name: 'modern-renderer',
        type: 'stdio',
        command: process.execPath,
        args: ['server.cjs'],
        protocol: { mode: 'modern', version: '2026-07-28' },
        env: { PROBE_REPORT: modernReport, NODE_PATH: join(process.cwd(), 'node_modules') },
      }],
    }, null, 2)}\n`;

    repo.writeFile('plugins/legacy-plugin/plugin.json', legacyManifest);
    repo.writeFile('plugins/legacy-plugin/server.cjs', LEGACY_SERVER);
    repo.writeFile('plugins/modern-plugin/plugin.json', modernManifest);
    repo.writeFile('plugins/modern-plugin/server.cjs', MODERN_SERVER);
    const commit = repo.commit('publish fixtures');

    const legacyDigest = computeGitTreeSha256([
      entryFor('plugin.json', legacyManifest),
      entryFor('server.cjs', LEGACY_SERVER),
    ]);
    const modernDigest = computeGitTreeSha256([
      entryFor('plugin.json', modernManifest),
      entryFor('server.cjs', MODERN_SERVER),
    ]);

    const request = async (url: string) => ({
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: Buffer.from(JSON.stringify({
        version: 2,
        plugins: [
          {
            name: 'legacy-plugin',
            repo: 'kaisersong/kai-xiaok-plugins',
            path: 'plugins/legacy-plugin',
            version: '1.0.0',
            source: { commit, treeSha256: legacyDigest },
          },
          {
            name: 'modern-plugin',
            repo: 'kaisersong/kai-xiaok-plugins',
            path: 'plugins/modern-plugin',
            version: '2.0.0',
            source: { commit, treeSha256: modernDigest },
          },
        ],
      }), 'utf8'),
      url,
    });

    const options = {
      pluginsDir,
      registryUrl: 'https://example.com/registry-v2.json',
      trustRegistry: true,
      request: request as never,
      cloneUrl: repo.dir,
      allowLocalSource: true,
    };

    const legacy = await installPlugin('legacy-plugin', options);
    const modern = await installPlugin('modern-plugin', options);

    expect(legacy.probe).toEqual({
      status: 'verified',
      outcomes: [{ serverName: 'legacy-renderer', status: 'connected', protocolEra: 'legacy', toolCount: 2 }],
    });
    expect(modern.probe.status).toBe('verified');
    expect(modern.probe.outcomes[0]).toMatchObject({
      serverName: 'modern-renderer',
      protocolEra: 'modern',
      toolCount: 1,
    });

    // Both probes must run from the final immutable version directory.
    const paths = resolveInstallPaths(pluginsDir);
    expect(JSON.parse(readFileSync(legacyReport, 'utf8')).cwd).toBe(realpathSync(legacy.pluginDir));
    expect(JSON.parse(readFileSync(modernReport, 'utf8')).cwd).toBe(realpathSync(modern.pluginDir));
    expect(legacy.pluginDir.startsWith(join(paths.managedDir, 'legacy-plugin', legacyDigest))).toBe(true);
    expect(readActivePluginPointer(paths, 'legacy-plugin').probe.status).toBe('verified');
    expect(readActivePluginPointer(paths, 'modern-plugin').digest).toBe(modernDigest);
  });
});
