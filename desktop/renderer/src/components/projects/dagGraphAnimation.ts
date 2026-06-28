import type { DagGraph, DagEdge, DagNode } from './dagGraphModel';

export const ANIM = {
  EDGE_DURATION: 500,
  EDGE_STEP_DELAY: 400,
  NODE_HIGHLIGHT_DURATION: 200,
  WARN_PULSE_DURATION: 800,
  MAX_TOTAL_DURATION: 2500,
};

export function topologicalRank(graph: DagGraph): Map<string, number> {
  const rank = new Map<string, number>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const n of graph.nodes) {
    incoming.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of graph.edges) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    outgoing.get(e.source)?.push(e.target);
  }

  const queue: string[] = [];
  for (const [id, count] of incoming) {
    if (count === 0) {
      rank.set(id, 0);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const currentRank = rank.get(id)!;
    for (const next of outgoing.get(id) ?? []) {
      const newRank = Math.max(rank.get(next) ?? 0, currentRank + 1);
      rank.set(next, newRank);
      incoming.set(next, incoming.get(next)! - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }

  for (const n of graph.nodes) {
    if (!rank.has(n.id)) {
      console.warn('[dagGraph] cycle detected, node fallback to rank=0', n.id);
      rank.set(n.id, 0);
    }
  }
  return rank;
}

function shouldAnimateEdge(edge: DagEdge, graph: DagGraph): boolean {
  const targetNode = graph.nodes.find(n => n.id === edge.target);
  if (!targetNode) return false;
  return ['running', 'done', 'failed', 'blocked', 'awaiting_review'].includes(targetNode.status);
}

function shouldHighlightStartNode(n: DagNode): boolean {
  return ['running', 'done', 'failed', 'blocked', 'awaiting_review'].includes(n.status);
}

export interface AnimationSchedule {
  edgeDelays: Map<string, number | null>;
  nodeHighlights: Map<string, number>;
  totalDuration: number;
}

export function computeAnimationSchedule(graph: DagGraph): AnimationSchedule {
  const rank = topologicalRank(graph);
  const edgeDelays = new Map<string, number | null>();
  const nodeHighlights = new Map<string, number>();
  let maxEnd = 0;

  for (const e of graph.edges) {
    if (!shouldAnimateEdge(e, graph)) {
      edgeDelays.set(e.id, null);
      continue;
    }
    const r = rank.get(e.source) ?? 0;
    const delay = r * ANIM.EDGE_STEP_DELAY;
    edgeDelays.set(e.id, delay);
    const end = delay + ANIM.EDGE_DURATION;
    if (end > maxEnd) maxEnd = end;
    const existing = nodeHighlights.get(e.target);
    nodeHighlights.set(e.target, Math.max(existing ?? 0, end));
  }

  for (const n of graph.nodes) {
    if (rank.get(n.id) === 0 && shouldHighlightStartNode(n)) {
      nodeHighlights.set(n.id, 300);
    }
  }

  if (maxEnd > ANIM.MAX_TOTAL_DURATION && maxEnd > 0) {
    const scale = ANIM.MAX_TOTAL_DURATION / maxEnd;
    for (const [id, delay] of edgeDelays) {
      if (delay != null) edgeDelays.set(id, Math.round(delay * scale));
    }
    for (const [id, time] of nodeHighlights) {
      nodeHighlights.set(id, Math.round(time * scale));
    }
    maxEnd = ANIM.MAX_TOTAL_DURATION;
  }

  return {
    edgeDelays,
    nodeHighlights,
    totalDuration: Math.min(maxEnd, ANIM.MAX_TOTAL_DURATION),
  };
}

export const PLAYED_TOPOLOGIES = new Map<string, string>();
