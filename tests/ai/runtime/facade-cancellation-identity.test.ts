import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../../../src/ai/agent.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { RuntimeFacade } from '../../../src/ai/runtime/runtime-facade.js';
import { PromptBuilder } from '../../../src/ai/prompts/builder.js';
import { FileMemoryStore } from '../../../src/ai/memory/store.js';
import { JsonHarnessMemoryStore } from '../../../src/runtime/harness-memory/store.js';

it.each(['build', 'run'] as const)('actual facade %s failure B survives cancellation A and rolls back original skill admission', async stage => {
  const root = mkdtempSync(join(tmpdir(), 'facade-independent-failure-'));
  const controller = new AbortController(), cancellation = new Error('original cancellation A'), failure = new Error('independent original failure B');
  let fault = true;
  const registry = new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true });
  const agent = new Agent({ getModelName: () => 'fixture', async *stream() { if(stage==='run'&&fault){fault=false;controller.abort(cancellation);throw failure;}yield { type: 'text', delta: 'actual normal model' };yield { type: 'done' }; } }, registry, 'system');
  const run = vi.spyOn(agent, 'runTurn');
  const facade = new RuntimeFacade({ agent, promptBuilder: new PromptBuilder({ memoryStore: new FileMemoryStore(join(root, 'memory')), harnessMemoryStore: new JsonHarnessMemoryStore(join(root, 'harness.json')) }),
    getPromptInput: async () => ({ enterpriseId: null, devApp: null, budget: 2000, skills: [], deferredTools: [], agents: [], pluginCommands: [], lspDiagnostics: '', autoContext: { docs: [], git: null } }),
    getSkillEntries: () => [{ name: 'first', listing: '- first: original skill' }, { name: 'second', get listing() { if(stage==='build'&&fault){fault=false;controller.abort(cancellation);throw failure;}return '- second: original skill'; } }],
  });
  const request = { sessionId: 'sess_11111111-1111-4111-8111-111111111111', cwd: root, source: 'chat' as const, input: 'original request' };
  try {
    await expect(facade.runTurn(request, () => {}, controller.signal)).rejects.toBe(failure);
    await facade.runTurn({ ...request, input: 'next explicit request' }, () => {}, new AbortController().signal);
    const next = JSON.stringify(run.mock.calls.at(-1)![0]);
    expect(next).toContain('- first: original skill');expect(next).toContain('- second: original skill');
    expect(run).toHaveBeenCalledTimes(stage==='build'?1:2);
  } finally { run.mockRestore();await agent.dispose();registry.dispose();rmSync(root,{recursive:true,force:true}); }
});
