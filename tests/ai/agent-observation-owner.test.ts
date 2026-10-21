import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../../src/ai/agent.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';
import { FileSessionStore } from '../../src/ai/runtime/session-store/file-store.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';
import { createReadTool } from '../../src/ai/tools/read.js';
import { createObservationService } from '../../src/runtime/sol-pi/observation-service.js';
import { createObservationSessionOwner } from '../../src/runtime/sol-pi/observation-session-owner.js';
import { testOnlyCapacity } from '../support/sol-pi-capacity.js';
import type { ModelAdapter, StreamChunk } from '../../src/types.js';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture() {
 const root = mkdtempSync(join(tmpdir(), 'solpi-agent-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
 const file = join(root, 'material.txt'); writeFileSync(file, 'ACTUAL_AGENT_MATERIAL');
 const session = new AgentSessionState();
 const service = createObservationService({ profileRoot: join(root, 'profile'), profileId: 'test', redactor: { version: 'test', redact: text => text } }); cleanup.push(() => service.dispose());
 const claims = { sessionId: session.exportSnapshot().sessionId, ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1, surface: 'ordinary-owner' as const };
 const user = service.bindCaller({ ...claims, requestSource: 'user' }); const caller = service.bindCaller({ ...claims, requestSource: 'agent' });
 const destination = { provider: 'test', model: 'test-model', url: 'https://provider.example/chat/completions' };
 service.setArchivePolicy({ caller: user, requestSource: 'user', policy: { version: 1, id: 'read', revision: 1, scopeId: 'scope', sourceAdapterId: 'native.read.v1', sourceDescriptors: [], readFileScopes: [{ filePath: file, startLine: 1 }], expiresAt: Date.now() + 60000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: [destination] } });
 const store = new FileSessionStore(join(root, 'sessions'));
 const owner = createObservationSessionOwner({ service, caller, session, destination, capacityProfile: testOnlyCapacity(destination.url, destination.model), persist: snapshot => store.save(snapshot) }); cleanup.push(() => owner.dispose());
 const registry = new ToolRegistry({ autoMode: true }, [createReadTool({ cwd: root })]); cleanup.push(() => registry.dispose());
 let calls = 0;
 const adapter: ModelAdapter = { getModelName: () => 'test-model', async *stream(): AsyncIterable<StreamChunk> {
  if (++calls === 1) yield { type: 'tool_use', id: 'read-1', name: 'read', input: { file_path: file } };
  else yield { type: 'text', delta: 'done' };
  yield { type: 'done' };
 } };
 return { root, file, session, service, claims, owner, registry, adapter, store };
}
describe('Agent host observation owner injection', () => {
 it('uses the exact host session through actual runtime read and durable owner publication', async () => {
  const f = fixture(); const options: any = { initialSession: f.session, observationOwner: f.owner };
  const agent = new Agent(f.adapter, f.registry, 'test', options);
  expect(agent.getSessionState()).toBe(f.session); options.observationOwner = undefined;
  await agent.runTurn('read material', () => {});
  expect(f.session.getProtectedObservationClosure()?.observations).toHaveLength(1);
  expect((await f.store.load(f.session.exportSnapshot().sessionId))?.protectedObservationClosure?.observations).toHaveLength(1);
  expect(f.owner.getFinalizedToolResult('read-1')).toBeDefined();
 });
 it('rejects mismatched or implicit session injection before taking owner lifecycle', () => {
  const f = fixture();
  expect(() => new Agent(f.adapter, f.registry, 'test', { observationOwner: f.owner } as never)).toThrow();
  expect(() => new Agent(f.adapter, f.registry, 'test', { initialSession: new AgentSessionState(), observationOwner: f.owner } as never)).toThrow();
  expect(() => f.owner.assertSession(f.session)).not.toThrow();
 });
 it('refuses history, restore, adapter and manual compaction mutations with an owner', () => {
  const f = fixture(); const agent = new Agent(f.adapter, f.registry, 'test', { initialSession: f.session, observationOwner: f.owner } as never);
  const before = f.session.exportSnapshot();
  expect(() => agent.clearHistory()).toThrow(); expect(() => agent.restoreSession(before)).toThrow();
  expect(() => agent.setAdapter({ ...f.adapter })).toThrow(); expect(() => agent.forceCompact()).toThrow();
  expect(agent.getSessionState()).toBe(f.session); expect(f.session.exportSnapshot()).toEqual(before);
 });
 it('disposes owner once, rejects future execution and leaves host service usable', async () => {
  const f = fixture(); const agent = new Agent(f.adapter, f.registry, 'test', { initialSession: f.session, observationOwner: f.owner } as never);
  (agent as any).dispose(); (agent as any).dispose();
  expect(() => f.owner.assertSession(f.session)).toThrow(); await expect(agent.runTurn('no', () => {})).rejects.toThrow();
  expect(() => f.service.bindCaller({ ...f.claims, requestSource: 'user' })).not.toThrow();
 });
 it('dispose aborts an active real runtime stream without restarting it', async () => {
  const f = fixture(); let opened!: (signal: AbortSignal) => void; const started = new Promise<AbortSignal>(resolve => { opened = resolve; });
  let calls = 0;
  const adapter: ModelAdapter = { getModelName: () => 'test-model', async *stream(_messages, _tools, _system, options) {
   calls++; const signal = options!.signal!; opened(signal);
   await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
   yield { type: 'done' as const };
  } };
  const agent = new Agent(adapter, f.registry, 'test', { initialSession: f.session, observationOwner: f.owner });
  const run = agent.runTurn('wait', () => {}); const settled = run.catch(() => {});
  const signal = await started; agent.dispose(); await settled;
  expect(signal.aborted).toBe(true); expect(calls).toBe(1); expect(() => f.owner.assertSession(f.session)).toThrow();
 });
});
