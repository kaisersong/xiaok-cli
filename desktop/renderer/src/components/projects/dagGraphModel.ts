import dagre from '@dagrejs/dagre';
import type { ProjectFullDetail, KSwarmWorkflowRun, KSwarmWorkflowNode, KSwarmWorkflowNodeStatus, KSwarmTask } from '../../hooks/useKSwarmClient';

export type DagNodeStatus =
  | 'pending' | 'ready' | 'running' | 'awaiting_review'
  | 'done' | 'failed' | 'blocked' | 'cancelled' | 'unknown';

export type DagNodeKind = 'task' | 'workflow_node' | 'po_plan';

export interface DagNode {
  id: string;
  title: string;
  status: DagNodeStatus;
  kind: DagNodeKind;
  agentName?: string;
  errorMessage?: string;
  taskId?: string;
  workflowNodeId?: string;
  hasTaskWorkflow?: boolean;
  startedAt?: number | null;
  completedAt?: number | null;
  parallelGroupId?: string | null;
  pipelineStageIndex?: number | null;
  workflowNode?: KSwarmWorkflowNode;
  task?: KSwarmTask;
  poPlan?: PoPlanData;
}

export interface PoPlanData {
  analysis?: string;
  successCriteria?: string[];
  phases?: Array<{ id: string | number; name: string; itemCount?: number }>;
  poAgent?: string;
  projectGoal?: string;
}

export type DagEdgeKind = 'depends_on' | 'blocked_by' | 'inferred' | 'plan';

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  kind: DagEdgeKind;
}

export interface DagGraph {
  nodes: DagNode[];
  edges: DagEdge[];
  source: 'workflow' | 'task_board';
  partial: boolean;
  emptyReason?: 'no_tasks' | 'task_board_no_deps' | 'workflow_not_started' | 'too_large';
}

export const GRAPH_NODE_LIMIT = 200;
export const PO_PLAN_NODE_ID = '__po_plan__';

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

function nodeOrder(n: KSwarmWorkflowNode): number {
  if (typeof n.pipelineStageIndex === 'number') return n.pipelineStageIndex;
  if (typeof n.startedAt === 'number') return n.startedAt;
  return 0;
}

interface InferredEdgeSource {
  source: string;
  target: string;
  kind: DagEdgeKind;
}

function inferEdgesFromWorkflow(run: KSwarmWorkflowRun): InferredEdgeSource[] {
  const inferred: InferredEdgeSource[] = [];
  const phases = run.phases ?? [];
  const nodesById = new Map<string, KSwarmWorkflowNode>();
  for (const n of run.nodes) nodesById.set(n.id, n);

  const phaseUnits: Array<{ phaseId: string | number; entryIds: string[]; exitIds: string[] }> = [];

  if (phases.length > 0) {
    for (const phase of phases) {
      const phaseNodes = (phase.nodeIds ?? [])
        .map(id => nodesById.get(id))
        .filter((n): n is KSwarmWorkflowNode => Boolean(n));
      if (phaseNodes.length === 0) continue;

      const grouped = new Map<string | '__no_group__', KSwarmWorkflowNode[]>();
      for (const n of phaseNodes) {
        const key = n.parallelGroupId || '__no_group__';
        const list = grouped.get(key) ?? [];
        list.push(n);
        grouped.set(key, list);
      }

      type Unit = { entryIds: string[]; exitIds: string[]; order: number };
      const units: Unit[] = [];
      for (const [key, members] of grouped) {
        members.sort((a, b) => nodeOrder(a) - nodeOrder(b) || a.id.localeCompare(b.id));
        const order = nodeOrder(members[0]);
        if (key === '__no_group__') {
          for (const m of members) {
            units.push({ entryIds: [m.id], exitIds: [m.id], order: nodeOrder(m) });
          }
        } else {
          units.push({
            entryIds: members.map(m => m.id),
            exitIds: members.map(m => m.id),
            order,
          });
        }
      }
      units.sort((a, b) => a.order - b.order);

      for (let i = 0; i + 1 < units.length; i++) {
        for (const src of units[i].exitIds) {
          for (const tgt of units[i + 1].entryIds) {
            inferred.push({ source: src, target: tgt, kind: 'inferred' });
          }
        }
      }

      const phaseEntries = units.length > 0 ? units[0].entryIds : [];
      const phaseExits = units.length > 0 ? units[units.length - 1].exitIds : [];
      phaseUnits.push({ phaseId: phase.id, entryIds: phaseEntries, exitIds: phaseExits });
    }

    for (let i = 0; i + 1 < phaseUnits.length; i++) {
      for (const src of phaseUnits[i].exitIds) {
        for (const tgt of phaseUnits[i + 1].entryIds) {
          inferred.push({ source: src, target: tgt, kind: 'inferred' });
        }
      }
    }
  }

  return inferred;
}

function buildPoPlanNode(detail: ProjectFullDetail): DagNode | null {
  const plan = detail.plan;
  const project = detail.project;
  if (!plan && !project?.poAgent && !project?.goal) return null;

  const planPhases = (plan?.phases as Array<{ id: string | number; name?: string; items?: unknown[] }> | undefined) ?? [];

  return {
    id: PO_PLAN_NODE_ID,
    title: 'PO 计划',
    status: 'done',
    kind: 'po_plan',
    agentName: project?.poAgent || undefined,
    poPlan: {
      analysis: typeof plan?.analysis === 'string' ? plan.analysis : undefined,
      successCriteria: Array.isArray(plan?.successCriteria) ? plan.successCriteria : undefined,
      phases: planPhases.map(p => ({
        id: p.id,
        name: p.name || String(p.id),
        itemCount: Array.isArray(p.items) ? p.items.length : undefined,
      })),
      poAgent: project?.poAgent || undefined,
      projectGoal: project?.goal,
    },
  };
}

function attachPoPlanNode(graph: DagGraph, poNode: DagNode): DagGraph {
  if (graph.nodes.length === 0) return graph;

  const targetIds = new Set(graph.nodes.map(n => n.id));
  for (const e of graph.edges) targetIds.delete(e.target);

  if (targetIds.size === 0) return graph;

  const planEdges: DagEdge[] = Array.from(targetIds).map(target => ({
    id: `${PO_PLAN_NODE_ID}->${target}`,
    source: PO_PLAN_NODE_ID,
    target,
    kind: 'plan',
  }));

  const allNodes = [poNode, ...graph.nodes];
  const allEdges = [...planEdges, ...graph.edges];
  allNodes.sort((a, b) => {
    if (a.id === PO_PLAN_NODE_ID) return -1;
    if (b.id === PO_PLAN_NODE_ID) return 1;
    return a.id.localeCompare(b.id);
  });
  allEdges.sort((a, b) => a.id.localeCompare(b.id));

  return { ...graph, nodes: allNodes, edges: allEdges };
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
    startedAt: n.startedAt ?? null,
    completedAt: n.completedAt ?? null,
    parallelGroupId: n.parallelGroupId ?? null,
    pipelineStageIndex: n.pipelineStageIndex ?? null,
    workflowNode: n,
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

  for (const inf of inferEdgesFromWorkflow(run)) {
    if (!nodeIds.has(inf.source) || !nodeIds.has(inf.target) || inf.source === inf.target) continue;
    const id = `${inf.source}->${inf.target}`;
    if (edgeSet.has(id)) continue;
    edgeSet.add(id);
    edges.push({ id, source: inf.source, target: inf.target, kind: inf.kind });
  }

  if (edges.length === 0 && nodes.length > 1) {
    const sorted = Array.from(nodeMap.values()).sort((a, b) => nodeOrder(a) - nodeOrder(b) || a.id.localeCompare(b.id));
    for (let i = 0; i + 1 < sorted.length; i++) {
      const id = `${sorted[i].id}->${sorted[i + 1].id}`;
      if (edgeSet.has(id)) continue;
      edgeSet.add(id);
      edges.push({ id, source: sorted[i].id, target: sorted[i + 1].id, kind: 'inferred' });
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
    startedAt: typeof t.startedAt === 'number' ? t.startedAt : null,
    completedAt: typeof t.completedAt === 'number' ? t.completedAt : null,
    task: t,
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
  let graph: DagGraph;
  if (primaryRun && (primaryRun.nodes?.length ?? 0) > 0) {
    graph = buildFromWorkflowRun(primaryRun);
  } else {
    graph = buildFromTaskBoard(tasks, detail.dispatchPlan);
  }

  if (graph.emptyReason && graph.emptyReason !== 'task_board_no_deps') return graph;

  const poNode = buildPoPlanNode(detail);
  if (poNode) {
    graph = attachPoPlanNode(graph, poNode);
    if (graph.emptyReason === 'task_board_no_deps') {
      graph = { ...graph, emptyReason: undefined };
    }
  }

  return graph;
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

function classifyEdgeStyle(
  edge: DagEdge,
  source: DagNode | undefined,
  target: DagNode | undefined,
): { stroke: string; strokeWidth: number; strokeDasharray?: string } {
  if (edge.kind === 'blocked_by') {
    return { stroke: 'var(--c-graph-edge-blocked)', strokeWidth: 1.5 };
  }
  if (edge.kind === 'plan') {
    return { stroke: 'var(--c-graph-edge-plan)', strokeWidth: 1, strokeDasharray: '3 4' };
  }
  const sStatus = source?.status;
  const tStatus = target?.status;
  if (sStatus === 'done' && tStatus === 'done') {
    return { stroke: 'var(--c-graph-edge-done)', strokeWidth: 1.6 };
  }
  if (tStatus === 'running' || tStatus === 'awaiting_review') {
    return { stroke: 'var(--c-graph-edge-active)', strokeWidth: 1.5 };
  }
  if (tStatus === 'pending' || tStatus === 'ready' || tStatus === 'unknown' || !tStatus) {
    return { stroke: 'var(--c-graph-edge-future)', strokeWidth: 1, strokeDasharray: '4 4' };
  }
  if (tStatus === 'failed' || tStatus === 'blocked') {
    return { stroke: 'var(--c-graph-edge-blocked)', strokeWidth: 1.5 };
  }
  return { stroke: 'var(--c-graph-edge-depends)', strokeWidth: 1 };
}

export function layoutWithDagre(graph: DagGraph): { nodes: LayoutedNode[]; edges: LayoutedEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, acyclicer: 'greedy' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) g.setNode(n.id, { width: 220, height: 76 });
  for (const e of graph.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));

  return {
    nodes: graph.nodes.map(n => {
      const pos = g.node(n.id);
      return {
        id: n.id,
        type: 'dag',
        position: { x: pos.x - 110, y: pos.y - 38 },
        data: n,
      };
    }),
    edges: graph.edges.map(e => {
      const style = classifyEdgeStyle(e, nodeById.get(e.source), nodeById.get(e.target));
      const markerColor =
        e.kind === 'blocked_by' ? 'var(--c-graph-edge-blocked)' :
        e.kind === 'plan' ? 'var(--c-graph-edge-plan)' :
        style.stroke;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: false,
        style: { ...style },
        markerEnd: { type: 'arrowclosed', color: markerColor },
      };
    }),
  };
}
