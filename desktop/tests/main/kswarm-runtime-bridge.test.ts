import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createKSwarmRuntimeBridge,
  createKSwarmRuntimeBridgeBrokerClient,
  submitKSwarmRuntimeResultToBroker,
} from '../../electron/kswarm-runtime-bridge.js';

describe('kswarm runtime bridge', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kswarm-runtime-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('executes a file handoff through desktop runtime and submits a result manifest', async () => {
    const handoffPath = join(rootDir, 'request.json');
    writeFileSync(handoffPath, JSON.stringify({
      kind: 'kswarm_task_handoff_v1',
      runId: 'run-1',
      project: { id: 'proj-1', name: 'Project', goal: 'Write report', requirements: '', workFolder: rootDir },
      task: { id: 'proj-1__item-1', title: 'Write', brief: 'Write markdown', requiredOutputs: ['markdown'] },
      contextPolicy: { resultManifest: 'result.json' },
    }));

    const submitResult = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const bridge = createKSwarmRuntimeBridge({
      allowedRoots: [rootDir],
      runDesktopTask: async ({ handoff }) => ({
        summary: `completed ${handoff.task.title}`,
        artifacts: [{ path: join(rootDir, 'report.md'), kind: 'markdown', label: 'report.md' }],
        provenance: { runtimeSource: 'desktop-agent-runtime', producingAgent: 'xiaok-worker' },
      }),
      submitResult,
    });

    const result = await bridge.handleTaskHandoff({
      handoffPath,
      projectId: 'proj-1',
      taskId: 'proj-1__item-1',
      runId: 'run-1',
      targetParticipantId: 'xiaok-worker',
    });

    expect(result).toEqual({ ok: true });
    expect(submitResult).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      taskId: 'proj-1__item-1',
      runId: 'run-1',
      result: expect.objectContaining({
        summary: 'completed Write',
        workFolder: rootDir,
        workspacePath: rootDir,
        provenance: expect.objectContaining({ runtimeSource: 'desktop-agent-runtime' }),
      }),
    }));
  });

  it('rejects handoff files outside allowed roots', async () => {
    const outside = join(tmpdir(), `outside-${Date.now()}.json`);
    writeFileSync(outside, JSON.stringify({ kind: 'kswarm_task_handoff_v1', runId: 'run-1' }));
    const bridge = createKSwarmRuntimeBridge({
      allowedRoots: [rootDir],
      runDesktopTask: async () => ({ summary: 'should not run' }),
      submitResult: async () => new Response('{}'),
    });

    await expect(bridge.handleTaskHandoff({
      handoffPath: outside,
      projectId: 'proj-1',
      taskId: 'task-1',
      runId: 'run-1',
    })).resolves.toEqual({ ok: false, error: 'handoff_path_outside_allowed_roots' });

    rmSync(outside, { force: true });
  });

  it('registers a desktop runtime participant and executes request_task handoffs from broker websocket', async () => {
    const handled = vi.fn().mockResolvedValue({ ok: true });
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, deliveredCount: 1, onlineRecipients: ['kswarm-hub'] }), { status: 200 });
    });
    const FakeWebSocket = createFakeWebSocket();

    const client = createKSwarmRuntimeBridgeBrokerClient({
      brokerUrl: 'http://127.0.0.1:4318',
      participantId: 'xiaok-worker',
      alias: 'Xiaok Worker',
      roles: ['worker'],
      capabilities: ['research', 'report'],
      bridge: { handleTaskHandoff: handled },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'request_task',
        fromParticipantId: 'kswarm-hub',
        taskId: 'task-1',
        threadId: 'thread-task-1',
        payload: {
          projectId: 'proj-1',
          taskId: 'task-1',
          runId: 'run-1',
          handoffPath: join(rootDir, 'handoffs', 'run-1', 'request.json'),
        },
      },
    });
    await nextTick();

    expect(posts[0]).toMatchObject({
      url: 'http://127.0.0.1:4318/participants/register',
      body: expect.objectContaining({
        participantId: 'xiaok-worker',
        kind: 'agent',
        inboxMode: 'realtime',
      }),
    });
    expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:4318/ws?participantId=xiaok-worker');
    expect(handled).toHaveBeenCalledWith(expect.objectContaining({
      handoffPath: join(rootDir, 'handoffs', 'run-1', 'request.json'),
      projectId: 'proj-1',
      taskId: 'task-1',
      runId: 'run-1',
      targetParticipantId: 'xiaok-worker',
    }));
    expect(posts.slice(1).map(post => post.body.kind)).toEqual([
      'accept_task',
      'report_progress',
    ]);
  });

  it('keeps sending progress heartbeats while a desktop handoff is running', async () => {
    const handled = vi.fn(async () => {
      await delay(45);
      return { ok: true as const };
    });
    const posts: Array<{ body: Record<string, any> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posts.push({ body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 });
    });
    const FakeWebSocket = createFakeWebSocket();

    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-worker',
      bridge: { handleTaskHandoff: handled },
      taskHeartbeatIntervalMs: 10,
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'request_task',
        fromParticipantId: 'kswarm-hub',
        taskId: 'task-1',
        threadId: 'thread-task-1',
        payload: {
          projectId: 'proj-1',
          taskId: 'task-1',
          runId: 'run-1',
          handoffPath: join(rootDir, 'handoffs', 'run-1', 'request.json'),
        },
      },
    });
    await delay(70);

    const progressPosts = posts.filter(post => post.body.kind === 'report_progress');
    expect(progressPosts.map(post => post.body.payload?.stage)).toContain('started');
    expect(progressPosts.map(post => post.body.payload?.stage)).toContain('running');
    expect(progressPosts.some(post => typeof post.body.payload?.telemetry?.lastHeartbeatAt === 'number')).toBe(true);
    client.stop();
  });

  it('reports a task_failed intent instead of running when request_task lacks a file handoff', async () => {
    const handled = vi.fn();
    const posts: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posts.push({ body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 });
    });
    const FakeWebSocket = createFakeWebSocket();
    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-worker',
      bridge: { handleTaskHandoff: handled },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'request_task',
        fromParticipantId: 'kswarm-hub',
        taskId: 'task-1',
        payload: { projectId: 'proj-1', taskId: 'task-1', runId: 'run-1' },
      },
    });
    await nextTick();

    expect(handled).not.toHaveBeenCalled();
    expect(posts.at(-1)?.body).toMatchObject({
      kind: 'task_failed',
      fromParticipantId: 'xiaok-worker',
      payload: expect.objectContaining({
        projectId: 'proj-1',
        taskId: 'task-1',
        runId: 'run-1',
        failureReason: 'handoff_missing',
      }),
    });
  });

  it('routes workflow_node_handoff intents through desktop runtime and reports workflow_node_result', async () => {
    const handleWorkflowNodeHandoff = vi.fn().mockResolvedValue({ ok: true });
    const posts: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posts.push({ body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 });
    });
    const FakeWebSocket = createFakeWebSocket();
    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-worker',
      bridge: {
        handleTaskHandoff: async () => ({ ok: true }),
        handleWorkflowNodeHandoff,
      },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'workflow_node_handoff',
        fromParticipantId: 'kswarm-hub',
        taskId: 'wf-proj-1-agent-review-smoke-1',
        payload: {
          projectId: 'proj-1',
          workflowRunId: 'wf-proj-1-agent-review-smoke-1',
          workflowId: 'agent-review-smoke',
          nodeId: 'worker-diagnose-project',
          nodeKind: 'agent_task',
          nodeTitle: 'Worker 项目诊断',
          attempt: 1,
          handoffId: 'wfhd-1',
          input: { project: { id: 'proj-1' } },
        },
      },
    });
    await nextTick();

    expect(handleWorkflowNodeHandoff).toHaveBeenCalledWith(expect.objectContaining({
      targetParticipantId: 'xiaok-worker',
      handoff: expect.objectContaining({
        projectId: 'proj-1',
        workflowRunId: 'wf-proj-1-agent-review-smoke-1',
        nodeId: 'worker-diagnose-project',
        attempt: 1,
        handoffId: 'wfhd-1',
      }),
    }));
    expect(posts.slice(1).map(post => post.body.kind)).toEqual(['workflow_node_progress']);
  });

  it('reports the actual workflow node runtime error as the failure reason', async () => {
    const handleWorkflowNodeHandoff = vi.fn().mockRejectedValue(new Error('Premature close'));
    const posts: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posts.push({ body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 });
    });
    const FakeWebSocket = createFakeWebSocket();
    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-worker',
      bridge: {
        handleTaskHandoff: async () => ({ ok: true }),
        handleWorkflowNodeHandoff,
      },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'workflow_node_handoff',
        fromParticipantId: 'kswarm-hub',
        taskId: 'wf-proj-1-parallel-1',
        payload: {
          projectId: 'proj-1',
          workflowRunId: 'wf-proj-1-parallel-1',
          workflowId: 'parallel-report',
          nodeId: 'script-agent-1',
          nodeKind: 'agent_task',
          nodeTitle: '并行研究 A',
          attempt: 1,
          handoffId: 'wfhd-1',
          input: { topic: 'A' },
        },
      },
    });
    await nextTick();

    expect(posts.at(-1)?.body).toMatchObject({
      kind: 'workflow_node_failed',
      fromParticipantId: 'xiaok-worker',
      taskId: 'wf-proj-1-parallel-1',
      payload: expect.objectContaining({
        projectId: 'proj-1',
        workflowRunId: 'wf-proj-1-parallel-1',
        nodeId: 'script-agent-1',
        failureReason: 'Premature close',
        errorMessage: 'Premature close',
      }),
    });
  });

  it('submits desktop runtime results to broker as the target xiaok participant', async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    });

    const response = await submitKSwarmRuntimeResultToBroker({
      brokerUrl: 'http://127.0.0.1:4318',
      participantId: 'xiaok-po',
      projectId: 'proj-1',
      taskId: 'task-1',
      runId: 'run-1',
      result: { summary: 'done', artifacts: [] },
      fetchImpl: fetchImpl as never,
    });

    expect(response.status).toBe(202);
    expect(posts[0]).toMatchObject({
      url: 'http://127.0.0.1:4318/intents',
      body: expect.objectContaining({
        kind: 'submit_result',
        fromParticipantId: 'xiaok-po',
        taskId: 'task-1',
        to: { mode: 'participant', participants: ['kswarm-hub'] },
        payload: expect.objectContaining({
          projectId: 'proj-1',
          taskId: 'task-1',
          runId: 'run-1',
          summary: 'done',
          provenance: expect.objectContaining({ runtimeSource: 'desktop-agent-runtime' }),
        }),
      }),
    });
  });

  it('routes assign_po broker intents to the desktop PO handler', async () => {
    const handleAssignPo = vi.fn().mockResolvedValue({ ok: true });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 }));
    const FakeWebSocket = createFakeWebSocket();
    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-po',
      bridge: {
        handleTaskHandoff: async () => ({ ok: true }),
        handleAssignPo,
      },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'assign_po',
        fromParticipantId: 'kswarm-hub',
        payload: {
          projectId: 'proj-1',
          projectName: 'Project',
          goal: 'Write report',
          requirements: 'Chinese output',
          members: ['xiaok-worker'],
        },
      },
    });
    await nextTick();

    expect(handleAssignPo).toHaveBeenCalledWith(expect.objectContaining({
      targetParticipantId: 'xiaok-po',
      payload: expect.objectContaining({
        projectId: 'proj-1',
        projectName: 'Project',
      }),
    }));
  });

  it('responds to readiness_probe broker intents without running a task handoff', async () => {
    const handleTaskHandoff = vi.fn().mockResolvedValue({ ok: true });
    const handleReadinessProbe = vi.fn().mockResolvedValue({
      ok: true,
      capabilities: ['planning', 'research'],
      outputCapabilities: ['markdown', 'report_html'],
    });
    const posts: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posts.push({ body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 });
    });
    const FakeWebSocket = createFakeWebSocket();
    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-po',
      bridge: {
        handleTaskHandoff,
        handleReadinessProbe,
      },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'readiness_probe',
        fromParticipantId: 'kswarm-hub',
        taskId: 'probe-1',
        payload: {
          probeId: 'probe-1',
          projectId: 'proj-1',
          agentId: 'xiaok-po',
          role: 'project_owner',
        },
      },
    });
    await nextTick();

    expect(handleTaskHandoff).not.toHaveBeenCalled();
    expect(handleReadinessProbe).toHaveBeenCalledWith(expect.objectContaining({
      targetParticipantId: 'xiaok-po',
      payload: expect.objectContaining({ probeId: 'probe-1' }),
    }));
    expect(posts.at(-1)?.body).toMatchObject({
      kind: 'readiness_probe_result',
      fromParticipantId: 'xiaok-po',
      taskId: 'probe-1',
      payload: expect.objectContaining({
        ok: true,
        probeId: 'probe-1',
        agentId: 'xiaok-po',
        participantId: 'xiaok-po',
        runtimeSource: 'desktop-agent-runtime',
        capabilities: ['planning', 'research'],
        outputCapabilities: ['markdown', 'report_html'],
      }),
    });
  });

  it('reports readiness probe failures with a stable reason', async () => {
    const posts: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posts.push({ body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 });
    });
    const FakeWebSocket = createFakeWebSocket();
    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-po',
      bridge: {
        handleTaskHandoff: async () => ({ ok: true }),
        handleReadinessProbe: async () => ({ ok: false, reason: 'model_config_missing' }),
      },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'readiness_probe',
        fromParticipantId: 'kswarm-hub',
        taskId: 'probe-2',
        payload: { probeId: 'probe-2', agentId: 'xiaok-po' },
      },
    });
    await nextTick();

    expect(posts.at(-1)?.body).toMatchObject({
      kind: 'readiness_probe_result',
      payload: expect.objectContaining({
        ok: false,
        reason: 'model_config_missing',
        probeId: 'probe-2',
      }),
    });
  });

  it('routes review_submission broker intents to the desktop PO review handler', async () => {
    const handleReviewSubmission = vi.fn().mockResolvedValue({ ok: true });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 }));
    const FakeWebSocket = createFakeWebSocket();
    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-po',
      bridge: {
        handleTaskHandoff: async () => ({ ok: true }),
        handleReviewSubmission,
      },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'review_submission',
        fromParticipantId: 'kswarm-hub',
        taskId: 'task-1',
        payload: {
          projectId: 'proj-1',
          taskId: 'task-1',
          fromWorker: 'xiaok-worker',
          result: { summary: 'done' },
        },
      },
    });
    await nextTick();

    expect(handleReviewSubmission).toHaveBeenCalledWith(expect.objectContaining({
      targetParticipantId: 'xiaok-po',
      payload: expect.objectContaining({
        projectId: 'proj-1',
        taskId: 'task-1',
      }),
    }));
  });

  it('routes respond_approval broker intents to the desktop PO dispatch handler', async () => {
    const handlePlanApproved = vi.fn().mockResolvedValue({ ok: true });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, deliveredCount: 1 }), { status: 200 }));
    const FakeWebSocket = createFakeWebSocket();
    const client = createKSwarmRuntimeBridgeBrokerClient({
      participantId: 'xiaok-po',
      bridge: {
        handleTaskHandoff: async () => ({ ok: true }),
        handlePlanApproved,
      },
      fetchImpl: fetchImpl as never,
      WebSocketImpl: FakeWebSocket,
    });

    await client.start();
    FakeWebSocket.instances[0].emitMessage({
      type: 'new_intent',
      event: {
        kind: 'respond_approval',
        fromParticipantId: 'kswarm-hub',
        taskId: 'proj-1',
        payload: {
          projectId: 'proj-1',
          decision: 'approved',
        },
      },
    });
    await nextTick();

    expect(handlePlanApproved).toHaveBeenCalledWith(expect.objectContaining({
      targetParticipantId: 'xiaok-po',
      payload: expect.objectContaining({
        projectId: 'proj-1',
        decision: 'approved',
      }),
    }));
  });
});

function createFakeWebSocket() {
  return class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(url: string) {
      this.url = url;
      FakeWebSocket.instances.push(this);
      setTimeout(() => this.onopen?.(), 0);
    }

    emitMessage(message: unknown) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }

    close() {
      this.onclose?.();
    }
  };
}

function nextTick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
