/**
 * useKSwarmClient — React hook for connecting to the KSwarm API from xiaok desktop renderer.
 *
 * Provides WebSocket real-time updates and REST API operations for projects/agents.
 * Port of kswarm/web/src/hooks/useKSwarm.js to TypeScript, adapted for xiaok desktop.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const KSWARM_PORT = 4400;
const BASE_URL = `http://127.0.0.1:${KSWARM_PORT}`;
const WS_URL = `ws://127.0.0.1:${KSWARM_PORT}/ws`;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 60_000;
const PARTICIPANT_POLL_INTERVAL = 8000;

// ─── Types ────────────────────────────────────────────────────────

export interface KSwarmTask {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'dispatched' | 'accepted' | 'in_progress' | 'submitted' | 'review' | 'done' | 'failed' | 'blocked' | 'cancelled';
  assignedAgent?: string;
  assignedRuntimeInstance?: string;
  phase?: number;
  priority?: number;
  planItemId?: string;
  acceptanceCriteria?: string[];
  result?: string;
  artifacts?: KSwarmArtifact[];
  blockedReason?: string;
  failureReason?: string;
  lastFailureClass?: string;
  failureClass?: string;
  failureCount?: number;
  qualityFailureCount?: number;
  reviewResult?: { passed?: boolean; feedback?: string; failureClass?: string; reviewedAt?: number };
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  createdAt?: number | string;
  updatedAt?: number | string;
}

export interface KSwarmArtifact {
  name?: string;
  filename?: string;
  mimeType?: string;
  type?: string;
  projectId?: string;
  path?: string;
  relativePath?: string;
  url?: string;
  size?: number;
  previewable?: boolean;
  createdAt?: number | string;
  updatedAt?: number | string;
  generatedAt?: number | string;
}

export interface KSwarmPhase {
  id: number;
  title: string;
  status: 'pending' | 'active' | 'completed';
  tasks: string[]; // task ids
}

export interface KSwarmProject {
  id: string;
  name: string;
  goal?: string;
  status: 'draft' | 'planning' | 'created' | 'active' | 'review' | 'delivered' | 'closed';
  tasks?: KSwarmTask[];
  phases?: KSwarmPhase[];
  poAgent?: string;
  members?: string[];
  createdAt?: string;
  updatedAt?: string;
  progress?: number;
  stoppedCount?: number;
  deliverables?: KSwarmDeliverable[];
  enableSummary?: boolean;
  summary?: string | null;
  summaryScore?: number | null;
  taskScores?: Array<{ title: string; agent: string; score: number; comment: string }> | null;
  projectIntervention?: ProjectIntervention | null;
  latestWorkflowRun?: KSwarmWorkflowRun | null;
}

export interface KSwarmDeliverable {
  id: string;
  title: string;
  format?: string;
  path?: string;
  url?: string;
  createdAt?: string;
}

export interface KSwarmAgent {
  id: string;
  name: string;
  description?: string;
  roles?: string[];
  capabilities?: string[];
  status: 'idle' | 'waiting' | 'working' | 'blocked' | 'failed' | 'error' | 'completed' | 'offline';
  runtimeType?: string;
  runtimeMode?: 'local' | 'cloud';
  maxConcurrentTasks?: number;
  currentTask?: string;
}

export interface KSwarmActivityEvent {
  type: string;
  projectId?: string;
  taskId?: string;
  taskTitle?: string;
  agent?: string;
  by?: string;
  target?: string;
  ts?: number | string;
  tasks?: Array<{ title: string; assignedAgent?: string }>;
  output?: { artifacts?: KSwarmArtifact[] };
  count?: number;
  failureReason?: string;
  errorMessage?: string;
  feedback?: string;
  reason?: string;
  blockedReason?: string;
  failureClass?: string;
  action?: string;
  passed?: boolean;
}

export interface KSwarmHumanAction {
  action: string;
  projectName?: string;
  ts: number;
}

export interface KSwarmParticipant {
  participantId: string;
  alias?: string;
  kind?: string;
  roles?: string[];
  inboxMode?: string;
  lastSeen?: string;
}

export interface KSwarmEvent {
  type: string;
  projectId?: string;
  taskId?: string;
  data?: unknown;
  timestamp?: string;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  roles?: string[];
  capabilities?: string[];
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  instructions?: string;
  runtimeType?: string;
  maxConcurrentTasks?: number;
}

export interface AgentProbe {
  healthy: boolean;
  version?: string;
  error?: string;
}

export type KSwarmAgentSelectionSource = 'default_seed' | 'explicit_user' | 'system_migration';

export interface KSwarmProjectAgentSelection {
  poAgent: { agentId: string; source: KSwarmAgentSelectionSource };
  members: Array<{ agentId: string; source: KSwarmAgentSelectionSource }>;
}

export interface CreateKSwarmProjectInput {
  name: string;
  goal: string;
  requirements?: string;
  poAgent: string;
  members?: string[];
  workFolder?: string;
  enableSummary?: boolean;
  agentSelection?: KSwarmProjectAgentSelection;
}

export interface KSwarmClientState {
  connected: boolean;
  projects: KSwarmProject[];
  agents: KSwarmAgent[];
  participants: KSwarmParticipant[];
  lastEvent: KSwarmEvent | null;
}

export interface KSwarmClientActions {
  // Project actions
  fetchProjects(): Promise<KSwarmProject[]>;
  getProjectDetail(projectId: string): Promise<KSwarmProject | null>;
  getProjectFullDetail(projectId: string): Promise<ProjectFullDetail | null>;
  createProject(input: CreateKSwarmProjectInput): Promise<KSwarmProject | null>;
  approveProject(projectId: string): Promise<boolean>;
  retryPlan(projectId: string): Promise<{ ok: boolean; retried?: boolean; poReassigned?: boolean; poAgent?: string; previousPoAgent?: string; poResolutionReason?: string } | null>;
  continueProject(projectId: string, request: ContinueProjectRequest): Promise<ContinueProjectResult | null>;
  closeProject(projectId: string): Promise<boolean>;
  deleteProject(projectId: string): Promise<boolean>;
  deliverProject(projectId: string): Promise<boolean>;
  startProjectDiagnoseWorkflow(projectId: string): Promise<KSwarmWorkflowRun | null>;
  startProjectAgentReviewSmokeWorkflow(projectId: string): Promise<KSwarmWorkflowRun | null>;
  // Task actions
  humanAddTasks(projectId: string, tasks: Array<{ title: string; description?: string }>): Promise<boolean>;
  createTasks(projectId: string, tasks: Array<{ title: string; description?: string; phase?: number }>): Promise<boolean>;
  dispatchTasks(projectId: string, fromAgent?: string): Promise<{ dispatched: string[] } | null>;
  markTaskDone(projectId: string, taskId: string, fromAgent?: string): Promise<boolean>;
  cancelTask(projectId: string, taskId: string): Promise<boolean>;
  taskFailed(projectId: string, taskId: string, failureReason?: string, errorMessage?: string): Promise<{ ok: boolean; retried?: boolean; retryTaskId?: string; attempt?: number; failureReason?: string } | null>;
  // Agent actions
  fetchAgents(): Promise<KSwarmAgent[]>;
  fetchParticipants(): Promise<KSwarmParticipant[]>;
  createAgent(input: CreateAgentInput): Promise<KSwarmAgent | null>;
  updateAgent(id: string, input: Partial<CreateAgentInput>): Promise<KSwarmAgent | null>;
  archiveAgent(id: string): Promise<boolean>;
  startAgent(id: string): Promise<boolean>;
  stopAgent(id: string): Promise<boolean>;
  probeAgent(id: string): Promise<AgentProbe | null>;
  fetchLiveness(): Promise<Record<string, { lastSeen: number | null; online: boolean; status: string }>>;
  pingHeartbeat(agentId: string): Promise<boolean>;
  // Runtime & provider discovery
  fetchRuntimes(): Promise<Array<{ type: string; displayName: string; description: string; detected: boolean; path: string | null }>>;
  fetchLlmProviders(): Promise<string[]>;
}

export interface ProjectFullDetail {
  project: KSwarmProject & { workFolder?: string; requirements?: string; plan?: any; deliveredAt?: string; deliverable?: any; closedAt?: string };
  tasks: KSwarmTask[];
  activities: KSwarmActivityEvent[];
  humanActions: KSwarmHumanAction[];
  workspace: { path: string; custom?: boolean; artifacts?: string[] };
  plan: any | null;
  planProgress: { phases: Array<{ phaseId: string | number; total: number; done: number }>; total: number; done: number } | null;
  dispatchPlan?: {
    dispatchedTasks?: Array<{
      id?: string;
      taskId?: string;
      title?: string;
      status?: string;
      agentId?: string;
      assignedAgent?: string;
      reason?: string;
      blockKind?: string | null;
      activeRunId?: string | null;
    }>;
    dispatchable?: Array<{ taskId: string; agentId?: string; reason?: string }>;
    blocked?: Array<{ taskId: string; reason: string; blockedByTaskId?: string }>;
    waiting?: Array<{ taskId: string; reason: string; agentId?: string }>;
  };
  projectHealth?: {
    status?: 'healthy' | 'running' | 'waiting' | 'needs_review' | 'blocked' | 'failed' | 'unknown';
    state?: 'idle' | 'healthy' | 'running' | 'dispatchable' | 'waiting' | 'needs_review' | 'blocked' | 'failed' | 'complete' | 'closed' | 'unknown';
    gate?: string | null;
    counts?: Record<string, number>;
    reasons?: Array<{ taskId?: string; message?: string; nextActions?: unknown[] }>;
    primaryBlockedTaskId?: string;
    message?: string;
    actions?: Array<{ id: string; label: string; recommended?: boolean }>;
  };
  projectIntervention?: ProjectIntervention | null;
  workflowRuns?: KSwarmWorkflowRun[];
}

export type KSwarmWorkflowRunStatus =
  | 'awaiting_approval'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type KSwarmWorkflowNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface KSwarmWorkflowRun {
  id: string;
  projectId: string;
  workflowId: 'project-diagnose' | string;
  title: string;
  strategy: 'workflow';
  source: 'builtin' | string;
  status: KSwarmWorkflowRunStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  cancelledAt?: number | null;
  requestedBy?: string | null;
  approval?: {
    required: boolean;
    status: 'not_required' | 'pending' | 'approved' | 'rejected' | string;
    budget?: { maxAgents?: number; maxUsd?: number; maxMinutes?: number } | null;
    approvedBy?: string | null;
    decidedAt?: number | null;
  };
  phases: Array<{ id: string; title: string; status: KSwarmWorkflowNodeStatus; nodeIds: string[] }>;
  nodes: KSwarmWorkflowNode[];
  summary: {
    total: number;
    completed: number;
    failed: number;
    blocked: number;
    running: number;
    pending: number;
    progress: number;
    primaryMessage?: string | null;
  };
  diagnosis?: KSwarmWorkflowDiagnosis | null;
  gateDecision?: KSwarmWorkflowReviewDecision | null;
}

export interface KSwarmWorkflowNode {
  id: string;
  phaseId: string;
  title: string;
  status: KSwarmWorkflowNodeStatus;
  kind: 'control' | 'review' | 'agent_task' | string;
  dependsOn: string[];
  assignedAgent?: string | null;
  attempt?: number;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  reviewDecision?: KSwarmWorkflowReviewDecision | null;
  runtime?: {
    handoffId?: string;
    runId?: string;
    participantId?: string;
    lastProgressAt?: number;
  } | null;
  producerAgent?: string | null;
  error?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface KSwarmWorkflowReviewDecision {
  status: 'passed' | 'needs_rework' | 'blocked' | string;
  reason: string;
  evidenceRefs?: string[];
}

export interface KSwarmWorkflowDiagnosis {
  healthState?: string | null;
  gate?: string | null;
  blockedTasks: Array<{ taskId?: string; message?: string }>;
  dispatchableCount: number;
  waitingCount: number;
  recommendedActions: Array<{ id: string; label: string; reason: string }>;
}

export interface ProjectIntervention {
  required: boolean;
  severity?: 'normal' | 'warning' | 'action_required' | string;
  projectId?: string | null;
  reason?: string;
  headline?: string | null;
  message?: string;
  primaryTaskId?: string | null;
  primaryTaskTitle?: string | null;
  lastEventAt?: number | string | null;
  downstreamBlockedCount?: number;
  primaryFailure?: {
    reason?: string | null;
    feedback?: string;
    assignedAgent?: string | null;
    status?: string | null;
    qualityFailureCount?: number;
  } | null;
  primaryAction?: {
    id: 'continue_project' | string;
    label: string;
    strategy?: string;
    taskId?: string;
    taskUpdatedAt?: number | string | null;
  } | null;
  secondaryAction?: {
    id: 'ask_xiaok' | string;
    label: string;
    context?: Record<string, unknown>;
  } | null;
}

export interface ContinueProjectRequest {
  expectedPrimaryTaskId?: string;
  expectedTaskUpdatedAt?: number | string | null;
  idempotencyKey: string;
}

export interface ContinueProjectResult {
  ok: boolean;
  action?: 'continue_project' | string;
  strategy?: string | null;
  outcome?: 'advanced' | 'submitted_for_review' | 'needs_user_action' | 'not_advanced' | string;
  projectChanged?: boolean;
  humanActionRequired?: boolean;
  error?: string;
  status?: number;
  dispatched?: string[];
  idempotent?: boolean;
  xiaokContext?: Record<string, unknown>;
  nextActions?: Array<{
    id: string;
    label?: string;
    description?: string;
    toolName?: string;
    params?: Record<string, unknown>;
  }>;
  reviewNotification?: 'sent' | 'failed' | 'not_available' | string;
  reviewNotificationError?: string;
  reviewNotificationNeeded?: boolean;
}

// ─── Principles Injection ────────────────────────────────────────

interface PrincipleEntry {
  id: string;
  content: string;
  scenarios: string[];
  enabled: boolean;
  createdAt: number;
}

export function buildCreateProjectPlanningGuidance(input: {
  goal: string;
  requirements?: string;
  principles?: PrincipleEntry[];
}): { visibleRequirements: string; planningGuidance: string } {
  const visibleRequirements = input.requirements || '';
  const blocks = [
    inferRendererPlanningGuidance(`${input.goal || ''}\n${visibleRequirements}`),
    formatPrinciplesForPlanningGuidance(input.principles || []),
  ].filter(Boolean);
  return {
    visibleRequirements,
    planningGuidance: blocks.join('\n\n'),
  };
}

function inferRendererPlanningGuidance(text: string): string {
  const value = String(text || '');
  const explicitMarkdown = /(\.md\b|\.markdown\b|\bmarkdown\b)/i.test(value);
  const explicitPptx = /(\.pptx\b|\bpptx\b|\bpowerpoint\b|\bppt\s*(文件|file|deck)?\b)/i.test(value);
  const slide = /(幻灯片|演示文稿|slide deck|slides|presentation)/i.test(value);
  const report = /(报告|\breport\b)/i.test(value);
  const analysisReport = !report && isAnalysisReportLikeProject(value);

  if (slide && explicitPptx) {
    return [
      '输出意图：用户明确要求演示文稿/幻灯片交付 PPTX。',
      '不要改写用户目标或项目要求；计划中细化为最终任务生成 PPTX 文件。',
      '前序内容任务可以产出素材或草稿，但最终交付物必须符合用户明确格式。',
    ].join('\n');
  }
  if (slide && !explicitPptx) {
    return [
      '输出意图：用户要演示文稿/幻灯片。',
      '计划中必须安排最终任务使用 slide renderer 生成 HTML deck；不要默认改成 PPTX。',
      '前序内容任务可以产出素材或草稿，但最终交付物必须是 slide renderer HTML。',
    ].join('\n');
  }
  if (report && explicitMarkdown) {
    return [
      '输出意图：用户明确要求报告交付 Markdown。',
      '不要改写用户目标或项目要求；计划中细化为最终任务生成 Markdown 报告。',
      '前序研究/写作任务可以产出素材或草稿，但最终交付物必须符合用户明确格式。',
    ].join('\n');
  }
  if ((report || analysisReport) && !explicitMarkdown) {
    return [
      analysisReport
        ? '输出意图：用户要分析/研究类交付物，默认按报告交付；最终任务必须使用 report renderer 生成 HTML 报告。'
        : '输出意图：用户要报告，最终任务必须使用 report renderer 生成 HTML 报告。',
      '不要把用户目标改写为其他交付格式。',
      '前序研究/写作任务可以产出素材或中间 Markdown，但最终交付物必须是 report renderer HTML。',
    ].join('\n');
  }
  return '';
}

function isAnalysisReportLikeProject(text: string): boolean {
  const analysis = /(分析|研究|调研|评估|研判|洞察|复盘|\banalysis\b|\bresearch\b|\bassessment\b|\bbrief\b)/i.test(text);
  const deliverableCue = /(高层|管理层|决策|战略|研发|产品|竞品|市场|行业|趋势|动态|情况|内容|汇报|材料|交付|leadership|executive|strategy|market|industry|trend|product|competitive)/i.test(text);
  return analysis && deliverableCue;
}

function formatPrinciplesForPlanningGuidance(principles: PrincipleEntry[]): string {
  // Filter: enabled + planning or execution scenarios (Phase 1: only createProject)
  const matched = principles.filter(
    p => p.enabled && (p.scenarios.includes('planning') || p.scenarios.includes('execution'))
  );
  if (matched.length === 0) return '';

  // Format lines: collapse multiline, escape ## headings
  const lines: string[] = [];
  let totalLen = 0;
  for (let i = 0; i < matched.length; i++) {
    const content = matched[i].content.replace(/\n/g, '；').replace(/^## /gm, '> ## ');
    const line = `${i + 1}. ${content}`;
    if (totalLen + line.length > 3000) break;
    lines.push(line);
    totalLen += line.length;
  }

  const truncateNote = lines.length < matched.length
    ? `\n\n（共 ${matched.length} 条原则，已展示前 ${lines.length} 条）`
    : '';

  const block = lines.join('\n');
  return `知识与规则（系统规划指导，不写入用户可见要求）：\n${block}${truncateNote}`;
}

// ─── HTTP Helpers ─────────────────────────────────────────────────

async function httpGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function httpPost<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function httpPostJson<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!data) return null;
    return { ...data, status: data.status ?? res.status } as T;
  } catch {
    return null;
  }
}

async function httpPut<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function httpDelete(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useKSwarmClient(): KSwarmClientState & KSwarmClientActions {
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<KSwarmProject[]>([]);
  const [agents, setAgents] = useState<KSwarmAgent[]>([]);
  const [participants, setParticipants] = useState<KSwarmParticipant[]>([]);
  const [lastEvent, setLastEvent] = useState<KSwarmEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const connectedRef = useRef(false);

  // ─── WebSocket Connection ─────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        connectedRef.current = true;
        reconnectAttemptsRef.current = 0;
        // Fetch initial state
        fetchProjects();
        fetchAgents();
        fetchParticipants();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleWsMessage(msg);
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        connectedRef.current = false;
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      scheduleReconnect();
    }
  }, []);

  function scheduleReconnect() {
    if (reconnectTimer.current) return;
    const delay = Math.min(RECONNECT_DELAY * 2 ** reconnectAttemptsRef.current, MAX_RECONNECT_DELAY);
    reconnectAttemptsRef.current++;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      connect();
    }, delay);
  }

  function handleWsMessage(msg: KSwarmEvent) {
    setLastEvent(msg);

    // Refresh project list on relevant events
    const refreshEvents = [
      'project_created', 'project_approved', 'project_closed', 'project_deliverable',
      'tasks_created', 'tasks_dispatched', 'task_done', 'task_failed', 'task_retry',
      'task_update', 'task_reviewed', 'task_cancelled', 'task_rework',
      'plan_submitted', 'plan_revised', 'project_continue',
    ];
    if (msg.type && refreshEvents.includes(msg.type)) {
      fetchProjects();
    }
    if (msg.type === 'agent_created' || msg.type === 'agent_updated' || msg.type === 'agent_archived' || msg.type === 'agent_started' || msg.type === 'agent_stopped') {
      fetchAgents();
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  useEffect(() => {
    connect();

    // Poll participants periodically (only when connected)
    pollTimer.current = setInterval(() => {
      if (connectedRef.current) fetchParticipants();
    }, PARTICIPANT_POLL_INTERVAL);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [connect]);

  // ─── Project Actions ──────────────────────────────────────────

  const fetchProjects = useCallback(async (): Promise<KSwarmProject[]> => {
    const data = await httpGet<{ projects: KSwarmProject[] }>('/projects');
    const list = data?.projects || [];
    setProjects(list);
    return list;
  }, []);

  const getProjectDetail = useCallback(async (projectId: string): Promise<KSwarmProject | null> => {
    return await httpGet<KSwarmProject>(`/projects/${projectId}`);
  }, []);

  const getProjectFullDetail = useCallback(async (projectId: string): Promise<ProjectFullDetail | null> => {
    return await httpGet<ProjectFullDetail>(`/projects/${projectId}`);
  }, []);

  const createProject = useCallback(async (input: CreateKSwarmProjectInput): Promise<KSwarmProject | null> => {
    let principles: PrincipleEntry[] = [];
    try {
      const api = (window as any).xiaokDesktop;
      if (api?.listPrinciples) {
        const loaded = await api.listPrinciples();
        if (Array.isArray(loaded)) principles = loaded;
      }
    } catch (e) {
      console.warn('[principles] Failed to load principles for planning guidance, using original requirements', e);
    }
    const guidance = buildCreateProjectPlanningGuidance({
      goal: input.goal,
      requirements: input.requirements || '',
      principles,
    });
    const result = await httpPost<KSwarmProject>('/projects', {
      ...input,
      requirements: guidance.visibleRequirements || undefined,
      planningGuidance: guidance.planningGuidance || undefined,
      enableSummary: input.enableSummary ?? true,
    });
    if (result) fetchProjects();
    return result;
  }, [fetchProjects]);

  const approveProject = useCallback(async (projectId: string): Promise<boolean> => {
    const result = await httpPost<{ ok: boolean }>(`/projects/${projectId}/approve`);
    if (result?.ok) fetchProjects();
    return !!result?.ok;
  }, [fetchProjects]);

  const retryPlan = useCallback(async (projectId: string) => {
    return httpPost<{ ok: boolean; retried?: boolean; poReassigned?: boolean; poAgent?: string; previousPoAgent?: string; poResolutionReason?: string }>(`/projects/${projectId}/retry-plan`, {});
  }, []);

  const continueProject = useCallback(async (projectId: string, request: ContinueProjectRequest): Promise<ContinueProjectResult | null> => {
    const result = await httpPostJson<ContinueProjectResult>(`/projects/${projectId}/continue`, request);
    if (result?.ok) fetchProjects();
    return result;
  }, [fetchProjects]);

  const closeProject = useCallback(async (projectId: string): Promise<boolean> => {
    const result = await httpPost<{ ok: boolean }>(`/projects/${projectId}/close`);
    if (result?.ok) fetchProjects();
    return !!result?.ok;
  }, [fetchProjects]);

  const deleteProject = useCallback(async (projectId: string): Promise<boolean> => {
    const ok = await httpDelete(`/projects/${projectId}`);
    if (ok) fetchProjects();
    return ok;
  }, [fetchProjects]);

  const deliverProject = useCallback(async (projectId: string): Promise<boolean> => {
    const result = await httpPost<{ ok: boolean }>(`/projects/${projectId}/deliver`, {});
    if (result?.ok) fetchProjects();
    return !!result?.ok;
  }, [fetchProjects]);

  const startProjectDiagnoseWorkflow = useCallback(async (projectId: string): Promise<KSwarmWorkflowRun | null> => {
    const result = await httpPost<{ ok: boolean; workflowRun?: KSwarmWorkflowRun }>(`/projects/${projectId}/workflows/project-diagnose`, {
      requestedBy: 'human',
    });
    if (result?.ok) fetchProjects();
    return result?.workflowRun || null;
  }, [fetchProjects]);

  const startProjectAgentReviewSmokeWorkflow = useCallback(async (projectId: string): Promise<KSwarmWorkflowRun | null> => {
    const result = await httpPost<{ ok: boolean; workflowRun?: KSwarmWorkflowRun }>(`/projects/${projectId}/workflows/agent-review-smoke`, {
      requestedBy: 'human',
    });
    if (result?.ok) fetchProjects();
    return result?.workflowRun || null;
  }, [fetchProjects]);

  // ─── Task Actions ─────────────────────────────────────────────

  const humanAddTasks = useCallback(async (projectId: string, tasks: Array<{ title: string; description?: string }>): Promise<boolean> => {
    const result = await httpPost<{ ok: boolean }>(`/projects/${projectId}/tasks`, { tasks });
    return !!result?.ok;
  }, []);

  const createTasks = useCallback(async (projectId: string, tasks: Array<{ title: string; description?: string; phase?: number }>): Promise<boolean> => {
    const result = await httpPost<{ ok: boolean }>(`/projects/${projectId}/tasks`, { tasks });
    return !!result?.ok;
  }, []);

  const dispatchTasks = useCallback(async (projectId: string, fromAgent?: string): Promise<{ dispatched: string[] } | null> => {
    return await httpPost<{ dispatched: string[] }>(`/projects/${projectId}/dispatch`, { fromAgent });
  }, []);

  const markTaskDone = useCallback(async (projectId: string, taskId: string, fromAgent?: string): Promise<boolean> => {
    const res = await httpPost<{ ok: boolean }>(`/projects/${projectId}/tasks/${taskId}/done`, { fromAgent });
    return !!res?.ok;
  }, []);

  const cancelTask = useCallback(async (projectId: string, taskId: string): Promise<boolean> => {
    const res = await httpPost<{ ok: boolean }>(`/projects/${projectId}/tasks/${taskId}/cancel`);
    return !!res?.ok;
  }, []);

  const taskFailed = useCallback(async (projectId: string, taskId: string, failureReason?: string, errorMessage?: string) => {
    return await httpPost<{ ok: boolean; retried?: boolean; retryTaskId?: string; attempt?: number; failureReason?: string }>(
      `/projects/${projectId}/tasks/${taskId}/fail`,
      { failureReason, errorMessage },
    );
  }, []);

  // ─── Agent Actions ────────────────────────────────────────────

  const fetchAgents = useCallback(async (): Promise<KSwarmAgent[]> => {
    const data = await httpGet<{ agents: KSwarmAgent[] }>('/agents');
    const list = data?.agents || [];
    setAgents(list);
    return list;
  }, []);

  const fetchParticipants = useCallback(async (): Promise<KSwarmParticipant[]> => {
    const data = await httpGet<{ participants: KSwarmParticipant[] }>('/participants');
    const list = data?.participants || [];
    setParticipants(list);
    return list;
  }, []);

  const createAgent = useCallback(async (input: CreateAgentInput): Promise<KSwarmAgent | null> => {
    const result = await httpPost<KSwarmAgent>('/agents', input);
    if (result) fetchAgents();
    return result;
  }, [fetchAgents]);

  const updateAgent = useCallback(async (id: string, input: Partial<CreateAgentInput>): Promise<KSwarmAgent | null> => {
    const result = await httpPut<KSwarmAgent>(`/agents/${id}`, input);
    if (result) fetchAgents();
    return result;
  }, [fetchAgents]);

  const archiveAgent = useCallback(async (id: string): Promise<boolean> => {
    const ok = await httpDelete(`/agents/${id}`);
    if (ok) fetchAgents();
    return ok;
  }, [fetchAgents]);

  const startAgent = useCallback(async (id: string): Promise<boolean> => {
    const result = await httpPost<{ ok: boolean }>(`/agents/${id}/start`);
    if (result?.ok) fetchAgents();
    return !!result?.ok;
  }, [fetchAgents]);

  const stopAgent = useCallback(async (id: string): Promise<boolean> => {
    const result = await httpPost<{ ok: boolean }>(`/agents/${id}/stop`);
    if (result?.ok) fetchAgents();
    return !!result?.ok;
  }, [fetchAgents]);

  const probeAgent = useCallback(async (id: string): Promise<AgentProbe | null> => {
    return await httpGet<AgentProbe>(`/agents/${id}/probe`);
  }, []);

  const fetchLiveness = useCallback(async () => {
    const data = await httpGet<{ liveness: Record<string, { lastSeen: number | null; online: boolean; status: string }> }>('/agents/liveness');
    return data?.liveness || {};
  }, []);

  const pingHeartbeat = useCallback(async (agentId: string): Promise<boolean> => {
    const res = await httpPost<{ ok: boolean }>('/agents/heartbeat', { agentId });
    return !!res?.ok;
  }, []);

  const fetchRuntimes = useCallback(async () => {
    const data = await httpGet<{ runtimes: Array<{ type: string; displayName: string; description: string; detected: boolean; path: string | null }> }>('/runtimes');
    return data?.runtimes || [];
  }, []);

  const fetchLlmProviders = useCallback(async () => {
    const data = await httpGet<{ providers: string[] }>('/llm/providers');
    return data?.providers || [];
  }, []);

  return {
    // State
    connected,
    projects,
    agents,
    participants,
    lastEvent,
    // Project actions
    fetchProjects,
    getProjectDetail,
    getProjectFullDetail,
    createProject,
    approveProject,
    retryPlan,
    continueProject,
    closeProject,
    deleteProject,
    deliverProject,
    startProjectDiagnoseWorkflow,
    startProjectAgentReviewSmokeWorkflow,
    // Task actions
    humanAddTasks,
    createTasks,
    dispatchTasks,
    markTaskDone,
    cancelTask,
    taskFailed,
    // Agent actions
    fetchAgents,
    fetchParticipants,
    createAgent,
    updateAgent,
    archiveAgent,
    startAgent,
    stopAgent,
    probeAgent,
    fetchLiveness,
    pingHeartbeat,
    fetchRuntimes,
    fetchLlmProviders,
  };
}
