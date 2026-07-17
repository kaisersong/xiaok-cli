import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { X, FolderTree, Code, Share2, Wrench, Maximize2, Minimize2 } from 'lucide-react';
import { WorkspaceTree } from './WorkspaceTree';
import { CanvasPreview, type CanvasPreviewModeRequest } from './CanvasPreview';
import { ToolsPanel } from './ToolsPanel';
import { CanvasEmptyState } from './CanvasEmptyState';
import { api } from '../api';
import { useLocale } from '../contexts/LocaleContext';
import type { DesktopTaskEvent } from '../../../shared/task-types';
import type { ArtifactWorkspacePreview, ArtifactWorkspaceSelectedArtifact } from '../../../shared/artifact-workspace-types';
import {
  ArtifactWorkspacePanel,
  type ArtifactWorkspacePreviewNavigationContext,
  type SpatialAvailability,
} from './artifact-workspace/ArtifactWorkspacePanel';

interface CanvasPanelProps {
  events: DesktopTaskEvent[];
  conversationId?: string;
  sourceTaskId?: string;
  workspaceRootId?: string;
  sourceArtifact?: ArtifactWorkspaceSelectedArtifact;
  onClose: () => void;
  initialPreviewFile?: string;
  initialPreviewContent?: string;
  initialPreviewModeRequest?: CanvasPreviewModeRequest;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onAnnotation?: (message: string) => void;
}

type CanvasTab = 'preview' | 'canvas' | 'workspace' | 'tools';
type FocusOwner = CanvasTab | 'other';

interface PreviewState {
  sourceIdentity: string;
  initialFile: string | null;
  initialContent: string;
  selectedFile: string | null;
  previewContent: string;
  managedPreview: ArtifactWorkspacePreview | null;
}

export function CanvasPanel({
  events,
  conversationId,
  sourceTaskId,
  workspaceRootId,
  sourceArtifact,
  onClose,
  initialPreviewFile,
  initialPreviewContent,
  initialPreviewModeRequest,
  expanded,
  onToggleExpand,
  onAnnotation,
}: CanvasPanelProps) {
  const { t } = useLocale();
  const idPrefix = useId();
  const previewTabId = `${idPrefix}-tab-preview`;
  const canvasTabId = `${idPrefix}-tab-canvas`;
  const workspaceTabId = `${idPrefix}-tab-workspace`;
  const toolsTabId = `${idPrefix}-tab-tools`;
  const previewPanelId = `${idPrefix}-panel-preview`;
  const canvasPanelId = `${idPrefix}-panel-canvas`;
  const workspacePanelId = `${idPrefix}-panel-workspace`;
  const toolsPanelId = `${idPrefix}-panel-tools`;
  const previewSourceIdentity = JSON.stringify([
    conversationId ?? null,
    workspaceRootId ?? null,
    sourceTaskId ?? null,
    sourceArtifact?.artifactId ?? null,
    sourceArtifact?.sourceTaskId ?? null,
  ]);
  const currentInitialFile = initialPreviewFile ?? null;
  const currentInitialContent = initialPreviewContent ?? '';
  const [activeTab, setActiveTab] = useState<CanvasTab>('preview');
  const [spatialAvailability, setSpatialAvailability] = useState<SpatialAvailability>('unknown');
  const [previewState, setPreviewState] = useState<PreviewState>(() => ({
    sourceIdentity: previewSourceIdentity,
    initialFile: currentInitialFile,
    initialContent: currentInitialContent,
    selectedFile: currentInitialFile,
    previewContent: currentInitialContent,
    managedPreview: null,
  }));
  const activeTabRef = useRef<CanvasTab>('preview');
  const spatialAvailabilityRef = useRef<SpatialAvailability>('unknown');
  const navigationEpochRef = useRef(0);
  const focusOwnerRef = useRef<FocusOwner>('other');
  const workspaceHostHadFocusRef = useRef(false);
  const previewAuthorityRef = useRef({
    sourceIdentity: previewSourceIdentity,
    initialFile: currentInitialFile,
    initialContent: currentInitialContent,
  });
  const tabRefs = useRef<Partial<Record<CanvasTab, HTMLButtonElement | null>>>({});
  const previewLayerRef = useRef<HTMLDivElement>(null);
  const workspaceHostRef = useRef<HTMLDivElement>(null);

  activeTabRef.current = activeTab;
  spatialAvailabilityRef.current = spatialAvailability;
  previewAuthorityRef.current = {
    sourceIdentity: previewSourceIdentity,
    initialFile: currentInitialFile,
    initialContent: currentInitialContent,
  };

  const previewStateMatchesAuthority = previewState.sourceIdentity === previewSourceIdentity
    && previewState.initialFile === currentInitialFile
    && previewState.initialContent === currentInitialContent;
  const currentPreviewState = previewStateMatchesAuthority
    ? previewState
    : {
        sourceIdentity: previewSourceIdentity,
        initialFile: currentInitialFile,
        initialContent: currentInitialContent,
        selectedFile: currentInitialFile,
        previewContent: currentInitialContent,
        managedPreview: null,
      };
  const { selectedFile, previewContent, managedPreview } = currentPreviewState;

  const tabs: Array<{ key: CanvasTab; label: string; icon: typeof X; id: string; controls: string }> = [
    {
      key: 'preview',
      label: t.artifactWorkspace.previewTab,
      icon: Code,
      id: previewTabId,
      controls: spatialAvailability === 'enabled' || !conversationId
        ? previewPanelId
        : `${previewPanelId} ${canvasPanelId}`,
    },
    ...(spatialAvailability === 'enabled' && conversationId ? [{
      key: 'canvas' as const,
      label: t.artifactWorkspace.canvasTab,
      icon: Share2,
      id: canvasTabId,
      controls: canvasPanelId,
    }] : []),
    {
      key: 'workspace',
      label: t.artifactWorkspace.workspaceTab,
      icon: FolderTree,
      id: workspaceTabId,
      controls: workspacePanelId,
    },
    {
      key: 'tools',
      label: t.artifactWorkspace.toolsTab,
      icon: Wrench,
      id: toolsTabId,
      controls: toolsPanelId,
    },
  ];

  const focusTab = useCallback((tab: CanvasTab, scroll = false) => {
    const element = tabRefs.current[tab];
    element?.focus();
    if (scroll) {
      element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  const surfaceOwnsFocus = useCallback((surface: CanvasTab) => {
    if (typeof document === 'undefined' || !document.hasFocus()) return false;
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body) {
      if (activeElement === tabRefs.current[surface]) return true;
      const owner = activeElement.closest<HTMLElement>('[data-canvas-surface]')?.dataset.canvasSurface;
      return owner === surface;
    }
    return focusOwnerRef.current === surface;
  }, []);

  const workspaceHostOwnsFocus = useCallback(() => {
    if (typeof document === 'undefined' || !document.hasFocus()) return false;
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body) {
      return workspaceHostRef.current?.contains(activeElement) ?? false;
    }
    return workspaceHostHadFocusRef.current;
  }, []);

  const activateTab = useCallback((nextTab: CanvasTab, options?: {
    focus?: boolean;
    scroll?: boolean;
    invalidateCurrent?: boolean;
    handoffFocus?: boolean;
  }) => {
    const previousTab = activeTabRef.current;
    const changed = previousTab !== nextTab;
    const shouldHandoffFocus = Boolean(
      changed && options?.handoffFocus && surfaceOwnsFocus(previousTab),
    );
    if (changed || options?.invalidateCurrent) {
      navigationEpochRef.current += 1;
    }
    if (changed) {
      activeTabRef.current = nextTab;
      setActiveTab(nextTab);
    }
    if (options?.focus || shouldHandoffFocus) focusTab(nextTab, options?.scroll);
  }, [focusTab, surfaceOwnsFocus]);

  const updatePreviewState = useCallback((
    update: (current: PreviewState) => PreviewState,
  ) => {
    const expectedAuthority = {
      sourceIdentity: previewSourceIdentity,
      initialFile: currentInitialFile,
      initialContent: currentInitialContent,
    };
    setPreviewState((current) => {
      const liveAuthority = previewAuthorityRef.current;
      if (
        liveAuthority.sourceIdentity !== expectedAuthority.sourceIdentity
        || liveAuthority.initialFile !== expectedAuthority.initialFile
        || liveAuthority.initialContent !== expectedAuthority.initialContent
      ) return current;
      const base = current.sourceIdentity === expectedAuthority.sourceIdentity
        && current.initialFile === expectedAuthority.initialFile
        && current.initialContent === expectedAuthority.initialContent
        ? current
        : {
            ...expectedAuthority,
            selectedFile: expectedAuthority.initialFile,
            previewContent: expectedAuthority.initialContent,
            managedPreview: null,
          };
      return update(base);
    });
  }, [currentInitialContent, currentInitialFile, previewSourceIdentity]);

  // When opened with an initial artifact, jump straight to preview
  useEffect(() => {
    const expectedAuthority = {
      sourceIdentity: previewSourceIdentity,
      initialFile: currentInitialFile,
      initialContent: currentInitialContent,
    };
    setPreviewState((current) => {
      const liveAuthority = previewAuthorityRef.current;
      if (
        liveAuthority.sourceIdentity !== expectedAuthority.sourceIdentity
        || liveAuthority.initialFile !== expectedAuthority.initialFile
        || liveAuthority.initialContent !== expectedAuthority.initialContent
      ) return current;
      return {
        ...expectedAuthority,
        selectedFile: expectedAuthority.initialFile,
        previewContent: expectedAuthority.initialContent,
        managedPreview: null,
      };
    });
    activateTab('preview', {
      invalidateCurrent: true,
      handoffFocus: true,
    });
  }, [activateTab, currentInitialContent, currentInitialFile, previewSourceIdentity]);

  // Extract canvas-specific events
  const toolCalls = useMemo(() =>
    events.filter((e): e is Extract<DesktopTaskEvent, { type: 'canvas_tool_call' }> => e.type === 'canvas_tool_call'),
    [events]
  );

  const toolResults = useMemo(() =>
    events.filter((e): e is Extract<DesktopTaskEvent, { type: 'canvas_tool_result' }> => e.type === 'canvas_tool_result'),
    [events]
  );

  const fileChanges = useMemo(() => {
    // Primary source: canvas_file_changed events
    const changes: Extract<DesktopTaskEvent, { type: 'canvas_file_changed' }>[] = events.filter(
      (e): e is Extract<DesktopTaskEvent, { type: 'canvas_file_changed' }> => e.type === 'canvas_file_changed'
    );
    // Fallback: extract files from canvas_tool_call Write events for backward compatibility
    if (changes.length === 0) {
      for (const e of events) {
        if (e.type === 'canvas_tool_call') {
          const call = e as { toolName: string; input: Record<string, unknown> };
          const toolName = call.toolName.toLowerCase();
          if ((toolName === 'write' || toolName === 'bash') && call.input?.file_path) {
            changes.push({
              type: 'canvas_file_changed',
              filePath: call.input.file_path as string,
              change: 'add',
              eventId: (e as { eventId: string }).eventId,
            } as Extract<DesktopTaskEvent, { type: 'canvas_file_changed' }>);
          }
        }
      }
    }
    return changes;
  }, [events]);

  // Extract file content from tool results (Write tool)
  const fileContents = useMemo(() => {
    const contents: Record<string, string> = {};
    for (const result of toolResults) {
      if (result.toolName === 'Write' && result.ok) {
        try {
          const response = typeof result.response === 'string' ? result.response : result.response;
          // Try to extract file path and content from Write response
          const parsed = JSON.parse(response);
          if (parsed.path) {
            contents[parsed.path] = parsed.content || response;
          }
        } catch {
          // Non-JSON response, skip
        }
      }
    }
    return contents;
  }, [toolResults]);

  const hasContent = fileChanges.length > 0 || toolCalls.length > 0;

  // Auto-refresh preview when the selected file is modified by Agent
  const fileChangesLen = fileChanges.length;
  const toolResultsLen = toolResults.length;
  useEffect(() => {
    if (!selectedFile) return;
    const filePath = selectedFile;
    // Re-read content whenever events indicate the file may have changed
    (async () => {
      try {
        const r = await api.readFileContent(filePath);
        updatePreviewState((current) => current.selectedFile === filePath
          ? { ...current, previewContent: r.content }
          : current);
      } catch { /* ignore */ }
    })();
  }, [fileChangesLen, toolResultsLen, selectedFile, updatePreviewState]);

  const handleRefreshPreview = useCallback(async () => {
    if (!selectedFile) return;
    const filePath = selectedFile;
    try {
      const r = await api.readFileContent(filePath);
      updatePreviewState((current) => current.selectedFile === filePath
        ? { ...current, previewContent: r.content }
        : current);
    } catch { /* ignore */ }
  }, [selectedFile, updatePreviewState]);

  const handleFileSelect = useCallback(async (path: string) => {
    updatePreviewState((current) => ({
      ...current,
      selectedFile: path,
      previewContent: '',
      managedPreview: null,
    }));
    activateTab('preview', { invalidateCurrent: true, handoffFocus: true });
    try {
      const r = await api.readFileContent(path);
      updatePreviewState((current) => current.selectedFile === path
        ? { ...current, previewContent: r.content }
        : current);
    } catch {
      updatePreviewState((current) => current.selectedFile === path
        ? { ...current, previewContent: '' }
        : current);
    }
  }, [activateTab, updatePreviewState]);

  const handleManagedPreview = useCallback((
    _version: unknown,
    preview: ArtifactWorkspacePreview,
    navigationContext: ArtifactWorkspacePreviewNavigationContext,
  ) => {
    const currentAvailability = spatialAvailabilityRef.current;
    const currentOrigin = currentAvailability === 'enabled' ? 'canvas' : 'preview';
    if (
      navigationContext.epoch !== navigationEpochRef.current
      || navigationContext.originSurface !== currentOrigin
    ) return;
    if (
      navigationContext.originSurface === 'canvas'
      && (currentAvailability !== 'enabled' || activeTabRef.current !== 'canvas')
    ) return;
    if (
      navigationContext.originSurface === 'preview'
      && (currentAvailability === 'enabled' || activeTabRef.current !== 'preview')
    ) return;

    updatePreviewState((current) => ({ ...current, managedPreview: preview }));
    if (navigationContext.originSurface === 'canvas') {
      activateTab('preview', { handoffFocus: true });
    }
  }, [activateTab, updatePreviewState]);

  const handleSpatialAvailabilityChange = useCallback((nextAvailability: SpatialAvailability) => {
    const previousAvailability = spatialAvailabilityRef.current;
    const canvasWasActive = activeTabRef.current === 'canvas';
    const availabilityChanged = previousAvailability !== nextAvailability;
    const compactWorkspaceWillHide = previousAvailability !== 'enabled'
      && nextAvailability === 'enabled'
      && activeTabRef.current === 'preview';
    if (compactWorkspaceWillHide && workspaceHostOwnsFocus()) {
      focusTab('preview');
    }
    spatialAvailabilityRef.current = nextAvailability;
    if (availabilityChanged) setSpatialAvailability(nextAvailability);

    if (nextAvailability !== 'enabled' && canvasWasActive) {
      activateTab('preview', { handoffFocus: true });
    }
  }, [activateTab, focusTab, workspaceHostOwnsFocus]);

  useLayoutEffect(() => {
    if (!conversationId) handleSpatialAvailabilityChange('hidden');
  }, [conversationId, handleSpatialAvailabilityChange]);

  const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    workspaceHostHadFocusRef.current = workspaceHostRef.current?.contains(event.target) ?? false;
    const owner = event.target.closest<HTMLElement>('[data-canvas-surface]')?.dataset.canvasSurface;
    focusOwnerRef.current = owner === 'preview'
      || owner === 'canvas'
      || owner === 'workspace'
      || owner === 'tools'
      ? owner
      : 'other';
  }, []);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: CanvasTab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.findIndex((candidate) => candidate.key === tab);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    activateTab(tabs[nextIndex].key, { focus: true, scroll: true });
  };

  const previewNavigationContext: ArtifactWorkspacePreviewNavigationContext = {
    originSurface: spatialAvailability === 'enabled' ? 'canvas' : 'preview',
    epoch: navigationEpochRef.current,
  };

  const managedPreviewFile = useMemo(() => {
    if (!managedPreview) return null;
    if (managedPreview.contentKind === 'package_manifest') {
      return `${managedPreview.title || managedPreview.versionId}.manifest.json`;
    }
    if (managedPreview.title) return managedPreview.title;
    const extension = managedPreview.kind === 'markdown' ? 'md' : managedPreview.kind;
    return `${managedPreview.versionId}.${extension || 'txt'}`;
  }, [managedPreview]);

  const managedPreviewContent = useMemo(() => {
    if (!managedPreview) return null;
    return typeof managedPreview.content === 'string'
      ? managedPreview.content
      : JSON.stringify(managedPreview.content, null, 2);
  }, [managedPreview]);

  const spatialEnabled = spatialAvailability === 'enabled' && Boolean(conversationId);
  const compactWorkspace = Boolean(conversationId) && !spatialEnabled;
  const previewActive = activeTab === 'preview';
  const workspaceHostActive = spatialEnabled ? activeTab === 'canvas' : previewActive;
  const previewInteractionProps = { interactionActive: previewActive };

  return (
    <div
      className="flex h-full flex-col border-l border-[var(--c-border)] bg-[var(--c-bg-page)] transition-[width,min-width,max-width] duration-200"
      style={{ width: expanded ? '60%' : 360, minWidth: expanded ? 500 : 360, maxWidth: expanded ? '70%' : 480, flexShrink: 0 }}
      onFocusCapture={handleFocusCapture}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--c-border)] px-3 py-2">
        <span className="text-sm font-medium text-[var(--c-text-heading)]">{t.artifactWorkspace.title}</span>
        <div className="flex items-center gap-1">
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded p-1 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
              title={expanded ? t.canvasPanelCollapseCanvas : t.canvasPanelExpandCanvas}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
            title={t.artifactWorkspace.panelClose}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="canvas-panel-tablist shrink-0 border-b border-[var(--c-border)] bg-[var(--c-bg-card)]"
        role="tablist"
        aria-label={t.artifactWorkspace.title}
      >
        {tabs.map(({ key, label, icon: Icon, id, controls }) => (
          <button
            key={key}
            ref={(element) => { tabRefs.current[key] = element; }}
            id={id}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            aria-controls={controls}
            data-canvas-surface={key}
            tabIndex={activeTab === key ? 0 : -1}
            onClick={() => activateTab(key)}
            onKeyDown={(event) => handleTabKeyDown(event, key)}
            className={`canvas-panel-tab flex items-center justify-center gap-1.5 p-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] focus-visible:ring-inset ${
              activeTab === key
                ? 'border-b-2 border-[var(--c-accent)] font-medium text-[var(--c-text-heading)]'
                : 'text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]'
            }`}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={`canvas-panel-content flex flex-1 overflow-hidden${compactWorkspace ? ' has-compact-workspace' : ''}`}>
        <div
          ref={previewLayerRef}
          id={previewPanelId}
          role="tabpanel"
          aria-labelledby={previewTabId}
          aria-hidden={previewActive ? undefined : true}
          inert={previewActive ? undefined : true}
          data-canvas-surface="preview"
          className={`canvas-panel-primary-layer canvas-panel-preview-layer${previewActive ? ' is-active' : ''}`}
        >
          {managedPreview || selectedFile ? (
            <CanvasPreview
              {...previewInteractionProps}
              filePath={managedPreviewFile ?? selectedFile ?? ''}
              content={managedPreviewContent ?? (previewContent || fileContents[selectedFile ?? ''] || '')}
              interactionMode={managedPreview ? 'read_only' : 'editable'}
              modeRequest={managedPreview ? undefined : initialPreviewModeRequest}
              onAnnotation={onAnnotation}
              onRefresh={managedPreview ? undefined : handleRefreshPreview}
            />
          ) : (
            <CanvasEmptyState message={t.artifactWorkspace.previewEmpty} />
          )}
        </div>

        {conversationId ? (
          <div
            ref={workspaceHostRef}
            id={canvasPanelId}
            role={spatialEnabled ? 'tabpanel' : 'region'}
            aria-labelledby={spatialEnabled ? canvasTabId : previewTabId}
            aria-hidden={workspaceHostActive ? undefined : true}
            inert={workspaceHostActive ? undefined : true}
            data-canvas-surface={spatialEnabled ? 'canvas' : 'preview'}
            className={`canvas-panel-workspace-host ${
              spatialEnabled ? 'is-spatial artifact-workspace-spatial-panel' : 'is-compact'
            }${workspaceHostActive ? ' is-active' : ''}`}
          >
            <ArtifactWorkspacePanel
              conversationId={conversationId}
              workspaceRootId={workspaceRootId}
              sourceArtifact={sourceArtifact}
              previewNavigationContext={previewNavigationContext}
              interactionActive={workspaceHostActive}
              onSpatialAvailabilityChange={handleSpatialAvailabilityChange}
              onPreviewVersion={handleManagedPreview}
              onSubmitPrompt={onAnnotation}
            />
          </div>
        ) : null}

        <div
          id={workspacePanelId}
          role="tabpanel"
          aria-labelledby={workspaceTabId}
          data-canvas-surface="workspace"
          className="canvas-panel-utility-layer"
          hidden={activeTab !== 'workspace'}
        >
          {hasContent ? (
            <WorkspaceTree
              fileChanges={fileChanges}
              onSelectFile={handleFileSelect}
            />
          ) : (
            <CanvasEmptyState message={t.artifactWorkspace.workspaceFilesEmpty} />
          )}
        </div>

        <div
          id={toolsPanelId}
          role="tabpanel"
          aria-labelledby={toolsTabId}
          data-canvas-surface="tools"
          className="canvas-panel-utility-layer"
          hidden={activeTab !== 'tools'}
        >
          {hasContent ? (
            <ToolsPanel toolCalls={toolCalls} toolResults={toolResults} />
          ) : (
            <CanvasEmptyState message={t.artifactWorkspace.toolsEmpty} />
          )}
        </div>
      </div>
    </div>
  );
}
