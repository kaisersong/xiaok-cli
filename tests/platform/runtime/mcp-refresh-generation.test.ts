import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatformRuntimeContext } from '../../../src/platform/runtime/context.js';

const mock = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock('../../../src/platform/mcp/config.js', () => ({
  loadSettingsMcpServers: () => [], loadPluginMcpServers: () => [],
  mergeMcpServerConfigs: () => ({ servers: [{ name: 'generation-fixture', type: 'stdio', command: 'unused' }], conflicts: [] }),
}));
vi.mock('../../../src/platform/mcp/transport.js', async (original) => ({
  ...await original<typeof import('../../../src/platform/mcp/transport.js')>(),
  tryConnect: async () => ({ status: 'connected', connection: mock.clients[0] }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function catalog(name: string) {
  return { tools: [{ name, description: name, inputSchema: { type: 'object', properties: {} } }] };
}

describe('MCP catalog generation handles stale failures', () => {
  let dir: string;
  let context: Awaited<ReturnType<typeof createPlatformRuntimeContext>> | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xiaok-mcp-generation-'));
    vi.stubEnv('XIAOK_CONFIG_DIR', dir);
    vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
  });
  afterEach(async () => {
    await context?.dispose(); context = undefined;
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  async function setup(initial: Promise<ReturnType<typeof catalog>> = Promise.resolve(catalog('initial'))) {
    let notify!: () => Promise<void>;
    const client = { listTools: vi.fn().mockReturnValueOnce(initial), callTool: vi.fn(), onclose: undefined as (() => void) | undefined,
      setNotificationHandler: (_name: string, handler: () => Promise<void>) => { notify = handler; },
    };
    const connection = { client, protocolEra: 'legacy', dispose: vi.fn(() => client.onclose?.()) };
    mock.clients = [connection];
    context = await createPlatformRuntimeContext({ cwd: dir, builtinCommands: [], reminderMode: 'local', mcpClassificationRegistry: [] });
    await vi.waitFor(() => expect(client.listTools).toHaveBeenCalledOnce());
    return { client, connection, notify: () => notify() };
  }
  const names = () => context!.mcpTools.map((tool) => tool.definition.name);

  it('does not let an older notification failure withdraw a newer successful catalog', async () => {
    const f = await setup(); await context!.mcpReady;
    const old = deferred<ReturnType<typeof catalog>>();
    f.client.listTools.mockReturnValueOnce(old.promise).mockResolvedValueOnce(catalog('new'));
    const stale = f.notify(); await f.notify();
    old.reject(new Error('old request failed')); await stale;
    expect(names()).toEqual(['mcp__generation-fixture__new']);
  });

  it('does not close a healthy connection when initial discovery loses to a newer notification', async () => {
    const initial = deferred<ReturnType<typeof catalog>>();
    const f = await setup(initial.promise);
    f.client.listTools.mockResolvedValueOnce(catalog('new'));
    await f.notify(); initial.reject(new Error('old initial request failed'));
    await context!.mcpReady;
    expect(names()).toEqual(['mcp__generation-fixture__new']);
    expect(f.connection.dispose).not.toHaveBeenCalled();
  });

  it('withdraws current failures but ignores late successes after disconnect', async () => {
    const f = await setup(); await context!.mcpReady;
    f.client.listTools.mockRejectedValueOnce(new Error('current catalog unavailable'));
    await f.notify(); expect(names()).toEqual([]);
    const late = deferred<ReturnType<typeof catalog>>();
    f.client.listTools.mockReturnValueOnce(late.promise);
    const pending = f.notify(); f.client.onclose?.();
    late.resolve(catalog('stale')); await pending;
    expect(names()).toEqual([]);
  });
});
