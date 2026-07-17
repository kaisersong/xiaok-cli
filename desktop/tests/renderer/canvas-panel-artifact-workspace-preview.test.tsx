import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

type PreviewNavigationContext = {
  originSurface: 'preview' | 'canvas';
  epoch: number;
};

type CapturedPreviewRequest = {
  callback: (
    version: { id: string; kind: string },
    preview: {
      versionId: string;
      kind: string;
      mimeType: string;
      title: string;
      contentKind: string;
      content: string;
    },
    navigationContext: PreviewNavigationContext,
  ) => void;
  navigationContext: PreviewNavigationContext;
  version: { id: string; kind: string };
  preview: {
    versionId: string;
    kind: string;
    mimeType: string;
    title: string;
    contentKind: string;
    content: string;
  };
};

const apiControl = vi.hoisted(() => ({
  readFileContent: vi.fn(),
}));

const panelControl = vi.hoisted(() => ({
  availability: 'enabled' as 'unknown' | 'enabled' | 'hidden',
  mounts: 0,
  unmounts: 0,
  latestProps: null as Record<string, unknown> | null,
  previewRequests: [] as CapturedPreviewRequest[],
  layoutCheckpoints: [] as Array<{
    activeElement: Element | null;
    canvasTabPresent: boolean;
    previewSelected: boolean;
  }>,
}));

const previewControl = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  latestProps: null as Record<string, unknown> | null,
  renders: [] as Array<{
    filePath: string;
    content: string;
    interactionMode: string;
  }>,
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    readFileContent: apiControl.readFileContent,
  },
}));

vi.mock('../../renderer/src/components/artifact-workspace/ArtifactWorkspacePanel', async () => {
  const React = await import('react');
  return {
    ArtifactWorkspacePanel: (props: Record<string, unknown>) => {
      const [localValue, setLocalValue] = React.useState('canvas-state');
      panelControl.latestProps = props;
      const capturePreviewRequest = () => {
        const requestNumber = panelControl.previewRequests.length + 1;
        const versionId = `queued-version-${requestNumber}`;
        panelControl.previewRequests.push({
          callback: props.onPreviewVersion as CapturedPreviewRequest['callback'],
          navigationContext: props.previewNavigationContext as PreviewNavigationContext,
          version: { id: versionId, kind: 'html' },
          preview: {
            versionId,
            kind: 'html',
            mimeType: 'text/html',
            title: `queued-revision-${requestNumber}.html`,
            contentKind: 'text',
            content: `<h1>Queued revision ${requestNumber}</h1>`,
          },
        });
      };
      React.useLayoutEffect(() => {
        panelControl.mounts += 1;
        return () => { panelControl.unmounts += 1; };
      }, []);
      React.useLayoutEffect(() => {
        (props.onSpatialAvailabilityChange as Function)?.(panelControl.availability);
      });
      React.useLayoutEffect(() => {
        const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
        const canvasTab = tabs.find((tab) => tab.textContent?.trim() === 'Canvas');
        const previewTab = tabs.find((tab) => tab.textContent?.trim() === 'Preview');
        panelControl.layoutCheckpoints.push({
          activeElement: document.activeElement,
          canvasTabPresent: Boolean(canvasTab),
          previewSelected: previewTab?.getAttribute('aria-selected') === 'true',
        });
      });
      return (
        <div data-testid="workspace-panel">
          <input
            aria-label="Canvas local state"
            value={localValue}
            onChange={(event) => setLocalValue(event.target.value)}
          />
          <button
            type="button"
            onClick={() => (props.onPreviewVersion as Function)?.(
              { id: 'version-2', kind: 'html' },
              {
                versionId: 'version-2', kind: 'html', mimeType: 'text/html', title: 'revision-2.html',
                contentKind: 'text', content: '<h1>Managed revision</h1>',
              },
              props.previewNavigationContext,
            )}
          >
            Open managed revision
          </button>
          <button type="button" onClick={capturePreviewRequest}>
            Start managed preview request
          </button>
        </div>
      );
    },
  };
});

vi.mock('../../renderer/src/components/CanvasPreview', async () => {
  const React = await import('react');
  return {
    CanvasPreview: (props: Record<string, unknown>) => {
      const [localValue, setLocalValue] = React.useState('preview-state');
      previewControl.latestProps = props;
      previewControl.renders.push({
        filePath: String(props.filePath),
        content: String(props.content),
        interactionMode: String(props.interactionMode ?? 'editable'),
      });
      React.useLayoutEffect(() => {
        previewControl.mounts += 1;
        return () => { previewControl.unmounts += 1; };
      }, []);
      return (
        <div data-testid="canvas-preview">
          {String(props.filePath)}|{String(props.content)}|{String(props.interactionMode ?? 'editable')}
          <input
            aria-label="Preview local state"
            value={localValue}
            onChange={(event) => setLocalValue(event.target.value)}
          />
        </div>
      );
    },
  };
});

vi.mock('../../renderer/src/components/WorkspaceTree', () => ({
  WorkspaceTree: () => (
    <button type="button" data-testid="workspace-tree" aria-label="Workspace focus owner">
      workspace-tree
    </button>
  ),
}));
vi.mock('../../renderer/src/components/ToolsPanel', () => ({
  ToolsPanel: () => (
    <button type="button" data-testid="tools-panel" aria-label="Tools focus owner">
      tools-panel
    </button>
  ),
}));
vi.mock('../../renderer/src/components/CanvasEmptyState', () => ({
  CanvasEmptyState: ({ message }: { message: string }) => (
    <div data-testid="canvas-empty-state">{message}</div>
  ),
}));

const { CanvasPanel } = await import('../../renderer/src/components/CanvasPanel');

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
let simulatedDocumentHasFocus = true;

const populatedEvents = [
  {
    type: 'canvas_file_changed',
    filePath: 'workspace.txt',
    change: 'add',
    eventId: 'file-change-1',
  },
  {
    type: 'canvas_tool_call',
    toolName: 'Read',
    input: {},
    eventId: 'tool-call-1',
  },
] as Parameters<typeof CanvasPanel>[0]['events'];

function panelElement(overrides: Partial<Parameters<typeof CanvasPanel>[0]> = {}) {
  return (
    <LocaleProvider>
      <button type="button" aria-label="External focus owner">External focus owner</button>
      <CanvasPanel
        events={populatedEvents}
        conversationId="conversation-1"
        sourceArtifact={{ artifactId: 'artifact-1', kind: 'html' }}
        initialPreviewFile="original.html"
        initialPreviewContent="<h1>Original</h1>"
        onClose={() => {}}
        onToggleExpand={() => {}}
        {...overrides}
      />
    </LocaleProvider>
  );
}

function renderPanel(overrides: Partial<Parameters<typeof CanvasPanel>[0]> = {}) {
  localStorage.setItem('xiaok:locale', 'en');
  return render(panelElement(overrides));
}

function startManagedPreviewRequest() {
  fireEvent.click(screen.getByRole('button', { name: 'Start managed preview request' }));
  const request = panelControl.previewRequests.at(-1);
  if (!request) {
    throw new Error('Preview request harness did not capture a request');
  }
  return request;
}

function resolveManagedPreviewRequest(request: CapturedPreviewRequest) {
  if (typeof request.callback !== 'function') {
    throw new Error('Preview request harness did not capture onPreviewVersion');
  }
  act(() => {
    request.callback(request.version, request.preview, request.navigationContext);
  });
}

function expectRequestOrigin(
  request: CapturedPreviewRequest,
  originSurface: PreviewNavigationContext['originSurface'],
) {
  expect(request.navigationContext).toEqual({
    originSurface,
    epoch: expect.any(Number),
  });
}

function lastLayoutCheckpoint() {
  const checkpoint = panelControl.layoutCheckpoints.at(-1);
  if (!checkpoint) {
    throw new Error('Layout checkpoint harness did not capture a commit');
  }
  return checkpoint;
}

beforeEach(() => {
  panelControl.availability = 'enabled';
  panelControl.mounts = 0;
  panelControl.unmounts = 0;
  panelControl.latestProps = null;
  panelControl.previewRequests = [];
  panelControl.layoutCheckpoints = [];
  previewControl.mounts = 0;
  previewControl.unmounts = 0;
  previewControl.latestProps = null;
  previewControl.renders = [];
  apiControl.readFileContent.mockReset();
  apiControl.readFileContent.mockResolvedValue({ content: '<h1>Original</h1>' });
  simulatedDocumentHasFocus = true;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => simulatedDocumentHasFocus);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
  } else {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

describe('CanvasPanel managed artifact preview integration', () => {
  it('switches CanvasPreview to the selected immutable version in read-only mode', () => {
    localStorage.setItem('xiaok:locale', 'en');
    render(
      <LocaleProvider>
        <CanvasPanel
          events={[]}
          conversationId="conversation-1"
          sourceArtifact={{ artifactId: 'artifact-1', kind: 'html' }}
          initialPreviewFile="original.html"
          initialPreviewContent="<h1>Original</h1>"
          onClose={() => {}}
        />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('canvas-preview')).toHaveTextContent('original.html|<h1>Original</h1>|editable');
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open managed revision' }));
    expect(screen.getByTestId('canvas-preview')).toHaveTextContent(
      'revision-2.html|<h1>Managed revision</h1>|read_only',
    );
  });

  it('shows a Canvas-managed preview when the workspace has no initially selected file', () => {
    renderPanel({
      initialPreviewFile: undefined,
      initialPreviewContent: undefined,
    });

    expect(screen.queryByTestId('canvas-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('canvas-empty-state')).toHaveTextContent('Select a file to preview');

    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open managed revision' }));

    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('canvas-preview')).toHaveTextContent(
      'revision-2.html|<h1>Managed revision</h1>|read_only',
    );
  });

  it('clears the previous preview before rendering a new source identity with no initial file', () => {
    const { rerender } = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open managed revision' }));
    expect(screen.getByTestId('canvas-preview')).toHaveTextContent('revision-2.html');

    const nextSourceRenderStart = previewControl.renders.length;
    rerender(panelElement({
      sourceArtifact: { artifactId: 'artifact-2', kind: 'html' },
      initialPreviewFile: undefined,
      initialPreviewContent: undefined,
    }));

    const nextSourceRenders = previewControl.renders.slice(nextSourceRenderStart);
    expect(nextSourceRenders.some((preview) => preview.filePath === 'revision-2.html')).toBe(false);
    expect(screen.queryByTestId('canvas-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('canvas-empty-state')).toHaveTextContent('Select a file to preview');
  });

  it('composes Preview, Canvas, Workspace, and Tools as exclusive tab surfaces without remounting Preview or Canvas', () => {
    renderPanel();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Preview', 'Canvas', 'Workspace', 'Tools']);
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');

    const previewLayer = screen.getByTestId('canvas-preview').closest('[role="tabpanel"]');
    const canvasLayer = screen.getByTestId('workspace-panel').closest('[role="tabpanel"]');
    expect(previewLayer).toHaveClass('is-active');
    expect(canvasLayer).not.toHaveClass('is-active');
    expect(previewLayer).not.toHaveAttribute('aria-hidden');
    expect(previewLayer).not.toHaveAttribute('inert');
    expect(canvasLayer).toHaveAttribute('aria-hidden', 'true');
    expect(canvasLayer).toHaveAttribute('inert');
    expect(previewControl.latestProps).toMatchObject({ interactionActive: true });
    expect(panelControl.latestProps).toMatchObject({ interactionActive: false });

    fireEvent.change(screen.getByLabelText('Preview local state'), { target: { value: 'preview-edited' } });
    fireEvent.change(screen.getByLabelText('Canvas local state'), { target: { value: 'canvas-edited' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));

    expect(screen.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('aria-selected', 'true');
    expect(previewLayer).not.toHaveClass('is-active');
    expect(canvasLayer).toHaveClass('is-active');
    expect(previewLayer).toHaveAttribute('aria-hidden', 'true');
    expect(previewLayer).toHaveAttribute('inert');
    expect(canvasLayer).not.toHaveAttribute('aria-hidden');
    expect(canvasLayer).not.toHaveAttribute('inert');
    expect(previewControl.latestProps).toMatchObject({ interactionActive: false });
    expect(panelControl.latestProps).toMatchObject({ interactionActive: true });

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(previewControl.latestProps).toMatchObject({ interactionActive: true });
    expect(panelControl.latestProps).toMatchObject({ interactionActive: false });
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    expect(previewControl.latestProps).toMatchObject({ interactionActive: false });
    expect(panelControl.latestProps).toMatchObject({ interactionActive: true });
    expect(screen.getByLabelText('Preview local state')).toHaveValue('preview-edited');
    expect(screen.getByLabelText('Canvas local state')).toHaveValue('canvas-edited');
    expect(previewControl.mounts).toBe(1);
    expect(previewControl.unmounts).toBe(0);
    expect(panelControl.mounts).toBe(1);
    expect(panelControl.unmounts).toBe(0);
  });

  it('exposes Workspace and Tools as active tabpanels while keeping Preview and Canvas inert', () => {
    renderPanel();

    const previewLayer = screen.getByTestId('canvas-preview').closest('[role="tabpanel"]');
    const canvasLayer = screen.getByTestId('workspace-panel').closest('[role="tabpanel"]');
    const controlledPanel = (tabName: string) => {
      const tab = screen.getByRole('tab', { name: tabName });
      const controlledIds = tab.getAttribute('aria-controls')?.trim().split(/\s+/) ?? [];
      expect(controlledIds).toHaveLength(1);
      const panel = document.getElementById(controlledIds[0]);
      expect(panel).toHaveAttribute('role', 'tabpanel');
      return panel;
    };
    const workspaceLayer = controlledPanel('Workspace');
    const toolsLayer = controlledPanel('Tools');
    const expectInactivePersistentSurface = (layer: Element | null) => {
      expect(layer).not.toHaveClass('is-active');
      expect(layer).toHaveAttribute('aria-hidden', 'true');
      expect(layer).toHaveAttribute('inert');
    };
    const expectActiveUtilitySurface = (layer: Element | null) => {
      expect(layer).not.toHaveAttribute('hidden');
      expect(layer).not.toHaveAttribute('aria-hidden', 'true');
      expect(layer).not.toHaveAttribute('inert');
      expect(layer).toBeVisible();
    };
    const expectInactiveUtilitySurface = (layer: Element | null) => {
      const usesHiddenContract = layer?.hasAttribute('hidden') ?? false;
      const usesInertLayerContract = layer?.getAttribute('aria-hidden') === 'true'
        && layer.hasAttribute('inert');
      expect(usesHiddenContract || usesInertLayerContract).toBe(true);
    };
    const expectOnlySelectedTab = (name: string) => {
      const selectedTabs = screen.getAllByRole('tab').filter(
        (tab) => tab.getAttribute('aria-selected') === 'true',
      );
      expect(selectedTabs).toHaveLength(1);
      expect(selectedTabs[0]).toHaveAccessibleName(name);
    };

    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }));
    expectOnlySelectedTab('Workspace');
    expectActiveUtilitySurface(workspaceLayer);
    expectInactiveUtilitySurface(toolsLayer);
    expect(workspaceLayer).toContainElement(screen.getByTestId('workspace-tree'));
    expectInactivePersistentSurface(previewLayer);
    expectInactivePersistentSurface(canvasLayer);
    expect(previewControl.latestProps).toMatchObject({ interactionActive: false });
    expect(panelControl.latestProps).toMatchObject({ interactionActive: false });

    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    expectOnlySelectedTab('Tools');
    expectActiveUtilitySurface(toolsLayer);
    expectInactiveUtilitySurface(workspaceLayer);
    expect(toolsLayer).toContainElement(screen.getByTestId('tools-panel'));
    expectInactivePersistentSurface(previewLayer);
    expectInactivePersistentSurface(canvasLayer);
    expect(previewControl.latestProps).toMatchObject({ interactionActive: false });
    expect(panelControl.latestProps).toMatchObject({ interactionActive: false });
  });

  it.each([
    ['en', 'Artifact workspace'],
    ['zh', 'Artifact 工作区'],
  ] as const)('gives the tablist its localized accessible name in %s', (locale, accessibleName) => {
    localStorage.setItem('xiaok:locale', locale);
    render(panelElement());

    expect(screen.getByRole('tablist', { name: accessibleName })).toBeInTheDocument();
  });

  it('gives every tab an explicit keyboard focus-visible treatment', () => {
    renderPanel();

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('focus-visible:outline-none');
      expect(tab).toHaveClass('focus-visible:ring-2');
      expect(tab).toHaveClass('focus-visible:ring-[var(--c-accent)]');
    }
  });

  it('implements automatic APG tab activation with roving tabIndex and live aria-controls targets', () => {
    renderPanel();

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    const controlsBeforeNavigation = new Map(
      tabs.map((tab) => {
        const name = tab.textContent ?? '';
        const ariaControls = tab.getAttribute('aria-controls') ?? '';
        expect(ariaControls).not.toBe('');
        return [name, ariaControls] as const;
      }),
    );
    const expectActiveTab = (name: string) => {
      for (const tab of screen.getAllByRole('tab')) {
        const active = tab.textContent === name;
        expect(tab).toHaveAttribute('aria-selected', String(active));
        expect(tab).toHaveAttribute('tabindex', active ? '0' : '-1');
      }
    };
    const expectStableLiveControls = () => {
      for (const [name, ariaControls] of controlsBeforeNavigation) {
        const tab = screen.getByRole('tab', { name });
        expect(tab).toHaveAttribute('aria-controls', ariaControls);
        for (const id of ariaControls.trim().split(/\s+/)) {
          expect(document.getElementById(id)).toBeInTheDocument();
        }
      }
    };
    const navigate = (
      sourceName: string,
      key: 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End',
      destinationName: string,
    ) => {
      const source = screen.getByRole('tab', { name: sourceName });
      source.focus();
      expect(source).toHaveFocus();
      fireEvent.keyDown(source, { key });

      const destination = screen.getByRole('tab', { name: destinationName });
      expect(destination).toHaveFocus();
      expect(destination.scrollIntoView).toHaveBeenLastCalledWith({
        block: 'nearest',
        inline: 'nearest',
      });
      expectActiveTab(destinationName);
      expectStableLiveControls();
    };

    expectStableLiveControls();
    expectActiveTab('Preview');
    navigate('Preview', 'ArrowRight', 'Canvas');
    navigate('Canvas', 'ArrowLeft', 'Preview');
    navigate('Preview', 'End', 'Tools');
    navigate('Tools', 'Home', 'Preview');
  });

  it.each([
    { tabName: 'Canvas', focusOwnerName: 'Canvas local state' },
    { tabName: 'Workspace', focusOwnerName: 'Workspace focus owner' },
    { tabName: 'Tools', focusOwnerName: 'Tools focus owner' },
  ])(
    'moves focus from the active $tabName surface to Preview when the initial preview changes',
    ({ tabName, focusOwnerName }) => {
      const { rerender } = renderPanel();
      fireEvent.click(screen.getByRole('tab', { name: tabName }));
      const hiddenSurfaceOwner = screen.getByLabelText(focusOwnerName);
      hiddenSurfaceOwner.focus();
      expect(hiddenSurfaceOwner).toHaveFocus();

      const previewTab = screen.getByRole('tab', { name: 'Preview' });
      const previewFocusSpy = vi.spyOn(previewTab, 'focus');
      rerender(panelElement({
        initialPreviewFile: 'replacement.html',
        initialPreviewContent: '<h1>Replacement</h1>',
      }));

      expect(previewTab).toHaveAttribute('aria-selected', 'true');
      expect(previewFocusSpy).toHaveBeenCalled();
      expect(previewTab).toHaveFocus();
    },
  );

  it.each(['Close artifact panel', 'Expand artifact panel', 'External focus owner'])(
    'keeps %s focus when the initial preview changes',
    (accessibleName) => {
      const { rerender } = renderPanel();
      fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
      const focusOwner = screen.getByRole('button', { name: accessibleName });
      focusOwner.focus();
      const focusBeforePreviewChange = document.activeElement;
      expect(focusOwner).toHaveFocus();

      const previewTab = screen.getByRole('tab', { name: 'Preview' });
      const previewFocusSpy = vi.spyOn(previewTab, 'focus');
      rerender(panelElement({
        initialPreviewFile: 'replacement.html',
        initialPreviewContent: '<h1>Replacement</h1>',
      }));

      expect(previewTab).toHaveAttribute('aria-selected', 'true');
      expect(previewFocusSpy).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(focusBeforePreviewChange);
      expect(focusOwner).toHaveFocus();
    },
  );

  it('removes a hidden Canvas tab and exposes its compact surface as a Preview-labelled region', () => {
    const { rerender } = renderPanel();
    expect(screen.getByRole('tab', { name: 'Canvas' })).toBeInTheDocument();
    const workspacePanel = screen.getByTestId('workspace-panel');
    const spatialHost = workspacePanel.closest('[role="tabpanel"]');
    fireEvent.change(screen.getByLabelText('Canvas local state'), {
      target: { value: 'canvas-state-before-hidden' },
    });

    panelControl.availability = 'hidden';
    rerender(panelElement());

    expect(screen.queryByRole('tab', { name: 'Canvas' })).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-panel')).toBe(workspacePanel);
    expect(screen.getByLabelText('Canvas local state')).toHaveValue('canvas-state-before-hidden');
    expect(panelControl.mounts).toBe(1);
    expect(panelControl.unmounts).toBe(0);
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const previewLayer = screen.getByTestId('canvas-preview').closest('[role="tabpanel"]');
    const compactRegion = screen.getByTestId('workspace-panel').closest('[role="region"]');
    expect(compactRegion).toBe(spatialHost);
    expect(compactRegion).toHaveAttribute('aria-labelledby', previewTab.id);
    expect(compactRegion).toHaveAttribute('id');
    expect(previewLayer).toHaveAttribute('id');

    const previewControls = previewTab.getAttribute('aria-controls')?.trim().split(/\s+/) ?? [];
    expect(previewControls).toEqual(expect.arrayContaining([compactRegion?.id, previewLayer?.id]));
    for (const id of previewControls) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }
  });

  it('moves focus from the Canvas owner to Preview when a current managed preview hides Canvas', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));

    const canvasOwner = screen.getByRole('button', { name: 'Start managed preview request' });
    canvasOwner.focus();
    const request = startManagedPreviewRequest();
    expect(canvasOwner).toHaveFocus();
    expectRequestOrigin(request, 'canvas');
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const previewFocusSpy = vi.spyOn(previewTab, 'focus');

    resolveManagedPreviewRequest(request);

    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('canvas-preview')).toHaveTextContent(
      'queued-revision-1.html|<h1>Queued revision 1</h1>|read_only',
    );
    expect(previewFocusSpy).toHaveBeenCalled();
    expect(previewTab).toHaveFocus();
  });

  it.each(['Close artifact panel', 'Expand artifact panel', 'External focus owner'])(
    'does not steal focus from %s when a Canvas preview resolves',
    (accessibleName) => {
      renderPanel();
      fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
      const request = startManagedPreviewRequest();
      expectRequestOrigin(request, 'canvas');

      const focusOwner = screen.getByRole('button', { name: accessibleName });
      focusOwner.focus();
      const focusBeforeResolution = document.activeElement;
      const previewTab = screen.getByRole('tab', { name: 'Preview' });
      const previewFocusSpy = vi.spyOn(previewTab, 'focus');
      expect(focusOwner).toHaveFocus();
      resolveManagedPreviewRequest(request);

      expect(previewTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('canvas-preview')).toHaveTextContent(
        'queued-revision-1.html|<h1>Queued revision 1</h1>|read_only',
      );
      expect(previewFocusSpy).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(focusBeforeResolution);
      expect(focusOwner).toHaveFocus();
    },
  );

  it('does not move focus when a current Canvas preview resolves while the document is unfocused', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));

    const canvasOwner = screen.getByRole('button', { name: 'Start managed preview request' });
    canvasOwner.focus();
    const request = startManagedPreviewRequest();
    const focusBeforeResolution = document.activeElement;
    expectRequestOrigin(request, 'canvas');
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const previewFocusSpy = vi.spyOn(previewTab, 'focus');
    simulatedDocumentHasFocus = false;

    resolveManagedPreviewRequest(request);

    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('canvas-preview')).toHaveTextContent(
      'queued-revision-1.html|<h1>Queued revision 1</h1>|read_only',
    );
    expect(previewFocusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(focusBeforeResolution);
    expect(previewTab).not.toHaveFocus();
  });

  it('updates Preview without top-level focus movement for a compact Preview-origin request', () => {
    panelControl.availability = 'hidden';
    renderPanel();

    expect(screen.queryByRole('tab', { name: 'Canvas' })).not.toBeInTheDocument();
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const compactOwner = screen.getByRole('button', { name: 'Start managed preview request' });
    compactOwner.focus();
    const request = startManagedPreviewRequest();
    expect(compactOwner).toHaveFocus();
    expectRequestOrigin(request, 'preview');
    const previewFocusSpy = vi.spyOn(previewTab, 'focus');

    resolveManagedPreviewRequest(request);

    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('canvas-preview')).toHaveTextContent(
      'queued-revision-1.html|<h1>Queued revision 1</h1>|read_only',
    );
    expect(previewFocusSpy).not.toHaveBeenCalled();
    expect(compactOwner).toHaveFocus();
    expect(previewTab).not.toHaveFocus();
  });

  it('rejects a managed preview result after the user navigates from Canvas to Workspace', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    const request = startManagedPreviewRequest();
    expectRequestOrigin(request, 'canvas');

    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }));
    resolveManagedPreviewRequest(request);

    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('canvas-preview')).toHaveTextContent(
      'original.html|<h1>Original</h1>|editable',
    );
    expect(screen.getByTestId('canvas-preview')).not.toHaveTextContent('Queued revision 1');
  });

  it('moves focus to Preview in the same layout phase when Canvas becomes unavailable', () => {
    const { rerender } = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    const canvasOwner = screen.getByLabelText('Canvas local state');
    canvasOwner.focus();
    expect(canvasOwner).toHaveFocus();
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const previewFocusSpy = vi.spyOn(previewTab, 'focus');

    panelControl.availability = 'hidden';
    rerender(panelElement());

    expect(screen.queryByRole('tab', { name: 'Canvas' })).not.toBeInTheDocument();
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(previewFocusSpy).toHaveBeenCalled();
    expect(previewTab).toHaveFocus();
    const checkpoint = lastLayoutCheckpoint();
    expect(checkpoint.canvasTabPresent).toBe(false);
    expect(checkpoint.previewSelected).toBe(true);
    expect(checkpoint.activeElement).toBe(previewTab);
  });

  it('moves compact workspace focus to Preview before spatial availability hides that region', () => {
    panelControl.availability = 'hidden';
    const { rerender } = renderPanel();
    expect(screen.queryByRole('tab', { name: 'Canvas' })).toBeNull();

    const compactOwner = screen.getByRole('button', { name: 'Start managed preview request' });
    compactOwner.focus();
    expect(compactOwner).toHaveFocus();
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const previewFocusSpy = vi.spyOn(previewTab, 'focus');

    panelControl.availability = 'enabled';
    rerender(panelElement());

    expect(screen.getByRole('tab', { name: 'Canvas' })).toBeInTheDocument();
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(previewFocusSpy).toHaveBeenCalled();
    expect(previewTab).toHaveFocus();
    const workspaceHost = screen.getByTestId('workspace-panel').closest('[role="tabpanel"]');
    expect(workspaceHost).toHaveAttribute('aria-hidden', 'true');
    expect(workspaceHost).toHaveAttribute('inert');
    expect(workspaceHost).not.toHaveClass('is-active');
  });

  it.each(['Close artifact panel', 'Expand artifact panel', 'External focus owner'])(
    'keeps %s focus when compact workspace becomes spatial',
    (accessibleName) => {
      panelControl.availability = 'hidden';
      const { rerender } = renderPanel();
      const focusOwner = screen.getByRole('button', { name: accessibleName });
      focusOwner.focus();
      const previewTab = screen.getByRole('tab', { name: 'Preview' });
      const previewFocusSpy = vi.spyOn(previewTab, 'focus');

      panelControl.availability = 'enabled';
      rerender(panelElement());

      expect(screen.getByRole('tab', { name: 'Canvas' })).toBeInTheDocument();
      expect(previewFocusSpy).not.toHaveBeenCalled();
      expect(focusOwner).toHaveFocus();
    },
  );

  it('does not move compact workspace focus while the document is unfocused', () => {
    panelControl.availability = 'hidden';
    const { rerender } = renderPanel();
    const compactOwner = screen.getByRole('button', { name: 'Start managed preview request' });
    compactOwner.focus();
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const previewFocusSpy = vi.spyOn(previewTab, 'focus');
    simulatedDocumentHasFocus = false;

    panelControl.availability = 'enabled';
    rerender(panelElement());

    expect(screen.getByRole('tab', { name: 'Canvas' })).toBeInTheDocument();
    expect(previewFocusSpy).not.toHaveBeenCalled();
    expect(compactOwner).toHaveFocus();
  });

  it.each(['Close artifact panel', 'Expand artifact panel', 'External focus owner'])(
    'keeps %s focus when Canvas becomes unavailable',
    (accessibleName) => {
      const { rerender } = renderPanel();
      fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
      const focusOwner = screen.getByRole('button', { name: accessibleName });
      focusOwner.focus();
      const focusBeforeAvailabilityChange = document.activeElement;
      const previewTab = screen.getByRole('tab', { name: 'Preview' });
      const previewFocusSpy = vi.spyOn(previewTab, 'focus');
      expect(focusOwner).toHaveFocus();

      panelControl.availability = 'hidden';
      rerender(panelElement());

      expect(screen.queryByRole('tab', { name: 'Canvas' })).not.toBeInTheDocument();
      expect(previewTab).toHaveAttribute('aria-selected', 'true');
      expect(previewFocusSpy).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(focusBeforeAvailabilityChange);
      expect(focusOwner).toHaveFocus();
      const checkpoint = lastLayoutCheckpoint();
      expect(checkpoint.canvasTabPresent).toBe(false);
      expect(checkpoint.previewSelected).toBe(true);
      expect(checkpoint.activeElement).toBe(focusOwner);
    },
  );

  it('does not move focus when Canvas becomes unavailable while the document is unfocused', () => {
    const { rerender } = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    const canvasOwner = screen.getByLabelText('Canvas local state');
    canvasOwner.focus();
    const focusBeforeAvailabilityChange = document.activeElement;
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const previewFocusSpy = vi.spyOn(previewTab, 'focus');
    simulatedDocumentHasFocus = false;

    panelControl.availability = 'hidden';
    rerender(panelElement());

    expect(screen.queryByRole('tab', { name: 'Canvas' })).not.toBeInTheDocument();
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(previewFocusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(focusBeforeAvailabilityChange);
    expect(previewTab).not.toHaveFocus();
    const checkpoint = lastLayoutCheckpoint();
    expect(checkpoint.canvasTabPresent).toBe(false);
    expect(checkpoint.previewSelected).toBe(true);
    expect(checkpoint.activeElement).toBe(focusBeforeAvailabilityChange);
  });
});
