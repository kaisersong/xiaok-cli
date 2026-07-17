import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ArtifactWorkspaceSelectedArtifact, ArtifactWorkspaceSnapshot } from '../../shared/artifact-workspace-types';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const reactFlowShortcutControl = vi.hoisted(() => ({
  deleteAttempts: 0,
  selectionActivations: 0,
  viewportActivations: 0,
}));

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return ({
  ReactFlow: ({
    nodes,
    edges,
    fitView,
    defaultViewport,
    deleteKeyCode,
    selectionKeyCode,
    multiSelectionKeyCode,
    panActivationKeyCode,
    zoomActivationKeyCode,
    disableKeyboardA11y,
    onInit,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    onMoveEnd,
    children,
  }: any) => {
    React.useEffect(() => {
      const handleGlobalKeyDown = (event: KeyboardEvent) => {
        if ((event.key === 'Backspace' || event.key === 'Delete') && deleteKeyCode !== null) {
          reactFlowShortcutControl.deleteAttempts += 1;
        }
        if ((event.key === 'Meta' || event.key === 'Control') && multiSelectionKeyCode !== null) {
          reactFlowShortcutControl.selectionActivations += 1;
        }
        if ((event.key === ' ' || event.code === 'Space') && panActivationKeyCode !== null) {
          reactFlowShortcutControl.viewportActivations += 1;
        }
      };
      document.addEventListener('keydown', handleGlobalKeyDown);
      return () => document.removeEventListener('keydown', handleGlobalKeyDown);
    }, [deleteKeyCode, multiSelectionKeyCode, panActivationKeyCode]);
    onInit?.({
      setViewport: vi.fn((viewport) => {
        onMoveEnd?.({}, viewport);
        return Promise.resolve(true);
      }),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitView: vi.fn(),
    });
    return <div
      data-testid="react-flow"
      data-edge-count={edges.length}
      data-fit-view={String(Boolean(fitView))}
      data-default-viewport={defaultViewport ? JSON.stringify(defaultViewport) : ''}
      data-delete-key={String(deleteKeyCode)}
      data-selection-key={String(selectionKeyCode)}
      data-multi-key={String(multiSelectionKeyCode)}
      data-pan-key={String(panActivationKeyCode)}
      data-zoom-key={String(zoomActivationKeyCode)}
      data-keyboard-a11y-disabled={String(Boolean(disableKeyboardA11y))}
    >
      {nodes.map((node: any) => (
        <div key={node.id}>
          {node.data.label}
          <span data-testid={`position-${node.id}`}>{node.position.x},{node.position.y}:{node.data.node.layoutRevision}</span>
          <button
            type="button"
            aria-label={node.data.label}
            tabIndex={node.data.tabIndex}
            onFocus={() => node.data.onFocus(node.id)}
            onKeyDown={(event) => node.data.onKeyDown(event, node.data.node)}
          >node-{node.id}</button>
          <button type="button" onClick={() => onNodeDragStart?.({}, node)}>start-{node.id}</button>
          <button type="button" onClick={() => onNodeDrag?.({}, { ...node, position: { x: 40, y: 50 } })}>move-{node.id}</button>
          <button type="button" onClick={() => onNodeDragStop?.({}, { ...node, position: { x: 40, y: 50 } })}>stop-{node.id}</button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onMoveEnd?.({}, defaultViewport ?? { x: 0, y: 0, zoom: 1 })}
      >move-canonical-viewport</button>
      <button
        type="button"
        onClick={() => onMoveEnd?.({}, defaultViewport
          ? { x: defaultViewport.x + 0.005, y: defaultViewport.y - 0.005, zoom: defaultViewport.zoom + 0.00005 }
          : { x: 0.005, y: -0.005, zoom: 1.00005 })}
      >move-jittered-viewport</button>
      <button
        type="button"
        onClick={() => onMoveEnd?.({}, { x: 40, y: 50, zoom: 1.25 })}
      >move-changed-viewport</button>
      {children}
    </div>;
  },
  Background: () => <div data-testid="background" />,
  Controls: ({ children }: any) => <div data-testid="controls">{children}</div>,
  ControlButton: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  MiniMap: () => <div data-testid="minimap" />,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  });
});

import { ArtifactSpatialCanvas } from '../../renderer/src/components/artifact-workspace/ArtifactSpatialCanvas';
import { ArtifactWorkspacePanel } from '../../renderer/src/components/artifact-workspace/ArtifactWorkspacePanel';
import { CanvasPreview } from '../../renderer/src/components/CanvasPreview';
import { CanvasPanel } from '../../renderer/src/components/CanvasPanel';
import { _resetDesktopApiCache } from '../../renderer/src/shared/desktop';

type PreviewNavigationContext = {
  originSurface: 'preview' | 'canvas';
  epoch: number;
};

type ArtifactWorkspacePanelContractProps = React.ComponentProps<typeof ArtifactWorkspacePanel> & {
  previewNavigationContext?: PreviewNavigationContext;
  onSpatialAvailabilityChange?: (availability: 'unknown' | 'enabled' | 'hidden') => void;
  interactionActive?: boolean;
};

type ArtifactSpatialCanvasContractProps = React.ComponentProps<typeof ArtifactSpatialCanvas> & {
  interactionActive?: boolean;
};

type CanvasPreviewContractProps = React.ComponentProps<typeof CanvasPreview> & {
  interactionActive?: boolean;
};

const ArtifactWorkspacePanelWithContract = ArtifactWorkspacePanel as React.ComponentType<
  ArtifactWorkspacePanelContractProps
>;

const ArtifactSpatialCanvasWithContract = ArtifactSpatialCanvas as React.ComponentType<
  ArtifactSpatialCanvasContractProps
>;

const CanvasPreviewWithContract = CanvasPreview as React.ComponentType<CanvasPreviewContractProps>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot(): ArtifactWorkspaceSnapshot {
  const base = {
    workspaceId: 'workspace-1', owner: 'user' as const, width: 280, height: 180, zIndex: 1,
    layoutRevision: 0, createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  };
  return {
    workspace: { id: 'workspace-1', conversationId: 'conversation-1', workspaceRootId: 'root-1', schemaVersion: 1, structureRevision: 1, createdAt: base.createdAt, updatedAt: base.updatedAt },
    access: { revision: 'write', spatial: 'enabled' },
    nodes: [
      { ...base, id: 'artifact-1', kind: 'artifact', lineageId: 'lineage-1', artifactVersionId: 'version-1', title: 'Artifact', x: 0, y: 0 },
      { ...base, id: 'placeholder-1', kind: 'placeholder', placeholderKind: 'image', placeholderState: 'draft', title: 'Placeholder', x: 300, y: 0 },
      { ...base, id: 'collection-1', kind: 'collection', title: 'Collection', x: 0, y: 240 },
      { ...base, id: 'note-1', kind: 'note', noteText: '<script>alert(1)</script>', title: 'Note', x: 300, y: 240 },
      { ...base, id: 'invalid-1', kind: 'transcript' as any, title: 'Invalid', x: 600, y: 0 },
    ],
    relations: [
      { id: 'relation-1', workspaceId: 'workspace-1', fromNodeId: 'artifact-1', toNodeId: 'collection-1', kind: 'part_of_collection', createdBy: 'user', createdAt: base.createdAt },
      { id: 'relation-invalid', workspaceId: 'workspace-1', fromNodeId: 'artifact-1', toNodeId: 'note-1', kind: 'freehand' as any, createdBy: 'user', createdAt: base.createdAt },
    ],
    lineages: [], versions: [], generationRequests: [], staging: [],
  };
}

function renderCanvas(props: Partial<ArtifactSpatialCanvasContractProps> = {}) {
  localStorage.setItem('xiaok:locale', 'en');
  return render(
    <LocaleProvider>
      <ArtifactSpatialCanvasWithContract
        snapshot={snapshot()}
        onLayoutPatch={vi.fn(async () => ({ ok: true, data: snapshot() }))}
        onViewportChange={vi.fn(async () => ({ ok: true, data: snapshot() }))}
        {...props}
      />
    </LocaleProvider>,
  );
}

function cleanSpatialSnapshot(): ArtifactWorkspaceSnapshot {
  const current = snapshot();
  current.nodes = [];
  current.relations = [];
  current.lineages = [];
  current.versions = [];
  return current;
}

function installSpatialPanelApi(current: ArtifactWorkspaceSnapshot) {
  const submitGeneration = vi.fn(async () => ({ ok: true as const, data: current }));
  Object.defineProperty(window, 'xiaokDesktop', {
    configurable: true,
    value: {
      getArtifactWorkspaceSnapshot: vi.fn(async () => ({ ok: true, data: current })),
      submitArtifactGeneration: submitGeneration,
      updateArtifactWorkspaceLayout: vi.fn(async () => ({ ok: true, data: current })),
      saveArtifactWorkspaceViewport: vi.fn(async () => ({ ok: true, data: current })),
    },
  });
  return submitGeneration;
}

function renderSpatialPanel(current: ArtifactWorkspaceSnapshot, sourceArtifact?: ArtifactWorkspaceSelectedArtifact) {
  const submitGeneration = installSpatialPanelApi(current);
  const view = render(
    <LocaleProvider>
      <ArtifactWorkspacePanel conversationId="conversation-1" sourceArtifact={sourceArtifact} />
    </LocaleProvider>,
  );
  return { ...view, submitGeneration };
}

function bootstrapActions(container: HTMLElement): HTMLElement | null {
  return container.querySelector(':scope > .artifact-workspace-object-actions');
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetDesktopApiCache();
  localStorage.clear();
});

describe('ArtifactSpatialCanvas Phase 1A', () => {
  it('renders only four typed nodes and three semantic relation kinds', () => {
    renderCanvas();
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-edge-count', '1');
    expect(screen.getAllByText('Artifact').length).toBeGreaterThan(0);
    expect(screen.getByText('Placeholder')).toBeInTheDocument();
    expect(screen.getByText('Collection')).toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.queryByText('Invalid')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });

  it('restores a persisted per-window viewport and only fits when no view exists', () => {
    const persisted = snapshot();
    persisted.view = {
      workspaceId: persisted.workspace.id,
      viewKey: 'window-opaque',
      viewport: { x: 12, y: 34, zoom: 1.5 },
      viewRevision: 3,
      updatedAt: persisted.workspace.updatedAt,
    };
    const persistedView = renderCanvas({ snapshot: persisted });
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view', 'false');
    expect(screen.getByTestId('react-flow')).toHaveAttribute(
      'data-default-viewport',
      JSON.stringify(persisted.view.viewport),
    );
    persistedView.unmount();

    renderCanvas();
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view', 'true');
  });

  it('does not persist canonical viewport echoes or insignificant float jitter', async () => {
    vi.useFakeTimers();
    const persisted = snapshot();
    persisted.view = {
      workspaceId: persisted.workspace.id,
      viewKey: 'window-opaque',
      viewport: { x: 12, y: 34, zoom: 1.5 },
      viewRevision: 3,
      updatedAt: persisted.workspace.updatedAt,
    };
    const onViewportChange = vi.fn(async () => ({ ok: true as const, data: persisted }));
    renderCanvas({ snapshot: persisted, onViewportChange });

    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onViewportChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'move-canonical-viewport' }));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onViewportChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'move-jittered-viewport' }));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it('persists a real viewport change once after the debounce window', async () => {
    vi.useFakeTimers();
    const persisted = snapshot();
    persisted.view = {
      workspaceId: persisted.workspace.id,
      viewKey: 'window-opaque',
      viewport: { x: 12, y: 34, zoom: 1.5 },
      viewRevision: 3,
      updatedAt: persisted.workspace.updatedAt,
    };
    const onViewportChange = vi.fn(async () => ({ ok: true as const, data: persisted }));
    renderCanvas({ snapshot: persisted, onViewportChange });

    fireEvent.click(screen.getByRole('button', { name: 'move-changed-viewport' }));
    await act(async () => { vi.advanceTimersByTime(249); });
    expect(onViewportChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledWith({ x: 40, y: 50, zoom: 1.25 });
  });

  it('cancels a pending viewport save when the final viewport returns to canonical', async () => {
    vi.useFakeTimers();
    const persisted = snapshot();
    persisted.view = {
      workspaceId: persisted.workspace.id,
      viewKey: 'window-opaque',
      viewport: { x: 12, y: 34, zoom: 1.5 },
      viewRevision: 3,
      updatedAt: persisted.workspace.updatedAt,
    };
    const onViewportChange = vi.fn(async () => ({ ok: true as const, data: persisted }));
    renderCanvas({ snapshot: persisted, onViewportChange });

    fireEvent.click(screen.getByRole('button', { name: 'move-changed-viewport' }));
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.click(screen.getByRole('button', { name: 'move-canonical-viewport' }));
    await act(async () => { vi.advanceTimersByTime(300); });

    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it('keeps pointer movement local and sends one layout patch on pointerup', async () => {
    const onLayoutPatch = vi.fn(async () => ({ ok: true, data: snapshot() }));
    renderCanvas({ onLayoutPatch });

    fireEvent.click(screen.getByRole('button', { name: 'start-artifact-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'move-artifact-1' }));
    expect(onLayoutPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'stop-artifact-1' }));
    expect(onLayoutPatch).toHaveBeenCalledTimes(1);
    expect(onLayoutPatch).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'artifact-1', x: 40, y: 50 }));
  });

  it('applies the IPC canonical node after a layout conflict', async () => {
    const canonicalNode = { ...snapshot().nodes[0], x: 70, y: 80, layoutRevision: 4 };
    const onLayoutPatch = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'layout_revision_conflict' as const, canonical: canonicalNode },
    }));
    renderCanvas({ onLayoutPatch });

    fireEvent.click(screen.getByRole('button', { name: 'start-artifact-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'move-artifact-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'stop-artifact-1' }));

    await waitFor(() => {
      expect(screen.getByTestId('position-artifact-1')).toHaveTextContent('70,80:4');
    });
  });

  it('batches arrow movement for 250ms, supports shift acceleration, enter, escape, and confirm-only delete', async () => {
    vi.useFakeTimers();
    const onLayoutPatch = vi.fn(async () => ({ ok: true, data: snapshot() }));
    const onOpenNode = vi.fn();
    const onRequestRemove = vi.fn();
    renderCanvas({ onLayoutPatch, onOpenNode, onRequestRemove });

    const nodeButton = screen.getByRole('button', { name: 'Artifact' });
    nodeButton.focus();
    fireEvent.keyDown(nodeButton, { key: 'ArrowRight' });
    fireEvent.keyDown(nodeButton, { key: 'ArrowDown', shiftKey: true });
    expect(onLayoutPatch).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(onLayoutPatch).toHaveBeenCalledTimes(1);
    expect(onLayoutPatch).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1, y: 10 }));

    fireEvent.keyDown(nodeButton, { key: 'Enter' });
    expect(onOpenNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'artifact-1' }));
    fireEvent.keyDown(nodeButton, { key: 'Delete' });
    expect(onRequestRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Remove from workspace?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRequestRemove).not.toHaveBeenCalled();
  });

  it('keeps React Flow deletion disabled while active and restores its other keyboard defaults', () => {
    renderCanvas({ interactionActive: true });

    const flow = screen.getByTestId('react-flow');
    expect(flow).toHaveAttribute('data-delete-key', 'null');
    expect(flow).toHaveAttribute('data-selection-key', 'undefined');
    expect(flow).toHaveAttribute('data-multi-key', 'undefined');
    expect(flow).toHaveAttribute('data-pan-key', 'undefined');
    expect(flow).toHaveAttribute('data-zoom-key', 'undefined');
    expect(flow).toHaveAttribute('data-keyboard-a11y-disabled', 'false');
  });

  it('disables React Flow keyboard activation props while inactive', () => {
    renderCanvas({ interactionActive: false });

    const flow = screen.getByTestId('react-flow');
    expect(flow).toHaveAttribute('data-delete-key', 'null');
    expect(flow).toHaveAttribute('data-selection-key', 'null');
    expect(flow).toHaveAttribute('data-multi-key', 'null');
    expect(flow).toHaveAttribute('data-pan-key', 'null');
    expect(flow).toHaveAttribute('data-zoom-key', 'null');
    expect(flow).toHaveAttribute('data-keyboard-a11y-disabled', 'true');
  });

  it('suppresses global Flow shortcuts from a Preview owner while inactive', () => {
    localStorage.setItem('xiaok:locale', 'en');
    reactFlowShortcutControl.deleteAttempts = 0;
    reactFlowShortcutControl.selectionActivations = 0;
    reactFlowShortcutControl.viewportActivations = 0;
    const onLayoutPatch = vi.fn(async () => ({ ok: true as const, data: snapshot() }));
    const onViewportChange = vi.fn(async () => ({ ok: true as const, data: snapshot() }));
    const onRequestRemove = vi.fn();
    const surface = (interactionActive: boolean) => (
      <LocaleProvider>
        <div tabIndex={0} data-canvas-surface="preview" aria-label="Preview shortcut owner" />
        <ArtifactSpatialCanvasWithContract
          snapshot={snapshot()}
          interactionActive={interactionActive}
          onLayoutPatch={onLayoutPatch}
          onViewportChange={onViewportChange}
          onRequestRemove={onRequestRemove}
        />
      </LocaleProvider>
    );
    const view = render(surface(false));
    let previewOwner = screen.getByLabelText('Preview shortcut owner');
    previewOwner.focus();

    fireEvent.keyDown(previewOwner, { key: 'Backspace', code: 'Backspace' });
    fireEvent.keyDown(previewOwner, { key: ' ', code: 'Space' });
    fireEvent.keyDown(previewOwner, { key: 'Meta', code: 'MetaLeft', metaKey: true });
    fireEvent.keyDown(previewOwner, { key: 'Control', code: 'ControlLeft', ctrlKey: true });

    expect(reactFlowShortcutControl).toEqual({
      deleteAttempts: 0,
      selectionActivations: 0,
      viewportActivations: 0,
    });
    expect(screen.getByTestId('position-artifact-1')).toHaveTextContent('0,0:0');
    expect(screen.queryByRole('dialog', { name: 'Remove from workspace?' })).toBeNull();
    expect(onLayoutPatch).not.toHaveBeenCalled();
    expect(onViewportChange).not.toHaveBeenCalled();
    expect(onRequestRemove).not.toHaveBeenCalled();

    view.rerender(surface(true));
    previewOwner = screen.getByLabelText('Preview shortcut owner');
    previewOwner.focus();
    fireEvent.keyDown(previewOwner, { key: 'Backspace', code: 'Backspace' });
    fireEvent.keyDown(previewOwner, { key: ' ', code: 'Space' });
    fireEvent.keyDown(previewOwner, { key: 'Meta', code: 'MetaLeft', metaKey: true });
    fireEvent.keyDown(previewOwner, { key: 'Control', code: 'ControlLeft', ctrlKey: true });

    expect(reactFlowShortcutControl).toEqual({
      deleteAttempts: 0,
      selectionActivations: 2,
      viewportActivations: 1,
    });
  });

  it('ignores custom node keyboard intents while inactive', async () => {
    vi.useFakeTimers();
    const onLayoutPatch = vi.fn(async () => ({ ok: true, data: snapshot() }));
    const onOpenNode = vi.fn();
    const onRequestRemove = vi.fn();
    renderCanvas({
      interactionActive: false,
      onLayoutPatch,
      onOpenNode,
      onRequestRemove,
    });

    const nodeButton = screen.getByRole('button', { name: 'Artifact' });
    nodeButton.focus();
    fireEvent.keyDown(nodeButton, { key: 'Enter' });
    fireEvent.keyDown(nodeButton, { key: 'Delete' });
    fireEvent.keyDown(nodeButton, { key: 'ArrowRight' });
    await act(async () => { vi.advanceTimersByTime(250); });

    expect(onOpenNode).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Remove from workspace?' })).toBeNull();
    expect(onRequestRemove).not.toHaveBeenCalled();
    expect(onLayoutPatch).not.toHaveBeenCalled();
  });

  it('has labelled zoom controls and pauses shortcuts while iframe detail owns focus', () => {
    renderCanvas({ iframeFocused: true });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    const nodeButton = screen.getByRole('button', { name: 'Artifact' });
    fireEvent.keyDown(nodeButton, { key: 'Delete' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates collections and plain-text notes and adds an artifact through a semantic membership action', () => {
    const onCreateCollection = vi.fn();
    const onCreateNote = vi.fn();
    const onAddToCollection = vi.fn();
    const onUpdateNote = vi.fn();
    renderCanvas({ onCreateCollection, onCreateNote, onAddToCollection, onUpdateNote });

    fireEvent.click(screen.getByRole('button', { name: 'New collection' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Collection title' }), { target: { value: 'Deck A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    expect(onCreateCollection).toHaveBeenCalledWith('Deck A');

    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), { target: { value: '<b>plain</b>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(onCreateNote).toHaveBeenCalledWith('<b>plain</b>');

    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Select collection' })).getByRole('button', { name: 'Collection' }));
    expect(onAddToCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'artifact-1' }),
      expect.objectContaining({ id: 'collection-1' }),
    );

    fireEvent.focus(screen.getByRole('button', { name: '<script>alert(1)</script>' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), { target: { value: 'Updated note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(onUpdateNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-1' }), 'Updated note');
  });

  it('keeps revision actions object-local in the spatial detail panel', () => {
    const current = snapshot();
    current.lineages = [{
      id: 'lineage-1', workspaceId: current.workspace.id, sourceLocatorHash: 'opaque',
      preferredVersionId: 'version-1', createdAt: current.workspace.createdAt, updatedAt: current.workspace.updatedAt,
    }];
    current.versions = [
      {
        id: 'version-1', lineageId: 'lineage-1', storageKind: 'single_file', sourceKind: 'materialized_base',
        kind: 'html', mimeType: 'text/html', checksum: 'one', status: 'ready', createdAt: current.workspace.createdAt,
        preferred: true, preview: { available: true, title: 'Original', contentKind: 'text' },
      },
      {
        id: 'version-2', lineageId: 'lineage-1', parentVersionId: 'version-1', storageKind: 'single_file',
        sourceKind: 'workspace_generation', kind: 'html', mimeType: 'text/html', checksum: 'two', status: 'ready',
        createdAt: current.workspace.updatedAt, preferred: false,
        preview: { available: true, title: 'Revision 2', contentKind: 'text' },
      },
    ];
    const onCompareVersion = vi.fn();
    const onPreferVersion = vi.fn();
    const onDownloadVersion = vi.fn();
    const onArtifactAction = vi.fn();
    renderCanvas({
      snapshot: current,
      onCompareVersion,
      onPreferVersion,
      onDownloadVersion,
      onArtifactAction,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Revision 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set as preferred' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create revision' }));

    expect(onCompareVersion).toHaveBeenCalledWith(expect.objectContaining({ id: 'version-2' }));
    expect(onPreferVersion).toHaveBeenCalledWith(expect.objectContaining({ id: 'version-2' }));
    expect(onDownloadVersion).toHaveBeenCalledWith(expect.objectContaining({ id: 'version-2' }));
    expect(onArtifactAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'version-2' }), 'revision');
  });

  it('offers cancel for active placeholders and retry/remove for recoverable placeholders', () => {
    const active = snapshot();
    active.generationRequests = [{
      id: 'request-1', workspaceId: active.workspace.id, placeholderNodeId: 'placeholder-1',
      producingTaskId: 'task-1', state: 'running', createdAt: active.workspace.createdAt, updatedAt: active.workspace.updatedAt,
    }];
    const onCancelGeneration = vi.fn();
    const activeView = renderCanvas({ snapshot: active, onCancelGeneration });
    fireEvent.focus(screen.getByRole('button', { name: 'Placeholder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelGeneration).toHaveBeenCalledWith(expect.objectContaining({ id: 'request-1' }));
    activeView.unmount();

    const recoverable = snapshot();
    recoverable.nodes = recoverable.nodes.map((node) => node.id === 'placeholder-1'
      ? { ...node, placeholderState: 'needs_recovery' as const }
      : node);
    recoverable.generationRequests = [{
      id: 'request-2', workspaceId: recoverable.workspace.id, placeholderNodeId: 'placeholder-1',
      producingTaskId: 'task-2', state: 'needs_recovery', errorCode: 'runtime_unavailable',
      createdAt: recoverable.workspace.createdAt, updatedAt: recoverable.workspace.updatedAt,
    }];
    const onRetryGeneration = vi.fn();
    const onRequestRemove = vi.fn();
    renderCanvas({ snapshot: recoverable, onRetryGeneration, onRequestRemove });
    fireEvent.focus(screen.getByRole('button', { name: 'Placeholder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryGeneration).toHaveBeenCalledWith(expect.objectContaining({ id: 'request-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('dialog', { name: 'Remove from workspace?' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove from workspace?' })).getByRole('button', { name: 'Remove' }));
    expect(onRequestRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'placeholder-1' }));
  });
});

describe('artifact workspace iframe focus handoff', () => {
  it('renders HTML compare/detail in read-only mode and reports iframe focus transitions', () => {
    localStorage.setItem('xiaok:locale', 'en');
    const onIframeFocusChange = vi.fn();
    render(
      <LocaleProvider>
        <CanvasPreview
          filePath="revision.html"
          content="<html><body>Revision</body></html>"
          interactionMode="read_only"
          onIframeFocusChange={onIframeFocusChange}
        />
      </LocaleProvider>,
    );

    const frame = screen.getByTitle('Artifact preview');
    fireEvent.focus(frame);
    fireEvent.blur(frame);
    expect(onIframeFocusChange.mock.calls).toEqual([[true], [false]]);
    expect(screen.queryByRole('button', { name: 'Start revision' })).toBeNull();
  });

  it('suppresses read-only iframe focus handoff while inactive and enables it after activation', () => {
    localStorage.setItem('xiaok:locale', 'en');
    const onIframeFocusChange = vi.fn();
    const onIframeFocusReturn = vi.fn();
    const preview = (interactionActive: boolean) => (
      <LocaleProvider>
        <CanvasPreviewWithContract
          filePath="revision.html"
          content="<html><body>Revision</body></html>"
          interactionMode="read_only"
          interactionActive={interactionActive}
          onIframeFocusChange={onIframeFocusChange}
          onIframeFocusReturn={onIframeFocusReturn}
        />
      </LocaleProvider>
    );
    const view = render(preview(false));
    const inactiveFrame = screen.getByTitle('Artifact preview');

    fireEvent.focus(inactiveFrame);
    fireEvent.blur(inactiveFrame);
    expect(onIframeFocusChange).not.toHaveBeenCalled();
    expect(onIframeFocusReturn).not.toHaveBeenCalled();

    view.rerender(preview(true));
    const activeFrame = screen.getByTitle('Artifact preview');
    expect(activeFrame).toBe(inactiveFrame);

    fireEvent.focus(activeFrame);
    fireEvent.blur(activeFrame);
    expect(onIframeFocusChange.mock.calls).toEqual([[true], [false]]);
    expect(onIframeFocusReturn).toHaveBeenCalledTimes(1);
  });
});

describe('ArtifactWorkspacePanel spatial semantic mutations', () => {
  it('keeps the first revision action available in a clean spatial workspace', async () => {
    localStorage.setItem('xiaok:locale', 'en');
    const current = cleanSpatialSnapshot();
    const { submitGeneration } = renderSpatialPanel(current, {
      artifactId: 'artifact-source',
      sourceTaskId: 'desktop-task-9',
      kind: 'html',
      mimeType: 'text/html',
      title: 'Source report',
    });

    expect(await screen.findByTestId('react-flow')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Create revision' }));
    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      selectedArtifact: expect.objectContaining({ artifactId: 'artifact-source', sourceTaskId: 'desktop-task-9' }),
      requestedKind: 'html',
      expectedStructureRevision: 1,
    })));
    expect(submitGeneration.mock.calls[0][0]).not.toHaveProperty('sourceVersionId');
  });

  it('keeps the clean source bootstrap bound to source A after opening existing artifact B', async () => {
    localStorage.setItem('xiaok:locale', 'en');
    const current = snapshot();
    current.lineages = [{
      id: 'lineage-1', workspaceId: current.workspace.id, sourceLocatorHash: 'artifact-b',
      preferredVersionId: 'version-1', createdAt: current.workspace.createdAt, updatedAt: current.workspace.updatedAt,
    }];
    current.versions = [{
      id: 'version-1', lineageId: 'lineage-1', storageKind: 'single_file', sourceKind: 'materialized_base',
      sourceArtifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html', mimeType: 'text/html',
      checksum: 'one', status: 'ready', createdAt: current.workspace.createdAt, preferred: true,
      preview: { available: true, title: 'Artifact B', contentKind: 'text' },
    }];
    const { container, submitGeneration } = renderSpatialPanel(current, {
      artifactId: 'artifact-a', sourceTaskId: 'task-a', kind: 'html', mimeType: 'text/html', title: 'Artifact A',
    });

    await screen.findByTestId('react-flow');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Artifact' }), { key: 'Enter' });
    const actions = bootstrapActions(container);
    expect(actions).not.toBeNull();
    fireEvent.click(within(actions!).getByRole('button', { name: 'Create revision' }));

    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      selectedArtifact: expect.objectContaining({ artifactId: 'artifact-a', sourceTaskId: 'task-a' }),
      requestedKind: 'html',
    })));
    expect(submitGeneration.mock.calls[0][0]).not.toHaveProperty('sourceVersionId');
  });

  it.each([
    { mapping: 'PPTX kind', kind: 'pptx', mimeType: undefined },
    {
      mapping: 'presentation MIME',
      kind: 'file',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
  ])('maps a clean $mapping artifact to a slides revision request', async ({ kind, mimeType }) => {
    localStorage.setItem('xiaok:locale', 'en');
    const current = cleanSpatialSnapshot();
    const { submitGeneration } = renderSpatialPanel(current, {
      artifactId: 'deck-source',
      sourceTaskId: 'deck-task',
      kind,
      mimeType,
      title: 'Quarterly deck',
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Create revision' }));
    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      selectedArtifact: expect.objectContaining({ artifactId: 'deck-source', sourceTaskId: 'deck-task' }),
      requestedKind: 'slides',
    })));
    expect(submitGeneration.mock.calls[0][0]).not.toHaveProperty('sourceVersionId');
  });

  it('hides the global bootstrap after the selected source has been materialized', async () => {
    localStorage.setItem('xiaok:locale', 'en');
    const current = snapshot();
    current.lineages = [{
      id: 'lineage-1', workspaceId: current.workspace.id, sourceLocatorHash: 'artifact-source',
      preferredVersionId: 'version-1', createdAt: current.workspace.createdAt, updatedAt: current.workspace.updatedAt,
    }];
    current.versions = [{
      id: 'version-1', lineageId: 'lineage-1', storageKind: 'single_file', sourceKind: 'materialized_base',
      sourceArtifactId: 'artifact-source', sourceTaskId: 'desktop-task-9', kind: 'html', mimeType: 'text/html',
      checksum: 'one', status: 'ready', createdAt: current.workspace.createdAt, preferred: true,
      preview: { available: true, title: 'Materialized source', contentKind: 'text' },
    }];
    const { container } = renderSpatialPanel(current, {
      artifactId: 'artifact-source', sourceTaskId: 'desktop-task-9', kind: 'html', mimeType: 'text/html',
    });

    await screen.findByTestId('react-flow');
    expect(bootstrapActions(container)).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Artifact' }), { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'Create revision' })).toBeInTheDocument();
  });

  it.each([
    {
      name: 'no explicit source',
      sourceArtifact: undefined,
      mutate: (_current: ArtifactWorkspaceSnapshot) => undefined,
    },
    {
      name: 'read-only access',
      sourceArtifact: { artifactId: 'artifact-source', sourceTaskId: 'task-1', kind: 'html', mimeType: 'text/html' },
      mutate: (current: ArtifactWorkspaceSnapshot) => { current.access.revision = 'read_only'; },
    },
    {
      name: 'PDF source',
      sourceArtifact: { artifactId: 'artifact-source', sourceTaskId: 'task-1', kind: 'pdf', mimeType: 'application/pdf' },
      mutate: (_current: ArtifactWorkspaceSnapshot) => undefined,
    },
    {
      name: 'unsupported source',
      sourceArtifact: { artifactId: 'artifact-source', sourceTaskId: 'task-1', kind: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      mutate: (_current: ArtifactWorkspaceSnapshot) => undefined,
    },
    {
      name: 'missing source task identity',
      sourceArtifact: { artifactId: 'artifact-source', kind: 'html', mimeType: 'text/html' },
      mutate: (_current: ArtifactWorkspaceSnapshot) => undefined,
    },
  ])('does not expose a global bootstrap for $name', async ({ sourceArtifact, mutate }) => {
    localStorage.setItem('xiaok:locale', 'en');
    const current = cleanSpatialSnapshot();
    mutate(current);
    const { container } = renderSpatialPanel(current, sourceArtifact);

    await screen.findByTestId('react-flow');
    expect(bootstrapActions(container)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create revision' })).toBeNull();
  });

  it('routes collection, note, and membership mutations through the semantic desktop API', async () => {
    localStorage.setItem('xiaok:locale', 'en');
    const current = snapshot();
    const createCollection = vi.fn(async () => ({ ok: true, data: current }));
    const createNote = vi.fn(async () => ({ ok: true, data: current }));
    const setMembership = vi.fn(async () => ({ ok: true, data: current }));
    const updateNote = vi.fn(async () => ({ ok: true, data: current }));
    Object.defineProperty(window, 'xiaokDesktop', {
      configurable: true,
      value: {
        getArtifactWorkspaceSnapshot: vi.fn(async () => ({ ok: true, data: current })),
        createArtifactWorkspaceCollection: createCollection,
        createArtifactWorkspaceNote: createNote,
        setArtifactCollectionMembership: setMembership,
        updateArtifactWorkspaceNote: updateNote,
        updateArtifactWorkspaceLayout: vi.fn(async () => ({ ok: true, data: current })),
        saveArtifactWorkspaceViewport: vi.fn(async () => ({ ok: true, data: current })),
      },
    });
    render(
      <LocaleProvider>
        <ArtifactWorkspacePanel conversationId="conversation-1" />
      </LocaleProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'New collection' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Collection title' }), { target: { value: 'Deck B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    expect(createCollection).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      title: 'Deck B',
      expectedStructureRevision: 1,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), { target: { value: '<i>plain</i>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ noteText: '<i>plain</i>' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Select collection' })).getByRole('button', { name: 'Collection' }));
    expect(setMembership).toHaveBeenCalledWith(expect.objectContaining({
      memberNodeId: 'artifact-1',
      collectionNodeId: 'collection-1',
      included: true,
    }));

    fireEvent.focus(screen.getByRole('button', { name: '<script>alert(1)</script>' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), { target: { value: 'Panel updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'note-1', noteText: 'Panel updated' }));
  });

  it('replaces optimistic semantic state with the canonical IPC snapshot after a conflict', async () => {
    localStorage.setItem('xiaok:locale', 'en');
    const current = snapshot();
    const canonical = snapshot();
    canonical.workspace = { ...canonical.workspace, structureRevision: 2 };
    canonical.nodes = canonical.nodes.map((node) => node.id === 'note-1'
      ? { ...node, noteText: 'Canonical note' }
      : node);
    Object.defineProperty(window, 'xiaokDesktop', {
      configurable: true,
      value: {
        getArtifactWorkspaceSnapshot: vi.fn(async () => ({ ok: true, data: current })),
        updateArtifactWorkspaceNote: vi.fn(async () => ({
          ok: false,
          error: { code: 'structure_revision_conflict', canonical },
        })),
        updateArtifactWorkspaceLayout: vi.fn(async () => ({ ok: true, data: current })),
        saveArtifactWorkspaceViewport: vi.fn(async () => ({ ok: true, data: current })),
      },
    });
    render(
      <LocaleProvider>
        <ArtifactWorkspacePanel conversationId="conversation-1" />
      </LocaleProvider>,
    );

    fireEvent.focus(await screen.findByRole('button', { name: '<script>alert(1)</script>' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), { target: { value: 'Conflicting edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveValue('Canonical note'));
  });
});

describe('ArtifactWorkspacePanel retained spatial snapshot integration', () => {
  it('keeps the same selected spatial child mounted through refresh pending/error until hidden succeeds', async () => {
    localStorage.setItem('xiaok:locale', 'en');
    const enabled = snapshot();
    const hidden = snapshot();
    hidden.access = { ...hidden.access, spatial: 'hidden' };
    const failedRefresh = deferred<unknown>();
    const hiddenRefresh = deferred<unknown>();
    let workspaceChanged: ((event: { conversationId: string; workspaceId: string }) => void) | undefined;
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: enabled })
      .mockReturnValueOnce(failedRefresh.promise)
      .mockReturnValueOnce(hiddenRefresh.promise);
    const onSpatialAvailabilityChange = vi.fn();
    Object.defineProperty(window, 'xiaokDesktop', {
      configurable: true,
      value: {
        getArtifactWorkspaceSnapshot: getSnapshot,
        onArtifactWorkspaceChanged: vi.fn((handler) => {
          workspaceChanged = handler;
          return () => { workspaceChanged = undefined; };
        }),
        updateArtifactWorkspaceLayout: vi.fn(async () => ({ ok: true, data: enabled })),
        saveArtifactWorkspaceViewport: vi.fn(async () => ({ ok: true, data: enabled })),
      },
    });

    render(
      <LocaleProvider>
        <ArtifactWorkspacePanelWithContract
          conversationId="conversation-1"
          workspaceRootId="root-1"
          previewNavigationContext={{ originSurface: 'canvas', epoch: 3 }}
          interactionActive
          onSpatialAvailabilityChange={onSpatialAvailabilityChange}
        />
      </LocaleProvider>,
    );

    const spatialChild = await screen.findByTestId('react-flow');
    const selectedNode = screen.getByRole('button', { name: 'Artifact' });
    selectedNode.focus();
    const selectedDetail = await screen.findByRole('complementary', { name: 'Artifact details' });
    expect(selectedNode).toHaveFocus();
    expect(selectedDetail).toHaveTextContent('Artifact');

    act(() => {
      workspaceChanged?.({ conversationId: 'conversation-1', workspaceId: 'workspace-1' });
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('react-flow')).toBe(spatialChild);
    expect(selectedNode).toHaveFocus();
    expect(screen.getByRole('complementary', { name: 'Artifact details' })).toBe(selectedDetail);
    expect(onSpatialAvailabilityChange).toHaveBeenLastCalledWith('enabled');

    await act(async () => {
      failedRefresh.reject(new Error('Background refresh unavailable'));
      await failedRefresh.promise.catch(() => undefined);
    });
    expect(screen.getByTestId('react-flow')).toBe(spatialChild);
    expect(selectedNode).toHaveFocus();
    expect(screen.getByRole('complementary', { name: 'Artifact details' })).toBe(selectedDetail);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Background refresh unavailable');
    expect(onSpatialAvailabilityChange).toHaveBeenLastCalledWith('enabled');

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('react-flow')).toBe(spatialChild);
    expect(selectedNode).toHaveFocus();
    expect(onSpatialAvailabilityChange).toHaveBeenLastCalledWith('enabled');

    await act(async () => {
      hiddenRefresh.resolve({ ok: true, data: hidden });
      await hiddenRefresh.promise;
    });
    expect(screen.queryByTestId('react-flow')).toBeNull();
    expect(onSpatialAvailabilityChange).toHaveBeenLastCalledWith('hidden');
  });

  it('does not let a stale source layout response overwrite the retained real Canvas child', async () => {
    localStorage.setItem('xiaok:locale', 'en');
    const sourceA = {
      artifactId: 'artifact-a', sourceTaskId: 'task-a', kind: 'html', title: 'Artifact A',
    };
    const sourceB = {
      artifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html', title: 'Artifact B',
    };
    const workspaceA = snapshot();
    const workspaceB = snapshot();
    workspaceB.workspace = { ...workspaceB.workspace, structureRevision: 4 };
    workspaceB.nodes = workspaceB.nodes.map((node) => node.id === 'artifact-1'
      ? { ...node, x: 10, y: 20, layoutRevision: 4 }
      : node);
    const staleWorkspaceA = snapshot();
    staleWorkspaceA.workspace = { ...staleWorkspaceA.workspace, structureRevision: 9 };
    staleWorkspaceA.nodes = staleWorkspaceA.nodes.map((node) => node.id === 'artifact-1'
      ? { ...node, x: 90, y: 100, layoutRevision: 9 }
      : node);
    const staleLayout = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: workspaceA })
      .mockResolvedValueOnce({ ok: true, data: workspaceB });
    const updateLayout = vi.fn().mockReturnValueOnce(staleLayout.promise);
    Object.defineProperty(window, 'xiaokDesktop', {
      configurable: true,
      value: {
        getArtifactWorkspaceSnapshot: getSnapshot,
        updateArtifactWorkspaceLayout: updateLayout,
        saveArtifactWorkspaceViewport: vi.fn(async () => ({ ok: true, data: workspaceA })),
      },
    });

    const view = render(
      <LocaleProvider>
        <ArtifactWorkspacePanel
          conversationId="conversation-1"
          workspaceRootId="root-1"
          sourceArtifact={sourceA}
        />
      </LocaleProvider>,
    );
    await screen.findByTestId('react-flow');
    expect(screen.getByTestId('position-artifact-1')).toHaveTextContent('0,0:0');

    fireEvent.click(screen.getByRole('button', { name: 'start-artifact-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'move-artifact-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'stop-artifact-1' }));
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));

    view.rerender(
      <LocaleProvider>
        <ArtifactWorkspacePanel
          conversationId="conversation-1"
          workspaceRootId="root-1"
          sourceArtifact={sourceB}
        />
      </LocaleProvider>,
    );
    await waitFor(() => {
      expect(getSnapshot).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('position-artifact-1')).toHaveTextContent('10,20:4');
    });

    await act(async () => {
      staleLayout.resolve({ ok: true, data: staleWorkspaceA });
      await staleLayout.promise;
    });

    expect(screen.getByTestId('position-artifact-1')).toHaveTextContent('10,20:4');
  });
});

describe('CanvasPanel real ArtifactWorkspacePanel availability integration', () => {
  it('falls back to focused Preview after the selected Canvas node becomes hidden', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    localStorage.setItem('xiaok:locale', 'en');
    const enabled = snapshot();
    const hidden = snapshot();
    hidden.access = { ...hidden.access, spatial: 'hidden' };
    const hiddenRefresh = deferred<unknown>();
    let workspaceChanged: ((event: { conversationId: string; workspaceId: string }) => void) | undefined;
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: enabled })
      .mockReturnValueOnce(hiddenRefresh.promise);
    Object.defineProperty(window, 'xiaokDesktop', {
      configurable: true,
      value: {
        getArtifactWorkspaceSnapshot: getSnapshot,
        onArtifactWorkspaceChanged: vi.fn((handler) => {
          workspaceChanged = handler;
          return () => { workspaceChanged = undefined; };
        }),
        updateArtifactWorkspaceLayout: vi.fn(async () => ({ ok: true, data: enabled })),
        saveArtifactWorkspaceViewport: vi.fn(async () => ({ ok: true, data: enabled })),
      },
    });

    render(
      <LocaleProvider>
        <CanvasPanel
          events={[]}
          conversationId="conversation-1"
          workspaceRootId="root-1"
          onClose={() => {}}
        />
      </LocaleProvider>,
    );

    const canvasTab = await screen.findByRole('tab', { name: 'Canvas' });
    fireEvent.click(canvasTab);
    const canvasNode = await screen.findByRole('button', { name: 'Artifact' });
    canvasNode.focus();
    expect(canvasNode).toHaveFocus();

    act(() => {
      workspaceChanged?.({ conversationId: 'conversation-1', workspaceId: 'workspace-1' });
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    await act(async () => {
      hiddenRefresh.resolve({ ok: true, data: hidden });
      await hiddenRefresh.promise;
    });

    expect(screen.queryByRole('tab', { name: 'Canvas' })).toBeNull();
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(previewTab).toHaveFocus();
  });
});
