import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationProjectService } from '../../electron/conversation-project-service.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { buildProjectCardMessageFromToolResult } from '../../renderer/src/components/chatToolResultMessages.js';
import { formatTaskToolResultResponse } from '../../../src/runtime/task-host/tool-result-response.js';
import { resolveAgentExecution } from '../../../../kswarm/src/core/agent-execution.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(extra: Record<string, unknown> = {}) {
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
  const service = new ConversationProjectService({ ...extra, dataRoot, kswarmService: gateway as never });
  service.bindRoomClient(roomClient);
  const proposal = {
    kind: 'project_proposal', name: '真实调研项目', goal: '交付 HTML 报告', requirements: 'Markdown 不算交付完成',
    planningGuidance: '生成 HTML 报告', poAgent: 'xiaok-po', members: ['xiaok-worker'], memberCount: 3, memberNames: [],
    executionMode: 'auto', startPolicy: 'activate_and_dispatch_after_plan',
  };
  function authorize(prompt = '创建一个项目，完成调研并交付 HTML 报告', taskId = 'task_user', permissionMode?: 'auto' | 'plan', threadId?: string) {
    return service.withUserRequest({ prompt, permissionMode, threadId }, { requestSource: 'user' }, () =>
      service.bindPreparedTask({ taskId, prompt, permissionMode }, { requestSource: 'user' }));
  }
  return { service, gateway, dataRoot, roomClient, request, projects, agents, proposal, authorize };
}

describe('main-owned conversation project creation', () => {
  it('creates and starts the report workflow requested in a single user turn', async () => {
    const f = fixture();
    expect(await f.authorize('设计一个工作流：资料收集、撰写、评审后交付xiaok介绍报告')).toBe(true);
    expect(await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' })).toMatchObject({ projectId: 'proj-real', planningStart: { sent: true } });
    expect(f.projects[0].requestedStartPolicy).toBe('activate_and_dispatch_after_plan');
  });

  it.each(['设计一个工作流，只设计不执行，交付介绍报告', '设计一个工作流：只输出脚本，不执行，交付报告', '设计工作流的方法是什么？交付报告', '请总结：设计一个工作流并交付报告', '设计一个工作流：资料收集与撰写'])('denies design-only or non-user delivery commands: %s', async prompt => {
    const f = fixture();
    expect(await f.authorize(prompt)).toBe(false);
    expect(f.service.isAuthorized('task_user')).toBe(false);
  });
  function pendingSnapshot(overrides: Record<string, unknown> = {}) {
    return { taskId: 'design', status: 'completed', prompt: '设计一个工作流：资料收集、撰写、评审后交付报告',
      context: { threadId: 'thread-confirm' },
      events: [{ type: 'canvas_tool_result', toolName: 'create_project', ok: true,
        response: JSON.stringify({ ok: true, proposal: { kind: 'project_proposal' } }) }],
      result: { summary: '是否确认按此设计创建并启动项目？回复确认和主题后，我会建立正式项目并把脚本提交执行。' }, ...overrides };
  }

  it('accepts the real two-turn confirmation from persisted history and reuses its durable creation receipt', async () => {
    const historyRoot = mkdtempSync(join(tmpdir(), 'confirmation-history-')); roots.push(historyRoot);
    const writer = new FileTaskSnapshotStore(historyRoot);
    await writer.save({ ...pendingSnapshot(), sessionId: 'prior-session', materials: [], createdAt: 1, updatedAt: 1 } as never);
    await writer.save({ taskId: 'confirmed', sessionId: 'confirmed-session', prompt: '同意，主题是xiaok介绍', status: 'understanding',
      context: { threadId: 'thread-confirm', taskIds: [], loadedTaskIds: [], skipped: [] }, materials: [], events: [], createdAt: 2, updatedAt: 2 } as never);
    const reader = new FileTaskSnapshotStore(historyRoot);
    const readPreviousUserTask = vi.fn((threadId, taskId) => reader.readPreviousUserTask(threadId, taskId));
    const f = fixture({ readPreviousUserTask });
    expect(await f.authorize('同意，主题是xiaok介绍', 'confirmed', 'auto', 'thread-confirm')).toBe(true);
    const receipt = await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'confirmed' });
    expect(receipt).toMatchObject({ ok: true, projectId: 'proj-real' });
    expect(buildProjectCardMessageFromToolResult(formatTaskToolResultResponse('create_project', JSON.stringify(receipt)))?.projectData).toMatchObject({ projectId: 'proj-real' });
    expect(f.projects).toHaveLength(1);
    expect(f.projects[0].requestedStartPolicy).toBe('activate_and_dispatch_after_plan');
    expect(readPreviousUserTask).toHaveBeenCalledWith('thread-confirm', 'confirmed');
    const restarted = new ConversationProjectService({ dataRoot: f.dataRoot, kswarmService: f.gateway as never });
    expect(await restarted.create(f.proposal, { requestSource: 'agent', taskId: 'confirmed' })).toMatchObject({ projectId: 'proj-real' });
    expect(f.projects).toHaveLength(1);
  });

  it.each(['同意吗？', '不同意', '同意，但不要创建项目', '同意，但不用创建项目', '同意，先说说风险', '请总结：同意', '同意，先不要执行'])(
    'denies ambiguous or negated confirmation: %s', async prompt => {
      const f = fixture({ readPreviousUserTask: async () => pendingSnapshot() });
      expect(await f.authorize(prompt, 'confirmed', 'auto', 'thread-confirm')).toBe(false);
      expect(f.service.isAuthorized('confirmed')).toBe(false);
    });

  it.each([
    { context: { threadId: 'another-thread' } }, { status: 'running' },
    { prompt: '请总结文档：设计一个工作流' }, { events: [] },
    { result: { summary: '同意吗？' } },
    { events: [{ type: 'canvas_tool_result', toolName: 'create_project', ok: true, response: JSON.stringify({ ok: true, projectId: 'existing' }) }] },
  ])('denies confirmation without a matching pending request: %j', async overrides => {
    const f = fixture({ readPreviousUserTask: async () => pendingSnapshot(overrides) });
    expect(await f.authorize('同意，主题是xiaok介绍', 'confirmed', 'auto', 'thread-confirm')).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
  });

  it('denies standalone and plan-mode confirmations', async () => {
    const f = fixture({ readPreviousUserTask: async () => pendingSnapshot() });
    expect(await f.authorize('同意')).toBe(false);
    expect(await f.authorize('同意', 'confirmed', 'plan', 'thread-confirm')).toBe(false);
  });
  it('journals the trusted original thread before project creation and attaches its observation receipt', async () => {
    const calls: string[] = [];
    const prepare = vi.fn(async (input: any) => { calls.push('prepare'); expect(input.threadId).toBe('thread-original'); });
    const created = vi.fn(async (input: any) => { calls.push('created'); expect(input.threadId).toBe('thread-original'); return { activityWatchId: 'watch-real' }; });
    const f = fixture({ activityHooks: { prepare, created } });
    await f.authorize(undefined, undefined, 'auto', 'thread-original');
    const operation = JSON.parse(readFileSync(join(f.dataRoot, 'conversation-projects', 'task_user.json'), 'utf8'));
    expect(operation).toMatchObject({ schemaVersion: 2, originThreadId: 'thread-original' });
    expect(calls).toEqual(['prepare']);
    const result = await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' });
    expect(result).toMatchObject({ ok: true, activityWatchId: 'watch-real', activityStatus: 'active' });
    expect(calls).toEqual(['prepare', 'created']);
  });
  it('has a recoverable origin journal before committing the separate activity association', async () => {
    let dataRoot = '';
    let fail = true;
    const prepare = vi.fn(async () => {
      expect(JSON.parse(readFileSync(join(dataRoot, 'conversation-projects', 'task_user.json'), 'utf8')).originThreadId).toBe('thread-original');
      if (fail) throw new Error('association commit fault');
    });
    const hooks = { prepare, created: vi.fn(async () => ({})) };
    const f = fixture({ activityHooks: hooks }); dataRoot = f.dataRoot;
    await expect(f.authorize(undefined, undefined, 'auto', 'thread-original')).rejects.toThrow('association commit fault');
    expect(f.projects).toEqual([]);
    fail = false;
    const recovered = new ConversationProjectService({ dataRoot, kswarmService: f.gateway as never, activityHooks: hooks });
    await recovered.recoverActivityBindings();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(f.request).not.toHaveBeenCalled(); expect(hooks.created).not.toHaveBeenCalled();
  });

  it('keeps a committed project successful when follow-up binding fails and retries only the binding', async () => {
    let fail = true;
    const created = vi.fn(async () => { if (fail) throw new Error('binding fault'); return { activityWatchId: 'repaired' }; });
    const f = fixture({ activityHooks: { prepare: async () => {}, created } });
    await f.authorize(undefined, undefined, 'auto', 'thread-original');
    const first = await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' });
    expect(first).toMatchObject({ ok: true, activityStatus: 'pending' });
    fail = false;
    const second = await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' });
    expect(second).toMatchObject({ ok: true, activityStatus: 'active', activityWatchId: 'repaired' });
    expect(f.projects).toHaveLength(1);
  });

  it('reconciles a source commit without a local response receipt on startup using read-only lookup', async () => {
    const created = vi.fn(async () => ({ activityWatchId: 'recovered' }));
    const hooks = { prepare: async () => {}, created };
    const f = fixture({ activityHooks: hooks });
    await f.authorize(undefined, undefined, 'auto', 'thread-original');
    await f.service.create(f.proposal, { requestSource: 'agent', taskId: 'task_user' });
    const filename = join(f.dataRoot, 'conversation-projects', 'task_user.json');
    const pending = JSON.parse(readFileSync(filename, 'utf8'));
    delete pending.result; writeFileSync(filename, JSON.stringify(pending));
    f.request.mockClear(); created.mockClear();
    const recovered = new ConversationProjectService({ dataRoot: f.dataRoot, kswarmService: f.gateway as never, activityHooks: hooks });
    await recovered.recoverActivityBindings();
    expect(created).toHaveBeenCalledOnce();
    expect(f.request.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([['/projects', 'GET']]);
    expect(JSON.parse(readFileSync(filename, 'utf8')).result).toMatchObject({ projectId: 'proj-real', activityStatus: 'active' });
    expect(f.projects).toHaveLength(1);
  });

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
