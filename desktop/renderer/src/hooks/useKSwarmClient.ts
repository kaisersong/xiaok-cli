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
  phase?: number;
  priority?: number;
  planItemId?: string;
  acceptanceCriteria?: string[];
  result?: string;
  artifacts?: KSwarmArtifact[];
  blockedReason?: string;
  failureClass?: string;
  failureCount?: number;
  qualityFailureCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface KSwarmArtifact {
  name: string;
  mimeType: string;
  path?: string;
  url?: string;
  size?: number;
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
  createdAt?: string;
  updatedAt?: string;
  progress?: number;
  deliverables?: KSwarmDeliverable[];
  enableSummary?: boolean;
  summary?: string | null;
  summaryScore?: number | null;
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
  ts?: number;
  tasks?: Array<{ title: string; assignedAgent?: string }>;
  output?: { artifacts?: KSwarmArtifact[] };
  count?: number;
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
  createProject(input: { name: string; goal: string; requirements?: string; poAgent: string; members?: string[]; workFolder?: string; enableSummary?: boolean }): Promise<KSwarmProject | null>;
  approveProject(projectId: string): Promise<boolean>;
  retryPlan(projectId: string): Promise<{ ok: boolean } | null>;
  closeProject(projectId: string): Promise<boolean>;
  deleteProject(projectId: string): Promise<boolean>;
  deliverProject(projectId: string): Promise<boolean>;
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
    dispatchable?: Array<{ taskId: string; agentId?: string; reason?: string }>;
    blocked?: Array<{ taskId: string; reason: string; blockedByTaskId?: string }>;
    waiting?: Array<{ taskId: string; reason: string; agentId?: string }>;
  };
  projectHealth?: {
    status: 'healthy' | 'running' | 'waiting' | 'blocked' | 'failed' | 'unknown';
    primaryBlockedTaskId?: string;
    message?: string;
    actions?: Array<{ id: string; label: string; recommended?: boolean }>;
  };
}

// ─── Principles Injection ────────────────────────────────────────

interface PrincipleEntry {
  id: string;
  content: string;
  scenarios: string[];
  enabled: boolean;
  createdAt: number;
}

function injectPrinciples(requirements: string, principles: PrincipleEntry[]): string {
  // Filter: enabled + planning or execution scenarios (Phase 1: only createProject)
  const matched = principles.filter(
    p => p.enabled && (p.scenarios.includes('planning') || p.scenarios.includes('execution'))
  );
  if (matched.length === 0) return requirements;

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
  const separator = requirements ? '\n\n' : '';
  return `${requirements}${separator}## 项目原则（必须遵守）\n\n以下原则适用于当前阶段，请严格遵循：\n\n${block}${truncateNote}`;
}

// ─── HTTP Helpers ─────────────────────────────────────────────────

async function httpGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
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
      'plan_submitted', 'plan_revised',
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

  const createProject = useCallback(async (input: { name: string; goal: string; requirements?: string; poAgent: string; members?: string[]; workFolder?: string; enableSummary?: boolean }): Promise<KSwarmProject | null> => {
    // Inject project principles into requirements
    let requirements = input.requirements || '';
    try {
      const api = (window as any).xiaokDesktop;
      if (api?.listPrinciples) {
        const principles = await api.listPrinciples();
        if (Array.isArray(principles) && principles.length > 0) {
          requirements = injectPrinciples(requirements, principles);
        }
      }
    } catch (e) {
      console.warn('[principles] Failed to load principles for injection, using original requirements', e);
    }
    const result = await httpPost<KSwarmProject>('/projects', { ...input, requirements: requirements || undefined, enableSummary: input.enableSummary ?? true });
    if (result) fetchProjects();
    return result;
  }, [fetchProjects]);

  const approveProject = useCallback(async (projectId: string): Promise<boolean> => {
    const result = await httpPost<{ ok: boolean }>(`/projects/${projectId}/approve`);
    if (result?.ok) fetchProjects();
    return !!result?.ok;
  }, [fetchProjects]);

  const retryPlan = useCallback(async (projectId: string) => {
    return httpPost<{ ok: boolean; retried: boolean }>(`/projects/${projectId}/retry-plan`, {});
  }, []);

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
    closeProject,
    deleteProject,
    deliverProject,
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
