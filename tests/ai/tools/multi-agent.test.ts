import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMultiAgentTools } from '../../../src/ai/tools/multi-agent.js';
import type { MultiAgentCoordinator } from '../../../src/ai/agents/multi-agent-coordinator.js';
import type { ToolExecutionContext } from '../../../src/types.js';

const coordinator = {
  spawn: vi.fn(),
  sendMessage: vi.fn(),
  followupTask: vi.fn(),
  waitForUpdate: vi.fn(),
  listAgents: vi.fn(),
  interruptAgent: vi.fn(),
  closeAgent: vi.fn(),
} as unknown as MultiAgentCoordinator;

const createSession = vi.fn();

function toolsFor(callerId = 'main') {
  return createMultiAgentTools({
    coordinator,
    callerId,
    agents: [{ name: 'reviewer', systemPrompt: 'review', source: 'builtin' }],
    createSession,
  });
}

describe('multi-agent tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coordinator.spawn).mockResolvedValue({
      id: 'agent_1',
      taskName: 'review',
      canonicalName: '/root/review',
      parentId: 'main',
      depth: 1,
      status: 'pending',
      unreadMessages: 0,
    });
    vi.mocked(coordinator.sendMessage).mockReturnValue({ messageId: 'msg_1' });
    vi.mocked(coordinator.followupTask).mockReturnValue({ queued: true });
    vi.mocked(coordinator.waitForUpdate).mockResolvedValue({ agents: [], messages: [], timedOut: true });
    vi.mocked(coordinator.listAgents).mockReturnValue([]);
    vi.mocked(coordinator.interruptAgent).mockReturnValue({ interrupted: true });
    vi.mocked(coordinator.closeAgent).mockResolvedValue({ closed: true });
  });

  it('exposes the Codex-style control-plane surface', () => {
    expect(toolsFor().map((tool) => tool.definition.name)).toEqual([
      'spawn_agent',
      'send_message',
      'followup_task',
      'wait_agent',
      'list_agents',
      'interrupt_agent',
      'close_agent',
    ]);
  });

  it('explains terminal waits, in-flight delivery and physical cleanup separately', () => {
    const descriptions = new Map(toolsFor().map((tool) => [tool.definition.name, tool.definition.description]));
    expect(descriptions.get('send_message')).toContain('完整模型边界');
    expect(descriptions.get('wait_agent')).toContain('严禁');
    expect(descriptions.get('wait_agent')).toContain('failed');
    expect(descriptions.get('list_agents')).toContain('lastActivityAt');
    expect(descriptions.get('close_agent')).toContain('resourcesReleased');
    expect(descriptions.get('interrupt_agent')).toContain('executionActive');
  });

  it('spawns a named persistent agent and passes host context only to the session factory', async () => {
    const context = { taskId: 'task_1', signal: new AbortController().signal } as ToolExecutionContext;
    const spawn = toolsFor().find((tool) => tool.definition.name === 'spawn_agent')!;
    const result = await spawn.execute({
      task_name: 'review',
      agent: 'reviewer',
      message: 'review this change',
    }, context);

    expect(JSON.parse(result)).toMatchObject({ id: 'agent_1', canonicalName: '/root/review' });
    expect(coordinator.spawn).toHaveBeenCalledWith(expect.objectContaining({
      requestSource: 'agent',
      callerId: 'main',
      taskName: 'review',
      message: 'review this change',
      createSession: expect.any(Function),
    }));
    const factory = vi.mocked(coordinator.spawn).mock.calls[0][0].createSession;
    const childController = new AbortController();
    await factory({
      id: 'agent_1', taskName: 'review', canonicalName: '/root/review',
      parentId: 'main', parentCanonicalName: '/root', depth: 1,
    }, childController.signal);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      agentDef: expect.objectContaining({ name: 'reviewer' }),
      identity: expect.objectContaining({ id: 'agent_1' }),
      signal: childController.signal,
      forkContext: context,
    }));
  });

  it('always passes agent requestSource and caller identity for mutations', async () => {
    const tools = toolsFor('agent_child');
    await tools.find((tool) => tool.definition.name === 'send_message')!
      .execute({ target: 'main', message: 'progress' });
    await tools.find((tool) => tool.definition.name === 'followup_task')!
      .execute({ target: '/root/reviewer', message: 'check again' });
    await tools.find((tool) => tool.definition.name === 'interrupt_agent')!
      .execute({ target: '/root/child/grandchild' });
    await tools.find((tool) => tool.definition.name === 'close_agent')!
      .execute({ target: '/root/child/grandchild' });

    for (const call of [
      vi.mocked(coordinator.sendMessage).mock.calls[0][0],
      vi.mocked(coordinator.followupTask).mock.calls[0][0],
      vi.mocked(coordinator.interruptAgent).mock.calls[0][0],
      vi.mocked(coordinator.closeAgent).mock.calls[0][0],
    ]) {
      expect(call).toMatchObject({ requestSource: 'agent', callerId: 'agent_child' });
    }
  });

  it('states the destructive boundaries in tool descriptions', () => {
    const byName = new Map(toolsFor().map((tool) => [tool.definition.name, tool]));
    expect(byName.get('spawn_agent')!.definition.description).toContain('Follow the CLI delegation policy');
    expect(byName.get('send_message')!.definition.description).toContain('不触发');
    expect(byName.get('followup_task')!.definition.description).toContain('只能');
    expect(byName.get('followup_task')!.definition.description).toContain('严格后代');
    expect(byName.get('spawn_agent')!.definition.inputSchema.properties.tools.description).toContain('显式');
    expect(byName.get('interrupt_agent')!.definition.description).toContain('严禁');
    expect(byName.get('close_agent')!.definition.description).toContain('严禁');
    expect(byName.get('close_agent')!.definition.description).toContain('结算后');
  });

  it('rejects simultaneous model and modelCapability before coordinator spawn', async () => {
    const spawn = toolsFor().find((tool) => tool.definition.name === 'spawn_agent')!;
    await expect(spawn.execute({ task_name: 'conflict', message: 'run', model: 'one', modelCapability: 'two' })).rejects.toThrow('mutually exclusive');
    expect(coordinator.spawn).not.toHaveBeenCalled();
  });
});
