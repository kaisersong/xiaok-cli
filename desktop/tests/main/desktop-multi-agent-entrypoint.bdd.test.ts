// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import type { Message } from '../../../src/types.js';
import * as kbStoreModule from '../../electron/kb-store-sqlite.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// Source-mode tests only: use the real fixed compiled Worker without adding a
// production TypeScript fallback or replacing native messages/exit semantics.
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

describe('BDD: actual createDesktopServices local task entrypoint', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action(); vi.unstubAllEnvs(); });
  function setup(runner?: Parameters<typeof createDesktopServices>[0]['runner']) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-multi-entry-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
    const createKbStore = kbStoreModule.createKbStoreSqlite;
    vi.spyOn(kbStoreModule, 'createKbStoreSqlite').mockImplementation(() => createKbStore(join(root, 'knowledge.sqlite')));
    const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {}, getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }) } as unknown as KSwarmService;
    const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'), kswarmService, runner, workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [] });
    cleanup.push(() => services.disposeMultiAgent());
    expect(kbStoreModule.createKbStoreSqlite).toHaveBeenCalledWith(join(root, 'knowledge.sqlite'));
    return { root, services };
  }

  it.each(['running', 'completed'] as const)('U2 Given report_progress with all steps %s, Then the existing Task surface receives the real progress event and completion guidance stays in model context', async status => {
    const { services } = setup(); await services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture' });
    let calls = 0; let modelResult = '';
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages) {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (++calls === 1) yield { type: 'tool_use', id: 'progress', name: 'report_progress', input: { steps: [{ id: 'verify', label: 'EXISTING_TASK_PANEL', status }] } };
      else {
        const result = messages.flatMap(message => message.content).find(block => block.type === 'tool_result' && block.tool_use_id === 'progress');
        if (result?.type === 'tool_result') modelResult = String(result.content);
        yield { type: 'text', delta: 'The progress report is displayed.' };
      }
    });
    const task = await services.createTask({ prompt: 'Report progress and reply briefly.', materials: [], context: { threadId: 'progress-thread' } });
    await vi.waitFor(async () => expect((await services.recoverTask(task.taskId)).snapshot.status).toBe('completed'));
    const snapshot = (await services.recoverTask(task.taskId)).snapshot;
    expect(snapshot.events.filter(event => event.type === 'progress_plan_reported')).toEqual([
      expect.objectContaining({ type: 'progress_plan_reported', steps: [{ id: 'verify', label: 'EXISTING_TASK_PANEL', status }] }),
    ]);
    expect(modelResult).not.toContain('_validated');
    if (status === 'completed') expect(modelResult).toContain('确认是否所有要求的交付物都已生成');
    else expect(modelResult).not.toContain('所有步骤已标记完成');
  });

  it('A1/A18/A31 Given the default Desktop factory, When createTask requests delegation, Then the real default provider loop spawns a Desktop child, exchanges messages and exposes its main-owned snapshot', async () => {
    const { root, services } = setup(); await services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture' });
    const initialBoundary = services.multiAgent!; await initialBoundary.ready;
    initialBoundary.service.registerThread({ threadId: 'thread', profileId: initialBoundary.profileId, workspaceId: initialBoundary.workspaceId, cwd: root });
    const initialAccess = initialBoundary.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: initialBoundary.profileId, workspaceId: initialBoundary.workspaceId });
    const groupChanges: unknown[] = [];
    const unsubscribe = initialBoundary.service.subscribe(initialAccess, event => { if (event.channel === 'group_changed') groupChanges.push(event); }); cleanup.push(unsubscribe);
    let rootTurns = 0; let childTurns = 0; let childId = '';
    const requests: Array<{ child: boolean; messages: Message[]; tools: string[]; system: string }> = [];
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages, definitions, system) {
      const child = system?.includes('Assigned Desktop agent:') ?? false;
      requests.push({ child, messages: structuredClone(messages), tools: definitions.map(tool => tool.name), system: system ?? '' });
      // Real K3 chunks carry provenance even for empty reasoning. The substitute
      // transport must preserve that contract, not bypass the production guard.
      yield { type: 'thinking', delta: 'ENTRY_PRIVATE', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (child) {
        if (++childTurns === 1) yield { type: 'tool_use', id: 'child-send', name: 'send_message', input: { target: 'main', message: 'ENTRY_CHILD_READY' } };
        else yield { type: 'text', delta: 'ENTRY_CHILD_DONE' };
      } else if (++rootTurns === 1) yield { type: 'tool_use', id: 'spawn', name: 'spawn_agent', input: { task_name: 'review', message: 'entry child', fork_context: true } };
      else if (rootTurns === 2) {
        const result = messages.flatMap(message => message.content).find(block => block.type === 'tool_result' && block.tool_use_id === 'spawn');
        if (result?.type !== 'tool_result') throw new Error('missing real spawn result');
        childId = JSON.parse(String(result.content)).targetAgentId;
        yield { type: 'tool_use', id: 'wait', name: 'wait_agent', input: { targets: [childId], timeout_ms: 1000 } };
      } else yield { type: 'text', delta: 'ENTRY_ROOT_DONE' };
    });
    const created = await services.createTask({ prompt: 'Delegate one bounded review and summarize it.', materials: [], context: { threadId: 'thread' } });
    await vi.waitFor(async () => {
      const snapshot = (await services.recoverTask(created.taskId)).snapshot;
      expect(snapshot.status, JSON.stringify(snapshot.salvage)).toBe('completed');
    });
    expect(childTurns).toBe(2); expect(childId).toBeTruthy();
    const boundary = services.multiAgent!; await boundary.ready;
    const access = boundary.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: boundary.profileId, workspaceId: boundary.workspaceId });
    const snapshot = boundary.service.getSnapshot({ access });
    expect(snapshot.root).toMatchObject({ sourceTaskId: created.taskId, status: 'completed' });
    expect(snapshot.agents.find(agent => agent.id === childId)).toMatchObject({ status: 'completed', executionActive: false });
    expect(snapshot.group?.threadId).toBe('thread'); expect(boundary.cwd).toBe(root);
    expect(groupChanges).toEqual([expect.objectContaining({ threadId: 'thread', oldGroupId: null, newGroupId: snapshot.group!.groupId, threadRevision: snapshot.threadRevision })]);
    expect(JSON.stringify(requests.filter(request => !request.child).at(-1)?.messages)).toContain('ENTRY_CHILD_READY');
    expect(requests[0].tools).toContain('spawn_agent');
    for (const child of [false, true]) {
      const actualPrompt = requests.find(request => request.child === child)!.system;
      expect(actualPrompt).toContain('Desktop autonomous delegation');
      expect(actualPrompt).not.toContain('用户已经授权你使用所有工具');
      expect(actualPrompt).toContain('拒绝后不得改用其他工具');
      expect(actualPrompt).toContain('read_material');
      expect(actualPrompt).toContain('one cheap inventory');
      expect(actualPrompt).toContain('No interactive question transport is bound');
      expect(actualPrompt).toContain('An empty answer, cancellation or timeout is not approval');
      expect(actualPrompt).not.toContain('CLI autonomous delegation');
    }
    const toolSearch = await services.executeTool('tool_search', { query: 'select:spawn_agent,send_message,wait_agent' });
    expect(JSON.stringify(toolSearch)).not.toContain('"name":"spawn_agent"');
  });

  it('A41 Given an unknown injected TaskRunner, When the same local API starts it, Then it stays ordinary and never receives a multi-agent context or creates a group', async () => {
    const calls: number[] = [];
    const { services } = setup(async function (...args) {
      calls.push(args.length);
      await args[0].emitRuntimeEvent({ type: 'receipt_emitted', sessionId: args[0].sessionId, turnId: 'turn', intentId: 'intent', stepId: 'step', note: 'ordinary' });
    });
    const created = await services.createTask({ prompt: 'ordinary', materials: [], context: { threadId: 'thread' } });
    await vi.waitFor(async () => expect((await services.recoverTask(created.taskId)).snapshot.status).toBe('completed'));
    expect(calls).toEqual([1]); expect(services.multiAgent).toBeNull();
  });

  it('A7 Given a real stdio MCP connection, When its catalog changes or disconnects, Then the actual Desktop registry drops old tools and a stale catalog failure cannot erase its new generation', async () => {
    const { root, services } = setup(async () => {});
    const plugin = join(root, 'plugins', 'fixture'); mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', mcpServers: [{ name: 'fixture-server', type: 'stdio',
      // This fixture implements 2024 JSON-RPC, not the modern negotiation probe.
      command: process.execPath, protocol: { mode: 'legacy' }, args: [join(process.cwd(), '..', 'tests', 'support', 'mcp-stdio-server.js')], env: { XIAOK_TEST_MCP_MUTABLE_CATALOG: '1' } }] }));
    const bounded = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout>;
      try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`MCP step stalled: ${label}`)), 1000); })]); }
      finally { clearTimeout(timer!); }
    };
    const registration = await bounded(services.registerMcpTools(), 'initial registration'); cleanup.push(() => registration.dispose());
    const names = () => services.getToolDefinitions().map(tool => tool.name);
    expect(names()).toContain('mcp__fixture-server__search');
    await bounded(services.executeTool('mcp__fixture-server__search', { q: '__race__' }), 'race invocation');
    await vi.waitFor(() => expect(names()).toContain('mcp__fixture-server__fresh'));
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(names()).toContain('mcp__fixture-server__fresh'); expect(names()).not.toContain('mcp__fixture-server__search');
    await bounded(services.executeTool('mcp__fixture-server__fresh', { q: '__remove__' }), 'remove invocation');
    await vi.waitFor(() => expect(names()).not.toContain('mcp__fixture-server__fresh'));
    registration.dispose();
    const again = await bounded(services.registerMcpTools(), 'second registration'); cleanup.push(() => again.dispose());
    await bounded(services.executeTool('mcp__fixture-server__search', { q: '__disconnect__' }), 'disconnect invocation');
    await vi.waitFor(() => expect(names()).not.toContain('mcp__fixture-server__search'));
    expect(names()).toContain('read');
  });
});
