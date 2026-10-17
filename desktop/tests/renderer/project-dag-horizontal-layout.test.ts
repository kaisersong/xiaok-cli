import { describe, expect, it } from 'vitest';
import { layoutWithDagre, PO_PLAN_NODE_ID, type DagGraph, type DagNode, type DagEdge } from '../../renderer/src/components/projects/dagGraphModel';

const node = (id: string, status: DagNode['status'] = 'pending'): DagNode => ({ id, title: id, status, kind: 'workflow_node' });
function graph(nodes: DagNode[], links: Array<[string, string, DagEdge['kind']?]>): DagGraph {
  return { nodes, edges: links.map(([source, target, kind = 'depends_on']) => ({ id: `${source}->${target}`, source, target, kind })), source: 'workflow', partial: false };
}

describe('project DAG horizontal layout', () => {
  it('places serial dependencies from left to right with room for cards', () => {
    const { nodes: [a, b, c] } = layoutWithDagre(graph([node('a'), node('b'), node('c')], [['a', 'b'], ['b', 'c']]));
    expect(b.position.x).toBeGreaterThanOrEqual(a.position.x + 220);
    expect(c.position.x).toBeGreaterThanOrEqual(b.position.x + 220);
    expect(a.position.y).toBe(b.position.y);
    expect(b.position.y).toBe(c.position.y);
  });

  it('stacks parallel branches in one column and merges to their right', () => {
    const { nodes: [entry, one, two, merge] } = layoutWithDagre(graph([node('entry'), node('one'), node('two'), node('merge')],
      [['entry', 'one'], ['entry', 'two'], ['one', 'merge'], ['two', 'merge']]));
    expect(one.position.x).toBe(two.position.x);
    expect(one.position.x).toBeGreaterThan(entry.position.x);
    expect(Math.abs(one.position.y - two.position.y)).toBeGreaterThanOrEqual(76);
    expect(merge.position.x).toBeGreaterThanOrEqual(one.position.x + 220);
  });

  it('keeps the plan at the left and retains edge styling and arrows', () => {
    const plan = { ...node(PO_PLAN_NODE_ID, 'done'), kind: 'po_plan' as const };
    const result = layoutWithDagre(graph([plan, node('done', 'done'), node('active', 'running'), node('blocked', 'blocked')],
      [[PO_PLAN_NODE_ID, 'done', 'plan'], ['done', 'active'], ['active', 'blocked', 'blocked_by']]));
    expect(result.nodes[0].position.x).toBeLessThan(result.nodes[1].position.x);
    expect(result.edges[0].style.strokeDasharray).toBe('3 4');
    expect(result.edges[1].style.stroke).toBe('var(--c-graph-edge-active)');
    expect(result.edges[2].style.stroke).toBe('var(--c-graph-edge-blocked)');
    expect(result.edges.every(edge => edge.markerEnd.type === 'arrowclosed')).toBe(true);
  });

  it('preserves positions and dependencies on status updates', () => {
    const original = graph([node('a'), node('b')], [['a', 'b']]);
    const updated = { ...original, nodes: original.nodes.map(n => ({ ...n, status: 'running' as const })) };
    expect(layoutWithDagre(original).nodes.map(n => n.position)).toEqual(layoutWithDagre(updated).nodes.map(n => n.position));
    expect(layoutWithDagre(updated).edges.map(e => [e.source, e.target])).toEqual([['a', 'b']]);
  });

  it('keeps long chains horizontal regardless of input order', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node(`stage-${i}`));
    const links = nodes.slice(1).map((n, i) => [nodes[i].id, n.id] as [string, string]);
    const result = layoutWithDagre(graph([...nodes].reverse(), links));
    const positions = new Map(result.nodes.map(n => [n.id, n.position]));
    for (const [source, target] of links) {
      expect(positions.get(target)!.x).toBeGreaterThanOrEqual(positions.get(source)!.x + 220);
    }
  });

  it('handles empty and isolated graphs', () => {
    expect(layoutWithDagre(graph([], []))).toEqual({ nodes: [], edges: [] });
    const { nodes: [only] } = layoutWithDagre(graph([node('only')], []));
    expect(Number.isFinite(only.position.x)).toBe(true);
    expect(Number.isFinite(only.position.y)).toBe(true);
  });
});
