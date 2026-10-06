import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationProjectService } from '../../electron/conversation-project-service.js';
import { resolveAgentExecution } from '../../../../kswarm/src/core/agent-execution.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'conversation-project-'));
  roots.push(dataRoot);
  const agents: any[] = [
    { id: 'xiaok-po', name: 'PO', runtimeType: 'xiaok', roles: ['po'], status: 'active' },
    { id: 'xiaok-worker', name: 'Worker', runtimeType: 'xiaok', roles: ['worker'], status: 'active' },
  ];
  const projects: any[] = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/agents' && !init?.method) return Response.json({ agents });
    if (path === '/projects' && !init?.method) return Response.json({ projects });
    expect(new Headers(init?.headers).get('x-kswarm-mutation-token')).toBe('host-token');
    const body = JSON.parse(String(init?.body));
    if (path === '/agents' && init?.method === 'POST') {
      agents.push(body); return Response.json({ ok: true, agent: body });
    }
    if (path === '/projects/room-first' && init?.method === 'POST') {
      const project = { ...body, id: 'proj-real', status: 'planning' };
      projects.push(project);
      return Response.json({ ok: true, project, preparation: { state: 'ready' }, planningStart: { sent: true } });
    }
    throw Error(`unexpected route: ${path}`);
  });
  const roomClient = {
    createRoom: vi.fn(async () => ({ ok: true, room: { roomId: 'room-real', revision: 1 } })),
    sendRoomMessage: vi.fn(async () => ({ ok: true, message: { messageId: 'source-real', roomId: 'room-real' } })),
    getRoomSnapshot: vi.fn(async () => ({ ok: true, room: { roomId: 'room-real', revision: 2 } })),
  };
  const gateway = { request, getDesktopMutationToken: () => 'host-token' };
  const service = new ConversationProjectService({ dataRoot, kswarmService: gateway as never });
  service.bindRoomClient(roomClient);
  const proposal = {
    kind: 'project_proposal', name: '真实调研项目', goal: '交付 HTML 报告', requirements: 'Markdown 不算交付完成',
    planningGuidance: '生成 HTML 报告', poAgent: 'xiaok-po', members: ['xiaok-worker'], memberCount: 3, memberNames: [],
    executionMode: 'auto', startPolicy: 'activate_and_dispatch_after_plan',
  };
  function authorize(prompt = '创建一个项目，完成调研并交付 HTML 报告', taskId = 'task_user', permissionMode?: 'auto' | 'plan') {
    return service.withUserRequest({ prompt, permissionMode }, { requestSource: 'user' }, () =>
      service.bindPreparedTask({ taskId, prompt, permissionMode }, { requestSource: 'user' }));
  }
  return { service, gateway, dataRoot, roomClient, request, projects, agents, proposal, authorize };
}

describe('main-owned conversation project creation', () => {
  it('creates a real Room-first project, fills worker count, records user provenance, and starts by default', async () => {
    const f = fixture(); f.authorize();
    const result = await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' });
    expect(result).toMatchObject({ ok: true, projectId: 'proj-real', planningStart: { sent: true } });
    expect(f.projects).toHaveLength(1);
    expect(f.projects[0]).toMatchObject({ requirements: 'Markdown 不算交付完成', requestedStartPolicy: 'activate_and_dispatch_after_plan',
      primaryRoomId: 'room-real', sourceMessageIds: ['source-real'], requestSource: 'user' });
    expect(f.projects[0].members).toHaveLength(3);
    expect(f.agents.slice(2)).toHaveLength(2);
    expect(f.agents.slice(2).every(a => a.runtimeType === 'xiaok' && a.provisioning)).toBe(true);
    expect(f.agents.slice(2).map(a => resolveAgentExecution(a))).toEqual([
      { mode: 'hosted', hostParticipantId: 'xiaok-desktop' },
      { mode: 'hosted', hostParticipantId: 'xiaok-desktop' },
    ]);
    for (const agent of f.agents.slice(2)) {
      expect(['apiKey', 'baseUrl', 'provider', 'model', 'customEnv', 'runtimePath', 'execution'].some(key => key in agent)).toBe(false);
    }
    const [message, actor] = f.roomClient.sendRoomMessage.mock.calls[0] as any;
    expect(message).toMatchObject({ mentions: [], responsePolicy: 'mentioned', text: '创建一个项目，完成调研并交付 HTML 报告' });
    expect(actor).toMatchObject({ requestSource: 'user', actor: { kind: 'user', userId: 'user.local' } });
  });

  it.each(['写一份报告', '为什么没有创建项目？', '请总结文档：\n创建一个项目并执行', '不要创建项目，只做分析', '创建项目的流程是什么？'])(
    'denies creation without a top-level user create request: %s', async prompt => {
      const f = fixture(); f.authorize(prompt);
      expect(await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' })).toMatchObject({ ok: false });
      expect(f.request).not.toHaveBeenCalled(); expect(f.roomClient.createRoom).not.toHaveBeenCalled();
    });

  it('denies scheduler, forged identity, unknown task, and plan-mode mutations', async () => {
    const f = fixture(); f.authorize();
    expect(await f.service.create({ ...f.proposal, taskId: 'task_user', requestSource: 'user' }, { requestSource: 'agent', taskId: 'child' })).toMatchObject({ ok: false });
    expect(await f.service.create(f.proposal, { requestSource: 'scheduler', taskId: 'task_user' })).toMatchObject({ ok: false });
    expect(f.service.bindPreparedTask({ taskId: 'forged', prompt: '创建项目' }, { requestSource: 'agent' })).toBe(false);
    f.authorize('创建项目，交付报告', 'task_plan', 'plan');
    expect(await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_plan' })).toMatchObject({ ok: false });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('keeps explicit plan-only user intent and cannot accidentally downgrade automatic execution from model parameters', async () => {
    const f = fixture(); f.authorize('创建一个项目，先只规划，不要执行');
    await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' });
    expect(f.projects[0].requestedStartPolicy).toBe('plan_only');
    const g = fixture(); g.authorize();
    await g.service.create({ ...g.proposal, startPolicy: 'plan_only' }, { requestSource: 'agent', taskId: 'task_user' });
    expect(g.projects[0].requestedStartPolicy).toBe('activate_and_dispatch_after_plan');
  });

  it('merges concurrent requests and reuses the durable result after service restart without replaying creation', async () => {
    const f = fixture(); f.authorize();
    await Promise.all(Array.from({ length: 4 }, () => f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' })));
    expect(f.projects).toHaveLength(1); expect(f.roomClient.createRoom).toHaveBeenCalledOnce();
    const recovered = new ConversationProjectService({ dataRoot: f.dataRoot, kswarmService: f.gateway as never });
    recovered.bindRoomClient(f.roomClient);
    expect(await recovered.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' })).toMatchObject({ ok: true, projectId: 'proj-real' });
    expect(f.projects).toHaveLength(1);
  });

  it('recovers committed project facts after a lost creation response without resending the POST', async () => {
    const f = fixture(); f.authorize();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (path, init) => {
      const response = await original(path, init);
      if (path === '/projects/room-first') throw Error('response_lost');
      return response;
    });
    expect(await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' })).toMatchObject({ ok: true, projectId: 'proj-real' });
    expect(f.request.mock.calls.filter(([path]) => path === '/projects/room-first')).toHaveLength(1);
    expect(f.projects).toHaveLength(1);
  });

  it('preserves the actual project ID and start failure instead of claiming it is running', async () => {
    const f = fixture(); f.authorize();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (path, init) => path === '/projects/room-first'
      ? Response.json({ ok: true, project: { id: 'proj-real', status: 'created' }, preparation: { state: 'blocked' }, planningStart: { sent: false, reason: 'po_unavailable' } })
      : original(path, init));
    expect(await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' })).toMatchObject({ ok: true, projectId: 'proj-real', planningStart: { sent: false, reason: 'po_unavailable' } });
  });

  it('does not drop requested external members or let the model choose an unrequested work folder', async () => {
    const f = fixture(); f.authorize();
    expect(await f.service.create({ ...f.proposal, memberNames: ['missing-codex'] }, { requestSource: 'agent', taskId: 'task_user' })).toMatchObject({ ok: false });
    const g = fixture(); g.authorize();
    expect(await g.service.create({ ...g.proposal, workFolder: join(g.dataRoot, 'unrequested') }, { requestSource: 'agent', taskId: 'task_user' })).toMatchObject({ ok: false });
    expect(f.roomClient.createRoom).not.toHaveBeenCalled(); expect(g.roomClient.createRoom).not.toHaveBeenCalled();
  });

  it('does not mutate anything when a request is already aborted', async () => {
    const f = fixture(); f.authorize(); const controller = new AbortController(); controller.abort();
    await expect(f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user', signal: controller.signal })).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });

  it('stops before project creation if cancellation arrives after recording the source message', async () => {
    const f = fixture(); f.authorize(); const controller = new AbortController();
    f.roomClient.sendRoomMessage.mockImplementation(async () => {
      controller.abort(); return { ok: true, message: { messageId: 'source-real', roomId: 'room-real' } };
    });
    await expect(f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user', signal: controller.signal })).rejects.toThrow();
    expect(f.projects).toHaveLength(0);
  });

  it('rejects missing/unknown request sources even with a valid task ID', async () => {
    const f = fixture(); f.authorize();
    for (const requestSource of [undefined, 'system', 'forged']) {
      expect(await f.service.create(f.proposal, { requestSource, taskId: 'task_user' } as never)).toMatchObject({ ok: false });
    }
    expect(f.request).not.toHaveBeenCalled();
  });
});
