// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createDesktopMultiAgentTools } from '../../electron/desktop-multi-agent-tools.js';
import { MULTI_AGENT_TOOL_NAMES } from '../../../src/ai/tools/multi-agent.js';
import type { DesktopAgentExecutionContext, DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import type { ToolExecutionContext } from '../../../src/types.js';

describe('BDD: Desktop tool surface is scoped and cannot route through the CLI coordinator', () => {
  function fixture(allowedControls?: readonly string[], agents = [] as Array<{ name: string; systemPrompt: string; model?: string }>) {
    const actor = Object.freeze({ groupId: 'group', agentId: 'child', turnId: 'turn' });
    const context = { ...actor, actor, signal: new AbortController().signal } as DesktopAgentExecutionContext;
    const methods = Object.fromEntries(['spawn', 'send', 'followup', 'wait', 'list', 'interrupt', 'close'].map(name => [name, vi.fn(async () => ({ state: 'applied' }))]));
    const seed = Object.freeze({ seedId: 'seed' }); const createSeed = vi.fn(() => seed);
    const tools = createDesktopMultiAgentTools({ service: methods as unknown as DesktopMultiAgentService, context, allowedControls, agents, createSeed });
    const registry = new ToolRegistry({ autoMode: true }, tools);
    return { registry, tools, methods, createSeed, context, seed };
  }
  it('A18 Given Desktop scope, When control tools are registered, Then exactly the seven semantic tools are present', () => {
    const { tools } = fixture(); expect(tools.map(tool => tool.definition.name)).toEqual([...MULTI_AGENT_TOOL_NAMES]);
  });
  it('returns stable display names alongside technical control IDs in spawn/wait/list', async () => {
    const { tools, methods } = fixture();
    const agent = { id: 'child-id', presentationOrdinal: 13 };
    methods.spawn.mockResolvedValue({ state: 'applied', targetAgentId: agent.id });
    methods.presentation = vi.fn(() => agent);
    methods.wait.mockResolvedValue({ agents: [agent] });
    methods.list.mockResolvedValue({ items: [agent] });
    const spawn = tools.find(t => t.definition.name === 'spawn_agent')!;
    const result = JSON.parse(await spawn.execute({ task_name: 'child', message: 'work' }));
    expect(result).toMatchObject({ targetAgentId: 'child-id', displayNames: { zh: '双鱼座-2', en: 'Pisces-2' } });
    const wait = JSON.parse(await tools.find(t => t.definition.name === 'wait_agent')!.execute({ targets: ['child-id'] }));
    expect(wait.agents[0].displayNames).toEqual(result.displayNames);
    const list = JSON.parse(await tools.find(t => t.definition.name === 'list_agents')!.execute({}));
    expect(list.items[0].displayNames).toEqual(result.displayNames);
  });
  it('A13 Given a child ceiling excluding mutation tools, When tools and search are inspected, Then only explicitly inherited controls plus communication are available', async () => {
    const { registry, tools } = fixture(['send_message', 'list_agents', 'wait_agent']);
    expect(tools.map(tool => tool.definition.name)).toEqual(['send_message', 'wait_agent', 'list_agents']);
    for (const name of ['spawn_agent', 'followup_task', 'interrupt_agent', 'close_agent']) expect(await registry.executeTool(name, {})).toMatch(/Error/);
  });
  it('A11 Given inline or predefined model overrides, When spawn is called, Then rejection happens before seed capture and reservation', async () => {
    const { registry, createSeed, methods } = fixture(undefined, [{ name: 'foreign', systemPrompt: 'preset', model: 'other-model' }]);
    for (const override of [{ model: 'other' }, { modelCapability: 'other' }, { agent: 'foreign' }]) {
      expect(await registry.executeTool('spawn_agent', { task_name: 'child', message: 'work', ...override })).toMatch(/model.*override.*unsupported/);
    }
    expect(createSeed).not.toHaveBeenCalled(); expect(methods.spawn).not.toHaveBeenCalled();
  });
  it('A14/A24 Given a real invocation context, When the model spawns, Then the trusted actor/source and stable invocation operation bind the captured child seed', async () => {
    const { registry, context, seed, methods, createSeed } = fixture();
    const callerController=new AbortController();
    const toolContext = Object.freeze({ toolInvocationId: 'call-42', signal: AbortSignal.any([context.signal,callerController.signal]), messages: [], session: { cwd: 'ignored' } }) as unknown as ToolExecutionContext;
    await registry.executeTool('spawn_agent', { task_name: 'child', message: 'work', fork_context: false }, toolContext);
    expect(createSeed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ forkContext: false, agentDef: expect.objectContaining({ name: 'child' }) }), expect.objectContaining({toolInvocationId:'call-42',messages:toolContext.messages,session:toolContext.session,executionProgress:expect.any(Object),signal:expect.any(AbortSignal)}));
    const captured=createSeed.mock.calls[0][1] as ToolExecutionContext;
    expect(Object.isFrozen(captured)).toBe(true);expect(captured.signal?.aborted).toBe(false);
    callerController.abort();expect(captured.signal?.aborted).toBe(true);
    expect(methods.spawn).toHaveBeenCalledExactlyOnceWith({ actor: context.actor, requestSource: 'agent', operationId: 'turn:call-42', taskName: 'child', message: 'work', sessionSeed: seed });
  });
  it('A43 Given a model tries to forge caller/group/source or submit oversize input, When invoking controls, Then schema validation rejects before service effects', async () => {
    const { registry, methods } = fixture();
    for (const forged of [{ requestSource: 'user' }, { callerId: 'root' }, { groupId: 'other' }]) {
      expect(await registry.executeTool('send_message', { target: 'main', message: 'text', ...forged })).toMatch(/Error/);
    }
    expect(await registry.executeTool('send_message', { target: 'main', message: '中'.repeat(6000) })).toMatch(/Error.*16KiB/);
    expect(methods.send).not.toHaveBeenCalled();
  });
  it('A29 Given wait targets a future turn, When invoked, Then its operation/turn propagate without consuming or fabricating messages', async () => {
    const { registry, methods, context } = fixture();
    await registry.executeTool('wait_agent', { targets: ['child'], operation_id: 'future', expected_turn: 2, timeout_ms: 100000 });
    expect(methods.wait).toHaveBeenCalledExactlyOnceWith({ actor: context.actor, requestSource: 'agent', targets: ['child'], operationId: 'future', expectedTurn: 2, timeoutMs: 30000 });
  });
  it('A7 Given a stale aborted invocation, When any control is called directly, Then none can bypass cancellation', async () => {
    const { tools, methods, context } = fixture();
    const controller = new AbortController(); controller.abort(); context.signal = controller.signal;
    for (const tool of tools) await expect(tool.execute({ target: 'child', targets: ['child'], task_name: 'new', message: 'work' })).rejects.toThrow();
    for (const method of Object.values(methods)) expect(method).not.toHaveBeenCalled();
  });
});
