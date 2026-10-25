import { expect, it, vi } from 'vitest';
import { Agent } from '../../src/ai/agent.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';
import type { ModelAdapter } from '../../src/types.js';
import { AgentRuntime } from '../../src/ai/runtime/agent-runtime.js';
import { AgentRunController } from '../../src/ai/runtime/controller.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';
import { RuntimeFacade } from '../../src/ai/runtime/runtime-facade.js';
import { PromptBuilder } from '../../src/ai/prompts/builder.js';
import { FileMemoryStore } from '../../src/ai/memory/store.js';
import { JsonHarnessMemoryStore } from '../../src/runtime/harness-memory/store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it.each([new DOMException('exact private owner closing', 'AbortError'), new Error('unknown original failure')])('preaborted original signal keeps reason identity: %s', async reason => {
  const stream = vi.fn(async function* () { throw Error('closed ingress reached model'); });
  const adapter: ModelAdapter = { getModelName: () => 'original-fixture', stream };
  const agent = new Agent(adapter, new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true }), 'system');
  const controller = new AbortController();controller.abort(reason);
  try { await expect(agent.runTurn('original accepted request', () => {}, controller.signal)).rejects.toBe(reason);expect(stream).not.toHaveBeenCalled(); }
  finally { await agent.dispose(); }
});

it.each(['preabort', 'active', 'build-error'] as const)('actual RuntimeFacade and Agent preserve both original reasons through %s', async stage => {
  const root = mkdtempSync(join(tmpdir(), 'facade-abort-identity-'));
  try {
    for (const reason of [new DOMException('facade actual private closing', 'AbortError'), new Error('facade unknown original reason')]) {
      const controller = new AbortController();
      const stream = vi.fn(async function* () { controller.abort(reason);yield { type: 'done' as const }; });
      const registry = new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true });
      const agent = new Agent({ getModelName: () => 'original-fixture', stream }, registry, 'system');
      const facade = new RuntimeFacade({ agent, promptBuilder: new PromptBuilder({ memoryStore: new FileMemoryStore(join(root, 'memory')), harnessMemoryStore: new JsonHarnessMemoryStore(join(root, 'harness.json')) }), getPromptInput: async () => {
        if(stage==='build-error'){controller.abort(reason);throw reason;}
        return { enterpriseId: null, devApp: null, budget: 2000, skills: [], deferredTools: [], agents: [], pluginCommands: [], lspDiagnostics: '', autoContext: { docs: [], git: null } };
      } });
      if(stage==='preabort')controller.abort(reason);
      try { await expect(facade.runTurn({ sessionId: 'sess_11111111-1111-4111-8111-111111111111', cwd: root, source: 'chat', input: 'original request' }, () => {}, controller.signal)).rejects.toBe(reason);expect(stream).toHaveBeenCalledTimes(stage==='active'?1:0); }
      finally { await agent.dispose();registry.dispose(); }
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

it.each([new DOMException('direct runtime original closing', 'AbortError'), new Error('direct runtime unknown reason')])('direct runtime preaborted entry preserves reason: %s', async reason => {
  const stream = vi.fn(async function* () { throw Error('closed runtime reached model'); });
  const controller = new AbortController();controller.abort(reason);
  const owner = new AgentRunController();
  const runtime = new AgentRuntime({ adapter: { getModelName: () => 'original-fixture', stream }, registry: new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true }), session: new AgentSessionState(), controller: owner, systemPrompt: 'system' });
  await expect(runtime.run('original request', () => {}, controller.signal)).rejects.toBe(reason);
  expect(stream).not.toHaveBeenCalled();expect(owner.hasActiveRun()).toBe(false);
});

it.each([new DOMException('original live owner closing', 'AbortError'), new Error('unknown live original reason')])('in-flight actual cancellation preserves original reason: %s', async reason => {
  const controller = new AbortController(), events: unknown[] = [];
  const adapter: ModelAdapter = { getModelName: () => 'original-fixture', async *stream() {
    yield { type: 'text', delta: 'original partial' };
    controller.abort(reason);
    yield { type: 'done' };
  } };
  const agent = new Agent(adapter, new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true }), 'system', { hooks: { emit: event => { events.push(event); } } });
  try { await expect(agent.runTurn('original request', () => {}, controller.signal)).rejects.toBe(reason);expect(events).toContainEqual(expect.objectContaining({ type: 'turn_aborted' })); }
  finally { await agent.dispose(); }
});

it.each([false, true])('independent adapter AbortError remains the original failure with actual abort=%s', async abort => {
  const controller = new AbortController(), events: unknown[] = [];
  const reason = new DOMException('actual private owner', 'AbortError'), failure = new Error('independent adapter failure');failure.name = 'AbortError';
  const adapter: ModelAdapter = { getModelName: () => 'original-fixture', async *stream() { if(abort)controller.abort(reason);throw failure; } };
  const agent = new Agent(adapter, new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true }), 'system', { hooks: { emit: event => { events.push(event); } } });
  try { await expect(agent.runTurn('original request', () => {}, controller.signal)).rejects.toBe(failure);expect(events).toContainEqual(expect.objectContaining({ type: abort ? 'turn_aborted' : 'turn_failed' })); }
  finally { await agent.dispose(); }
});
