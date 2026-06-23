import dagre from '@dagrejs/dagre';
import type { ProjectFullDetail, KSwarmWorkflowRun, KSwarmWorkflowNode, KSwarmWorkflowNodeStatus, KSwarmTask } from '../../hooks/useKSwarmClient';

export type DagNodeStatus =
  | 'pending' | 'ready' | 'running' | 'awaiting_review'
  | 'done' | 'failed' | 'blocked' | 'cancelled' | 'unknown';

export interface DagNode {
  id: string;
  title: string;
  status: DagNodeStatus;
  kind: 'task' | 'workflow_node';
  agentName?: string;
  errorMessage?: string;
  taskId?: string;
  workflowNodeId?: string;
  hasTaskWorkflow?: boolean;
}

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  kind: 'depends_on' | 'blocked_by';
}

export interface DagGraph {
  nodes: DagNode[];
  edges: DagEdge[];
  source: 'workflow' | 'task_board';
  partial: boolean;
  emptyReason?: 'no_tasks' | 'task_board_no_deps' | 'workflow_not_started' | 'too_large';
}

export const GRAPH_NODE_LIMIT = 200;

export const STATUS_STYLE: Record<DagNodeStatus, { bg: string; border: string }> = {
  pending: { bg: 'var(--c-graph-node-pending-bg)', border: 'var(--c-graph-node-pending-border)' },
  ready: { bg: 'var(--c-bg-card)', border: 'var(--c-graph-node-ready-border)' },
  running: { bg: 'var(--c-graph-node-running-bg)', border: 'var(--c-graph-node-running-border)' },
  awaiting_review: { bg: 'var(--c-graph-node-review-bg)', border: 'var(--c-graph-node-review-border)' },
  done: { bg: 'var(--c-bg-card)', border: 'var(--c-graph-node-done-border)' },
  failed: { bg: 'var(--c-graph-node-failed-bg)', border: 'var(--c-graph-node-failed-border)' },
  blocked: { bg: 'var(--c-graph-node-blocked-bg)', border: 'var(--c-graph-node-blocked-border)' },
  cancelled: { bg: 'var(--c-bg-card)', border: 'var(--c-graph-node-cancelled-border)' },
  unknown: { bg: 'var(--c-bg-card)', border: 'var(--c-text-muted)' },
};

function mapWorkflowStatus(s: KSwarmWorkflowNodeStatus | string): DagNodeStatus {
  switch (s) {
    case 'pending': return 'pending';
    case 'ready': return 'ready';
    case 'running': return 'running';
    case 'completed': return 'done';
    case 'failed': return 'failed';
    case 'blocked': return 'blocked';
    case 'cancelled': return 'cancelled';
    default:
      console.warn('[dagGraph] unknown workflow status', s);
      return 'unknown';
  }
}

function mapTaskStatus(s: KSwarmTask['status']): DagNodeStatus {
  switch (s) {
    case 'pending': return 'pending';
    case 'dispatched':
    case 'accepted':
    case 'in_progress': return 'running';
    case 'submitted':
    case 'review': return 'awaiting_review';
    case 'done': return 'done';
    case 'failed': return 'failed';
    case 'blocked': return 'blocked';
    case 'cancelled': return 'cancelled';
    default:
      console.warn('[dagGraph] unknown task status', s);
      return 'unknown';
  }
}

function pickPrimaryWorkflowRun(runs?: KSwarmWorkflowRun[]): KSwarmWorkflowRun | undefined {
  if (!runs?.length) return undefined;
  const projectLevel = runs.filter(r => !r.scope?.taskId);
  if (projectLevel.length === 0) return undefined;
  const running = projectLevel.find(r => r.status === 'running');
  if (running) return running;
  return [...projectLevel].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
}

function buildFromWorkflowRun(run: KSwarmWorkflowRun): DagGraph {
  const nodeMap = new Map<string, KSwarmWorkflowNode>();
  for (const n of run.nodes) {
    if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
  }
  const nodeIds = new Set(nodeMap.keys());

  const nodes: DagNode[] = Array.from(nodeMap.values()).map(n => ({
    id: n.id,
    title: n.title,
    status: mapWorkflowStatus(n.status),
    kind: 'workflow_node' as const,
    agentName: n.assignedAgent || n.producerAgent || undefined,
    errorMessage: typeof n.error === 'string' ? n.error : undefined,
    workflowNodeId: n.id,
  }));

  const edgeSet = new Set<string>();
  const edges: DagEdge[] = [];
  for (const n of nodeMap.values()) {
    for (const dep of (n.dependsOn ?? [])) {
      if (!nodeIds.has(dep) || dep === n.id) continue;
      const id = `${dep}->${n.id}`;
      if (edgeSet.has(id)) continue;
      edgeSet.add(id);
      edges.push({ id, source: dep, target: n.id, kind: 'depends_on' });
    }
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));

  if (nodes.length > GRAPH_NODE_LIMIT) {
    return { nodes: [], edges: [], source: 'workflow', partial: false, emptyReason: 'too_large' };
  }
  return { nodes, edges, source: 'workflow', partial: false };
}

function buildFromTaskBoard(tasks: KSwarmTask[], dispatchPlan?: ProjectFullDetail['dispatchPlan']): DagGraph {
  const nodeIds = new Set(tasks.map(t => t.id));
  const nodes: DagNode[] = tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: mapTaskStatus(t.status),
    kind: 'task' as const,
    agentName: t.assignedAgent || undefined,
    errorMessage: t.failureReason || t.blockedReason || undefined,
    taskId: t.id,
    hasTaskWorkflow: t.execution?.strategy === 'workflow',
  }));

  const edgeSet = new Set<string>();
  const edges: DagEdge[] = [];
  for (const b of (dispatchPlan?.blocked ?? [])) {
    if (!b.blockedByTaskId || !nodeIds.has(b.blockedByTaskId) || !nodeIds.has(b.taskId)) continue;
    if (b.blockedByTaskId === b.taskId) continue;
    const id = `${b.blockedByTaskId}->${b.taskId}`;
    if (edgeSet.has(id)) continue;
    edgeSet.add(id);
    edges.push({ id, source: b.blockedByTaskId, target: b.taskId, kind: 'blocked_by' });
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));

  if (nodes.length > GRAPH_NODE_LIMIT) {
    return { nodes: [], edges: [], source: 'task_board', partial: true, emptyReason: 'too_large' };
  }
  return {
    nodes,
    edges,
    source: 'task_board',
    partial: true,
    emptyReason: edges.length === 0 ? 'task_board_no_deps' : undefined,
  };
}

export function buildDagFromProject(detail: ProjectFullDetail): DagGraph {
  const tasks = detail.tasks ?? [];
  if (tasks.length === 0) {
    return { nodes: [], edges: [], source: 'task_board', partial: true, emptyReason: 'no_tasks' };
  }

  const primaryRun = pickPrimaryWorkflowRun(detail.workflowRuns);
  if (primaryRun && (primaryRun.nodes?.length ?? 0) > 0) {
    return buildFromWorkflowRun(primaryRun);
  }

  return buildFromTaskBoard(tasks, detail.dispatchPlan);
}

export interface LayoutedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: DagNode;
}

export interface LayoutedEdge {
  id: string;
  source: string;
  target: string;
  animated: boolean;
  style: Record<string, string | number>;
  markerEnd: { type: string; color?: string };
}

export function layoutWithDagre(graph: DagGraph): { nodes: LayoutedNode[]; edges: LayoutedEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 60, acyclicer: 'greedy' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) g.setNode(n.id, { width: 220, height: 80 });
  for (const e of graph.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  return {
    nodes: graph.nodes.map(n => {
      const pos = g.node(n.id);
      return {
        id: n.id,
        type: 'dag',
        position: { x: pos.x - 110, y: pos.y - 40 },
        data: n,
      };
    }),
    edges: graph.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: false,
      style: e.kind === 'blocked_by'
        ? { stroke: 'var(--c-graph-edge-blocked)', strokeWidth: 1.5 }
        : { stroke: 'var(--c-graph-edge-depends)' },
      markerEnd: e.kind === 'blocked_by'
        ? { type: 'arrowclosed', color: 'var(--c-graph-edge-blocked)' }
        : { type: 'arrow' },
    })),
  };
}
