import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  Background,
  MiniMap,
  ReactFlow,
  type Edge,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  ArtifactWorkspaceLayoutPatch,
  ArtifactWorkspaceNode,
  ArtifactWorkspaceResult,
  ArtifactWorkspaceSnapshot,
  ArtifactWorkspaceVersionView,
  WorkspaceGenerationRequest,
} from '../../../../shared/artifact-workspace-types';
import { useLocale } from '../../contexts/LocaleContext';
import {
  artifactWorkspaceOptimisticReducer,
  createArtifactWorkspaceOptimisticState,
  selectActiveLayoutPatch,
} from '../../lib/artifact-workspace-optimistic-state';
import { ArtifactWorkspaceDetailPanel } from './ArtifactWorkspaceDetailPanel';
import {
  ArtifactWorkspaceNode as ArtifactWorkspaceNodeComponent,
  type ArtifactWorkspaceFlowNode,
} from './ArtifactWorkspaceNode';

const ALLOWED_NODE_KINDS = new Set(['artifact', 'placeholder', 'collection', 'note']);
const ALLOWED_RELATION_KINDS = new Set(['derived_from', 'references', 'part_of_collection']);
const VIEWPORT_POSITION_EPSILON = 0.01;
const VIEWPORT_ZOOM_EPSILON = 0.0001;
const nodeTypes = {
  artifact: ArtifactWorkspaceNodeComponent,
  placeholder: ArtifactWorkspaceNodeComponent,
  collection: ArtifactWorkspaceNodeComponent,
  note: ArtifactWorkspaceNodeComponent,
};

interface ArtifactSpatialCanvasProps {
  snapshot: ArtifactWorkspaceSnapshot;
  interactionActive?: boolean;
  iframeFocused?: boolean;
  onLayoutPatch: (
    patch: ArtifactWorkspaceLayoutPatch,
  ) => Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  onViewportChange: (
    viewport: { x: number; y: number; zoom: number },
  ) => Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  onOpenNode?: (node: ArtifactWorkspaceNode) => void;
  onRequestRemove?: (node: ArtifactWorkspaceNode) => void | Promise<void>;
  onCreateCollection?: (title: string) => void | Promise<void>;
  onCreateNote?: (noteText: string) => void | Promise<void>;
  onUpdateNote?: (node: ArtifactWorkspaceNode, noteText: string) => void | Promise<void>;
  onAddToCollection?: (member: ArtifactWorkspaceNode, collection: ArtifactWorkspaceNode) => void | Promise<void>;
  onPreviewVersion?: (version: ArtifactWorkspaceVersionView) => void;
  onCompareVersion?: (version: ArtifactWorkspaceVersionView) => void;
  onPreferVersion?: (version: ArtifactWorkspaceVersionView) => void;
  onDownloadVersion?: (version: ArtifactWorkspaceVersionView) => void;
  onArtifactAction?: (
    version: ArtifactWorkspaceVersionView,
    action: 'revision' | 'annotations' | 'reference' | 'continue',
  ) => void;
  onCancelGeneration?: (request: WorkspaceGenerationRequest) => void;
  onRetryGeneration?: (request: WorkspaceGenerationRequest) => void;
  onCloseDetail?: () => void;
}

function nodeLabel(node: ArtifactWorkspaceNode): string {
  if (node.kind === 'note') return node.noteText || node.title || node.kind;
  return node.title || node.placeholderKind || node.kind;
}

function isSameViewport(left: Viewport, right: Viewport | undefined): boolean {
  return !!right
    && Math.abs(left.x - right.x) <= VIEWPORT_POSITION_EPSILON
    && Math.abs(left.y - right.y) <= VIEWPORT_POSITION_EPSILON
    && Math.abs(left.zoom - right.zoom) <= VIEWPORT_ZOOM_EPSILON;
}

function readingOrder(nodes: ArtifactWorkspaceNode[]): ArtifactWorkspaceNode[] {
  return [...nodes].sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
}

function isCanonicalNode(value: unknown): value is ArtifactWorkspaceNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ArtifactWorkspaceNode>;
  return typeof candidate.id === 'string'
    && typeof candidate.x === 'number'
    && typeof candidate.y === 'number'
    && typeof candidate.layoutRevision === 'number';
}

function readCanonicalNode(
  error: { canonical?: unknown; canonicalNodes?: ArtifactWorkspaceNode[] },
  nodeId: string,
): ArtifactWorkspaceNode | undefined {
  const canonical = error.canonical ?? error.canonicalNodes;
  if (Array.isArray(canonical)) return canonical.find((node) => isCanonicalNode(node) && node.id === nodeId);
  return isCanonicalNode(canonical) && canonical.id === nodeId ? canonical : undefined;
}

export function ArtifactSpatialCanvas({
  snapshot,
  interactionActive = true,
  iframeFocused = false,
  onLayoutPatch,
  onViewportChange,
  onOpenNode,
  onRequestRemove,
  onCreateCollection,
  onCreateNote,
  onUpdateNote,
  onAddToCollection,
  onPreviewVersion,
  onCompareVersion,
  onPreferVersion,
  onDownloadVersion,
  onArtifactAction,
  onCancelGeneration,
  onRetryGeneration,
  onCloseDetail,
}: ArtifactSpatialCanvasProps) {
  const { t } = useLocale();
  const [state, dispatch] = useReducer(
    artifactWorkspaceOptimisticReducer,
    snapshot.nodes,
    createArtifactWorkspaceOptimisticState,
  );
  const stateRef = useRef(state);
  const flowRef = useRef<ReactFlowInstance<ArtifactWorkspaceFlowNode, Edge> | null>(null);
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardPatchesRef = useRef(new Map<string, ArtifactWorkspaceLayoutPatch>());
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingViewportRef = useRef<Viewport | null>(null);
  const appliedViewRevisionRef = useRef<number | undefined>(undefined);
  const [focusedNodeId, setFocusedNodeId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [removeCandidate, setRemoveCandidate] = useState<ArtifactWorkspaceNode | null>(null);
  const [createMode, setCreateMode] = useState<'collection' | 'note' | null>(null);
  const [createText, setCreateText] = useState('');
  const [membershipOpen, setMembershipOpen] = useState(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    dispatch({ type: 'inbound_snapshot', nodes: snapshot.nodes });
  }, [snapshot.nodes]);

  useEffect(() => {
    if (!snapshot.view || pendingViewportRef.current || !flowRef.current) return;
    if (appliedViewRevisionRef.current === snapshot.view.viewRevision) return;
    appliedViewRevisionRef.current = snapshot.view.viewRevision;
    void flowRef.current.setViewport(snapshot.view.viewport);
  }, [snapshot.view]);

  const visibleNodes = useMemo(
    () => readingOrder(state.nodes.filter((node) => ALLOWED_NODE_KINDS.has(node.kind))),
    [state.nodes],
  );

  useEffect(() => {
    const firstId = visibleNodes[0]?.id;
    setFocusedNodeId((current) => current && visibleNodes.some((node) => node.id === current) ? current : firstId);
    setSelectedNodeId((current) => current && visibleNodes.some((node) => node.id === current) ? current : firstId);
  }, [visibleNodes]);

  const applyPatch = useCallback(async (patch: ArtifactWorkspaceLayoutPatch) => {
    const result = await onLayoutPatch(patch);
    if (result.ok) {
      dispatch({ type: 'inbound_snapshot', nodes: result.data.nodes });
      return;
    }
    const canonical = readCanonicalNode(result.error, patch.nodeId);
    if (canonical) dispatch({ type: 'canonical_layout', node: canonical });
  }, [onLayoutPatch]);

  const flushKeyboard = useCallback(() => {
    if (keyboardTimerRef.current) {
      clearTimeout(keyboardTimerRef.current);
      keyboardTimerRef.current = null;
    }
    const patches = Array.from(keyboardPatchesRef.current.values());
    keyboardPatchesRef.current.clear();
    for (const patch of patches) void applyPatch(patch);
    dispatch({ type: 'end_drag' });
  }, [applyPatch]);

  const scheduleKeyboardPatch = useCallback((patch: ArtifactWorkspaceLayoutPatch) => {
    keyboardPatchesRef.current.set(patch.nodeId, patch);
    if (keyboardTimerRef.current) clearTimeout(keyboardTimerRef.current);
    keyboardTimerRef.current = setTimeout(flushKeyboard, 250);
  }, [flushKeyboard]);

  const handleNodeKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, node: ArtifactWorkspaceNode) => {
    if (!interactionActive || iframeFocused) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      setSelectedNodeId(node.id);
      onOpenNode?.(node);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setSelectedNodeId(undefined);
      onCloseDetail?.();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      setRemoveCandidate(node);
      return;
    }
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    const current = stateRef.current.nodes.find((candidate) => candidate.id === node.id);
    if (!current) return;
    const step = event.shiftKey ? 10 : 1;
    const x = current.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0);
    const y = current.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
    let next = stateRef.current;
    if (next.activeDrag?.nodeId !== node.id) {
      next = artifactWorkspaceOptimisticReducer(next, { type: 'begin_drag', nodeId: node.id });
      dispatch({ type: 'begin_drag', nodeId: node.id });
    }
    next = artifactWorkspaceOptimisticReducer(next, { type: 'move_drag', nodeId: node.id, x, y });
    stateRef.current = next;
    dispatch({ type: 'move_drag', nodeId: node.id, x, y });
    const patch = selectActiveLayoutPatch(next);
    if (patch) scheduleKeyboardPatch(patch);
  }, [iframeFocused, interactionActive, onCloseDetail, onOpenNode, scheduleKeyboardPatch]);

  const flowNodes = useMemo<ArtifactWorkspaceFlowNode[]>(() => visibleNodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    zIndex: node.zIndex,
    selected: node.id === selectedNodeId,
    draggable: true,
    connectable: false,
    data: {
      node,
      label: nodeLabel(node),
      tabIndex: node.id === focusedNodeId ? 0 : -1,
      onFocus: (nodeId: string) => {
        setFocusedNodeId(nodeId);
        setSelectedNodeId(nodeId);
      },
      onKeyDown: handleNodeKeyDown,
      onOpen: (selected: ArtifactWorkspaceNode) => {
        setSelectedNodeId(selected.id);
        onOpenNode?.(selected);
      },
    },
  })), [focusedNodeId, handleNodeKeyDown, onOpenNode, selectedNodeId, visibleNodes]);

  const nodeIdSet = useMemo(() => new Set(flowNodes.map((node) => node.id)), [flowNodes]);
  const edges = useMemo<Edge[]>(() => snapshot.relations
    .filter((relation) => ALLOWED_RELATION_KINDS.has(relation.kind)
      && nodeIdSet.has(relation.fromNodeId)
      && nodeIdSet.has(relation.toNodeId))
    .map((relation) => ({
      id: relation.id,
      source: relation.fromNodeId,
      target: relation.toNodeId,
      type: 'straight',
      label: relation.kind,
    })), [nodeIdSet, snapshot.relations]);

  const flushViewport = useCallback(() => {
    if (viewportTimerRef.current) {
      clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = null;
    }
    const viewport = pendingViewportRef.current;
    pendingViewportRef.current = null;
    if (viewport) void onViewportChange(viewport);
  }, [onViewportChange]);

  useEffect(() => () => {
    flushKeyboard();
    flushViewport();
  }, [flushKeyboard, flushViewport]);

  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId);
  const selectedVersions = selectedNode?.lineageId
    ? snapshot.versions.filter((version) => version.lineageId === selectedNode.lineageId)
    : [];
  const selectedGenerationRequest = selectedNode?.kind === 'placeholder'
    ? [...snapshot.generationRequests].reverse().find((request) => request.placeholderNodeId === selectedNode.id)
    : undefined;
  const collections = visibleNodes.filter((node) => node.kind === 'collection');
  return (
    <div className="artifact-spatial-workspace">
      <div className="artifact-workspace-zoom-toolbar" role="toolbar">
        <button type="button" aria-label={t.artifactWorkspace.zoomIn} onClick={() => void flowRef.current?.zoomIn()}>
          +
        </button>
        <button type="button" aria-label={t.artifactWorkspace.zoomOut} onClick={() => void flowRef.current?.zoomOut()}>
          −
        </button>
        <button type="button" aria-label={t.artifactWorkspace.fitView} onClick={() => void flowRef.current?.fitView()}>
          ⛶
        </button>
        {onCreateCollection ? (
          <button type="button" onClick={() => { setCreateText(''); setCreateMode('collection'); }}>
            {t.artifactWorkspace.newCollection}
          </button>
        ) : null}
        {onCreateNote ? (
          <button type="button" onClick={() => { setCreateText(''); setCreateMode('note'); }}>
            {t.artifactWorkspace.newNote}
          </button>
        ) : null}
        {onAddToCollection && selectedNode?.kind === 'artifact' && collections.length > 0 ? (
          <button type="button" onClick={() => setMembershipOpen(true)}>
            {t.artifactWorkspace.addToCollection}
          </button>
        ) : null}
      </div>
      <div className="artifact-workspace-flow-surface">
        <ReactFlow<ArtifactWorkspaceFlowNode, Edge>
          deleteKeyCode={null}
          selectionKeyCode={interactionActive ? undefined : null}
          multiSelectionKeyCode={interactionActive ? undefined : null}
          panActivationKeyCode={interactionActive ? undefined : null}
          zoomActivationKeyCode={interactionActive ? undefined : null}
          disableKeyboardA11y={!interactionActive}
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          elementsSelectable
          onInit={(instance) => { flowRef.current = instance; }}
          defaultViewport={snapshot.view?.viewport}
          onNodeDragStart={(_event, node) => dispatch({ type: 'begin_drag', nodeId: node.id })}
          onNodeDrag={(_event, node) => dispatch({ type: 'move_drag', nodeId: node.id, x: node.position.x, y: node.position.y })}
          onNodeDragStop={(_event, node) => {
            const canonical = stateRef.current.nodes.find((candidate) => candidate.id === node.id);
            if (!canonical) return;
            void applyPatch({
              nodeId: node.id,
              x: node.position.x,
              y: node.position.y,
              zIndex: canonical.zIndex,
              expectedLayoutRevision: canonical.layoutRevision,
            });
            dispatch({ type: 'end_drag' });
          }}
          onMoveEnd={(_event, viewport) => {
            if (isSameViewport(viewport, snapshot.view?.viewport)) {
              pendingViewportRef.current = null;
              if (viewportTimerRef.current) {
                clearTimeout(viewportTimerRef.current);
                viewportTimerRef.current = null;
              }
              return;
            }
            pendingViewportRef.current = viewport;
            if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
            viewportTimerRef.current = setTimeout(flushViewport, 250);
          }}
          fitView={!snapshot.view}
        >
          <Background />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      {selectedNode ? (
        <ArtifactWorkspaceDetailPanel
          node={selectedNode}
          onUpdateNote={onUpdateNote}
          versions={selectedVersions}
          writable={snapshot.access.revision === 'write'}
          generationRequest={selectedGenerationRequest}
          onPreviewVersion={onPreviewVersion}
          onCompareVersion={onCompareVersion}
          onPreferVersion={onPreferVersion}
          onDownloadVersion={onDownloadVersion}
          onArtifactAction={onArtifactAction}
          onCancelGeneration={onCancelGeneration}
          onRetryGeneration={onRetryGeneration}
          onRemoveNode={setRemoveCandidate}
          onClose={() => {
            setSelectedNodeId(undefined);
            onCloseDetail?.();
          }}
        />
      ) : null}
      {state.removedDuringDragNodeId ? (
        <div role="status" className="artifact-workspace-inline-status">{t.artifactWorkspace.nodeRemoved}</div>
      ) : null}
      {removeCandidate ? (
        <div role="dialog" aria-modal="true" aria-label={t.artifactWorkspace.removeTitle} className="artifact-workspace-remove-dialog">
          <h2>{t.artifactWorkspace.removeTitle}</h2>
          <p>{t.artifactWorkspace.removeBody}</p>
          <button type="button" onClick={() => setRemoveCandidate(null)}>{t.artifactWorkspace.cancel}</button>
          <button
            type="button"
            onClick={() => {
              const candidate = removeCandidate;
              setRemoveCandidate(null);
              void onRequestRemove?.(candidate);
            }}
          >
            {t.artifactWorkspace.remove}
          </button>
        </div>
      ) : null}
      {createMode ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={createMode === 'collection' ? t.artifactWorkspace.newCollection : t.artifactWorkspace.newNote}
          className="artifact-workspace-remove-dialog"
        >
          {createMode === 'collection' ? (
            <input
              aria-label={t.artifactWorkspace.collectionTitle}
              value={createText}
              onChange={(event) => setCreateText(event.target.value)}
              autoFocus
            />
          ) : (
            <textarea
              aria-label={t.artifactWorkspace.noteText}
              value={createText}
              onChange={(event) => setCreateText(event.target.value)}
              autoFocus
            />
          )}
          <button type="button" onClick={() => setCreateMode(null)}>{t.artifactWorkspace.cancel}</button>
          <button
            type="button"
            disabled={!createText.trim()}
            onClick={() => {
              const value = createText.trim();
              const mode = createMode;
              setCreateMode(null);
              setCreateText('');
              if (mode === 'collection') void onCreateCollection?.(value);
              else void onCreateNote?.(value);
            }}
          >
            {createMode === 'collection' ? t.artifactWorkspace.saveCollection : t.artifactWorkspace.saveNote}
          </button>
        </div>
      ) : null}
      {membershipOpen && selectedNode?.kind === 'artifact' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.artifactWorkspace.selectCollection}
          className="artifact-workspace-remove-dialog"
        >
          <h2>{t.artifactWorkspace.selectCollection}</h2>
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              onClick={() => {
                setMembershipOpen(false);
                void onAddToCollection?.(selectedNode, collection);
              }}
            >
              {nodeLabel(collection)}
            </button>
          ))}
          <button type="button" onClick={() => setMembershipOpen(false)}>{t.artifactWorkspace.cancel}</button>
        </div>
      ) : null}
    </div>
  );
}
