import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createRef, Profiler } from 'react';
import type {
  ArtifactWorkspacePreview,
  ArtifactWorkspaceResult,
  ArtifactWorkspaceSnapshot,
  ArtifactWorkspaceVersionView,
} from '../../shared/artifact-workspace-types';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ArtifactWorkspacePanel } from '../../renderer/src/components/artifact-workspace/ArtifactWorkspacePanel';
import { ArtifactCompare } from '../../renderer/src/components/artifact-workspace/ArtifactCompare';
import { useArtifactWorkspace } from '../../renderer/src/components/artifact-workspace/useArtifactWorkspace';
import { _resetDesktopApiCache } from '../../renderer/src/shared/desktop';

const getSnapshot = vi.fn();
const readPreview = vi.fn();
const preferVersion = vi.fn();
const recordEvent = vi.fn();
const submitGeneration = vi.fn();
const exportVersion = vi.fn();
const closeWorkspace = vi.fn();
const saveViewport = vi.fn();
const updateLayout = vi.fn();
let workspaceChangedHandler: ((event: { conversationId: string; workspaceId: string }) => void) | undefined;

type PreviewNavigationContext = {
  originSurface: 'preview' | 'canvas';
  epoch: number;
};

type ArtifactWorkspacePanelContractProps = Omit<
  React.ComponentProps<typeof ArtifactWorkspacePanel>,
  'onPreviewVersion'
> & {
  previewNavigationContext?: PreviewNavigationContext;
  onPreviewVersion?: (
    version: ArtifactWorkspaceVersionView,
    preview: ArtifactWorkspacePreview,
    navigationContext: PreviewNavigationContext,
  ) => void;
  onSpatialAvailabilityChange?: (availability: 'unknown' | 'enabled' | 'hidden') => void;
  interactionActive?: boolean;
};

const ArtifactWorkspacePanelWithContract = ArtifactWorkspacePanel as React.ComponentType<
  ArtifactWorkspacePanelContractProps
>;
const defaultPreviewNavigationContext: PreviewNavigationContext = {
  originSurface: 'preview',
  epoch: 1,
};
const successfulPreviewNavigationContext: PreviewNavigationContext = {
  originSurface: 'canvas',
  epoch: 7,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installApi() {
  Object.defineProperty(window, 'xiaokDesktop', {
    configurable: true,
    value: {
      getArtifactWorkspaceSnapshot: getSnapshot,
      readArtifactWorkspaceVersionPreview: readPreview,
      preferArtifactVersion: preferVersion,
      recordArtifactWorkspaceEvent: recordEvent,
      submitArtifactGeneration: submitGeneration,
      exportArtifactWorkspaceVersion: exportVersion,
      closeArtifactWorkspace: closeWorkspace,
      saveArtifactWorkspaceViewport: saveViewport,
      updateArtifactWorkspaceLayout: updateLayout,
      onArtifactWorkspaceChanged: vi.fn((handler) => {
        workspaceChangedHandler = handler;
        return () => { workspaceChangedHandler = undefined; };
      }),
    },
  });
}

function snapshot(overrides: Partial<ArtifactWorkspaceSnapshot> = {}): ArtifactWorkspaceSnapshot {
  return {
    workspace: {
      id: 'workspace-1',
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
      schemaVersion: 1,
      structureRevision: 3,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    access: { revision: 'write', spatial: 'hidden' },
    nodes: [{
      id: 'node-1', workspaceId: 'workspace-1', kind: 'artifact', lineageId: 'lineage-1',
      artifactVersionId: 'version-2', owner: 'user', x: 0, y: 0, width: 280, height: 180,
      zIndex: 1, layoutRevision: 0, createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    }],
    relations: [],
    lineages: [{
      id: 'lineage-1', workspaceId: 'workspace-1', sourceLocatorHash: 'opaque',
      preferredVersionId: 'version-1', createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    }],
    versions: [
      {
        id: 'version-1', lineageId: 'lineage-1', storageKind: 'single_file', sourceKind: 'materialized_base',
        sourceArtifactId: 'artifact-1', sourceTaskId: 'task-1',
        kind: 'html', mimeType: 'text/html', checksum: 'one', status: 'ready', createdAt: '2026-07-13T00:00:00.000Z',
        preferred: true, preview: { available: true, title: 'Original', contentKind: 'text' },
      },
      {
        id: 'version-2', lineageId: 'lineage-1', parentVersionId: 'version-1', storageKind: 'single_file',
        sourceKind: 'workspace_generation', kind: 'html', mimeType: 'text/html', checksum: 'two', status: 'ready',
        createdAt: '2026-07-13T01:00:00.000Z', preferred: false,
        preview: { available: true, title: 'Revision 2', contentKind: 'text' },
      },
    ],
    generationRequests: [],
    staging: [],
    ...overrides,
  };
}

function renderPanel(props: Partial<ArtifactWorkspacePanelContractProps> = {}) {
  localStorage.setItem('xiaok:locale', 'en');
  return render(
    <LocaleProvider>
      <ArtifactWorkspacePanelWithContract
        conversationId="conversation-1"
        sourceArtifact={{ artifactId: 'artifact-1', kind: 'html', mimeType: 'text/html', title: 'Report' }}
        previewNavigationContext={defaultPreviewNavigationContext}
        {...props}
      />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  _resetDesktopApiCache();
  workspaceChangedHandler = undefined;
  localStorage.clear();
});

describe('ArtifactWorkspacePanel Phase 0 revisions', () => {
  it('synchronously masks a retained snapshot when the workspace identity changes', async () => {
    installApi();
    const workspaceA = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const workspaceB = snapshot({
      workspace: {
        ...snapshot().workspace,
        id: 'workspace-2',
        conversationId: 'conversation-2',
        workspaceRootId: 'root-2',
      },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const lateRefreshA = deferred<unknown>();
    const pendingWorkspaceB = deferred<unknown>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: workspaceA })
      .mockReturnValueOnce(lateRefreshA.promise)
      .mockReturnValueOnce(pendingWorkspaceB.promise);

    const renderHistory: Array<{
      identity: { conversationId: string; workspaceRootId: string };
      result: {
        snapshot: ArtifactWorkspaceSnapshot | null;
        status: ReturnType<typeof useArtifactWorkspace>['status'];
        error: ReturnType<typeof useArtifactWorkspace>['error'];
      };
    }> = [];
    const { result, rerender } = renderHook(
      ({ conversationId, workspaceRootId }) => {
        const hookResult = useArtifactWorkspace({ conversationId, workspaceRootId });
        renderHistory.push({
          identity: { conversationId, workspaceRootId },
          result: {
            snapshot: hookResult.snapshot,
            status: hookResult.status,
            error: hookResult.error,
          },
        });
        return hookResult;
      },
      { initialProps: { conversationId: 'conversation-1', workspaceRootId: 'root-1' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.snapshot).toBe(workspaceA);

    act(() => {
      workspaceChangedHandler?.({ conversationId: 'conversation-1', workspaceId: 'workspace-1' });
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    rerender({ conversationId: 'conversation-2', workspaceRootId: 'root-2' });
    const firstWorkspaceBRender = renderHistory.filter((entry) => (
      entry.identity.conversationId === 'conversation-2'
      && entry.identity.workspaceRootId === 'root-2'
    ))[0];
    expect(firstWorkspaceBRender).toEqual({
      identity: { conversationId: 'conversation-2', workspaceRootId: 'root-2' },
      result: { snapshot: null, status: 'loading', error: null },
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();

    await act(async () => {
      lateRefreshA.resolve({ ok: true, data: workspaceA });
      await lateRefreshA.promise;
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();

    await act(async () => {
      pendingWorkspaceB.resolve({ ok: true, data: workspaceB });
      await pendingWorkspaceB.promise;
    });
    expect(result.current.snapshot).toBe(workspaceB);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('synchronously masks retained snapshot, status, and error when only workspaceRootId changes', async () => {
    installApi();
    const rootA = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const rootB = snapshot({
      workspace: {
        ...snapshot().workspace,
        id: 'workspace-2',
        workspaceRootId: 'root-2',
      },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const pendingRootB = deferred<unknown>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: rootA })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'runtime_unavailable', message: 'Root A refresh failed' },
      })
      .mockReturnValueOnce(pendingRootB.promise);

    const renderHistory: Array<{
      workspaceRootId: string;
      snapshot: ArtifactWorkspaceSnapshot | null;
      status: ReturnType<typeof useArtifactWorkspace>['status'];
      error: ReturnType<typeof useArtifactWorkspace>['error'];
    }> = [];
    const { result, rerender } = renderHook(
      ({ workspaceRootId }) => {
        const hookResult = useArtifactWorkspace({
          conversationId: 'conversation-1',
          workspaceRootId,
        });
        renderHistory.push({
          workspaceRootId,
          snapshot: hookResult.snapshot,
          status: hookResult.status,
          error: hookResult.error,
        });
        return hookResult;
      },
      { initialProps: { workspaceRootId: 'root-1' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot).toBe(rootA);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Root A refresh failed');

    rerender({ workspaceRootId: 'root-2' });
    const firstRootBRender = renderHistory.find((entry) => entry.workspaceRootId === 'root-2');
    expect(firstRootBRender).toEqual({
      workspaceRootId: 'root-2',
      snapshot: null,
      status: 'loading',
      error: null,
    });

    await act(async () => {
      pendingRootB.resolve({ ok: true, data: rootB });
      await pendingRootB.promise;
    });
    expect(result.current.snapshot).toBe(rootB);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('rejects pending refresh and mutation results after a root-only workspace switch', async () => {
    installApi();
    const rootA = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const staleRootA = snapshot({
      workspace: { ...snapshot().workspace, structureRevision: 90 },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const rootB = snapshot({
      workspace: {
        ...snapshot().workspace,
        id: 'workspace-2',
        workspaceRootId: 'root-2',
        structureRevision: 4,
      },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const lateRefreshA = deferred<unknown>();
    const lateMutationA = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    const pendingRootB = deferred<unknown>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: rootA })
      .mockReturnValueOnce(lateRefreshA.promise)
      .mockReturnValueOnce(pendingRootB.promise);
    updateLayout.mockReturnValueOnce(lateMutationA.promise);

    const { result, rerender } = renderHook(
      ({ workspaceRootId }) => useArtifactWorkspace({
        conversationId: 'conversation-1',
        workspaceRootId,
      }),
      { initialProps: { workspaceRootId: 'root-1' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let refreshA!: Promise<void>;
    let mutationA!: ReturnType<typeof result.current.updateLayout>;
    act(() => {
      refreshA = result.current.refresh();
      mutationA = result.current.updateLayout({
        nodeId: 'node-1',
        x: 12,
        y: 34,
        zIndex: 2,
        expectedLayoutRevision: 0,
      });
    });
    await waitFor(() => {
      expect(getSnapshot).toHaveBeenCalledTimes(2);
      expect(updateLayout).toHaveBeenCalledTimes(1);
    });

    rerender({ workspaceRootId: 'root-2' });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();

    await act(async () => {
      lateRefreshA.resolve({ ok: true, data: staleRootA });
      lateMutationA.resolve({ ok: true, data: staleRootA });
      await Promise.all([refreshA, mutationA]);
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();

    await act(async () => {
      pendingRootB.resolve({ ok: true, data: rootB });
      await pendingRootB.promise;
    });
    expect(result.current.snapshot).toBe(rootB);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('treats a rapid root A-to-B-to-A return as a new authority session', async () => {
    installApi();
    const rootAInitial = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const rootANew = snapshot({
      workspace: { ...snapshot().workspace, structureRevision: 7 },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const staleRootA = snapshot({
      workspace: { ...snapshot().workspace, structureRevision: 90 },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const rootB = snapshot({
      workspace: {
        ...snapshot().workspace,
        id: 'workspace-2',
        workspaceRootId: 'root-2',
        structureRevision: 4,
      },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const pendingRootB = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    const pendingRootAReturn = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    const lateMutationA = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: rootAInitial })
      .mockReturnValueOnce(pendingRootB.promise)
      .mockReturnValueOnce(pendingRootAReturn.promise);
    updateLayout.mockReturnValueOnce(lateMutationA.promise);

    const { result, rerender } = renderHook(
      ({ workspaceRootId }) => useArtifactWorkspace({
        conversationId: 'conversation-1',
        workspaceRootId,
      }),
      { initialProps: { workspaceRootId: 'root-1' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let mutationA!: ReturnType<typeof result.current.updateLayout>;
    act(() => {
      mutationA = result.current.updateLayout({
        nodeId: 'node-1',
        x: 12,
        y: 34,
        zIndex: 2,
        expectedLayoutRevision: 0,
      });
    });
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));

    rerender({ workspaceRootId: 'root-2' });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(result.current.snapshot).toBeNull();

    rerender({ workspaceRootId: 'root-1' });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();

    await act(async () => {
      pendingRootAReturn.resolve({ ok: true, data: rootANew });
      await pendingRootAReturn.promise;
    });
    expect(result.current.snapshot).toBe(rootANew);
    expect(result.current.status).toBe('ready');

    let staleMutationResult!: Awaited<typeof mutationA>;
    await act(async () => {
      lateMutationA.resolve({ ok: true, data: staleRootA });
      staleMutationResult = await mutationA;
    });
    expect(staleMutationResult).toEqual({
      ok: false,
      error: { code: 'runtime_unavailable', message: 'stale_workspace_operation' },
    });
    expect(result.current.snapshot).toBe(rootANew);

    await act(async () => {
      pendingRootB.resolve({ ok: true, data: rootB });
      await pendingRootB.promise;
    });
    expect(result.current.snapshot).toBe(rootANew);
  });

  it('rejects an older layout snapshot after a newer refresh has committed', async () => {
    installApi();
    const initial = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const newer = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      nodes: initial.nodes.map((node) => node.id === 'node-1'
        ? { ...node, x: 50, y: 60, layoutRevision: 2 }
        : node),
    });
    const olderLayout = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      nodes: initial.nodes.map((node) => node.id === 'node-1'
        ? { ...node, x: 20, y: 30, layoutRevision: 1 }
        : node),
    });
    const pendingLayout = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockResolvedValueOnce({ ok: true, data: newer });
    updateLayout.mockReturnValueOnce(pendingLayout.promise);

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let layoutOperation!: ReturnType<typeof result.current.updateLayout>;
    act(() => {
      layoutOperation = result.current.updateLayout({
        nodeId: 'node-1',
        x: 20,
        y: 30,
        zIndex: 1,
        expectedLayoutRevision: 0,
      });
    });
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot).toBe(newer);

    let staleLayoutResult!: Awaited<typeof layoutOperation>;
    await act(async () => {
      pendingLayout.resolve({ ok: true, data: olderLayout });
      staleLayoutResult = await layoutOperation;
    });
    expect(staleLayoutResult).toEqual({
      ok: false,
      error: { code: 'runtime_unavailable', message: 'stale_workspace_operation' },
    });
    expect(result.current.snapshot).toBe(newer);
  });

  it('merges only the successful layout projection into a newer same-revision refresh', async () => {
    installApi();
    const initialRequest = {
      id: 'request-1',
      workspaceId: 'workspace-1',
      placeholderNodeId: 'node-1',
      state: 'running' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const initial = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [initialRequest],
    });
    const newer = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [{
        ...initialRequest,
        state: 'ready',
        updatedAt: '2026-07-13T01:00:00.000Z',
      }],
      staging: [{
        id: 'staging-1',
        source: 'generation',
        generationRequestId: 'request-1',
        availability: 'present',
        owner: 'system_staging',
        keep: false,
        createdAt: '2026-07-13T01:00:00.000Z',
        expiresAt: '2026-07-14T01:00:00.000Z',
      }],
    });
    const oldFullSnapshotWithNewLayout = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [initialRequest],
      nodes: initial.nodes.map((node) => node.id === 'node-1'
        ? { ...node, x: 20, y: 30, layoutRevision: 1 }
        : node),
    });
    const pendingLayout = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockResolvedValueOnce({ ok: true, data: newer });
    updateLayout.mockReturnValueOnce(pendingLayout.promise);

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let layoutOperation!: ReturnType<typeof result.current.updateLayout>;
    act(() => {
      layoutOperation = result.current.updateLayout({
        nodeId: 'node-1',
        x: 20,
        y: 30,
        zIndex: 1,
        expectedLayoutRevision: 0,
      });
    });
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot).toBe(newer);

    let layoutResult!: Awaited<typeof layoutOperation>;
    await act(async () => {
      pendingLayout.resolve({ ok: true, data: oldFullSnapshotWithNewLayout });
      layoutResult = await layoutOperation;
    });

    expect(layoutResult.ok).toBe(true);
    if (!layoutResult.ok) throw new Error('Expected the layout projection to be accepted');
    expect(layoutResult.data.generationRequests[0]).toMatchObject({ state: 'ready' });
    expect(layoutResult.data.nodes[0]).toMatchObject({ x: 20, y: 30, layoutRevision: 1 });
    expect(result.current.snapshot?.generationRequests[0]).toMatchObject({ state: 'ready' });
    expect(result.current.snapshot?.nodes[0]).toMatchObject({ x: 20, y: 30, layoutRevision: 1 });
  });

  it('absorbs a newer generation refresh after an intervening layout projection', async () => {
    installApi();
    const initialRequest = {
      id: 'request-1',
      workspaceId: 'workspace-1',
      placeholderNodeId: 'node-1',
      state: 'running' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const initial = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [initialRequest],
    });
    const afterLayout = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [initialRequest],
      nodes: initial.nodes.map((node) => node.id === 'node-1'
        ? { ...node, x: 20, y: 30, layoutRevision: 1 }
        : node),
    });
    const refreshed = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [{
        ...initialRequest,
        state: 'ready',
        updatedAt: '2026-07-13T01:00:00.000Z',
      }],
      nodes: afterLayout.nodes.map((node) => node.id === 'node-1'
        ? { ...node, title: 'Ready node', artifactVersionId: 'version-1' }
        : node),
    });
    const pendingRefresh = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockReturnValueOnce(pendingRefresh.promise);
    updateLayout.mockResolvedValueOnce({ ok: true, data: afterLayout });

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let refreshOperation!: ReturnType<typeof result.current.refresh>;
    act(() => {
      refreshOperation = result.current.refresh();
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    let layoutResult!: Awaited<ReturnType<typeof result.current.updateLayout>>;
    await act(async () => {
      layoutResult = await result.current.updateLayout({
        nodeId: 'node-1',
        x: 20,
        y: 30,
        zIndex: 1,
        expectedLayoutRevision: 0,
      });
    });
    expect(layoutResult.ok).toBe(true);
    expect(result.current.snapshot?.nodes[0]).toMatchObject({ x: 20, y: 30, layoutRevision: 1 });
    expect(result.current.snapshot?.generationRequests[0]).toMatchObject({ state: 'running' });

    await act(async () => {
      pendingRefresh.resolve({ ok: true, data: refreshed });
      await refreshOperation;
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.snapshot?.nodes[0]).toMatchObject({
      x: 20,
      y: 30,
      layoutRevision: 1,
      title: 'Ready node',
      artifactVersionId: 'version-1',
    });
    expect(result.current.snapshot?.generationRequests[0]).toMatchObject({ state: 'ready' });
  });

  it('resyncs instead of clearing the workspace when an older not-found follows a layout projection', async () => {
    installApi();
    const initial = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const afterLayout = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      nodes: initial.nodes.map((node) => node.id === 'node-1'
        ? { ...node, x: 20, y: 30, layoutRevision: 1 }
        : node),
    });
    const pendingRefresh = deferred<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockReturnValueOnce(pendingRefresh.promise)
      .mockResolvedValueOnce({ ok: true, data: afterLayout });
    updateLayout.mockResolvedValueOnce({ ok: true, data: afterLayout });

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let refreshOperation!: ReturnType<typeof result.current.refresh>;
    act(() => {
      refreshOperation = result.current.refresh();
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.updateLayout({
        nodeId: 'node-1',
        x: 20,
        y: 30,
        zIndex: 1,
        expectedLayoutRevision: 0,
      });
    });
    expect(result.current.snapshot?.nodes[0]).toMatchObject({ x: 20, y: 30, layoutRevision: 1 });

    await act(async () => {
      pendingRefresh.resolve({ ok: false, error: { code: 'workspace_not_found' } });
      await refreshOperation;
    });

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.snapshot).toBe(afterLayout);
  });

  it('does not let an older successful mutation snapshot roll back a newer generation refresh', async () => {
    installApi();
    const initialRequest = {
      id: 'request-1',
      workspaceId: 'workspace-1',
      placeholderNodeId: 'node-1',
      state: 'running' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const initial = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [initialRequest],
    });
    const newer = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [{
        ...initialRequest,
        state: 'ready',
        updatedAt: '2026-07-13T01:00:00.000Z',
      }],
      staging: [{
        id: 'staging-1',
        source: 'generation',
        generationRequestId: 'request-1',
        availability: 'present',
        owner: 'system_staging',
        keep: false,
        createdAt: '2026-07-13T01:00:00.000Z',
        expiresAt: '2026-07-14T01:00:00.000Z',
      }],
    });
    const pendingMutation = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockResolvedValueOnce({ ok: true, data: newer })
      .mockResolvedValueOnce({ ok: true, data: newer });
    submitGeneration.mockReturnValueOnce(pendingMutation.promise);
    const sourceArtifact = {
      artifactId: 'artifact-1',
      sourceTaskId: 'task-1',
      kind: 'html',
    };

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
      sourceArtifact,
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let mutationOperation!: ReturnType<typeof result.current.submitRevision>;
    act(() => {
      mutationOperation = result.current.submitRevision({
        prompt: 'Create another revision',
        sourceVersionId: 'version-2',
        requestedKind: 'html',
      });
    });
    await waitFor(() => expect(submitGeneration).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot).toBe(newer);

    let mutationSucceeded!: Awaited<typeof mutationOperation>;
    await act(async () => {
      pendingMutation.resolve({ ok: true, data: initial });
      mutationSucceeded = await mutationOperation;
    });

    expect(mutationSucceeded).toBe(true);
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.snapshot).toBe(newer);
    expect(result.current.snapshot?.generationRequests[0]).toMatchObject({ state: 'ready' });
    expect(result.current.snapshot?.staging).toHaveLength(1);
  });

  it('does not let an older mutation conflict canonical roll back a newer refresh', async () => {
    installApi();
    const initial = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const newer = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [{
        id: 'request-1',
        workspaceId: 'workspace-1',
        placeholderNodeId: 'node-1',
        state: 'ready',
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T01:00:00.000Z',
      }],
    });
    const pendingMutation = deferred<{
      ok: false;
      error: {
        code: 'structure_revision_conflict';
        message: string;
        canonical: ArtifactWorkspaceSnapshot;
      };
    }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockResolvedValueOnce({ ok: true, data: newer })
      .mockResolvedValueOnce({ ok: true, data: newer });
    preferVersion.mockReturnValueOnce(pendingMutation.promise);

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let mutationOperation!: ReturnType<typeof result.current.preferVersion>;
    act(() => {
      mutationOperation = result.current.preferVersion('lineage-1', 'version-2');
    });
    await waitFor(() => expect(preferVersion).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot).toBe(newer);

    await act(async () => {
      pendingMutation.resolve({
        ok: false,
        error: {
          code: 'structure_revision_conflict',
          message: 'stale structure revision',
          canonical: initial,
        },
      });
      await mutationOperation;
    });

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.snapshot).toBe(newer);
    expect(result.current.snapshot?.generationRequests[0]).toMatchObject({ state: 'ready' });
  });

  it('does not let an older refresh roll back a newer successful mutation snapshot', async () => {
    installApi();
    const initialRequest = {
      id: 'request-1',
      workspaceId: 'workspace-1',
      placeholderNodeId: 'node-1',
      state: 'running' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const initial = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [initialRequest],
    });
    const newer = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [{
        ...initialRequest,
        state: 'ready',
        updatedAt: '2026-07-13T01:00:00.000Z',
      }],
    });
    const pendingRefresh = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockReturnValueOnce(pendingRefresh.promise)
      .mockResolvedValueOnce({ ok: true, data: newer });
    submitGeneration.mockResolvedValueOnce({ ok: true, data: newer });
    const sourceArtifact = {
      artifactId: 'artifact-1',
      sourceTaskId: 'task-1',
      kind: 'html',
    };

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
      sourceArtifact,
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let refreshOperation!: ReturnType<typeof result.current.refresh>;
    act(() => {
      refreshOperation = result.current.refresh();
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    let mutationSucceeded!: Awaited<ReturnType<typeof result.current.submitRevision>>;
    await act(async () => {
      mutationSucceeded = await result.current.submitRevision({
        prompt: 'Create another revision',
        sourceVersionId: 'version-2',
        requestedKind: 'html',
      });
    });
    expect(mutationSucceeded).toBe(true);
    expect(result.current.snapshot).toBe(newer);

    await act(async () => {
      pendingRefresh.resolve({ ok: true, data: initial });
      await refreshOperation;
    });

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.snapshot).toBe(newer);
    expect(result.current.snapshot?.generationRequests[0]).toMatchObject({ state: 'ready' });
  });

  it('keeps a newer mutation snapshot ready when an older refresh rejects', async () => {
    installApi();
    const initial = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const newer = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [{
        id: 'request-1',
        workspaceId: 'workspace-1',
        placeholderNodeId: 'node-1',
        state: 'ready',
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T01:00:00.000Z',
      }],
    });
    const pendingRefresh = deferred<ArtifactWorkspaceResult<ArtifactWorkspaceSnapshot>>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockReturnValueOnce(pendingRefresh.promise)
      .mockResolvedValueOnce({ ok: true, data: newer });
    submitGeneration.mockResolvedValueOnce({ ok: true, data: newer });
    const sourceArtifact = {
      artifactId: 'artifact-1',
      sourceTaskId: 'task-1',
      kind: 'html',
    };

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
      sourceArtifact,
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let refreshOperation!: ReturnType<typeof result.current.refresh>;
    act(() => {
      refreshOperation = result.current.refresh();
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.submitRevision({
        prompt: 'Create another revision',
        sourceVersionId: 'version-2',
        requestedKind: 'html',
      });
    });
    expect(result.current.snapshot).toBe(newer);

    await act(async () => {
      pendingRefresh.reject(new Error('older refresh failed'));
      await refreshOperation;
    });

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
    expect(result.current.snapshot).toBe(newer);
  });

  it('resyncs after concurrent full mutation responses consume all change notifications', async () => {
    installApi();
    const initial = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const requestA = {
      id: 'request-a',
      workspaceId: 'workspace-1',
      placeholderNodeId: 'node-1',
      state: 'ready' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T01:00:00.000Z',
    };
    const requestB = {
      ...requestA,
      id: 'request-b',
      updatedAt: '2026-07-13T02:00:00.000Z',
    };
    const afterA = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [requestA],
    });
    const afterAB = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      generationRequests: [requestA, requestB],
    });
    const pendingRefresh = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    const pendingMutationA = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    const pendingMutationB = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockReturnValueOnce(pendingRefresh.promise)
      .mockResolvedValueOnce({ ok: true, data: afterAB });
    submitGeneration
      .mockReturnValueOnce(pendingMutationA.promise)
      .mockReturnValueOnce(pendingMutationB.promise);
    const sourceArtifact = {
      artifactId: 'artifact-1',
      sourceTaskId: 'task-1',
      kind: 'html',
    };

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
      sourceArtifact,
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let refreshOperation!: ReturnType<typeof result.current.refresh>;
    let mutationA!: ReturnType<typeof result.current.submitRevision>;
    let mutationB!: ReturnType<typeof result.current.submitRevision>;
    act(() => {
      refreshOperation = result.current.refresh();
      mutationA = result.current.submitRevision({
        prompt: 'Revision A', sourceVersionId: 'version-2', requestedKind: 'html',
      });
      mutationB = result.current.submitRevision({
        prompt: 'Revision B', sourceVersionId: 'version-2', requestedKind: 'html',
      });
    });
    await waitFor(() => {
      expect(getSnapshot).toHaveBeenCalledTimes(2);
      expect(submitGeneration).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      pendingMutationA.resolve({ ok: true, data: afterA });
      await mutationA;
    });
    expect(result.current.snapshot).toBe(afterA);

    await act(async () => {
      pendingMutationB.resolve({ ok: true, data: afterAB });
      await mutationB;
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.snapshot).toBe(afterAB));

    await act(async () => {
      pendingRefresh.resolve({ ok: true, data: afterAB });
      await refreshOperation;
    });
    expect(result.current.snapshot).toBe(afterAB);
  });

  it('fails closed when a layout conflict returns a canonical node older than the latest refresh', async () => {
    installApi();
    const initial = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const newer = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      nodes: initial.nodes.map((node) => node.id === 'node-1'
        ? { ...node, x: 50, y: 60, layoutRevision: 2 }
        : node),
    });
    const staleCanonical = {
      ...initial.nodes[0],
      x: 20,
      y: 30,
      layoutRevision: 1,
    };
    const pendingLayout = deferred<{
      ok: false;
      error: {
        code: 'layout_revision_conflict';
        message: string;
        canonical: typeof staleCanonical;
      };
    }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockResolvedValueOnce({ ok: true, data: newer });
    updateLayout.mockReturnValueOnce(pendingLayout.promise);

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let layoutOperation!: ReturnType<typeof result.current.updateLayout>;
    act(() => {
      layoutOperation = result.current.updateLayout({
        nodeId: 'node-1',
        x: 20,
        y: 30,
        zIndex: 1,
        expectedLayoutRevision: 0,
      });
    });
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot).toBe(newer);

    let conflictResult!: Awaited<typeof layoutOperation>;
    await act(async () => {
      pendingLayout.resolve({
        ok: false,
        error: {
          code: 'layout_revision_conflict',
          message: 'stale layout revision',
          canonical: staleCanonical,
        },
      });
      conflictResult = await layoutOperation;
    });

    expect(conflictResult).toEqual({
      ok: false,
      error: { code: 'runtime_unavailable', message: 'stale_workspace_operation' },
    });
    expect(result.current.snapshot).toBe(newer);
  });

  it('serializes same-session layout writes so full snapshots cannot resolve out of order', async () => {
    installApi();
    const initial = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    initial.nodes.push({
      ...initial.nodes[0],
      id: 'node-2',
      artifactVersionId: 'version-1',
      x: 100,
      y: 100,
    });
    const afterFirst = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      nodes: initial.nodes.map((node) => node.id === 'node-1'
        ? { ...node, x: 10, y: 20, layoutRevision: 1 }
        : node),
    });
    const afterSecond = snapshot({
      access: { revision: 'write', spatial: 'enabled' },
      nodes: afterFirst.nodes.map((node) => node.id === 'node-2'
        ? { ...node, x: 30, y: 40, layoutRevision: 1 }
        : node),
    });
    const firstLayout = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    const secondLayout = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot.mockResolvedValueOnce({ ok: true, data: initial });
    updateLayout
      .mockReturnValueOnce(firstLayout.promise)
      .mockReturnValueOnce(secondLayout.promise);

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let firstOperation!: ReturnType<typeof result.current.updateLayout>;
    let secondOperation!: ReturnType<typeof result.current.updateLayout>;
    act(() => {
      firstOperation = result.current.updateLayout({
        nodeId: 'node-1', x: 10, y: 20, zIndex: 1, expectedLayoutRevision: 0,
      });
      secondOperation = result.current.updateLayout({
        nodeId: 'node-2', x: 30, y: 40, zIndex: 1, expectedLayoutRevision: 0,
      });
    });
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));

    await act(async () => {
      firstLayout.resolve({ ok: true, data: afterFirst });
      await firstLayout.promise;
    });
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondLayout.resolve({ ok: true, data: afterSecond });
      await Promise.all([firstOperation, secondOperation]);
    });
    expect(result.current.snapshot).toStrictEqual(afterSecond);
  });

  it('retains the workspace snapshot but resets request state when the selected artifact changes', async () => {
    installApi();
    const workspace = snapshot({ access: { revision: 'write', spatial: 'enabled' } });
    const staleArtifactA = snapshot({
      workspace: { ...snapshot().workspace, structureRevision: 90 },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const artifactB = snapshot({
      workspace: { ...snapshot().workspace, structureRevision: 4 },
      access: { revision: 'write', spatial: 'enabled' },
    });
    const lateArtifactA = deferred<unknown>();
    const pendingArtifactB = deferred<unknown>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: workspace })
      .mockResolvedValueOnce({ ok: false, error: { code: 'runtime_unavailable', message: 'Artifact A refresh failed' } })
      .mockReturnValueOnce(lateArtifactA.promise)
      .mockReturnValueOnce(pendingArtifactB.promise);

    const sourceA = { artifactId: 'artifact-a', sourceTaskId: 'task-a', kind: 'html' };
    const sourceB = { artifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html' };
    const { result, rerender } = renderHook(
      ({ sourceArtifact }) => useArtifactWorkspace({
        conversationId: 'conversation-1',
        workspaceRootId: 'root-1',
        sourceArtifact,
      }),
      { initialProps: { sourceArtifact: sourceA } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot).toBe(workspace);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Artifact A refresh failed');

    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    rerender({ sourceArtifact: sourceB });

    expect(result.current.snapshot).toBe(workspace);
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();
    expect(getSnapshot.mock.calls[3][0]).toEqual(expect.objectContaining({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
      selectedArtifact: expect.objectContaining({ artifactId: 'artifact-b', sourceTaskId: 'task-b' }),
    }));

    await act(async () => {
      lateArtifactA.resolve({ ok: true, data: staleArtifactA });
      await lateArtifactA.promise;
    });
    expect(result.current.snapshot).toBe(workspace);
    expect(result.current.status).toBe('loading');

    await act(async () => {
      pendingArtifactB.resolve({ ok: true, data: artifactB });
      await pendingArtifactB.promise;
    });
    expect(result.current.snapshot).toBe(artifactB);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('omits expectedViewRevision from the first viewport save when no view exists', async () => {
    installApi();
    const initial = snapshot();
    getSnapshot.mockResolvedValue({ ok: true, data: initial });
    saveViewport.mockResolvedValue({ ok: true, data: initial });

    const { result } = renderHook(() => useArtifactWorkspace({ conversationId: 'conversation-1' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.saveViewport({ x: 12, y: 34, zoom: 1.5 });
    });

    expect(saveViewport).toHaveBeenCalledTimes(1);
    expect(saveViewport.mock.calls[0][0]).not.toHaveProperty('expectedViewRevision');
  });

  it('merges only a saved viewport into a newer same-revision refresh', async () => {
    installApi();
    const initialRequest = {
      id: 'request-1',
      workspaceId: 'workspace-1',
      placeholderNodeId: 'node-1',
      state: 'running' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const initialView = {
      workspaceId: 'workspace-1',
      viewKey: 'window-opaque',
      viewport: { x: 0, y: 0, zoom: 1 },
      viewRevision: 0,
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const initial = snapshot({
      generationRequests: [initialRequest],
      view: initialView,
    });
    const newer = snapshot({
      generationRequests: [{
        ...initialRequest,
        state: 'ready',
        updatedAt: '2026-07-13T01:00:00.000Z',
      }],
      view: initialView,
    });
    const oldFullSnapshotWithNewView = snapshot({
      generationRequests: [initialRequest],
      view: {
        ...initialView,
        viewport: { x: 12, y: 34, zoom: 1.5 },
        viewRevision: 1,
        updatedAt: '2026-07-13T01:00:00.000Z',
      },
    });
    const pendingSave = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: initial })
      .mockResolvedValueOnce({ ok: true, data: newer });
    saveViewport.mockReturnValueOnce(pendingSave.promise);

    const { result } = renderHook(() => useArtifactWorkspace({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-1',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let saveOperation!: ReturnType<typeof result.current.saveViewport>;
    act(() => {
      saveOperation = result.current.saveViewport({ x: 12, y: 34, zoom: 1.5 });
    });
    await waitFor(() => expect(saveViewport).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot).toBe(newer);

    let saveResult!: Awaited<typeof saveOperation>;
    await act(async () => {
      pendingSave.resolve({ ok: true, data: oldFullSnapshotWithNewView });
      saveResult = await saveOperation;
    });

    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) throw new Error('Expected the viewport projection to be accepted');
    expect(saveResult.data.generationRequests[0]).toMatchObject({ state: 'ready' });
    expect(saveResult.data.view).toMatchObject({
      viewport: { x: 12, y: 34, zoom: 1.5 },
      viewRevision: 1,
    });
    expect(result.current.snapshot?.generationRequests[0]).toMatchObject({ state: 'ready' });
    expect(result.current.snapshot?.view).toMatchObject({
      viewport: { x: 12, y: 34, zoom: 1.5 },
      viewRevision: 1,
    });
  });

  it('preserves a zero expectedViewRevision for an existing viewport', async () => {
    installApi();
    const existing = snapshot({
      view: {
        workspaceId: 'workspace-1',
        viewKey: 'window-opaque',
        viewport: { x: 0, y: 0, zoom: 1 },
        viewRevision: 0,
        updatedAt: '2026-07-13T00:00:00.000Z',
      },
    });
    getSnapshot.mockResolvedValue({ ok: true, data: existing });
    saveViewport.mockResolvedValue({ ok: true, data: existing });

    const { result } = renderHook(() => useArtifactWorkspace({ conversationId: 'conversation-1' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.saveViewport({ x: 1, y: 2, zoom: 1.25 });
    });

    expect(saveViewport).toHaveBeenCalledWith(expect.objectContaining({ expectedViewRevision: 0 }));
  });

  it('omits metadata from an event request when no metadata is supplied', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    recordEvent.mockResolvedValue({ ok: true, data: { recorded: true } });

    const { result } = renderHook(() => useArtifactWorkspace({ conversationId: 'conversation-1' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.recordEvent('revision_branched');
    });

    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent.mock.calls[0][0]).not.toHaveProperty('metadata');
  });

  it('omits selectedArtifact from snapshot requests when no source artifact exists', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });

    renderPanel({ sourceArtifact: undefined });
    await screen.findByRole('button', { name: 'Original' });

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(getSnapshot.mock.calls[0][0]).not.toHaveProperty('selectedArtifact');
  });

  it('omits selectedArtifact when revising a managed version without a source artifact', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    submitGeneration.mockResolvedValue({ ok: true, data: snapshot() });

    renderPanel({ sourceArtifact: undefined });
    fireEvent.click(await screen.findByRole('button', { name: 'Create revision' }));

    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionId: 'version-2',
      requestedKind: 'html',
    })));
    expect(submitGeneration.mock.calls[0][0]).not.toHaveProperty('selectedArtifact');
  });

  it('strips undefined optional fields from selectedArtifact snapshot input', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });

    renderPanel({
      sourceArtifact: {
        artifactId: 'artifact-1',
        sourceTaskId: undefined,
        kind: 'html',
        mimeType: undefined,
        title: 'Report',
      },
    });
    await screen.findByRole('button', { name: 'Original' });

    const selectedArtifact = getSnapshot.mock.calls[0][0].selectedArtifact;
    expect(selectedArtifact).toEqual({
      artifactId: 'artifact-1',
      kind: 'html',
      title: 'Report',
    });
    expect(selectedArtifact).not.toHaveProperty('sourceTaskId');
    expect(selectedArtifact).not.toHaveProperty('mimeType');
  });

  it('keeps one view session open while switching source artifacts in the same conversation', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    closeWorkspace.mockResolvedValue({ ok: true, data: { closed: true } });
    const view = renderPanel();
    await screen.findByRole('button', { name: 'Original' });

    view.rerender(
      <LocaleProvider>
        <ArtifactWorkspacePanel
          conversationId="conversation-1"
          sourceArtifact={{ artifactId: 'artifact-2', kind: 'html', title: 'Other' }}
        />
      </LocaleProvider>,
    );
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(closeWorkspace).not.toHaveBeenCalled();

    view.unmount();
    await waitFor(() => expect(closeWorkspace).toHaveBeenCalledTimes(1));
  });

  it('refreshes once when main reports a matching generation state change', async () => {
    installApi();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: snapshot({ generationRequests: [{
        id: 'request-1', workspaceId: 'workspace-1', placeholderNodeId: 'node-1', state: 'running',
        createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
      }] }) })
      .mockResolvedValueOnce({ ok: true, data: snapshot() });
    renderPanel();
    await screen.findByRole('button', { name: 'Original' });

    workspaceChangedHandler?.({ conversationId: 'other-conversation', workspaceId: 'workspace-2' });
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    workspaceChangedHandler?.({ conversationId: 'conversation-1', workspaceId: 'workspace-1' });

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
  });

  it('renders empty and retries a recoverable snapshot error', async () => {
    installApi();
    getSnapshot.mockResolvedValueOnce({ ok: false, error: { code: 'workspace_not_found' } });
    const emptyView = renderPanel();
    expect(await screen.findByText('This conversation has no artifact versions yet')).toBeInTheDocument();
    emptyView.unmount();

    getSnapshot
      .mockResolvedValueOnce({ ok: false, error: { code: 'runtime_unavailable', message: 'Workspace offline' } })
      .mockResolvedValueOnce({ ok: true, data: snapshot() });
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Original' })).toBeInTheDocument();
  });

  it('renders immutable revisions, compares two previews, and prefers without deleting either version', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    readPreview
      .mockResolvedValueOnce({ ok: true, data: { versionId: 'version-1', kind: 'html', title: 'Original', contentKind: 'text', content: '<h1>One</h1>' } })
      .mockResolvedValueOnce({ ok: true, data: { versionId: 'version-2', kind: 'html', title: 'Revision 2', contentKind: 'text', content: '<h1>Two</h1>' } });
    preferVersion.mockResolvedValue({ ok: true, data: snapshot() });
    exportVersion.mockResolvedValue({ ok: true, data: { exported: true } });

    renderPanel();

    expect(screen.getByRole('status')).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Original' });
    fireEvent.click(screen.getByRole('button', { name: 'Revision 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));

    expect(await screen.findByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Set as preferred' }));
    await waitFor(() => expect(preferVersion).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version-2' })));
    expect(screen.getByRole('button', { name: 'Original' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revision 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(exportVersion).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version-2' })));
  });

  it('loads the selected immutable version before handing it to the host preview', async () => {
    installApi();
    const preview = {
      versionId: 'version-2', kind: 'html', mimeType: 'text/html', title: 'Revision 2',
      contentKind: 'text' as const, content: '<h1>Managed revision</h1>',
    };
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    readPreview.mockResolvedValue({ ok: true, data: preview });
    const onPreviewVersion = vi.fn();
    renderPanel({
      onPreviewVersion,
      previewNavigationContext: successfulPreviewNavigationContext,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Revision 2' }));

    await waitFor(() => expect(readPreview).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version-2' })));
    expect(onPreviewVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'version-2' }),
      preview,
      successfulPreviewNavigationContext,
    );
    expect(onPreviewVersion).toHaveBeenCalledTimes(1);
    expect(onPreviewVersion.mock.calls[0]).toHaveLength(3);
    expect(onPreviewVersion.mock.calls[0]?.[2]).toStrictEqual({ originSurface: 'canvas', epoch: 7 });
  });

  it('keeps preview selection, detail, and focus while reject/null failures remain retryable', async () => {
    installApi();
    const rejectedPreview = deferred<unknown>();
    const missingPreview = deferred<unknown>();
    const successfulPreview = deferred<unknown>();
    const preview = {
      versionId: 'version-2', kind: 'html', mimeType: 'text/html', title: 'Revision 2',
      contentKind: 'text' as const, content: '<h1>Managed revision</h1>',
    };
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    readPreview
      .mockReturnValueOnce(rejectedPreview.promise)
      .mockReturnValueOnce(missingPreview.promise)
      .mockReturnValueOnce(successfulPreview.promise);
    const onPreviewVersion = vi.fn();
    renderPanel({
      onPreviewVersion,
      previewNavigationContext: successfulPreviewNavigationContext,
    });

    const revision = await screen.findByRole('button', { name: 'Revision 2' });
    revision.focus();
    fireEvent.click(revision);
    await act(async () => {
      rejectedPreview.reject(new Error('Preview read rejected'));
      await rejectedPreview.promise.catch(() => undefined);
    });

    const expectSelectionAndFocus = () => {
      expect(revision).toHaveAttribute('aria-pressed', 'true');
      expect(revision).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Set as preferred' })).toBeInTheDocument();
    };
    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Could not open this version preview\. Try again\.$/,
    );
    expectSelectionAndFocus();
    expect(onPreviewVersion).not.toHaveBeenCalled();

    fireEvent.click(revision);
    expect(screen.queryByRole('alert')).toBeNull();
    expectSelectionAndFocus();
    await act(async () => {
      missingPreview.resolve({ ok: true, data: null });
      await missingPreview.promise;
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Could not open this version preview\. Try again\.$/,
    );
    expectSelectionAndFocus();
    expect(onPreviewVersion).not.toHaveBeenCalled();

    fireEvent.click(revision);
    expect(screen.queryByRole('alert')).toBeNull();
    expectSelectionAndFocus();
    await act(async () => {
      successfulPreview.resolve({ ok: true, data: preview });
      await successfulPreview.promise;
    });
    expect(onPreviewVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'version-2' }),
      preview,
      successfulPreviewNavigationContext,
    );
    expect(onPreviewVersion).toHaveBeenCalledTimes(1);
    expect(onPreviewVersion.mock.calls[0]).toHaveLength(3);
    expect(onPreviewVersion.mock.calls[0]?.[2]).toStrictEqual({ originSurface: 'canvas', epoch: 7 });
  });

  it.each(['success', 'reject'] as const)(
    'drops a stale preview %s after the navigation epoch changes without disturbing selection',
    async (outcome) => {
      installApi();
      const pendingPreview = deferred<unknown>();
      const preview = {
        versionId: 'version-2', kind: 'html', mimeType: 'text/html', title: 'Revision 2',
        contentKind: 'text' as const, content: '<h1>Stale managed revision</h1>',
      };
      getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
      readPreview.mockReturnValueOnce(pendingPreview.promise);
      const onPreviewVersion = vi.fn();
      const sourceArtifact = {
        artifactId: 'artifact-1', kind: 'html', mimeType: 'text/html', title: 'Report',
      };
      const initialContext: PreviewNavigationContext = { originSurface: 'canvas', epoch: 7 };
      const view = renderPanel({ sourceArtifact, onPreviewVersion, previewNavigationContext: initialContext });

      const revision = await screen.findByRole('button', { name: 'Revision 2' });
      revision.focus();
      fireEvent.click(revision);
      expect(readPreview).toHaveBeenCalledTimes(1);

      view.rerender(
        <LocaleProvider>
          <ArtifactWorkspacePanelWithContract
            conversationId="conversation-1"
            sourceArtifact={sourceArtifact}
            onPreviewVersion={onPreviewVersion}
            previewNavigationContext={{ originSurface: 'canvas', epoch: 8 }}
          />
        </LocaleProvider>,
      );

      await act(async () => {
        if (outcome === 'success') {
          pendingPreview.resolve({ ok: true, data: preview });
          await pendingPreview.promise;
        } else {
          pendingPreview.reject(new Error('Stale preview failure'));
          await pendingPreview.promise.catch(() => undefined);
        }
      });

      expect(onPreviewVersion).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(revision).toHaveAttribute('aria-pressed', 'true');
      expect(revision).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Set as preferred' })).toBeInTheDocument();
    },
  );

  it('keeps the newer preview when real Panel requests resolve out of order', async () => {
    installApi();
    const olderPreview = deferred<unknown>();
    const newerPreview = deferred<unknown>();
    const original = {
      versionId: 'version-1', kind: 'html', mimeType: 'text/html', title: 'Original',
      contentKind: 'text' as const, content: '<h1>Original preview</h1>',
    };
    const revision = {
      versionId: 'version-2', kind: 'html', mimeType: 'text/html', title: 'Revision 2',
      contentKind: 'text' as const, content: '<h1>Newer preview</h1>',
    };
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    readPreview
      .mockReturnValueOnce(olderPreview.promise)
      .mockReturnValueOnce(newerPreview.promise);
    const onPreviewVersion = vi.fn();
    renderPanel({
      onPreviewVersion,
      previewNavigationContext: successfulPreviewNavigationContext,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Original' }));
    const revisionButton = screen.getByRole('button', { name: 'Revision 2' });
    revisionButton.focus();
    fireEvent.click(revisionButton);

    await act(async () => {
      newerPreview.resolve({ ok: true, data: revision });
      await newerPreview.promise;
    });
    expect(onPreviewVersion).toHaveBeenCalledTimes(1);
    expect(onPreviewVersion).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'version-2' }),
      revision,
      successfulPreviewNavigationContext,
    );
    expect(onPreviewVersion.mock.calls[0]).toHaveLength(3);
    expect(onPreviewVersion.mock.calls[0]?.[2]).toStrictEqual({ originSurface: 'canvas', epoch: 7 });

    await act(async () => {
      olderPreview.resolve({ ok: true, data: original });
      await olderPreview.promise;
    });
    expect(onPreviewVersion).toHaveBeenCalledTimes(1);
    expect(revisionButton).toHaveAttribute('aria-pressed', 'true');
    expect(revisionButton).toHaveFocus();
  });

  it('masks source-scoped compare and preview errors on the first render after switching artifacts', async () => {
    installApi();
    localStorage.setItem('xiaok:locale', 'en');
    const pendingArtifactB = deferred<unknown>();
    const leftPreview = {
      versionId: 'version-1', kind: 'html', title: 'Original',
      contentKind: 'text' as const, content: '<h1>Artifact A original</h1>',
    };
    const rightPreview = {
      versionId: 'version-2', kind: 'html', title: 'Revision 2',
      contentKind: 'text' as const, content: '<h1>Artifact A revision</h1>',
    };
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: snapshot() })
      .mockReturnValueOnce(pendingArtifactB.promise);
    readPreview
      .mockRejectedValueOnce(new Error('Artifact A preview failed'))
      .mockResolvedValueOnce({ ok: true, data: leftPreview })
      .mockResolvedValueOnce({ ok: true, data: rightPreview });

    const sourceA = {
      artifactId: 'artifact-1', sourceTaskId: 'task-1', kind: 'html', title: 'Artifact A',
    };
    const sourceB = {
      artifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html', title: 'Artifact B',
    };
    const onPreviewVersion = vi.fn();
    const panelRoot = createRef<HTMLDivElement>();
    let committingSource = sourceA.artifactId;
    const sourceBCommits: Array<{ previewError: boolean; compareDialog: boolean }> = [];
    const panel = (sourceArtifact: typeof sourceA) => (
      <LocaleProvider>
        <Profiler
          id="artifact-workspace-source-authority"
          onRender={() => {
            if (committingSource !== sourceB.artifactId || !panelRoot.current) return;
            sourceBCommits.push({
              previewError: Array.from(panelRoot.current.querySelectorAll('[role="alert"]')).some((alert) => (
                alert.textContent?.includes('Could not open this version preview')
              )),
              compareDialog: panelRoot.current.querySelector('[role="dialog"]') !== null,
            });
          }}
        >
          <div ref={panelRoot}>
            <ArtifactWorkspacePanelWithContract
              conversationId="conversation-1"
              sourceArtifact={sourceArtifact}
              previewNavigationContext={successfulPreviewNavigationContext}
              onPreviewVersion={onPreviewVersion}
            />
          </div>
        </Profiler>
      </LocaleProvider>
    );
    const view = render(panel(sourceA));

    fireEvent.click(await screen.findByRole('button', { name: 'Revision 2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Could not open this version preview\. Try again\.$/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    committingSource = sourceB.artifactId;
    view.rerender(panel(sourceB));

    expect(sourceBCommits[0]).toEqual({
      previewError: false,
      compareDialog: false,
    });
  });

  it('does not revive an old revision selection after source A-to-B-to-A', async () => {
    installApi();
    const pendingArtifactB = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    const pendingArtifactAReturn = deferred<{ ok: true; data: ArtifactWorkspaceSnapshot }>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: snapshot() })
      .mockReturnValueOnce(pendingArtifactB.promise)
      .mockReturnValueOnce(pendingArtifactAReturn.promise);
    const sourceA = {
      artifactId: 'artifact-1', sourceTaskId: 'task-1', kind: 'html', title: 'Artifact A',
    };
    const sourceB = {
      artifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html', title: 'Artifact B',
    };
    const panel = (sourceArtifact: typeof sourceA) => (
      <LocaleProvider>
        <ArtifactWorkspacePanelWithContract
          conversationId="conversation-1"
          sourceArtifact={sourceArtifact}
          previewNavigationContext={defaultPreviewNavigationContext}
        />
      </LocaleProvider>
    );
    const view = render(panel(sourceA));

    const revisionTwo = await screen.findByRole('button', { name: 'Revision 2' });
    fireEvent.click(revisionTwo);
    expect(revisionTwo).toHaveAttribute('aria-pressed', 'true');

    view.rerender(panel(sourceB));
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    view.rerender(panel(sourceA));
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));

    expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Revision 2' })).toHaveAttribute('aria-pressed', 'false');

    await act(async () => {
      pendingArtifactB.resolve({ ok: true, data: snapshot() });
      pendingArtifactAReturn.resolve({ ok: true, data: snapshot() });
      await Promise.all([pendingArtifactB.promise, pendingArtifactAReturn.promise]);
    });
    expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('rejects pending compare and preview completions after switching source artifacts', async () => {
    installApi();
    const pendingArtifactB = deferred<unknown>();
    const pendingPreview = deferred<unknown>();
    const pendingCompareLeft = deferred<unknown>();
    const pendingCompareRight = deferred<unknown>();
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: snapshot() })
      .mockReturnValueOnce(pendingArtifactB.promise);
    readPreview
      .mockReturnValueOnce(pendingPreview.promise)
      .mockReturnValueOnce(pendingCompareLeft.promise)
      .mockReturnValueOnce(pendingCompareRight.promise);
    const sourceA = {
      artifactId: 'artifact-1', sourceTaskId: 'task-1', kind: 'html', title: 'Artifact A',
    };
    const sourceB = {
      artifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html', title: 'Artifact B',
    };
    const onPreviewVersion = vi.fn();
    const view = renderPanel({
      sourceArtifact: sourceA,
      onPreviewVersion,
      previewNavigationContext: successfulPreviewNavigationContext,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Revision 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));
    await waitFor(() => expect(readPreview).toHaveBeenCalledTimes(3));

    view.rerender(
      <LocaleProvider>
        <ArtifactWorkspacePanelWithContract
          conversationId="conversation-1"
          sourceArtifact={sourceB}
          previewNavigationContext={successfulPreviewNavigationContext}
          onPreviewVersion={onPreviewVersion}
        />
      </LocaleProvider>,
    );
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    const preview = {
      versionId: 'version-2', kind: 'html', title: 'Artifact A revision',
      contentKind: 'text' as const, content: '<h1>Artifact A preview</h1>',
    };
    const compareLeft = {
      versionId: 'version-1', kind: 'html', title: 'Artifact A original',
      contentKind: 'text' as const, content: '<h1>Artifact A original</h1>',
    };
    await act(async () => {
      pendingPreview.resolve({ ok: true, data: preview });
      pendingCompareLeft.resolve({ ok: true, data: compareLeft });
      pendingCompareRight.resolve({ ok: true, data: preview });
      await Promise.all([
        pendingPreview.promise,
        pendingCompareLeft.promise,
        pendingCompareRight.promise,
      ]);
    });

    expect(onPreviewVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks a missing immutable version and disables compare/export actions for it', async () => {
    installApi();
    const missing = snapshot();
    missing.versions = missing.versions.map((version) => version.id === 'version-2'
      ? { ...version, status: 'missing' as const, preview: { ...version.preview, available: false } }
      : version);
    getSnapshot.mockResolvedValue({ ok: true, data: missing });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Revision 2' }));
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Compare versions' })).toBeDisabled();
  });

  it('keeps existing lineage read-only when mutation flag is off and excludes PDF from revision', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot({ access: { revision: 'read_only', spatial: 'hidden' } }) });
    const { rerender } = renderPanel();

    await screen.findByRole('button', { name: 'Revision 2' });
    expect(screen.queryByRole('button', { name: 'Set as preferred' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create revision' })).toBeNull();

    rerender(
      <LocaleProvider>
        <ArtifactWorkspacePanel
          conversationId="conversation-1"
          sourceArtifact={{ artifactId: 'artifact-pdf', kind: 'pdf', mimeType: 'application/pdf', title: 'Manual' }}
        />
      </LocaleProvider>,
    );
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Create revision' })).toBeNull();
  });

  it.each(['failed', 'cancelled', 'needs_recovery'] as const)('shows the current generation state %s', async (state) => {
    installApi();
    getSnapshot.mockResolvedValue({
      ok: true,
      data: snapshot({
        nodes: [{
          id: 'placeholder-1', workspaceId: 'workspace-1', kind: 'placeholder', placeholderKind: 'image',
          placeholderState: state, owner: 'user', x: 0, y: 0, width: 280, height: 180, zIndex: 1,
          layoutRevision: 0, createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
        }],
        versions: [],
        lineages: [],
      }),
    });
    renderPanel();
    expect(await screen.findByText(state === 'failed' ? 'Generation failed' : state === 'cancelled' ? 'Generation cancelled' : 'Recovery required')).toBeInTheDocument();
  });

  it('ignores a stale snapshot after switching conversations', async () => {
    installApi();
    let resolveFirst!: (value: unknown) => void;
    getSnapshot
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: snapshot({ workspace: { ...snapshot().workspace, conversationId: 'conversation-2' } }) });

    const view = renderPanel();
    view.rerender(
      <LocaleProvider>
        <ArtifactWorkspacePanel conversationId="conversation-2" />
      </LocaleProvider>,
    );
    await screen.findByRole('button', { name: 'Original' });
    resolveFirst({ ok: false, error: { code: 'workspace_not_found', message: 'stale' } });
    await Promise.resolve();
    expect(screen.queryByText('stale')).toBeNull();
    expect(screen.getByRole('button', { name: 'Original' })).toBeInTheDocument();
  });

  it('ignores a stale mutation response after switching conversations', async () => {
    installApi();
    let resolvePrefer!: (value: unknown) => void;
    const conversationTwo = snapshot({
      workspace: { ...snapshot().workspace, id: 'workspace-2', conversationId: 'conversation-2' },
      versions: snapshot().versions.map((version) => ({
        ...version,
        preview: { ...version.preview, title: version.id === 'version-1' ? 'Conversation B original' : 'Conversation B revision' },
      })),
    });
    getSnapshot
      .mockResolvedValueOnce({ ok: true, data: snapshot() })
      .mockResolvedValueOnce({ ok: true, data: conversationTwo });
    preferVersion.mockReturnValueOnce(new Promise((resolve) => { resolvePrefer = resolve; }));

    const view = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Revision 2' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Set as preferred' }));
    await waitFor(() => expect(preferVersion).toHaveBeenCalledTimes(1));

    view.rerender(
      <LocaleProvider>
        <ArtifactWorkspacePanel conversationId="conversation-2" />
      </LocaleProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Conversation B original' })).toBeInTheDocument();
    resolvePrefer({ ok: true, data: snapshot() });
    await Promise.resolve();

    expect(screen.getByRole('button', { name: 'Conversation B original' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Original' })).toBeNull();
  });

  it('binds revision actions to the selected artifact lineage in a multi-lineage workspace', async () => {
    installApi();
    const base = snapshot();
    const multiLineage = snapshot({
      lineages: [
        ...base.lineages,
        {
          id: 'lineage-2', workspaceId: 'workspace-1', sourceLocatorHash: 'opaque-2',
          preferredVersionId: 'version-b1', createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
        },
      ],
      versions: [
        ...base.versions.map((version) => ({
          ...version,
          sourceArtifactId: version.id === 'version-1' ? 'artifact-a' : version.sourceArtifactId,
        })),
        {
          id: 'version-b1', lineageId: 'lineage-2', storageKind: 'single_file', sourceKind: 'materialized_base',
          sourceArtifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html', mimeType: 'text/html', checksum: 'b-one',
          status: 'ready', createdAt: '2026-07-13T02:00:00.000Z', preferred: true,
          preview: { available: true, title: 'Artifact B original', contentKind: 'text' },
        },
        {
          id: 'version-b2', lineageId: 'lineage-2', parentVersionId: 'version-b1', storageKind: 'single_file',
          sourceKind: 'workspace_generation', kind: 'html', mimeType: 'text/html', checksum: 'b-two', status: 'ready',
          createdAt: '2026-07-13T03:00:00.000Z', preferred: false,
          preview: { available: true, title: 'Artifact B revision', contentKind: 'text' },
        },
      ],
    });
    getSnapshot.mockResolvedValue({ ok: true, data: multiLineage });
    submitGeneration.mockResolvedValue({ ok: true, data: multiLineage });

    renderPanel({
      sourceArtifact: { artifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html', title: 'Artifact B' },
    });
    expect(await screen.findByRole('button', { name: 'Artifact B original' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Artifact B revision' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Original' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Artifact B revision' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create revision' }));
    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionId: 'version-b2',
      selectedArtifact: expect.objectContaining({ artifactId: 'artifact-b', sourceTaskId: 'task-b' }),
    })));
  });

  it('does not borrow the only existing lineage when the explicit source artifact has no lineage yet', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    submitGeneration.mockResolvedValue({ ok: true, data: snapshot() });

    renderPanel({
      sourceArtifact: { artifactId: 'artifact-b', sourceTaskId: 'task-b', kind: 'html', title: 'Artifact B' },
    });
    await screen.findByRole('button', { name: 'Create revision' });
    expect(screen.queryByRole('button', { name: 'Original' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create revision' }));
    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      selectedArtifact: expect.objectContaining({ artifactId: 'artifact-b', sourceTaskId: 'task-b' }),
    })));
    expect(submitGeneration.mock.calls[0][0]).not.toHaveProperty('sourceVersionId');
  });

  it('builds a target-bound revision prompt from an annotation action', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    submitGeneration.mockResolvedValue({ ok: true, data: snapshot() });
    renderPanel({ sourceArtifact: { artifactId: 'artifact-1', sourceTaskId: 'task-1', kind: 'html', title: 'Report' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Revision 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revise with annotations' }));
    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionId: 'version-2',
      selectedArtifact: expect.objectContaining({ artifactId: 'artifact-1', sourceTaskId: 'task-1' }),
      prompt: expect.stringContaining('version-2'),
    })));
  });

  it('branches an existing managed version without requiring the original task identity', async () => {
    installApi();
    getSnapshot.mockResolvedValue({ ok: true, data: snapshot() });
    submitGeneration.mockResolvedValue({ ok: true, data: snapshot() });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Revision 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create revision' }));
    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionId: 'version-2',
      expectedStructureRevision: 3,
    })));
  });

  it('submits first revision identity without materializing during preview open', async () => {
    installApi();
    getSnapshot.mockResolvedValue({
      ok: true,
      data: snapshot({ nodes: [], lineages: [], versions: [], access: { revision: 'write', spatial: 'hidden' } }),
    });
    submitGeneration.mockResolvedValue({
      ok: true,
      data: snapshot({ nodes: [], lineages: [], versions: [], access: { revision: 'write', spatial: 'hidden' } }),
    });
    renderPanel({
      sourceArtifact: {
        artifactId: 'artifact-source',
        sourceTaskId: 'desktop-task-9',
        kind: 'html',
        mimeType: undefined,
        title: 'Source report',
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Create revision' }));
    await waitFor(() => expect(submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      selectedArtifact: expect.objectContaining({ artifactId: 'artifact-source', sourceTaskId: 'desktop-task-9' }),
      requestedKind: 'html',
      expectedStructureRevision: 3,
    })));
    expect(submitGeneration.mock.calls[0][0]).not.toHaveProperty('workspaceRootId');
    expect(submitGeneration.mock.calls[0][0].selectedArtifact).not.toHaveProperty('filePath');
    expect(submitGeneration.mock.calls[0][0].selectedArtifact).not.toHaveProperty('mimeType');
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('renders Markdown, image, and slides package comparisons without editing content', () => {
    localStorage.setItem('xiaok:locale', 'en');
    const onClose = vi.fn();
    const view = render(
      <LocaleProvider>
        <ArtifactCompare
          left={{ versionId: 'md-1', kind: 'markdown', title: 'Markdown A', contentKind: 'text', content: '# A' }}
          right={{ versionId: 'md-2', kind: 'markdown', title: 'Markdown B', contentKind: 'text', content: '# B' }}
          onClose={onClose}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText('# A')).toBeInTheDocument();
    expect(screen.getByText('# B')).toBeInTheDocument();

    view.rerender(
      <LocaleProvider>
        <ArtifactCompare
          left={{ versionId: 'image-1', kind: 'image', title: 'Image A', contentKind: 'data_url', content: 'data:image/png;base64,QQ==' }}
          right={{ versionId: 'image-2', kind: 'image', title: 'Image B', contentKind: 'data_url', content: 'data:image/png;base64,Qg==' }}
          onClose={onClose}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole('img', { name: 'Image A' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Image B' })).toBeInTheDocument();

    view.rerender(
      <LocaleProvider>
        <ArtifactCompare
          left={{
            versionId: 'slides-1', kind: 'slides', title: 'Deck A', contentKind: 'package_manifest',
            content: { entryRef: 'deck.json', files: [{ path: 'slides/1.png', size: 1, sha256: 'one' }] },
          }}
          right={{
            versionId: 'slides-2', kind: 'slides', title: 'Deck B', contentKind: 'package_manifest',
            content: { entryRef: 'deck.json', files: [{ path: 'slides/2.png', size: 1, sha256: 'two' }] },
          }}
          onClose={onClose}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText('slides/1.png')).toBeInTheDocument();
    expect(screen.getByText('slides/2.png')).toBeInTheDocument();
  });
});
