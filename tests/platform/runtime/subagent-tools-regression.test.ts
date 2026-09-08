import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import type { ModelAdapter, Tool } from '../../../src/types.js';

const roots: string[] = [];
const factories: ReturnType<typeof createPlatformRegistryFactory>[] = [];
afterEach(async () => {
  await Promise.all(factories.splice(0).map(factory => factory.dispose()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'xiaok-subagent-tools-')); roots.push(cwd);
  const file = join(cwd, 'evidence.txt'); writeFileSync(file, 'REGISTRY_EVIDENCE\n');
  const seen: string[][] = []; const events: any[] = [];
  let refresh!: (tools: Tool[]) => void;
  const adapter: ModelAdapter = { async *stream(messages, tools) {
    seen.push(tools.map(tool => tool.name));
    if (!messages.at(-1)?.content.some(block => block.type === 'tool_result')) {
      yield { type: 'tool_use', id: 'read-evidence', name: 'read', input: { file_path: file } };
      yield { type: 'tool_use', id: 'grep-evidence', name: 'grep', input: { pattern: 'REGISTRY_EVIDENCE', path: cwd } };
    } else {
      yield { type: 'text', delta: messages.at(-1)!.content.filter(block => block.type === 'tool_result').map(block => block.content).join('\n') };
    }
    yield { type: 'done' };
  } };
  const platform = {
    customAgents: [{ name: 'named', systemPrompt: '', allowedTools: ['Read', 'Grep'] }],
    pluginRuntime: { hookConfigs: [], agentDirs: [] }, mcpTools: [], capabilityRegistry: new CapabilityRegistry(),
    createBackgroundRunner: () => ({ dispose: async () => ({ settled: true, pendingJobs: [] }) }),
    createReminderApi: () => undefined,
    onMcpToolsChanged: (cb: typeof refresh) => { refresh = cb; return () => {}; },
  } as unknown as PlatformRuntimeContext;
  const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'regression', adapter: () => adapter,
    buildSystemPrompt: async () => 'read-only test', onSubAgentEvent: event => events.push(event) });
  factories.push(factory);
  return { cwd, factory, seen, events, refresh: (tools: Tool[]) => refresh(tools) };
}

describe('production subagent tool surface regression', () => {
  it.each(['inline', 'named'] as const)('executes Read/Grep allowlists in legacy %s children, without orphan tree tools', async (mode) => {
    const { cwd, factory, seen, events } = fixture();
    const main = factory.createRegistry(cwd);
    const result = await main.executeTool('subagent', { prompt: 'read evidence',
      ...(mode === 'named' ? { agent: 'named' } : { description: 'evidence review', tools: ['Read', 'Grep'] }) });
    expect(result).not.toContain('未知工具');
    expect(result.match(/REGISTRY_EVIDENCE/g)?.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).toEqual(expect.arrayContaining(['read', 'grep']));
    for (const tool of ['write', 'edit', 'bash', 'spawn_agent', 'send_message', 'wait_agent', 'list_agents']) expect(seen[0]).not.toContain(tool);
    expect(events.at(-1)).toMatchObject({ status: 'completed', toolsCompleted: 2, toolsFailed: 0 });
  });

  it('executes the same allowlist in managed children and retains real tree communication', async () => {
    const { cwd, factory, seen, events } = fixture(); const main = factory.createRegistry(cwd);
    const child = JSON.parse(await main.executeTool('spawn_agent', { task_name: 'evidence', message: 'read evidence', tools: ['Read', 'Grep'], fork_context: false }));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ kind: 'finished', toolsCompleted: 2, toolsFailed: 0 }));
    expect(seen[0]).toEqual(expect.arrayContaining(['read', 'grep', 'send_message', 'list_agents', 'wait_agent']));
    expect(seen[0]).not.toContain('write');
    const status = JSON.parse(await main.executeTool('list_agents', {})).find((agent: any) => agent.id === child.id);
    expect(status.lastResult).toContain('REGISTRY_EVIDENCE');
  });

  it('does not advertise global tools outside the child registry or widen a nonmatching allowlist', async () => {
    const { cwd, factory } = fixture(); factory.createRegistry(cwd);
    const child = factory.createRegistry(cwd, ['Read'], 'legacy');
    expect(child.searchTools('select:read,write,spawn_agent').map(tool => tool.name)).toEqual(['read']);
    expect(await child.executeTool('write', {})).toContain('未知工具');
    const empty = factory.createRegistry(cwd, ['does-not-exist'], 'another');
    expect(empty.getToolDefinitions().map(tool => tool.name)).toEqual(['tool_search']);
  });

  it('keeps canonical allowlists on MCP refresh and rejects unrelated tools', async () => {
    const { cwd, factory, refresh } = fixture();
    const child = factory.createRegistry(cwd, ['READ', 'MCP__EVIDENCE'], 'legacy');
    const tool = (name: string): Tool => ({ definition: { name, description: name, inputSchema: {} }, permission: 'safe', execute: async () => 'ok' });
    refresh([tool('mcp__evidence'), tool('mcp__forbidden')]);
    expect(child.getToolDefinitions().map(t => t.name)).toEqual(expect.arrayContaining(['read', 'mcp__evidence']));
    expect(await child.executeTool('mcp__evidence', {})).toBe('ok');
    expect(await child.executeTool('mcp__forbidden', {})).toContain('未知工具');
    refresh([]);
    expect(await child.executeTool('mcp__evidence', {})).toContain('未知工具');
  });
});
