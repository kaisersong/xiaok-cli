import { vi, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, constants } from 'node:sqlite';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import type { DesktopAgentExecutionContext, DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import type { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import type { MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import type { StreamChunk, Message } from '../../../src/types.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import * as kbStoreModule from '../../electron/kb-store-sqlite.js';

export function barrier<T = void>() { let release!: (value: T) => void; return { wait: new Promise<T>(resolve => { release = resolve; }), release: (value: T) => release(value) }; }
export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
export type Cleanup = Array<() => void | Promise<void>>;
type NativeDb = DatabaseSync & { setAuthorizer(callback: ((action: number, table: string | null, column: string | null) => number) | null): void };
export const nativeAuthorizer = typeof (DatabaseSync.prototype as unknown as NativeDb).setAuthorizer === 'function';
export type LiveFacts = { frozen?: string; lifetime: AbortController; commands: MultiAgentCommandSequencer;
  root?: { context?: DesktopAgentExecutionContext }; activities: Map<string, unknown> };
type Internals = { options: { store: DesktopMultiAgentStore }; groups: Map<string, LiveFacts> };
export type ModelCall = { child: boolean; call: number; adapter: OpenAIAdapter; system: string; messages: Message[]; signal?: AbortSignal; options?: StreamOptions };
export type Program = (call: ModelCall) => AsyncIterable<StreamChunk>;

// Only substitutes the network provider and out-of-scope sidecar. All task,
// managed-session, registry, service, command queue and SQLite owners are real.
export async function activityFixture(cleanup: Cleanup) {
  const stackLimit = Error.stackTraceLimit; Error.stackTraceLimit = 40; cleanup.push(() => { Error.stackTraceLimit = stackLimit; });
  const root = mkdtempSync(join(tmpdir(), 'xiaok-activity-bdd-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config')); vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
  const createKb = kbStoreModule.createKbStoreSqlite;
  vi.spyOn(kbStoreModule, 'createKbStoreSqlite').mockImplementation(() => createKb(join(root, 'knowledge.sqlite')));
  const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {},
    getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }),
  } as unknown as KSwarmService;
  const services = createDesktopServices({ dataRoot: join(root, 'data'), workspaceRoot: root, knowledgeDbPath: join(root, 'knowledge.sqlite'),
    pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService });
  cleanup.push(() => services.disposeMultiAgent());
  const boundary = services.multiAgent!; await boundary.ready;
  await services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture-no-network' });
  const service = boundary.service, internals = service as unknown as Internals, store = internals.options.store;
  const db = (store as unknown as { db: NativeDb }).db;
  cleanup.push(() => db.setAuthorizer(null));
  const contexts: DesktopAgentExecutionContext[] = [];
  const observedGroups = new Map<string, LiveFacts>();
  const capture = (context: DesktopAgentExecutionContext) => {
    if (!contexts.includes(context)) contexts.push(context);
    const group = internals.groups.get(context.groupId); if (group) observedGroups.set(context.groupId, group);
  };
  const activity = service.recordActivity.bind(service), started = service.recordRunStarted.bind(service);
  vi.spyOn(service, 'recordActivity').mockImplementation((context, fact) => { capture(context); return activity(context, fact); });
  vi.spyOn(service, 'recordRunStarted').mockImplementation((context, message) => { capture(context); return started(context, message); });
  const calls: ModelCall[] = []; let rootCalls = 0, childCalls = 0;
  let program: Program = async function* () { yield { type: 'text', delta: 'fixture done' }; };
  const originalStream = OpenAIAdapter.prototype.stream;
  vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (this: OpenAIAdapter, messages, _tools, system, options) {
    const child = system?.includes('Assigned Desktop agent:') ?? false;
    const call: ModelCall = { child, call: child ? ++childCalls : ++rootCalls, adapter: this, system: system ?? '', messages, signal: options?.signal, options };
    calls.push(call);
    yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
    yield* program(call);
  });
  const tasks: string[] = [];
  const start = async (threadId = 'activity-thread') => {
    const task = await services.createTask({ prompt: 'Perform the bounded fixture task and finish.', materials: [], context: { threadId } });
    tasks.push(task.taskId); return task.taskId;
  };
  cleanup.push(async () => { for (const id of tasks) await services.cancelTask(id).catch(() => {}); });
  const settled = async (taskId: string) => {
    await vi.waitFor(async () => expect(['completed', 'failed', 'cancelled']).toContain((await services.recoverTask(taskId)).snapshot.status), { timeout: 7000 });
    await tick(); return (await services.recoverTask(taskId)).snapshot;
  };
  const rootContext = () => contexts.find(context => context.agentId === `root_${context.groupId}`)!;
  const childContext = () => contexts.find(context => context.agentId !== `root_${context.groupId}`)!;
  const live = (context = rootContext()) => internals.groups.get(context.groupId) ?? observedGroups.get(context.groupId)!;
  const access = (threadId = 'activity-thread') => service.createUserAccess({ requestSource: 'user', actorId: 'fixture-user', threadId,
    profileId: boundary.profileId, workspaceId: boundary.workspaceId });
  return { root, services, service, store, db, contexts, calls, originalStream, start, settled, rootContext, childContext, live, access,
    setProgram: (next: Program) => { program = next; } };
}
export type ActivityFixture = Awaited<ReturnType<typeof activityFixture>>;
export async function parkedActivityFixture(cleanup: Cleanup) {
  const f = await activityFixture(cleanup), entered = barrier(), release = barrier();
  cleanup.push(() => { release.release(); });
  f.setProgram(async function* ({ call }) { if (call === 1) { entered.release(); await release.wait; yield writeChunk(join(f.root, 'effect.txt')); }
    else yield { type: 'text', delta: 'done' }; });
  const taskId = await f.start(); await entered.wait; await tick(); await tick();
  return { ...f, taskId, release, context: f.rootContext(), effect: join(f.root, 'effect.txt') };
}
export async function siblingActivityFixture(cleanup: Cleanup, twoChildren = false) {
  const f = await activityFixture(cleanup), entered = barrier(), childEntered = barrier(), release = barrier(), childRelease = barrier();
  cleanup.push(() => { release.release(); childRelease.release(); });
  f.setProgram(async function* ({ child, call }) {
    if (child) { if (call === 1) { childEntered.release(); await childRelease.wait; yield writeChunk(join(f.root, 'child-effect.txt')); }
      else yield { type: 'text', delta: 'child done' }; return; }
    if (call === 1) { yield spawnChunk(); if (twoChildren) yield spawnChunk('cousin'); }
    else if (call === 2) { entered.release(); await release.wait; yield writeChunk(join(f.root, 'effect.txt')); }
    else yield { type: 'text', delta: 'done' };
  });
  const taskId = await f.start(); await entered.wait; await childEntered.wait; await tick(); await tick();
  return { ...f, taskId, release, childRelease, context: f.rootContext(), child: f.childContext(), effect: join(f.root, 'effect.txt') };
}

export type FaultSite = { table: string; site: string; action?: number; column?: string; occurrence?: number; persistent?: boolean; extra?: (stack: string) => boolean };
// Source-map address selects an existing anonymous sequencer callback. It only
// locates fault injection; SQLite still executes the actual production query.
export function serviceSite(method: string, statement: string, occurrence = 0): string {
  const lines = readFileSync(new URL('../../electron/desktop-multi-agent-service.ts', import.meta.url), 'utf8').split('\n');
  const start = lines.findIndex(line => line.includes(method));
  if (start < 0) throw new Error(`missing fault site method ${method}`);
  let seen = 0;
  const offset = lines.slice(start).findIndex(line => line.includes(statement) && seen++ === occurrence);
  if (offset < 0) throw new Error(`missing fault statement ${statement}`);
  return `desktop-multi-agent-service.ts:${start + offset + 1}:`;
}
// Faults originate from SQLite itself. Filtering selects an existing SQL prepare
// call stack; no business return values or synchronous queue shape are replaced.
export function sqliteFault(f: ActivityFixture, spec: FaultSite) {
  const hit = barrier(); const traces: string[] = []; let seen = 0, enabled = true;
  f.db.setAuthorizer((action, table, column) => {
    if (!enabled || action !== (spec.action ?? constants.SQLITE_READ) || table !== spec.table || (spec.column && column !== spec.column)) return constants.SQLITE_OK;
    const stack = new Error().stack ?? '';
    if (!stack.includes(spec.site) || spec.extra && !spec.extra(stack)) return constants.SQLITE_OK;
    if (seen++ < (spec.occurrence ?? 0)) return constants.SQLITE_OK;
    traces.push(stack); if (!spec.persistent) enabled = false; hit.release(); return constants.SQLITE_DENY;
  });
  return { hit: hit.wait, traces, seen: () => seen, clear: () => { enabled = false; f.db.setAuthorizer(null); } };
}
export const writeChunk = (path: string, id = 'effect'): StreamChunk => ({ type: 'tool_use', id, name: 'write', input: { file_path: path, content: 'actual production write' } });
export const spawnChunk = (name = 'child'): StreamChunk => ({ type: 'tool_use', id: `spawn-${name}`, name: 'spawn_agent', input: { task_name: name, message: 'bounded sibling', fork_context: false } });
export const rootRequest = (context: DesktopAgentExecutionContext, operationId = 'fixture-operation') => ({ actor: context.actor, requestSource: 'agent' as const, operationId });
export function invokeRecord(service: DesktopMultiAgentService, method: string, context: DesktopAgentExecutionContext) {
  if (method === 'recordActivity') return service.recordActivity(context, { phase: 'model' });
  if (method === 'recordRunStarted') return service.recordRunStarted(context, 'bounded run');
  if (method === 'recordToolFinished') return service.recordToolFinished(context, { executionEventId: 'bounded-finish', toolName: 'write', ok: true });
  if (method === 'recordUsage') return service.recordUsage(context, { usageId: 'bounded-usage', inputTokens: 1, outputTokens: 1 });
  return service.recordRuntimeEvent(context, { type: 'assistant_delta', sessionId: context.agentId, turnId: context.turnId,
    intentId: 'bounded-intent', stepId: 'bounded-step', delta: 'bounded text' });
}
