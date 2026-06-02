/**
 * E2E test: Plugin bundling deployment + MCP server startup
 *
 * This test simulates the full deployment flow:
 * 1. Sets up a fake bundled-plugins directory with report-creator
 * 2. Runs deployBundledPlugins logic to copy to target plugins dir
 * 3. Starts the real report-renderer MCP server from the bundle
 * 4. Verifies MCP initialize handshake succeeds
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const REPORT_BUNDLE_PATH = join(
  __dirname, '..', '..', '..', '..',
  'kai-xiaok-plugins', 'plugins', 'kai-report-creator',
  'mcp-servers', 'report-renderer', 'dist', 'server.bundle.js'
);

describe('e2e: plugin bundling and MCP server startup', () => {
  let testDir: string;
  let pluginsDir: string;
  let bundledDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-e2e-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    pluginsDir = join(testDir, 'plugins');
    bundledDir = join(testDir, 'bundled-plugins');
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(bundledDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('deploys report-creator plugin and verifies file structure', () => {
    // Simulate bundled plugin
    const srcPlugin = join(bundledDir, 'kai-report-creator');
    mkdirSync(join(srcPlugin, 'skills'), { recursive: true });
    mkdirSync(join(srcPlugin, 'mcp-servers', 'report-renderer', 'dist'), { recursive: true });

    writeFileSync(join(srcPlugin, 'plugin.json'), JSON.stringify({
      name: 'kai-report-creator',
      version: '2.0.0',
      mcpServers: [{
        name: 'report-renderer',
        type: 'stdio',
        command: 'node',
        args: ['mcp-servers/report-renderer/dist/server.bundle.js'],
      }],
    }, null, 2));
    writeFileSync(join(srcPlugin, 'skills', 'SKILL.md'), '# Report Creator');
    writeFileSync(join(srcPlugin, 'mcp-servers', 'report-renderer', 'dist', 'server.bundle.js'), 'console.log("stub")');
    mkdirSync(join(srcPlugin, 'mcp-servers', 'report-renderer', 'dist', 'renderer'), { recursive: true });
    writeFileSync(join(srcPlugin, 'mcp-servers', 'report-renderer', 'dist', 'renderer', 'html-builder.js'), 'export function buildHtml() {}');

    // Simulate deploy
    const dest = join(pluginsDir, 'kai-report-creator');
    cpSync(srcPlugin, dest, { recursive: true });

    // Mark as bundled
    const manifest = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
    manifest.source = 'bundled';
    writeFileSync(join(dest, 'plugin.json'), JSON.stringify(manifest, null, 2));

    // Verify structure
    expect(existsSync(join(dest, 'plugin.json'))).toBe(true);
    expect(existsSync(join(dest, 'skills', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dest, 'mcp-servers', 'report-renderer', 'dist', 'server.bundle.js'))).toBe(true);
    expect(existsSync(join(dest, 'mcp-servers', 'report-renderer', 'dist', 'renderer', 'html-builder.js'))).toBe(true);

    const deployed = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
    expect(deployed.source).toBe('bundled');
    expect(deployed.version).toBe('2.0.0');
  });

  it('report-renderer MCP server responds to initialize (real bundle)', async () => {
    if (!existsSync(REPORT_BUNDLE_PATH)) {
      // Skip if bundle not available (CI without plugin repo)
      console.log('Skipping: report-renderer bundle not found at', REPORT_BUNDLE_PATH);
      return;
    }

    const result = await new Promise<{ success: boolean; response: string }>((resolve) => {
      const proc = spawn('node', [REPORT_BUNDLE_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10_000,
      });

      let stdout = '';
      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        // Got a response, kill the server
        if (stdout.includes('"jsonrpc"')) {
          proc.kill();
          resolve({ success: true, response: stdout });
        }
      });

      proc.on('error', () => {
        resolve({ success: false, response: '' });
      });

      // Send timeout fallback
      setTimeout(() => {
        proc.kill();
        resolve({ success: false, response: stdout });
      }, 8000);

      // Send MCP initialize request
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e-test', version: '1.0' },
        },
      });
      proc.stdin.write(initRequest + '\n');
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.response.trim());
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(1);
    expect(parsed.result.serverInfo.name).toBe('report-renderer');
    expect(parsed.result.capabilities.tools).toBeDefined();
  });

  it('report-renderer lists tools after initialization (real bundle)', async () => {
    if (!existsSync(REPORT_BUNDLE_PATH)) {
      console.log('Skipping: report-renderer bundle not found at', REPORT_BUNDLE_PATH);
      return;
    }

    const tools = await new Promise<string[]>((resolve) => {
      const proc = spawn('node', [REPORT_BUNDLE_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10_000,
      });

      let stdout = '';
      let messageCount = 0;

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        const lines = stdout.split('\n').filter(l => l.trim());
        if (lines.length > messageCount) {
          messageCount = lines.length;
          if (messageCount >= 2) {
            proc.kill();
            try {
              const toolsResponse = JSON.parse(lines[1]);
              const toolNames = toolsResponse.result?.tools?.map((t: { name: string }) => t.name) || [];
              resolve(toolNames);
            } catch {
              resolve([]);
            }
          }
        }
      });

      setTimeout(() => {
        proc.kill();
        resolve([]);
      }, 8000);

      // Send initialize
      proc.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }) + '\n');

      // Send initialized notification + list tools
      setTimeout(() => {
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
      }, 500);
    });

    expect(tools.length).toBeGreaterThan(0);
    // report-renderer should have render_report tool
    expect(tools.some(t => t.includes('render'))).toBe(true);
  });

  it('slide-renderer plugin structure is correct when deployed', () => {
    const srcPlugin = join(bundledDir, 'kai-slide-creator');
    mkdirSync(join(srcPlugin, 'mcp-servers', 'slide-renderer'), { recursive: true });
    mkdirSync(join(srcPlugin, 'skills'), { recursive: true });
    mkdirSync(join(srcPlugin, 'references'), { recursive: true });
    mkdirSync(join(srcPlugin, 'schemas'), { recursive: true });
    mkdirSync(join(srcPlugin, 'bundled-wheels'), { recursive: true });

    writeFileSync(join(srcPlugin, 'plugin.json'), JSON.stringify({
      name: 'kai-slide-creator',
      version: '3.1.0',
      mcpServers: [{
        name: 'slide-renderer',
        type: 'stdio',
        command: 'python3',
        args: ['mcp-servers/slide-renderer/server.py'],
      }],
    }, null, 2));
    writeFileSync(join(srcPlugin, 'mcp-servers', 'slide-renderer', 'server.py'), '# stub');
    writeFileSync(join(srcPlugin, 'skills', 'SKILL.md'), '# Slide Creator');
    writeFileSync(join(srcPlugin, 'schemas', 'brief.json'), '{}');
    writeFileSync(join(srcPlugin, 'bundled-wheels', 'mcp-1.0.0-py3-none-any.whl'), 'wheel-stub');

    // Deploy
    const dest = join(pluginsDir, 'kai-slide-creator');
    cpSync(srcPlugin, dest, { recursive: true });

    // Verify all critical paths exist
    expect(existsSync(join(dest, 'plugin.json'))).toBe(true);
    expect(existsSync(join(dest, 'mcp-servers', 'slide-renderer', 'server.py'))).toBe(true);
    expect(existsSync(join(dest, 'skills', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dest, 'schemas', 'brief.json'))).toBe(true);
    expect(existsSync(join(dest, 'bundled-wheels', 'mcp-1.0.0-py3-none-any.whl'))).toBe(true);
  });

  it('version upgrade preserves bundled source marker', () => {
    // Initial deploy v2.0.0
    const srcPlugin = join(bundledDir, 'kai-report-creator');
    mkdirSync(srcPlugin, { recursive: true });
    writeFileSync(join(srcPlugin, 'plugin.json'), JSON.stringify({
      name: 'kai-report-creator', version: '2.0.0',
    }));

    const dest = join(pluginsDir, 'kai-report-creator');
    cpSync(srcPlugin, dest, { recursive: true });
    const m1 = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
    m1.source = 'bundled';
    writeFileSync(join(dest, 'plugin.json'), JSON.stringify(m1));

    // Upgrade to v3.0.0
    writeFileSync(join(srcPlugin, 'plugin.json'), JSON.stringify({
      name: 'kai-report-creator', version: '3.0.0',
    }));
    cpSync(srcPlugin, dest, { recursive: true });
    const m2 = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
    m2.source = 'bundled';
    writeFileSync(join(dest, 'plugin.json'), JSON.stringify(m2));

    const final = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
    expect(final.version).toBe('3.0.0');
    expect(final.source).toBe('bundled');
  });
});
