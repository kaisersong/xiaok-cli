import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createPlatformRuntimeContext } from '../../../src/platform/runtime/context.js';

const fixture = vi.hoisted(() => ({ url: '' }));
vi.mock('../../../src/platform/mcp/config.js', () => ({
  loadSettingsMcpServers: () => [], loadPluginMcpServers: () => [],
  mergeMcpServerConfigs: () => ({ servers: [{ name: 'event-fixture', type: 'http', url: fixture.url }], conflicts: [] }),
}));
describe('actual CLI MCP catalog event consumer', () => {
  const cleanup: Array<() => Promise<unknown> | void> = [];
  afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });
  it('replaces a server catalog after a modern event and forwards real tool progress', async () => {
    let name = 'initial';
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'events', version: '1' });
      server.registerTool(name, { inputSchema: {} }, async (_args, ctx) => {
        await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: ctx.mcpReq._meta!.progressToken!, progress: 1 } });
        return { content: [{ type: 'text', text: 'done' }] };
      });
      return server;
    });
    const http = createServer(toNodeHandler(handler));
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => http.close(() => resolve())));
    const address = http.address(); if (!address || typeof address === 'string') throw new Error('no address');
    fixture.url = `http://127.0.0.1:${address.port}/mcp`;
    const dir = mkdtempSync(join(tmpdir(), 'mcp-events-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', dir); vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
    const context = await createPlatformRuntimeContext({ cwd: dir, builtinCommands: [], reminderMode: 'local', mcpClassificationRegistry: [] });
    cleanup.push(() => context.dispose()); await context.mcpReady;
    expect(context.mcpTools.map(tool => tool.definition.name)).toEqual(['mcp__event-fixture__initial']);
    const changed = vi.fn(); context.onMcpToolsChanged(changed);
    name = 'replacement'; await handler.notify.toolsChanged();
    await vi.waitFor(() => expect(context.mcpTools.map(tool => tool.definition.name)).toEqual(['mcp__event-fixture__replacement']));
    expect(changed).toHaveBeenCalled();
    const progress = vi.fn();
    await expect(context.mcpTools[0]!.execute({}, { executionProgress: { progress, wait() {}, resume() {} } } as any)).resolves.toBe('done');
    await vi.waitFor(() => expect(progress).toHaveBeenCalledOnce());
    expect(context.health.capabilities.find(item => item.name === 'event-fixture')?.detail).toContain('tool events subscribed');
    await context.dispose(); expect(context.mcpTools).toEqual([]);
  });
});
