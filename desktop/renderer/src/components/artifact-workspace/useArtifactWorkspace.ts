import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArtifactWorkspaceEventName,
  ArtifactWorkspaceLayoutPatch,
  ArtifactWorkspaceNode,
  ArtifactWorkspacePreview,
  ArtifactWorkspaceRequestedKind,
  ArtifactWorkspaceResult,
  ArtifactWorkspaceSelectedArtifact,
  ArtifactWorkspaceSnapshot,
  ArtifactWorkspaceView,
} from '../../../../shared/artifact-workspace-types';
import { getDesktopApi } from '../../shared/desktop';

interface ArtifactWorkspaceRendererApi {
  onArtifactWorkspaceChanged?(handler: (change: { conversationId: string; workspaceId: string }) => void): () => void;
  closeArtifactWorkspace?(input: { conversationId: string; workspaceRootId?: string }): Promise<ArtifactWorkspaceResult<{ closed: boolean }>>;
  getArtifactWorkspaceSnapshot(input: {
    conversationId: string;
    workspaceRootId?: string;
    selectedArtifact?: ArtifactWorkspaceSelectedArtifact;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  readArtifactWorkspaceVersionPreview(input: {
    conversationId: string;
    workspaceRootId?: string;
    versionId: string;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspacePreview>>;
  exportArtifactWorkspaceVersion(input: {
    conversationId: string;
    workspaceRootId?: string;
    versionId: string;
  }): Promise<ArtifactWorkspaceResult<{ exported: boolean; canceled?: boolean }>>;
  preferArtifactVersion(input: {
    conversationId: string;
    workspaceRootId?: string;
    lineageId: string;
    versionId: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  recordArtifactWorkspaceEvent(input: {
    conversationId: string;
    workspaceRootId?: string;
    eventName: ArtifactWorkspaceEventName;
    requestId?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<ArtifactWorkspaceResult<unknown>>;
  submitArtifactGeneration(input: {
    conversationId: string;
    workspaceRootId?: string;
    placeholderNodeId?: string;
    prompt: string;
    sourceVersionId?: string;
    selectedArtifact?: ArtifactWorkspaceSelectedArtifact;
    requestedKind?: ArtifactWorkspaceRequestedKind;
    expectedStructureRevision?: number;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  cancelArtifactGeneration(input: {
    conversationId: string;
    workspaceRootId?: string;
    generationRequestId: string;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  retryArtifactGeneration(input: {
    conversationId: string;
    workspaceRootId?: string;
    generationRequestId: string;
    prompt?: string;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  updateArtifactWorkspaceLayout(input: {
    conversationId: string;
    workspaceRootId?: string;
    patches: ArtifactWorkspaceLayoutPatch[];
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  saveArtifactWorkspaceViewport(input: {
    conversationId: string;
    workspaceRootId?: string;
    viewport: { x: number; y: number; zoom: number };
    expectedViewRevision?: number;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  removeArtifactWorkspaceNode(input: {
    conversationId: string;
    workspaceRootId?: string;
    nodeId: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  createArtifactWorkspaceCollection(input: {
    conversationId: string;
    workspaceRootId?: string;
    title: string;
    x?: number;
    y?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  createArtifactWorkspaceNote(input: {
    conversationId: string;
    workspaceRootId?: string;
    noteText: string;
    x?: number;
    y?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  updateArtifactWorkspaceNote(input: {
    conversationId: string;
    workspaceRootId?: string;
    nodeId: string;
    noteText: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
  setArtifactCollectionMembership(input: {
    conversationId: string;
    workspaceRootId?: string;
    collectionNodeId: string;
    memberNodeId: string;
    included: boolean;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>;
}

function readApi(): Partial<ArtifactWorkspaceRendererApi> {
  return (getDesktopApi() ?? {}) as unknown as Partial<ArtifactWorkspaceRendererApi>;
}

function selectedArtifactForIpc(
  artifact: ArtifactWorkspaceSelectedArtifact | undefined,
): ArtifactWorkspaceSelectedArtifact | undefined {
  if (!artifact) return undefined;
  return {
    artifactId: artifact.artifactId,
    ...(typeof artifact.sourceTaskId === 'string' ? { sourceTaskId: artifact.sourceTaskId } : {}),
    ...(typeof artifact.kind === 'string' ? { kind: artifact.kind } : {}),
    ...(typeof artifact.mimeType === 'string' ? { mimeType: artifact.mimeType } : {}),
    ...(typeof artifact.title === 'string' ? { title: artifact.title } : {}),
  };
}

function readCanonicalSnapshot(error: {
  canonical?: unknown;
  canonicalSnapshot?: ArtifactWorkspaceSnapshot;
}): ArtifactWorkspaceSnapshot | null {
  const candidate = error.canonical ?? error.canonicalSnapshot;
  if (!candidate || typeof candidate !== 'object') return null;
  const snapshot = candidate as Partial<ArtifactWorkspaceSnapshot>;
  return snapshot.workspace && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.relations)
    ? candidate as ArtifactWorkspaceSnapshot
    : null;
}

function isCanonicalLayoutNode(value: unknown): value is ArtifactWorkspaceNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ArtifactWorkspaceNode>;
  return typeof candidate.id === 'string'
    && typeof candidate.workspaceId === 'string'
    && typeof candidate.x === 'number'
    && typeof candidate.y === 'number'
    && typeof candidate.zIndex === 'number'
    && typeof candidate.layoutRevision === 'number';
}

function readCanonicalLayoutNode(error: {
  canonical?: unknown;
  canonicalSnapshot?: ArtifactWorkspaceSnapshot;
  canonicalNodes?: ArtifactWorkspaceNode[];
}, nodeId: string): ArtifactWorkspaceNode | null {
  const candidates = [error.canonical, error.canonicalSnapshot, error.canonicalNodes];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const node = candidate.find((entry) => isCanonicalLayoutNode(entry) && entry.id === nodeId);
      if (node) return node;
      continue;
    }
    if (!candidate || typeof candidate !== 'object') continue;
    const snapshot = candidate as Partial<ArtifactWorkspaceSnapshot>;
    if (Array.isArray(snapshot.nodes)) {
      const node = snapshot.nodes.find((entry) => isCanonicalLayoutNode(entry) && entry.id === nodeId);
      if (node) return node;
      continue;
    }
    if (isCanonicalLayoutNode(candidate) && candidate.id === nodeId) return candidate;
  }
  return null;
}

function mergeLayoutProjection(
  current: ArtifactWorkspaceSnapshot,
  candidate: ArtifactWorkspaceNode,
): { snapshot: ArtifactWorkspaceSnapshot; node: ArtifactWorkspaceNode } | null {
  if (candidate.workspaceId !== current.workspace.id) return null;
  const currentNode = current.nodes.find((node) => node.id === candidate.id);
  if (!currentNode || currentNode.tombstonedAt || candidate.layoutRevision < currentNode.layoutRevision) return null;
  if (candidate.layoutRevision === currentNode.layoutRevision) {
    return { snapshot: current, node: currentNode };
  }
  const mergedNode: ArtifactWorkspaceNode = {
    ...currentNode,
    x: candidate.x,
    y: candidate.y,
    zIndex: candidate.zIndex,
    layoutRevision: candidate.layoutRevision,
    updatedAt: candidate.updatedAt,
  };
  return {
    snapshot: {
      ...current,
      nodes: current.nodes.map((node) => node.id === candidate.id ? mergedNode : node),
    },
    node: mergedNode,
  };
}

function isCanonicalViewport(value: unknown): value is ArtifactWorkspaceView {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ArtifactWorkspaceView>;
  const viewport = candidate.viewport as Partial<ArtifactWorkspaceView['viewport']> | undefined;
  return typeof candidate.workspaceId === 'string'
    && typeof candidate.viewKey === 'string'
    && typeof candidate.viewRevision === 'number'
    && !!viewport
    && typeof viewport.x === 'number'
    && typeof viewport.y === 'number'
    && typeof viewport.zoom === 'number';
}

function readCanonicalViewport(error: {
  canonical?: unknown;
  canonicalSnapshot?: ArtifactWorkspaceSnapshot;
}): ArtifactWorkspaceView | null {
  const candidates = [error.canonical, error.canonicalSnapshot];
  for (const candidate of candidates) {
    if (isCanonicalViewport(candidate)) return candidate;
    if (!candidate || typeof candidate !== 'object') continue;
    const view = (candidate as Partial<ArtifactWorkspaceSnapshot>).view;
    if (isCanonicalViewport(view)) return view;
  }
  return null;
}

function mergeViewportProjection(
  current: ArtifactWorkspaceSnapshot,
  candidate: ArtifactWorkspaceView,
): { snapshot: ArtifactWorkspaceSnapshot; view: ArtifactWorkspaceView } | null {
  if (candidate.workspaceId !== current.workspace.id) return null;
  if (current.view && candidate.viewRevision < current.view.viewRevision) return null;
  if (current.view && candidate.viewRevision === current.view.viewRevision) {
    return { snapshot: current, view: current.view };
  }
  return {
    snapshot: { ...current, view: candidate },
    view: candidate,
  };
}

function staleWorkspaceOperation(): ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot> {
  return {
    ok: false,
    error: { code: 'runtime_unavailable', message: 'stale_workspace_operation' },
  };
}

function isSnapshotAtLeastAsFresh(
  candidate: ArtifactWorkspaceSnapshot,
  current: ArtifactWorkspaceSnapshot,
): boolean {
  if (candidate.workspace.id !== current.workspace.id) return false;
  if (candidate.workspace.structureRevision < current.workspace.structureRevision) return false;
  if (candidate.workspace.structureRevision > current.workspace.structureRevision) return true;

  const candidateNodes = new Map(candidate.nodes.map((node) => [node.id, node]));
  for (const currentNode of current.nodes) {
    const candidateNode = candidateNodes.get(currentNode.id);
    if (!candidateNode || candidateNode.layoutRevision < currentNode.layoutRevision) return false;
  }

  if (current.view) {
    if (!candidate.view || candidate.view.viewRevision < current.view.viewRevision) return false;
  }
  return true;
}

function preserveCurrentProjections(
  candidate: ArtifactWorkspaceSnapshot,
  current: ArtifactWorkspaceSnapshot,
): ArtifactWorkspaceSnapshot {
  if (candidate.workspace.id !== current.workspace.id) return candidate;
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  let nodesChanged = false;
  const nodes = candidate.nodes.map((node) => {
    const currentNode = currentNodes.get(node.id);
    if (!currentNode || currentNode.layoutRevision < node.layoutRevision) return node;
    const projectionChanged = currentNode.layoutRevision > node.layoutRevision
      || currentNode.x !== node.x
      || currentNode.y !== node.y
      || currentNode.zIndex !== node.zIndex;
    if (!projectionChanged) return node;
    nodesChanged = true;
    return {
      ...node,
      x: currentNode.x,
      y: currentNode.y,
      zIndex: currentNode.zIndex,
      layoutRevision: currentNode.layoutRevision,
      updatedAt: currentNode.updatedAt,
    };
  });
  const shouldPreserveView = !!current.view && (
    !candidate.view
    || (
      current.view.viewKey === candidate.view.viewKey
      && (
        current.view.viewRevision > candidate.view.viewRevision
        || (
          current.view.viewRevision === candidate.view.viewRevision
          && (
            current.view.viewport.x !== candidate.view.viewport.x
            || current.view.viewport.y !== candidate.view.viewport.y
            || current.view.viewport.zoom !== candidate.view.viewport.zoom
          )
        )
      )
    )
  );
  const view = shouldPreserveView ? current.view : candidate.view;
  if (!nodesChanged && view === candidate.view) return candidate;
  return {
    ...candidate,
    nodes,
    ...(view ? { view } : {}),
  };
}

type WorkspaceStatus = 'loading' | 'ready' | 'empty' | 'error' | 'unavailable';
type SnapshotCommitMode = 'full' | 'projection';

type WorkspaceAuthority = {
  identity: string;
  generation: number;
};

type RequestAuthority = {
  identity: string;
  generation: number;
};

type WorkspaceSnapshotState = {
  authority: WorkspaceAuthority;
  snapshot: ArtifactWorkspaceSnapshot | null;
};

type WorkspaceRequestState = {
  authority: RequestAuthority;
  status: WorkspaceStatus;
  error: string | null;
};

export function useArtifactWorkspace(input: {
  conversationId: string;
  workspaceRootId?: string;
  sourceArtifact?: ArtifactWorkspaceSelectedArtifact;
}) {
  const workspaceIdentity = `${input.conversationId}\u0000${input.workspaceRootId ?? ''}`;
  const requestIdentity = `${workspaceIdentity}\u0000${input.sourceArtifact?.artifactId ?? ''}\u0000${input.sourceArtifact?.sourceTaskId ?? ''}`;
  const workspaceAuthorityRef = useRef<WorkspaceAuthority>({ identity: workspaceIdentity, generation: 0 });
  if (workspaceAuthorityRef.current.identity !== workspaceIdentity) {
    workspaceAuthorityRef.current = {
      identity: workspaceIdentity,
      generation: workspaceAuthorityRef.current.generation + 1,
    };
  }
  const workspaceAuthority = workspaceAuthorityRef.current;
  const requestAuthorityRef = useRef<RequestAuthority>({ identity: requestIdentity, generation: 0 });
  if (requestAuthorityRef.current.identity !== requestIdentity) {
    requestAuthorityRef.current = {
      identity: requestIdentity,
      generation: requestAuthorityRef.current.generation + 1,
    };
  }
  const requestAuthority = requestAuthorityRef.current;
  const [snapshotState, setSnapshotState] = useState<WorkspaceSnapshotState | null>(null);
  const [requestState, setRequestState] = useState<WorkspaceRequestState>({
    authority: requestAuthority,
    status: 'loading',
    error: null,
  });
  const fullSnapshotCommitEpochRef = useRef(0);
  const projectionCommitEpochRef = useRef(0);
  const committedSnapshotStateRef = useRef<WorkspaceSnapshotState | null>(snapshotState);
  committedSnapshotStateRef.current = snapshotState;
  const snapshot = snapshotState?.authority === workspaceAuthority ? snapshotState.snapshot : null;
  const status = requestState.authority === requestAuthority ? requestState.status : 'loading';
  const error = requestState.authority === requestAuthority ? requestState.error : null;
  const requestEpochRef = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const resyncStateRef = useRef({ scheduled: false, running: false, requested: false });
  const scheduleAuthoritativeResync = useCallback(() => {
    const state = resyncStateRef.current;
    state.requested = true;
    if (state.scheduled || state.running) return;
    state.scheduled = true;
    queueMicrotask(() => {
      state.scheduled = false;
      state.running = true;
      void (async () => {
        try {
          while (state.requested) {
            state.requested = false;
            await refreshRef.current();
          }
        } finally {
          state.running = false;
        }
      })();
    });
  }, []);
  const layoutQueueRef = useRef<{ authority: RequestAuthority; tail: Promise<void> }>({
    authority: requestAuthority,
    tail: Promise.resolve(),
  });
  if (layoutQueueRef.current.authority !== requestAuthority) {
    layoutQueueRef.current = { authority: requestAuthority, tail: Promise.resolve() };
  }
  const identityKey = requestAuthority;
  const viewSessionKey = workspaceIdentity;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const commitSnapshot = useCallback((
    authority: WorkspaceAuthority,
    nextSnapshot: ArtifactWorkspaceSnapshot | null,
    mode: SnapshotCommitMode = 'full',
  ): boolean => {
    const current = committedSnapshotStateRef.current;
    const preparedSnapshot = nextSnapshot
      && mode === 'full'
      && current?.authority === authority
      && current.snapshot
      ? preserveCurrentProjections(nextSnapshot, current.snapshot)
      : nextSnapshot;
    if (
      preparedSnapshot
      && current?.authority === authority
      && current.snapshot
      && !isSnapshotAtLeastAsFresh(preparedSnapshot, current.snapshot)
    ) return false;
    const nextState = { authority, snapshot: preparedSnapshot };
    if (mode === 'full') fullSnapshotCommitEpochRef.current += 1;
    committedSnapshotStateRef.current = nextState;
    setSnapshotState(nextState);
    return true;
  }, []);

  const applyMutationResult = useCallback((
    result: ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>,
    operationAuthority: RequestAuthority,
    operationCommitEpoch: number,
    reportError = false,
  ): boolean => {
    if (requestAuthorityRef.current !== operationAuthority) return false;
    if (result.ok) {
      if (fullSnapshotCommitEpochRef.current !== operationCommitEpoch) {
        scheduleAuthoritativeResync();
        return true;
      }
      return commitSnapshot(workspaceAuthorityRef.current, result.data);
    }
    const canonical = readCanonicalSnapshot(result.error);
    if (canonical && fullSnapshotCommitEpochRef.current === operationCommitEpoch) {
      commitSnapshot(workspaceAuthorityRef.current, canonical);
    } else if (fullSnapshotCommitEpochRef.current !== operationCommitEpoch) {
      scheduleAuthoritativeResync();
    }
    if (reportError) {
      setRequestState((current) => current.authority === operationAuthority
        ? { ...current, error: result.error.message ?? result.error.code }
        : current);
    }
    return false;
  }, [commitSnapshot, scheduleAuthoritativeResync]);

  const applyLayoutProjection = useCallback((
    candidate: ArtifactWorkspaceNode,
    operationAuthority: RequestAuthority,
  ): { snapshot: ArtifactWorkspaceSnapshot; node: ArtifactWorkspaceNode } | null => {
    if (requestAuthorityRef.current !== operationAuthority) return null;
    const authority = workspaceAuthorityRef.current;
    const current = committedSnapshotStateRef.current;
    if (!current || current.authority !== authority || !current.snapshot) return null;
    const merged = mergeLayoutProjection(current.snapshot, candidate);
    if (!merged) return null;
    if (merged.snapshot !== current.snapshot && !commitSnapshot(authority, merged.snapshot, 'projection')) return null;
    projectionCommitEpochRef.current += 1;
    return merged;
  }, [commitSnapshot]);

  const applyViewportProjection = useCallback((
    candidate: ArtifactWorkspaceView,
    operationAuthority: RequestAuthority,
  ): { snapshot: ArtifactWorkspaceSnapshot; view: ArtifactWorkspaceView } | null => {
    if (requestAuthorityRef.current !== operationAuthority) return null;
    const authority = workspaceAuthorityRef.current;
    const current = committedSnapshotStateRef.current;
    if (!current || current.authority !== authority || !current.snapshot) return null;
    const merged = mergeViewportProjection(current.snapshot, candidate);
    if (!merged) return null;
    if (merged.snapshot !== current.snapshot && !commitSnapshot(authority, merged.snapshot, 'projection')) return null;
    projectionCommitEpochRef.current += 1;
    return merged;
  }, [commitSnapshot]);

  const refresh = useCallback(async () => {
    const capturedWorkspaceAuthority = workspaceAuthority;
    const capturedRequestAuthority = requestAuthority;
    const epoch = ++requestEpochRef.current;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const operationProjectionEpoch = projectionCommitEpochRef.current;
    const api = readApi();
    if (!api.getArtifactWorkspaceSnapshot) {
      if (requestAuthorityRef.current === capturedRequestAuthority) {
        setRequestState({
          authority: capturedRequestAuthority,
          status: 'unavailable',
          error: null,
        });
      }
      return;
    }
    setRequestState({
      authority: capturedRequestAuthority,
      status: 'loading',
      error: null,
    });
    try {
      const selectedArtifact = selectedArtifactForIpc(input.sourceArtifact);
      const result = await api.getArtifactWorkspaceSnapshot({
        conversationId: input.conversationId,
        ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
        ...(selectedArtifact ? { selectedArtifact } : {}),
      });
      if (epoch !== requestEpochRef.current || requestAuthorityRef.current !== capturedRequestAuthority) return;
      if (fullSnapshotCommitEpochRef.current !== operationCommitEpoch) {
        scheduleAuthoritativeResync();
        const current = committedSnapshotStateRef.current;
        const currentSnapshot = current?.authority === capturedWorkspaceAuthority ? current.snapshot : null;
        setRequestState({
          authority: capturedRequestAuthority,
          status: currentSnapshot ? 'ready' : 'empty',
          error: null,
        });
        return;
      }
      if (!result.ok) {
        if (result.error.code === 'workspace_not_found') {
          if (projectionCommitEpochRef.current !== operationProjectionEpoch) {
            scheduleAuthoritativeResync();
            const current = committedSnapshotStateRef.current;
            const currentSnapshot = current?.authority === capturedWorkspaceAuthority ? current.snapshot : null;
            setRequestState({
              authority: capturedRequestAuthority,
              status: currentSnapshot ? 'ready' : 'empty',
              error: null,
            });
            return;
          }
          commitSnapshot(capturedWorkspaceAuthority, null);
          setRequestState({
            authority: capturedRequestAuthority,
            status: 'empty',
            error: null,
          });
          return;
        }
        setRequestState({
          authority: capturedRequestAuthority,
          status: 'error',
          error: result.error.message ?? result.error.code,
        });
        return;
      }
      commitSnapshot(capturedWorkspaceAuthority, result.data);
      setRequestState({
        authority: capturedRequestAuthority,
        status: 'ready',
        error: null,
      });
    } catch (caught) {
      if (epoch !== requestEpochRef.current || requestAuthorityRef.current !== capturedRequestAuthority) return;
      if (fullSnapshotCommitEpochRef.current !== operationCommitEpoch) {
        scheduleAuthoritativeResync();
        const current = committedSnapshotStateRef.current;
        const currentSnapshot = current?.authority === capturedWorkspaceAuthority ? current.snapshot : null;
        setRequestState({
          authority: capturedRequestAuthority,
          status: currentSnapshot ? 'ready' : 'empty',
          error: null,
        });
        return;
      }
      setRequestState({
        authority: capturedRequestAuthority,
        status: 'error',
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }, [commitSnapshot, input.conversationId, input.sourceArtifact, input.workspaceRootId, requestAuthority, scheduleAuthoritativeResync, workspaceAuthority]);
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
    return () => {
      requestEpochRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    return () => {
      const close = readApi().closeArtifactWorkspace;
      if (!close) return;
      void close({
        conversationId: input.conversationId,
        ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      });
    };
  }, [viewSessionKey, input.conversationId, input.workspaceRootId]);

  useEffect(() => {
    const subscribe = readApi().onArtifactWorkspaceChanged;
    if (!subscribe) return;
    return subscribe((change) => {
      const currentSnapshot = snapshotRef.current;
      if (
        change.conversationId === input.conversationId
        && (!currentSnapshot || currentSnapshot.workspace.id === change.workspaceId)
      ) void refresh();
    });
  }, [input.conversationId, refresh]);

  const readPreview = useCallback(async (versionId: string) => {
    const method = readApi().readArtifactWorkspaceVersionPreview;
    if (!method) return null;
    const operationIdentity = identityKey;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      versionId,
    });
    if (requestAuthorityRef.current !== operationIdentity) return null;
    if (!result.ok) throw new Error(result.error.message ?? result.error.code);
    return result.data;
  }, [identityKey, input.conversationId, input.workspaceRootId]);

  const exportVersion = useCallback(async (versionId: string) => {
    const method = readApi().exportArtifactWorkspaceVersion;
    if (!method) return false;
    const operationIdentity = identityKey;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      versionId,
    });
    if (requestAuthorityRef.current !== operationIdentity) return false;
    if (!result.ok) {
      setRequestState((current) => current.authority === operationIdentity
        ? { ...current, error: result.error.message ?? result.error.code }
        : current);
      return false;
    }
    return result.data.exported;
  }, [identityKey, input.conversationId, input.workspaceRootId]);

  const preferVersion = useCallback(async (lineageId: string, versionId: string) => {
    const method = readApi().preferArtifactVersion;
    if (!method || !snapshot) return;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      lineageId,
      versionId,
      expectedStructureRevision: snapshot.workspace.structureRevision,
    });
    applyMutationResult(result, operationIdentity, operationCommitEpoch, true);
  }, [applyMutationResult, identityKey, input.conversationId, input.workspaceRootId, snapshot]);

  const recordEvent = useCallback(async (
    eventName: ArtifactWorkspaceEventName,
    metadata?: Record<string, string | number | boolean | null>,
  ) => {
    const method = readApi().recordArtifactWorkspaceEvent;
    if (!method) return;
    await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      eventName,
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }, [input.conversationId, input.workspaceRootId]);

  const updateLayout = useCallback((
    patch: ArtifactWorkspaceLayoutPatch,
  ): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>> => {
    const method = readApi().updateArtifactWorkspaceLayout;
    if (!method) return Promise.resolve({ ok: false, error: { code: 'feature_disabled' as const } });
    const operationIdentity = identityKey;
    if (requestAuthorityRef.current !== operationIdentity) {
      return Promise.resolve(staleWorkspaceOperation());
    }
    const queue = layoutQueueRef.current;
    const execute = async (): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>> => {
      if (requestAuthorityRef.current !== operationIdentity) {
        return staleWorkspaceOperation();
      }
      const result = await method({
        conversationId: input.conversationId,
        ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
        patches: [patch],
      });
      if (requestAuthorityRef.current !== operationIdentity) {
        return staleWorkspaceOperation();
      }
      if (result.ok) {
        const candidate = result.data.nodes.find((node) => node.id === patch.nodeId);
        const accepted = candidate ? applyLayoutProjection(candidate, operationIdentity) : null;
        return accepted ? { ok: true, data: accepted.snapshot } : staleWorkspaceOperation();
      }
      const canonical = readCanonicalLayoutNode(result.error, patch.nodeId);
      if (!canonical) return result;
      const accepted = applyLayoutProjection(canonical, operationIdentity);
      if (!accepted) return staleWorkspaceOperation();
      return {
        ok: false,
        error: {
          code: result.error.code,
          ...(result.error.message ? { message: result.error.message } : {}),
          canonical: accepted.node,
        },
      };
    };
    const operation = queue.tail.then(execute, execute);
    queue.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }, [applyLayoutProjection, identityKey, input.conversationId, input.workspaceRootId]);

  const saveViewport = useCallback(async (
    viewport: { x: number; y: number; zoom: number },
  ): Promise<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>> => {
    const method = readApi().saveArtifactWorkspaceViewport;
    if (!method) return { ok: false, error: { code: 'feature_disabled' as const } };
    const operationIdentity = identityKey;
    const expectedViewRevision = snapshot?.view?.viewRevision;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      viewport,
      ...(expectedViewRevision !== undefined ? { expectedViewRevision } : {}),
    });
    if (requestAuthorityRef.current !== operationIdentity) return staleWorkspaceOperation();
    if (result.ok) {
      const accepted = result.data.view
        ? applyViewportProjection(result.data.view, operationIdentity)
        : null;
      return accepted ? { ok: true, data: accepted.snapshot } : staleWorkspaceOperation();
    }
    const canonical = readCanonicalViewport(result.error);
    if (!canonical) return result;
    const accepted = applyViewportProjection(canonical, operationIdentity);
    if (!accepted) return staleWorkspaceOperation();
    return {
      ok: false,
      error: {
        code: result.error.code,
        ...(result.error.message ? { message: result.error.message } : {}),
        canonical: accepted.view,
      },
    };
  }, [applyViewportProjection, identityKey, input.conversationId, input.workspaceRootId, snapshot?.view?.viewRevision]);

  const removeNode = useCallback(async (nodeId: string) => {
    const method = readApi().removeArtifactWorkspaceNode;
    if (!method || !snapshot) return;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      nodeId,
      expectedStructureRevision: snapshot.workspace.structureRevision,
    });
    applyMutationResult(result, operationIdentity, operationCommitEpoch);
  }, [applyMutationResult, identityKey, input.conversationId, input.workspaceRootId, snapshot]);

  const submitRevision = useCallback(async (revision: {
    prompt: string;
    sourceVersionId?: string;
    requestedKind: ArtifactWorkspaceRequestedKind;
  }) => {
    const method = readApi().submitArtifactGeneration;
    if (!method || !snapshot || (!revision.sourceVersionId && !input.sourceArtifact?.sourceTaskId)) return false;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const selectedArtifact = selectedArtifactForIpc(input.sourceArtifact);
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      prompt: revision.prompt,
      ...(revision.sourceVersionId ? { sourceVersionId: revision.sourceVersionId } : {}),
      ...(selectedArtifact ? { selectedArtifact } : {}),
      requestedKind: revision.requestedKind,
      expectedStructureRevision: snapshot.workspace.structureRevision,
    });
    return applyMutationResult(result, operationIdentity, operationCommitEpoch, true);
  }, [applyMutationResult, identityKey, input.conversationId, input.sourceArtifact, input.workspaceRootId, snapshot]);

  const cancelGeneration = useCallback(async (generationRequestId: string) => {
    const method = readApi().cancelArtifactGeneration;
    if (!method) return false;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      generationRequestId,
    });
    return applyMutationResult(result, operationIdentity, operationCommitEpoch, true);
  }, [applyMutationResult, identityKey, input.conversationId, input.workspaceRootId]);

  const retryGeneration = useCallback(async (generationRequestId: string, prompt?: string) => {
    const method = readApi().retryArtifactGeneration;
    if (!method) return false;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      generationRequestId,
      ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
    });
    return applyMutationResult(result, operationIdentity, operationCommitEpoch, true);
  }, [applyMutationResult, identityKey, input.conversationId, input.workspaceRootId]);

  const createCollection = useCallback(async (title: string) => {
    const method = readApi().createArtifactWorkspaceCollection;
    if (!method || !snapshot) return;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      title,
      expectedStructureRevision: snapshot.workspace.structureRevision,
    });
    applyMutationResult(result, operationIdentity, operationCommitEpoch);
  }, [applyMutationResult, identityKey, input.conversationId, input.workspaceRootId, snapshot]);

  const createNote = useCallback(async (noteText: string) => {
    const method = readApi().createArtifactWorkspaceNote;
    if (!method || !snapshot) return;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      noteText,
      expectedStructureRevision: snapshot.workspace.structureRevision,
    });
    applyMutationResult(result, operationIdentity, operationCommitEpoch);
  }, [applyMutationResult, identityKey, input.conversationId, input.workspaceRootId, snapshot]);

  const updateNote = useCallback(async (nodeId: string, noteText: string) => {
    const method = readApi().updateArtifactWorkspaceNote;
    if (!method || !snapshot) return;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      nodeId,
      noteText,
      expectedStructureRevision: snapshot.workspace.structureRevision,
    });
    applyMutationResult(result, operationIdentity, operationCommitEpoch);
  }, [applyMutationResult, identityKey, input.conversationId, input.workspaceRootId, snapshot]);

  const addToCollection = useCallback(async (memberNodeId: string, collectionNodeId: string) => {
    const method = readApi().setArtifactCollectionMembership;
    if (!method || !snapshot) return;
    const operationIdentity = identityKey;
    const operationCommitEpoch = fullSnapshotCommitEpochRef.current;
    const result = await method({
      conversationId: input.conversationId,
      ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
      memberNodeId,
      collectionNodeId,
      included: true,
      expectedStructureRevision: snapshot.workspace.structureRevision,
    });
    applyMutationResult(result, operationIdentity, operationCommitEpoch);
  }, [applyMutationResult, identityKey, input.conversationId, input.workspaceRootId, snapshot]);

  return {
    snapshot,
    status,
    error,
    refresh,
    readPreview,
    exportVersion,
    preferVersion,
    recordEvent,
    updateLayout,
    saveViewport,
    removeNode,
    submitRevision,
    cancelGeneration,
    retryGeneration,
    createCollection,
    createNote,
    updateNote,
    addToCollection,
  };
}
