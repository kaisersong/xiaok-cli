import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export interface KSwarmTaskHandoff {
  kind: 'kswarm_task_handoff_v1';
  runId: string;
  project: {
    id: string;
    name: string;
    goal: string;
    requirements?: string;
    workFolder?: string | null;
    artifactsDir?: string | null;
  };
  task: {
    id: string;
    title: string;
    brief?: string;
    acceptanceCriteria?: string;
    requiredOutputs?: Array<string | { type?: string; format?: string; kind?: string; mimeType?: string; enforcement?: string }>;
    executionContract?: Record<string, unknown> | null;
    evidenceContract?: Record<string, unknown> | null;
    repairInstruction?: string;
  };
}

export interface KSwarmRuntimeBridgeOptions {
  allowedRoots?: string[];
  runDesktopTask(input: { handoff: KSwarmTaskHandoff; targetParticipantId?: string }): Promise<{
    summary: string;
    artifacts?: Array<{ path: string; kind: string; label?: string }>;
    provenance?: Record<string, unknown>;
  }>;
  submitResult(input: {
    projectId: string;
    taskId: string;
    runId: string;
    targetParticipantId?: string;
    result: Record<string, unknown>;
  }): Promise<Response>;
}

export function createKSwarmRuntimeBridge(options: KSwarmRuntimeBridgeOptions) {
  async function handleTaskHandoff(input: {
    handoffPath: string;
    projectId: string;
    taskId: string;
    runId: string;
    targetParticipantId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isAllowedPath(input.handoffPath, options.allowedRoots)) {
      return { ok: false, error: 'handoff_path_outside_allowed_roots' };
    }
    const raw = await readFile(input.handoffPath, 'utf-8');
    const handoff = JSON.parse(raw) as KSwarmTaskHandoff;
    if (handoff.kind !== 'kswarm_task_handoff_v1') return { ok: false, error: 'invalid_handoff_kind' };
    if (handoff.runId !== input.runId) return { ok: false, error: 'run_id_mismatch' };

    const executed = await options.runDesktopTask({ handoff, targetParticipantId: input.targetParticipantId });
    const result = {
      summary: executed.summary,
      artifacts: executed.artifacts ?? [],
      ...(handoff.project.workFolder ? { workFolder: handoff.project.workFolder, workspacePath: handoff.project.workFolder } : {}),
      provenance: {
        runtimeSource: 'desktop-agent-runtime',
        ...(executed.provenance ?? {}),
      },
    };
    const response = await options.submitResult({
      projectId: input.projectId,
      taskId: input.taskId,
      runId: input.runId,
      targetParticipantId: input.targetParticipantId,
      result,
    });
    if (!response.ok) return { ok: false, error: `submit_failed:${response.status}` };
    return { ok: true };
  }

  return { handleTaskHandoff };
}

export interface KSwarmRuntimeBridge {
  handleTaskHandoff(input: {
    handoffPath: string;
    projectId: string;
    taskId: string;
    runId: string;
    targetParticipantId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  handleAssignPo?(input: {
    payload: Record<string, unknown>;
    targetParticipantId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  handleReviewSubmission?(input: {
    payload: Record<string, unknown>;
    targetParticipantId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  handlePlanApproved?(input: {
    payload: Record<string, unknown>;
    targetParticipantId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  handleReadinessProbe?(input: {
    payload: Record<string, unknown>;
    targetParticipantId?: string;
  }): Promise<{
    ok: boolean;
    reason?: string;
    error?: string;
    capabilities?: string[];
    taskCapabilities?: string[];
    outputCapabilities?: string[];
  }>;
}

interface BrokerEvent {
  kind?: string;
  fromParticipantId?: string;
  taskId?: string | null;
  threadId?: string | null;
  payload?: Record<string, unknown>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface KSwarmRuntimeBridgeBrokerClientOptions {
  brokerUrl?: string;
  participantId: string;
  alias?: string;
  roles?: string[];
  capabilities?: string[];
  bridge: KSwarmRuntimeBridge;
  taskHeartbeatIntervalMs?: number;
  fetchImpl?: FetchLike;
  WebSocketImpl?: WebSocketConstructor;
}

export interface KSwarmRuntimeResultBrokerInput {
  brokerUrl?: string;
  participantId: string;
  projectId: string;
  taskId: string;
  runId: string;
  result: Record<string, unknown>;
  fetchImpl?: FetchLike;
}

export async function submitKSwarmRuntimeResultToBroker(input: KSwarmRuntimeResultBrokerInput): Promise<Response> {
  const brokerUrl = normalizeBrokerUrl(input.brokerUrl ?? 'http://127.0.0.1:4318');
  const fetchImpl = input.fetchImpl ?? fetch;
  const payload = {
    ...input.result,
    projectId: input.projectId,
    taskId: input.taskId,
    runId: input.runId,
    provenance: {
      runtimeSource: 'desktop-agent-runtime',
      ...((input.result.provenance && typeof input.result.provenance === 'object')
        ? input.result.provenance as Record<string, unknown>
        : {}),
    },
  };
  return fetchImpl(`${brokerUrl}/intents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      intentId: `${input.participantId}-submit_result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'submit_result',
      fromParticipantId: input.participantId,
      taskId: input.taskId,
      threadId: `thread-${input.taskId}`,
      to: { mode: 'participant', participants: ['kswarm-hub'] },
      payload,
    }),
  });
}

export function createKSwarmRuntimeBridgeBrokerClient(options: KSwarmRuntimeBridgeBrokerClientOptions) {
  const brokerUrl = normalizeBrokerUrl(options.brokerUrl ?? 'http://127.0.0.1:4318');
  const fetchImpl = options.fetchImpl ?? fetch;
  const WebSocketImpl = options.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketConstructor | undefined);
  let socket: WebSocketLike | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function start(): Promise<void> {
    if (socket) return;
    stopped = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!WebSocketImpl) throw new Error('websocket_unavailable');
    try {
      socket = new WebSocketImpl(`${brokerUrl.replace(/^http/, 'ws')}/ws?participantId=${encodeURIComponent(options.participantId)}`);
      socket.onmessage = (event) => {
        handleSocketMessage(event.data).catch(() => {});
      };
      socket.onerror = () => {};
      socket.onclose = () => {
        socket = null;
        if (!stopped) scheduleReconnect();
      };
      await waitForSocketOpen(socket);
      await postJson('/participants/register', {
        participantId: options.participantId,
        kind: 'agent',
        alias: options.alias ?? options.participantId,
        roles: options.roles ?? [],
        capabilities: options.capabilities ?? [],
        inboxMode: 'realtime',
        context: { runtimeSource: 'desktop-agent-runtime' },
      });
    } catch (error) {
      const current = socket;
      socket = null;
      current?.close();
      if (!stopped) scheduleReconnect();
      throw error;
    }
  }

  function stop(): void {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    socket?.close();
    socket = null;
  }

  function scheduleReconnect(): void {
    if (reconnectTimer || stopped) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start().catch(() => scheduleReconnect());
    }, 2_000);
  }

  async function handleSocketMessage(data: unknown): Promise<void> {
    if (stopped) return;
    const message = parseBrokerMessage(data);
    if (message?.type !== 'new_intent') return;
    const event = message.event as BrokerEvent | undefined;
    if (event?.kind === 'request_task') {
      await handleRequestTask(event);
      return;
    }
    if (event?.kind === 'readiness_probe') {
      await handleReadinessProbe(event);
      return;
    }
    if (event?.kind === 'assign_po' && typeof options.bridge.handleAssignPo === 'function') {
      await options.bridge.handleAssignPo({
        payload: event.payload ?? {},
        targetParticipantId: options.participantId,
      });
      return;
    }
    if (event?.kind === 'review_submission' && typeof options.bridge.handleReviewSubmission === 'function') {
      await options.bridge.handleReviewSubmission({
        payload: event.payload ?? {},
        targetParticipantId: options.participantId,
      });
      return;
    }
    if ((event?.kind === 'respond_approval' || event?.kind === 'plan_approved') && typeof options.bridge.handlePlanApproved === 'function') {
      await options.bridge.handlePlanApproved({
        payload: event.payload ?? {},
        targetParticipantId: options.participantId,
      });
    }
  }

  async function handleReadinessProbe(event: BrokerEvent): Promise<void> {
    const payload = event.payload ?? {};
    const probeId = asNonEmptyString(payload.probeId) || asNonEmptyString(event.taskId) || `probe-${Date.now()}`;
    const agentId = asNonEmptyString(payload.agentId) || options.participantId;
    let probeResult: Awaited<ReturnType<NonNullable<KSwarmRuntimeBridge['handleReadinessProbe']>>>;
    if (typeof options.bridge.handleReadinessProbe === 'function') {
      try {
        probeResult = await options.bridge.handleReadinessProbe({
          payload,
          targetParticipantId: options.participantId,
        });
      } catch (error) {
        probeResult = {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      probeResult = { ok: false, reason: 'readiness_handler_missing' };
    }

    await sendIntent('readiness_probe_result', event, {
      probeId,
      agentId,
      participantId: options.participantId,
      ok: Boolean(probeResult.ok),
      ...(probeResult.ok ? {} : { reason: probeResult.reason || probeResult.error || 'readiness_probe_failed' }),
      runtimeSource: 'desktop-agent-runtime',
      capabilities: probeResult.capabilities ?? probeResult.taskCapabilities ?? [],
      outputCapabilities: probeResult.outputCapabilities ?? [],
      checkedAt: Date.now(),
    });
  }

  async function handleRequestTask(event: BrokerEvent): Promise<void> {
    const payload = event.payload ?? {};
    const projectId = asNonEmptyString(payload.projectId);
    const taskId = asNonEmptyString(payload.taskId) || asNonEmptyString(event.taskId);
    const runId = asNonEmptyString(payload.runId);
    const handoffPath = asNonEmptyString(payload.handoffPath);
    if (!projectId || !taskId || !runId || !handoffPath) {
      await sendTaskFailed(event, {
        projectId,
        taskId,
        runId,
        failureReason: 'handoff_missing',
        errorMessage: 'request_task_missing_file_handoff',
      });
      return;
    }

    await sendIntent('accept_task', event, { projectId, taskId, runId });
    await sendIntent('report_progress', event, { projectId, taskId, runId, stage: 'started' });

    const stopHeartbeat = startTaskHeartbeat(event, { projectId, taskId, runId });
    try {
      const result = await options.bridge.handleTaskHandoff({
        handoffPath,
        projectId,
        taskId,
        runId,
        targetParticipantId: options.participantId,
      });
      if (!result.ok) {
        await sendTaskFailed(event, {
          projectId,
          taskId,
          runId,
          failureReason: result.error || 'desktop_runtime_failed',
          errorMessage: result.error || 'desktop_runtime_failed',
        });
      }
    } catch (error) {
      await sendTaskFailed(event, {
        projectId,
        taskId,
        runId,
        failureReason: 'desktop_runtime_error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      stopHeartbeat();
    }
  }

  function startTaskHeartbeat(event: BrokerEvent, payload: { projectId: string; taskId: string; runId: string }): () => void {
    const intervalMs = options.taskHeartbeatIntervalMs ?? 30_000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
    const timer = setInterval(() => {
      sendIntent('report_progress', event, {
        ...payload,
        stage: 'running',
        telemetry: { lastHeartbeatAt: Date.now() },
      }).catch(() => {});
    }, intervalMs);
    return () => clearInterval(timer);
  }

  async function sendTaskFailed(event: BrokerEvent, payload: Record<string, unknown>): Promise<void> {
    await sendIntent('task_failed', event, payload);
  }

  async function sendIntent(kind: string, event: BrokerEvent, payload: Record<string, unknown>): Promise<Response> {
    return postJson('/intents', {
      intentId: `${options.participantId}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      fromParticipantId: options.participantId,
      taskId: asNonEmptyString(event.taskId) || asNonEmptyString(payload.taskId) || null,
      threadId: asNonEmptyString(event.threadId) || null,
      to: { mode: 'participant', participants: [event.fromParticipantId || 'kswarm-hub'] },
      payload: {
        ...payload,
        participantId: options.participantId,
      },
    });
  }

  async function postJson(path: string, body: Record<string, unknown>): Promise<Response> {
    const response = await fetchImpl(`${brokerUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`broker_http_${response.status}`);
    return response;
  }

  return { start, stop, handleSocketMessage };
}

function isAllowedPath(filePath: string, allowedRoots: string[] | undefined): boolean {
  if (!allowedRoots || allowedRoots.length === 0) return true;
  const resolvedFile = resolve(filePath);
  return allowedRoots.some((root) => {
    const resolvedRoot = resolve(root);
    return resolvedFile === resolvedRoot || resolvedFile.startsWith(`${resolvedRoot}/`);
  });
}

function normalizeBrokerUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function parseBrokerMessage(data: unknown): { type?: string; event?: unknown } | null {
  try {
    if (typeof data === 'string') return JSON.parse(data) as { type?: string; event?: unknown };
    if (data instanceof Buffer) return JSON.parse(data.toString('utf-8')) as { type?: string; event?: unknown };
  } catch {
    return null;
  }
  return null;
}

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

function waitForSocketOpen(socket: WebSocketLike): Promise<void> {
  return new Promise((resolve, reject) => {
    const previousError = socket.onerror;
    const previousClose = socket.onclose;
    const timer = setTimeout(() => {
      restore();
      reject(new Error('websocket_open_timeout'));
    }, 5_000);
    const restore = () => {
      clearTimeout(timer);
      socket.onopen = null;
      socket.onerror = previousError;
      socket.onclose = previousClose;
    };
    socket.onopen = () => {
      restore();
      resolve();
    };
    socket.onerror = () => {
      previousError?.();
      restore();
      reject(new Error('websocket_error'));
    };
    socket.onclose = () => {
      previousClose?.();
      restore();
      reject(new Error('websocket_closed'));
    };
  });
}
