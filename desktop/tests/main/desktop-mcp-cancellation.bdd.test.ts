// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpTestContext } from '../../../tests/support/mcp-cancellation-context.js';
import * as transport from '../../../src/platform/mcp/transport.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { createDesktopServices, createReportArtifactTool } from '../../electron/desktop-services.js';
import { DesktopOwnedToolRegistry, DesktopToolCatalogBridge } from '../../electron/desktop-multi-agent-catalog-bridge.js';
import { PluginProviderRuntimeFacade } from '../../electron/plugin-provider-runtime-facade.js';
import { HOST_GATEWAY_CONTRACTS } from '../../electron/provider-gateways/host-gateway-contracts.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import * as kbStoreModule from '../../electron/kb-store-sqlite.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// Source-mode factory tests need the fixed emitted Worker entry. Only its URL
// is mapped; production code, native messages/exit, and MCP assertions stay real.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => {
  try { expect(nativeWorker.exits).toBe(nativeWorker.starts); }
  finally { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); }
});

function barrier() { let release!: () => void; return { wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
const genericSchema = { name: 'probe', description: 'controlled fixture', inputSchema: { type: 'object' } };
const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] });
type RawCall = { server: string; name: string; arguments?: Record<string, unknown>; options?: { signal?: AbortSignal }; abortedAtCall?: boolean };

describe('R1 actual Desktop factory MCP sibling cancellation', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  function setup(includeCua = false) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-mcp-cancel-factory-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config')); vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
    const createKbStore = kbStoreModule.createKbStoreSqlite;
    vi.spyOn(kbStoreModule, 'createKbStoreSqlite').mockImplementation(() => createKbStore(join(root, 'knowledge.sqlite')));
    const notifications = new Map<string, () => void | Promise<void>>(); const calls: RawCall[] = []; const closes: string[] = [];
    let handler: (call: RawCall) => Promise<ReturnType<typeof textResult>> = async () => textResult('MCP_FIXTURE_OK');
    const connect = vi.spyOn(transport, 'createMcpClientConnection').mockImplementation(async (server) => ({
      protocolEra: 'modern', getStderrTail: () => '', getChildPid: () => null,
      close: async () => { closes.push(server); }, dispose: () => { closes.push(server); },
      client: {
        listTools: async () => ({ tools: server === 'cua-driver' ? ['list_windows', 'get_window_state', 'click'].map(name => ({ name, description: 'CUA controlled fixture', inputSchema: { type: 'object' } })) : server === 'generic' ? [genericSchema]
          : HOST_GATEWAY_CONTRACTS.filter(c => c.capabilityKey === `mcp:${server}`).map(c => ({ name: c.operation, description: c.description, inputSchema: c.inputSchema })) }),
        setNotificationHandler: (_name: string, callback: () => void | Promise<void>) => { notifications.set(server, callback); },
        async callTool(params: { name: string; arguments?: Record<string, unknown> }, options?: { signal?: AbortSignal }) {
          const call = { server, ...params, options, abortedAtCall: options?.signal?.aborted }; calls.push(call); return handler(call);
        },
      },
    } as unknown as transport.McpClientConnection));
    for (const server of ['generic', 'report-renderer', 'slide-renderer', ...(includeCua ? ['cua-driver'] : [])]) {
      const plugin = join(root, 'plugins', `fixture-${server}`); mkdirSync(plugin, { recursive: true });
      writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ name: `fixture-${server}`, version: '1', mcpServers: [{ name: server, type: 'stdio', command: process.execPath, args: [], protocol: { mode: 'modern', version: '2026-07-28' } }] }));
    }
    let mainRegistry!: DesktopOwnedToolRegistry;
    const originalRegister = DesktopOwnedToolRegistry.prototype.registerOwnedTool;
    vi.spyOn(DesktopOwnedToolRegistry.prototype, 'registerOwnedTool').mockImplementation(function (this: DesktopOwnedToolRegistry, tool, owner) {
      if (tool.definition.name === 'render_report_artifact') mainRegistry = this;
      return originalRegister.call(this, tool, owner);
    });
    const provider = new PluginProviderRuntimeFacade(); cleanup.push(() => provider.dispose());
    const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {}, getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }), onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }) } as unknown as KSwarmService;
    const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'), workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService, pluginProviderRuntime: provider });
    cleanup.push(() => services.disposeMultiAgent());
    return { root, services, provider, connect, calls, closes, notifications, setHandler: (next: typeof handler) => { handler = next; }, registry: () => mainRegistry };
  }

  it.each(['initial', 'refreshed'] as const)('M1 actual %s factory catalog reaches Chat root and a real managed child with separate per-call signals', async catalog => {
    const f = setup(); const registration = await f.services.registerMcpTools(); cleanup.push(() => registration.dispose());
    if (catalog === 'refreshed') await f.notifications.get('generic')!();
    await f.services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture' });
    let rootTurns = 0; let childTurns = 0; let childId = '';
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages, _defs, system) {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (system?.includes('Assigned Desktop agent:')) {
        if (++childTurns === 1) yield { type: 'tool_use', id: 'child-mcp', name: 'mcp__generic__probe', input: { caller: 'child' } };
        else yield { type: 'text', delta: 'child done' };
      } else if (++rootTurns === 1) yield { type: 'tool_use', id: 'spawn', name: 'spawn_agent', input: { task_name: 'fixture', message: 'bounded independent probe', fork_context: false } };
      else if (rootTurns === 2) {
        const spawn = messages.flatMap(m => m.content).find(b => b.type === 'tool_result' && b.tool_use_id === 'spawn');
        if (spawn?.type !== 'tool_result') throw new Error('real spawn result missing'); childId = JSON.parse(String(spawn.content)).targetAgentId;
        yield { type: 'tool_use', id: 'root-mcp', name: 'mcp__generic__probe', input: { caller: 'root' } };
      } else if (rootTurns === 3) yield { type: 'tool_use', id: 'wait', name: 'wait_agent', input: { targets: [childId], timeout_ms: 1000 } };
      else yield { type: 'text', delta: 'root done' };
    });
    const task = await f.services.createTask({ prompt: 'Delegate one independent probe and summarize.', materials: [], context: { threadId: `thread-${catalog}` } });
    await vi.waitFor(async () => expect((await f.services.recoverTask(task.taskId)).snapshot.status).toBe('completed'), { timeout: 5000 });
    const actual = f.calls.filter(call => call.server === 'generic');
    expect(actual.map(call => call.arguments?.caller).sort()).toEqual(['child', 'root']);
    for (const call of actual) { expect(call.options?.signal).toBeInstanceOf(AbortSignal); expect(call.abortedAtCall).toBe(false); }
    expect(actual[0]!.options?.signal).not.toBe(actual[1]!.options?.signal); expect(f.closes).toEqual([]);
  });

  it.each(['initial', 'refreshed'] as const)('M1 %s factory generic tool rejects preabort before the SDK preflight', async catalog => {
    const f = setup(); const registration = await f.services.registerMcpTools(); cleanup.push(() => registration.dispose());
    if (catalog === 'refreshed') await f.notifications.get('generic')!();
    const controller = new AbortController(); const reason = new Error('preaborted factory call'); controller.abort(reason);
    const run = f.registry().getRegisteredTool('mcp__generic__probe')!.execute({}, mcpTestContext(controller.signal)).then(value => ({ value }), error => ({ error }));
    expect(await run).toEqual({ error: reason }); expect(f.calls).toEqual([]); expect(f.closes).toEqual([]);
  });

  it('M1/M3 actual root cancellation does not publish late tool success or consume another model request', async () => {
    const f = setup(); const registration = await f.services.registerMcpTools(); cleanup.push(() => registration.dispose());
    await f.services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture' }); const entered = barrier(); const held = barrier();
    f.setHandler(async () => { entered.release(); await held.wait; return textResult('LATE_MCP_SUCCESS'); });
    let modelCalls = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      modelCalls++; yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      yield { type: 'tool_use', id: 'late-mcp', name: 'mcp__generic__probe', input: {} };
    });
    const task = await f.services.createTask({ prompt: 'Run one bounded probe.', materials: [], context: { threadId: 'cancel-root' } });
    try {
      await entered.wait; await f.services.cancelTask(task.taskId); held.release();
      await vi.waitFor(async () => expect((await f.services.recoverTask(task.taskId)).snapshot.status).toBe('cancelled'));
      const snapshot = (await f.services.recoverTask(task.taskId)).snapshot;
      const boundary = f.services.multiAgent!;
      const access = boundary.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'cancel-root', profileId: boundary.profileId, workspaceId: boundary.workspaceId });
      expect(boundary.service.getSnapshot({ access }).root?.status).toBe('interrupted');
      expect(f.calls[0]!.options?.signal?.aborted).toBe(true);
      expect(snapshot.events.filter(event => event.type === 'goal_tool_finished' && event.toolName === 'mcp__generic__probe')).toEqual([]);
      expect(modelCalls).toBe(1); expect(f.closes).toEqual([]);
    } finally { held.release(); }
  });

  it('M1/M4 real parent interrupts a running MCP child while its own sibling request succeeds on the shared connection', async () => {
    const f = setup(); const registration = await f.services.registerMcpTools(); cleanup.push(() => registration.dispose());
    await f.services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture' }); const entered = barrier(); const held = barrier();
    f.setHandler(async call => { if (call.arguments?.caller === 'child') { entered.release(); await held.wait; } else held.release(); return textResult('MCP_RESULT'); });
    let rootTurns = 0; let childTurns = 0; let childId = '';
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages, _defs, system) {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (system?.includes('Assigned Desktop agent:')) { childTurns++; yield { type: 'tool_use', id: 'child-mcp', name: 'mcp__generic__probe', input: { caller: 'child' } }; }
      else if (++rootTurns === 1) yield { type: 'tool_use', id: 'spawn', name: 'spawn_agent', input: { task_name: 'fixture', message: 'bounded probe', fork_context: false } };
      else if (rootTurns === 2) {
        const spawn = messages.flatMap(m => m.content).find(b => b.type === 'tool_result' && b.tool_use_id === 'spawn');
        if (spawn?.type !== 'tool_result') throw new Error('real spawn result missing'); childId = JSON.parse(String(spawn.content)).targetAgentId;
        await entered.wait; yield { type: 'tool_use', id: 'interrupt', name: 'interrupt_agent', input: { target: childId } };
      } else if (rootTurns === 3) yield { type: 'tool_use', id: 'root-mcp', name: 'mcp__generic__probe', input: { caller: 'root' } };
      else if (rootTurns === 4) yield { type: 'tool_use', id: 'wait', name: 'wait_agent', input: { targets: [childId], timeout_ms: 1000 } };
      else yield { type: 'text', delta: 'root done' };
    });
    const task = await f.services.createTask({ prompt: 'Delegate a bounded probe, interrupt it, and check the parent can continue.', materials: [], context: { threadId: 'cancel-child' } });
    try {
      await vi.waitFor(async () => expect((await f.services.recoverTask(task.taskId)).snapshot.status).toBe('completed'), { timeout: 5000 });
      const boundary = f.services.multiAgent!; const access = boundary.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'cancel-child', profileId: boundary.profileId, workspaceId: boundary.workspaceId });
      const snapshot = boundary.service.getSnapshot({ access }); expect(snapshot.root?.status).toBe('completed');
      expect(snapshot.agents.find(agent => agent.id === childId)?.status).toBe('interrupted'); expect(childTurns).toBe(1);
      const child = f.calls.find(call => call.arguments?.caller === 'child')!; const root = f.calls.find(call => call.arguments?.caller === 'root')!;
      expect(child.options?.signal?.aborted).toBe(true); expect(root.abortedAtCall).toBe(false); expect(f.closes).toEqual([]);
    } finally { held.release(); }
  });

  it.each(['lookup', 'action'] as const)('M5 actual Desktop CUA facade cancels at %s without invoking the next backend step', async stage => {
    const f = setup(true); const registration = await f.services.registerMcpTools(); cleanup.push(() => registration.dispose());
    expect(f.services.listPluginMcpServers().find(server => server.name === 'cua-driver')?.connected).toBe(true);
    f.calls.splice(0); const entered = barrier(); const held = barrier(); const controller = new AbortController(); const reason = new Error('Desktop CUA cancelled');
    f.setHandler(async call => { entered.release(); await held.wait; return { ...textResult('controlled CUA result'), ...(call.name === 'list_windows' ? { structuredContent: { windows: [{ app: 'Probe', pid: 42, window_id: '42' }] } } : {}) }; });
    const input = stage === 'lookup' ? { action: 'capture', app: 'Probe' } : { action: 'click', pid: 42, window_id: '42', x: 1, y: 2, capture_after: true };
    const run = f.registry().getRegisteredTool('xiaok_computer_use')!.execute(input, mcpTestContext(controller.signal)).then(value => ({ value }), error => ({ error }));
    try {
      await entered.wait; controller.abort(reason); held.release(); expect(await run).toEqual({ error: reason });
      expect(f.calls).toHaveLength(1); expect(f.calls[0]!.options?.signal).toBe(controller.signal); expect(f.closes).toEqual([]);
    } finally { held.release(); await run; }
  });

  it.each(HOST_GATEWAY_CONTRACTS)('M6 factory $canonicalName carries its lease signal to the SDK and discards late success while sibling B survives', async contract => {
    const f = setup(); const registration = await f.services.registerMcpTools(); cleanup.push(() => registration.dispose()); await f.services.startPluginProviderRuntime();
    const tool = f.registry().getRegisteredTool(contract.canonicalName)!; expect(tool).toBeDefined();
    const input = contract.operation === 'preview_section' ? { section_ir: ':::callout type=note\nfixture\n:::' }
      : contract.capabilityKey === 'mcp:slide-renderer' && ['validate_brief', 'render_slide'].includes(contract.operation) ? { brief_json: '{}' }
        : ['validate_ir', 'render_report'].includes(contract.operation) ? { ir_content: '# fixture' } : {};
    const entered = barrier(); const held = barrier(); const a = new AbortController(); const b = new AbortController(); let first = true;
    f.setHandler(async () => { if (first) { first = false; entered.release(); await held.wait; } return textResult('provider result'); });
    const aRun = tool.execute(input, mcpTestContext(a.signal)).then(value => ({ value }), error => ({ error }));
    try {
      await entered.wait; a.abort(new Error('A cancelled'));
      await expect(tool.execute(input, mcpTestContext(b.signal))).resolves.toBe('provider result');
      held.release(); expect(await aRun).toMatchObject({ error: { name: 'AbortError' } });
      expect(f.calls[0]!.options?.signal?.aborted).toBe(true); expect(f.calls[1]!.options?.signal?.aborted).toBe(false);
      expect(f.calls[0]!.options?.signal).not.toBe(f.calls[1]!.options?.signal); expect(f.closes).toEqual([]);
    } finally { held.release(); await aRun; }
  });

  it('M6 preabort prevents acquiring a provider lease for all eight factory gateways', async () => {
    const f = setup(); const registration = await f.services.registerMcpTools(); cleanup.push(() => registration.dispose()); await f.services.startPluginProviderRuntime();
    const acquire = vi.spyOn(f.provider, 'acquire'); const controller = new AbortController(); const reason = new Error('preabort'); controller.abort(reason);
    for (const contract of HOST_GATEWAY_CONTRACTS) {
      const tool = f.registry().getRegisteredTool(contract.canonicalName)!;
      await expect(tool.execute({}, mcpTestContext(controller.signal))).rejects.toBe(reason);
    }
    expect(acquire).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  });

  it('M9 all rootOnly siblings remain forbidden to a real child scoped registry', async () => {
    const f = setup(); const registration = await f.services.registerMcpTools(); cleanup.push(() => registration.dispose());
    const registry = f.registry(); const bridge = new DesktopToolCatalogBridge({ registry, workspaceId: 'w' }); bridge.authorizeRoot(); cleanup.push(() => bridge.dispose());
    const scoped = bridge.catalog.createScopedRegistry(bridge.catalog.snapshotPolicy(), { groupId: 'g', agentId: 'child', turnId: 't', cwd: f.root, workspaceId: 'w', materialIds: [], permissionRevision: 0, signal: new AbortController().signal, deadlineAt: Date.now() + 10000 }, { autoMode: true }); cleanup.push(() => scoped.dispose());
    const names = ['xiaok_computer_use', 'render_report_artifact', ...HOST_GATEWAY_CONTRACTS.map(c => c.canonicalName)];
    for (const name of names) {
      const tool = registry.getRegisteredTool(name); if (!tool) continue; // CUA not registered on non-macOS.
      expect(registry.ownerOf(name)?.binding).toBe('rootOnly');
      const actualTool = scoped.registry.getRegisteredTool(name)!;
      await expect(actualTool.execute({}, mcpTestContext(scoped.authority.signal))).rejects.toThrow('tool_scope_unsupported');
    }
    expect(f.calls).toEqual([]);
  });

  it.each(['preabort', 'startup', 'call'] as const)('M7 actual report artifact wrapper protects the %s boundary and disposes only its own connection', async stage => {
    const f = setup(); const plugin = join(f.root, 'config', 'plugins', 'kai-report-creator');
    const bundle = join(plugin, 'mcp-servers', 'report-renderer', 'dist', 'server.bundle.js'); mkdirSync(join(bundle, '..'), { recursive: true }); writeFileSync(bundle, '// fixed test entry; SDK receiver is controlled below');
    const output = join(f.root, 'new-artifact-dir', 'report.html'); const controller = new AbortController(); const reason = new Error('report cancelled');
    const entered = barrier(); const held = barrier(); const original = f.connect.getMockImplementation()!;
    f.connect.mockImplementation(async (...args) => {
      if (stage === 'startup') { entered.release(); await held.wait; }
      return original(...args);
    });
    f.setHandler(async () => { entered.release(); await held.wait; writeFileSync(output, '<html>late fixture</html>'); return textResult('{"success":true}'); });
    if (stage === 'preabort') controller.abort(reason);
    const tool = createReportArtifactTool(); const outcome = tool.execute({ ir_content: '# fixture', output_path: output }, mcpTestContext(controller.signal)).then(value => ({ value }), error => ({ error }));
    try {
      if (stage !== 'preabort') { await entered.wait; controller.abort(reason); }
      held.release(); expect(await outcome).toEqual({ error: reason });
      if (stage === 'preabort') { expect(f.connect).not.toHaveBeenCalled(); expect(existsSync(join(output, '..'))).toBe(false); }
      else {
        expect(f.connect.mock.calls[0]?.[2]?.startupSignal).toBe(controller.signal);
        expect(f.closes).toEqual(['report-renderer']);
        if (stage === 'startup') expect(f.calls).toEqual([]);
        else expect(f.calls[0]!.options?.signal).toBe(controller.signal);
      }
    } finally { held.release(); await outcome; }
  });
});
