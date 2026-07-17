import { describe, expect, it } from 'vitest';
import type { ArtifactWorkspaceNode } from '../../shared/artifact-workspace-types';
import {
  createArtifactWorkspaceOptimisticState,
  artifactWorkspaceOptimisticReducer,
  selectActiveLayoutPatch,
} from '../../renderer/src/lib/artifact-workspace-optimistic-state';

function node(overrides: Partial<ArtifactWorkspaceNode> = {}): ArtifactWorkspaceNode {
  return {
    id: 'node-a',
    workspaceId: 'workspace-1',
    kind: 'artifact',
    lineageId: 'lineage-1',
    artifactVersionId: 'version-1',
    owner: 'user',
    x: 10,
    y: 20,
    width: 280,
    height: 180,
    zIndex: 1,
    layoutRevision: 2,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('artifact workspace optimistic state', () => {
  it('keeps the active drag delta while merging inbound non-layout fields and unrelated nodes', () => {
    let state = createArtifactWorkspaceOptimisticState([
      node(),
      node({ id: 'node-b', x: 100, y: 100, layoutRevision: 1 }),
    ]);
    state = artifactWorkspaceOptimisticReducer(state, { type: 'begin_drag', nodeId: 'node-a' });
    state = artifactWorkspaceOptimisticReducer(state, { type: 'move_drag', nodeId: 'node-a', x: 25, y: 45 });

    state = artifactWorkspaceOptimisticReducer(state, {
      type: 'inbound_snapshot',
      nodes: [
        node({ title: 'Renamed', x: 12, y: 22, layoutRevision: 3 }),
        node({ id: 'node-b', x: 160, y: 140, layoutRevision: 2 }),
      ],
    });

    expect(state.nodes.find((item) => item.id === 'node-a')).toMatchObject({
      title: 'Renamed',
      x: 27,
      y: 47,
      layoutRevision: 3,
    });
    expect(state.nodes.find((item) => item.id === 'node-b')).toMatchObject({ x: 160, y: 140 });
    expect(selectActiveLayoutPatch(state)).toEqual({
      nodeId: 'node-a',
      x: 27,
      y: 47,
      zIndex: 1,
      expectedLayoutRevision: 3,
    });
  });

  it('lets a tombstone cancel the active drag without reviving the node', () => {
    let state = createArtifactWorkspaceOptimisticState([node()]);
    state = artifactWorkspaceOptimisticReducer(state, { type: 'begin_drag', nodeId: 'node-a' });
    state = artifactWorkspaceOptimisticReducer(state, { type: 'move_drag', nodeId: 'node-a', x: 90, y: 90 });
    state = artifactWorkspaceOptimisticReducer(state, {
      type: 'inbound_snapshot',
      nodes: [node({ tombstonedAt: '2026-07-13T01:00:00.000Z' })],
    });

    expect(state.activeDrag).toBeUndefined();
    expect(state.nodes).toEqual([]);
    expect(state.removedDuringDragNodeId).toBe('node-a');
    expect(selectActiveLayoutPatch(state)).toBeUndefined();
  });

  it('accepts a canonical conflict response and clears the local delta', () => {
    let state = createArtifactWorkspaceOptimisticState([node()]);
    state = artifactWorkspaceOptimisticReducer(state, { type: 'begin_drag', nodeId: 'node-a' });
    state = artifactWorkspaceOptimisticReducer(state, { type: 'move_drag', nodeId: 'node-a', x: 30, y: 40 });
    state = artifactWorkspaceOptimisticReducer(state, {
      type: 'canonical_layout',
      node: node({ x: 15, y: 25, layoutRevision: 4 }),
    });

    expect(state.activeDrag).toBeUndefined();
    expect(state.nodes[0]).toMatchObject({ x: 15, y: 25, layoutRevision: 4 });
  });
});
