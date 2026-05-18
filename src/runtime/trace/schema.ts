export type TraceSourceApp = 'xiaok-cli' | 'xiaok-desktop' | 'kswarm';
export type TraceScopeKind = 'session' | 'project' | 'task';
export type TraceEventSource = 'cli' | 'desktop' | 'kswarm' | 'tool' | 'memory' | 'skill' | 'guard' | 'diagnoser';
export type TraceSeverity = 'debug' | 'info' | 'warn' | 'error';

export interface TraceEvent {
  id: string;
  ts: string;
  source: TraceEventSource;
  type: string;
  severity?: TraceSeverity;
  message?: string;
  refs?: {
    turnId?: string;
    toolCallId?: string;
    taskId?: string;
    agentId?: string;
    artifactId?: string;
    memoryId?: string;
  };
  data?: Record<string, unknown>;
}

export interface TraceToolCall {
  id: string;
  turnId?: string;
  name: string;
  inputPreview: string;
  redactedInputSha256?: string;
  outputPreview?: string;
  redactedOutputSha256?: string;
  outputBytes?: number;
  persistedOutputPath?: string;
  startedAt: string;
  endedAt?: string;
  ok?: boolean;
  errorClass?: string;
  permission?: 'safe' | 'requires_approval' | 'denied';
}

export interface TraceTask {
  id: string;
  title: string;
  status: string;
  assignedAgent?: string;
  dependencies?: string[];
  phase?: string | number;
  dispatchState?: string;
  failureClass?: string;
  failureCount?: number;
  blockedReason?: string;
  evidenceContract?: string;
  artifacts?: string[];
}

export interface TraceAgent {
  id: string;
  name?: string;
  status: string;
  currentTask?: string;
}

export interface TraceArtifact {
  id: string;
  path: string;
  kind?: string;
  bytes?: number;
  sha256?: string;
  createdBy?: {
    toolCallId?: string;
    taskId?: string;
    agentId?: string;
  };
  existsAtExport: boolean;
  protected?: boolean;
}

export interface TraceRedaction {
  type: string;
  fieldPath?: string;
  count: number;
}

export interface TraceBundleV1 {
  schemaVersion: 1;
  bundleId: string;
  createdAt: string;
  source: {
    app: TraceSourceApp;
    version?: string;
    platform?: string;
    command?: string;
  };
  scope: {
    kind: TraceScopeKind;
    sessionId?: string;
    projectId?: string;
    taskId?: string;
    workspaceRoot?: string;
  };
  environment: Record<string, unknown>;
  turns: Array<{ id: string; role?: string; ts?: string }>;
  events: TraceEvent[];
  toolCalls: TraceToolCall[];
  approvals: Array<Record<string, unknown>>;
  tasks: TraceTask[];
  agents: TraceAgent[];
  artifacts: TraceArtifact[];
  memoryRefs: Array<Record<string, unknown>>;
  skillEvidence: Array<Record<string, unknown>>;
  recovery: Array<Record<string, unknown>>;
  crashes: Array<Record<string, unknown>>;
  redactions: TraceRedaction[];
  attachments: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
}

const TASK_STATUSES = new Set([
  'pending',
  'dispatched',
  'accepted',
  'in_progress',
  'submitted',
  'review',
  'done',
  'failed',
  'blocked',
  'cancelled',
]);

const AGENT_STATUSES = new Set([
  'idle',
  'waiting',
  'working',
  'blocked',
  'failed',
  'error',
  'completed',
  'offline',
]);

export function validateTraceBundle(input: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const bundle = isRecord(input) ? input : {};

  if (typeof bundle.bundleId !== 'string' || bundle.bundleId.length === 0) errors.push('bundleId');
  if (!isRecord(bundle.source) || typeof bundle.source.app !== 'string') errors.push('source.app');
  if (!isRecord(bundle.scope) || typeof bundle.scope.kind !== 'string') errors.push('scope.kind');

  const events = Array.isArray(bundle.events) ? bundle.events : [];
  const tasks = Array.isArray(bundle.tasks) ? bundle.tasks : [];
  const agents = Array.isArray(bundle.agents) ? bundle.agents : [];
  const toolCalls = Array.isArray(bundle.toolCalls) ? bundle.toolCalls : [];
  const artifacts = Array.isArray(bundle.artifacts) ? bundle.artifacts : [];

  const eventIds = new Set<string>();
  const taskIds = new Set(tasks.map((task) => isRecord(task) ? String(task.id) : ''));
  const agentIds = new Set(agents.map((agent) => isRecord(agent) ? String(agent.id) : ''));
  const toolCallIds = new Set(toolCalls.map((toolCall) => isRecord(toolCall) ? String(toolCall.id) : ''));
  const artifactIds = new Set(artifacts.map((artifact) => isRecord(artifact) ? String(artifact.id) : ''));

  tasks.forEach((task, index) => {
    if (!isRecord(task)) return;
    const status = task.status;
    if (typeof status === 'string' && !TASK_STATUSES.has(status)) {
      errors.push(`tasks[${index}].status:${status}`);
    }
  });

  agents.forEach((agent, index) => {
    if (!isRecord(agent)) return;
    const status = agent.status;
    if (typeof status === 'string' && !AGENT_STATUSES.has(status)) {
      errors.push(`agents[${index}].status:${status}`);
    }
  });

  events.forEach((event, index) => {
    if (!isRecord(event)) return;
    if (typeof event.id === 'string') {
      if (eventIds.has(event.id)) errors.push(`events[${index}].id:duplicate`);
      eventIds.add(event.id);
    }
    if (typeof event.ts === 'string' && Number.isNaN(Date.parse(event.ts))) {
      errors.push(`events[${index}].ts:invalid`);
    }
    if (isRecord(event.refs)) {
      if (typeof event.refs.taskId === 'string' && !taskIds.has(event.refs.taskId)) {
        errors.push(`events[${index}].refs.taskId:${event.refs.taskId}`);
      }
      if (typeof event.refs.agentId === 'string' && !agentIds.has(event.refs.agentId)) {
        errors.push(`events[${index}].refs.agentId:${event.refs.agentId}`);
      }
      if (typeof event.refs.toolCallId === 'string' && !toolCallIds.has(event.refs.toolCallId)) {
        errors.push(`events[${index}].refs.toolCallId:${event.refs.toolCallId}`);
      }
      if (typeof event.refs.artifactId === 'string' && !artifactIds.has(event.refs.artifactId)) {
        errors.push(`events[${index}].refs.artifactId:${event.refs.artifactId}`);
      }
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
