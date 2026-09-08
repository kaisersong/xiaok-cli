import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import * as transport from '../../../src/platform/mcp/transport.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';

const schema = { name: 'probe', description: 'fixture', inputSchema: { type: 'object' } };
describe('M8/M10 actual CLI context MCP cancellation and emitted Windows boundary', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  function directory() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-cli-mcp-cancel-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config')); vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
    return root;
  }
  function plugin(root: string, server: string) {
    const dir = join(root, '.xiaok', 'plugins', server); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name: server === 'cua-driver' ? 'cua-computer-use' : 'fixture', version: '1', commands: [],
      mcpServers: [{ name: server, type: 'stdio', command: server === 'cua-driver' ? 'cua-driver' : process.execPath, args: server === 'cua-driver' ? ['mcp'] : [], ...(server === 'cua-driver' ? { requiresUserActivation: true } : {}) }],
    }));
  }
  it.each(['darwin', 'win32'] as const)('M8 actual %s generic context initial/refresh forwards per-call signals and preabort starts no new SDK request', async platform => {
    const root = directory(); plugin(root, 'generic'); const calls: Array<{ signal?: AbortSignal }> = []; let refresh!: () => void | Promise<void>;
    const connection = { protocolEra: 'modern', getStderrTail: () => '', getChildPid: () => null, close: async () => {}, dispose: vi.fn(),
      client: { listTools: async () => ({ tools: [schema] }), setNotificationHandler: (_name: string, callback: () => void | Promise<void>) => { refresh = callback; },
        callTool: async (_params: unknown, options?: { signal?: AbortSignal }) => { calls.push(options ?? {}); return { content: [{ type: 'text', text: 'ok' }] }; } },
    } as unknown as transport.McpClientConnection;
    vi.spyOn(transport, 'tryConnect').mockResolvedValue({ status: 'connected', connection });
    const context = await createPlatformRuntimeContext({ cwd: root, builtinCommands: [], reminderMode: 'local', platform }); cleanup.push(() => context.dispose()); await context.mcpReady;
    const a = new AbortController(); const b = new AbortController();
    await context.mcpTools.find(t => t.definition.name === 'mcp__generic__probe')!.execute({}, mcpTestContext(a.signal));
    await refresh(); a.abort(new Error('old turn cancelled'));
    await context.mcpTools.find(t => t.definition.name === 'mcp__generic__probe')!.execute({}, mcpTestContext(b.signal));
    expect(calls.map(call => call.signal)).toEqual([a.signal, b.signal]); expect(connection.dispose).not.toHaveBeenCalled();
    await expect(context.mcpTools[0]!.execute({}, mcpTestContext(a.signal))).rejects.toBe(a.signal.reason); expect(calls).toHaveLength(2);
  });

  it('M8 actual macOS lazy CUA context passes the calling signal through manager and final SDK closure', async () => {
    const root = directory(); plugin(root, 'cua-driver');
    const receiver = vi.fn(async (_params: unknown, _options?: { signal?: AbortSignal }) => ({ content: [{ type: 'text', text: 'ok' }] }));
    const dispose = vi.fn(); const connect = vi.spyOn(transport, 'createMcpClientConnection').mockResolvedValue({
      client: { callTool: receiver }, dispose, close: async () => {}, protocolEra: 'modern', getStderrTail: () => '', getChildPid: () => null,
    } as unknown as transport.McpClientConnection);
    const context = await createPlatformRuntimeContext({ cwd: root, builtinCommands: [], reminderMode: 'local', platform: 'darwin' }); cleanup.push(() => context.dispose()); await context.mcpReady;
    expect(connect).not.toHaveBeenCalled(); const signal = new AbortController().signal;
    await context.mcpTools.find(t => t.definition.name === 'xiaok_computer_use')!.execute({ action: 'list_windows' }, mcpTestContext(signal));
    expect(receiver).toHaveBeenCalledWith({ name: 'list_windows', arguments: {} }, expect.objectContaining({ signal })); expect(dispose).not.toHaveBeenCalled();
  });

  it('M10 emitted context imports with CUA module absent in an isolated package copy and Windows registers no CUA wrapper', async () => {
    const root = directory(); plugin(root, 'cua-driver');
    const source = join(process.cwd(), '.test-dist', 'src');
    expect(existsSync(join(source, 'platform', 'runtime', 'context.js')), 'run test:sandbox:build before package boundary').toBe(true);
    // Do not remove shared .test-dist files: other agent test/build processes own them too.
    const packageRoot = mkdtempSync(join(process.cwd(), '.test-dist', 'mcp-win-boundary-')); cleanup.push(() => rmSync(packageRoot, { recursive: true, force: true, maxRetries: 3 }));
    cpSync(source, join(packageRoot, 'src'), { recursive: true, filter: path => !['cua-connection-manager.js', 'cua-connection-manager.js.map'].some(name => path.endsWith(name)) });
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }));
    const module = await import(pathToFileURL(join(packageRoot, 'src', 'platform', 'runtime', 'context.js')).href) as typeof import('../../../src/platform/runtime/context.js');
    const context = await module.createPlatformRuntimeContext({ cwd: root, builtinCommands: [], reminderMode: 'local', platform: 'win32' }); cleanup.push(() => context.dispose()); await context.mcpReady;
    expect(context.mcpTools.map(tool => tool.definition.name)).not.toContain('xiaok_computer_use');
    expect(context.health.summary()).toContain('macOS-only');
  });
});
