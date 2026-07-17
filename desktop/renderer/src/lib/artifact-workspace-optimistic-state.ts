import type {
  ArtifactWorkspaceLayoutPatch,
  ArtifactWorkspaceNode,
} from '../../../shared/artifact-workspace-types';

export interface ArtifactWorkspaceActiveDrag {
  nodeId: string;
  deltaX: number;
  deltaY: number;
}

export interface ArtifactWorkspaceOptimisticState {
  nodes: ArtifactWorkspaceNode[];
  activeDrag?: ArtifactWorkspaceActiveDrag;
  removedDuringDragNodeId?: string;
}

export type ArtifactWorkspaceOptimisticAction =
  | { type: 'begin_drag'; nodeId: string }
  | { type: 'move_drag'; nodeId: string; x: number; y: number }
  | { type: 'end_drag' }
  | { type: 'inbound_snapshot'; nodes: ArtifactWorkspaceNode[] }
  | { type: 'canonical_layout'; node: ArtifactWorkspaceNode };

function visibleNodes(nodes: ArtifactWorkspaceNode[]): ArtifactWorkspaceNode[] {
  return nodes.filter((node) => !node.tombstonedAt);
}

export function createArtifactWorkspaceOptimisticState(
  nodes: ArtifactWorkspaceNode[],
): ArtifactWorkspaceOptimisticState {
  return { nodes: visibleNodes(nodes) };
}

export function artifactWorkspaceOptimisticReducer(
  state: ArtifactWorkspaceOptimisticState,
  action: ArtifactWorkspaceOptimisticAction,
): ArtifactWorkspaceOptimisticState {
  if (action.type === 'begin_drag') {
    if (!state.nodes.some((node) => node.id === action.nodeId)) return state;
    return {
      ...state,
      activeDrag: { nodeId: action.nodeId, deltaX: 0, deltaY: 0 },
      removedDuringDragNodeId: undefined,
    };
  }

  if (action.type === 'move_drag') {
    const current = state.nodes.find((node) => node.id === action.nodeId);
    if (!current || state.activeDrag?.nodeId !== action.nodeId) return state;
    const deltaX = action.x - (current.x - state.activeDrag.deltaX);
    const deltaY = action.y - (current.y - state.activeDrag.deltaY);
    return {
      ...state,
      nodes: state.nodes.map((node) => node.id === action.nodeId
        ? { ...node, x: action.x, y: action.y }
        : node),
      activeDrag: { nodeId: action.nodeId, deltaX, deltaY },
    };
  }

  if (action.type === 'end_drag') {
    return { ...state, activeDrag: undefined };
  }

  if (action.type === 'canonical_layout') {
    return {
      ...state,
      nodes: visibleNodes(state.nodes.map((node) => node.id === action.node.id ? action.node : node)),
      activeDrag: state.activeDrag?.nodeId === action.node.id ? undefined : state.activeDrag,
    };
  }

  const activeNodeId = state.activeDrag?.nodeId;
  const inboundActive = activeNodeId
    ? action.nodes.find((node) => node.id === activeNodeId)
    : undefined;
  if (activeNodeId && (!inboundActive || inboundActive.tombstonedAt)) {
    return {
      nodes: visibleNodes(action.nodes),
      activeDrag: undefined,
      removedDuringDragNodeId: activeNodeId,
    };
  }

  const deltaX = state.activeDrag?.deltaX ?? 0;
  const deltaY = state.activeDrag?.deltaY ?? 0;
  return {
    ...state,
    nodes: visibleNodes(action.nodes).map((node) => node.id === activeNodeId
      ? { ...node, x: node.x + deltaX, y: node.y + deltaY }
      : node),
  };
}

export function selectActiveLayoutPatch(
  state: ArtifactWorkspaceOptimisticState,
): ArtifactWorkspaceLayoutPatch | undefined {
  const node = state.activeDrag
    ? state.nodes.find((candidate) => candidate.id === state.activeDrag?.nodeId)
    : undefined;
  if (!node) return undefined;
  return {
    nodeId: node.id,
    x: node.x,
    y: node.y,
    zIndex: node.zIndex,
    expectedLayoutRevision: node.layoutRevision,
  };
}
