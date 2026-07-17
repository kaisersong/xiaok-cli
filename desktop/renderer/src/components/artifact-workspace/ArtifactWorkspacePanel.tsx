import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ArtifactWorkspacePreview,
  ArtifactWorkspaceRequestedKind,
  ArtifactWorkspaceSelectedArtifact,
  ArtifactWorkspaceVersionView,
} from '../../../../shared/artifact-workspace-types';
import { useLocale } from '../../contexts/LocaleContext';
import { ArtifactCompare } from './ArtifactCompare';
import { RevisionStrip } from './RevisionStrip';
import { useArtifactWorkspace } from './useArtifactWorkspace';
import { ArtifactSpatialCanvas } from './ArtifactSpatialCanvas';

export type SpatialAvailability = 'unknown' | 'enabled' | 'hidden';

export interface ArtifactWorkspacePreviewNavigationContext {
  originSurface: 'preview' | 'canvas';
  epoch: number;
}

interface ArtifactWorkspacePanelProps {
  conversationId: string;
  workspaceRootId?: string;
  sourceArtifact?: ArtifactWorkspaceSelectedArtifact;
  previewNavigationContext?: ArtifactWorkspacePreviewNavigationContext;
  onPreviewVersion?: (
    version: ArtifactWorkspaceVersionView,
    preview: ArtifactWorkspacePreview,
    navigationContext: ArtifactWorkspacePreviewNavigationContext,
  ) => void;
  onSpatialAvailabilityChange?: (availability: SpatialAvailability) => void;
  interactionActive?: boolean;
  onSubmitPrompt?: (prompt: string) => void;
}

const DEFAULT_PREVIEW_NAVIGATION_CONTEXT: ArtifactWorkspacePreviewNavigationContext = {
  originSurface: 'preview',
  epoch: 0,
};

function placeholderLabel(state: string | undefined, labels: {
  failed: string;
  cancelled: string;
  recovery: string;
  draft: string;
  generating: string;
}) {
  if (state === 'failed') return labels.failed;
  if (state === 'cancelled') return labels.cancelled;
  if (state === 'needs_recovery') return labels.recovery;
  if (state === 'generating') return labels.generating;
  return labels.draft;
}

function requestedKindForArtifact(artifact: { kind?: string; mimeType?: string } | undefined): ArtifactWorkspaceRequestedKind | undefined {
  const raw = artifact?.kind?.toLowerCase() ?? '';
  const mime = artifact?.mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'text/html') return 'html';
  if (mime === 'text/markdown') return 'markdown';
  if (mime.includes('presentation') || mime.includes('xiaok.slides')) return 'slides';
  if (raw === 'image' || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(raw)) return 'image';
  if (raw === 'html') return 'html';
  if (raw === 'md' || raw === 'markdown') return 'markdown';
  if (raw === 'slides' || raw === 'pptx') return 'slides';
  return undefined;
}

export function ArtifactWorkspacePanel({
  conversationId,
  workspaceRootId,
  sourceArtifact,
  previewNavigationContext = DEFAULT_PREVIEW_NAVIGATION_CONTEXT,
  onPreviewVersion,
  onSpatialAvailabilityChange,
  interactionActive = true,
  onSubmitPrompt,
}: ArtifactWorkspacePanelProps) {
  const { t } = useLocale();
  const workspace = useArtifactWorkspace({ conversationId, workspaceRootId, sourceArtifact });
  const sourceIdentity = `${conversationId}\u0000${workspaceRootId ?? ''}\u0000${sourceArtifact?.artifactId ?? ''}\u0000${sourceArtifact?.sourceTaskId ?? ''}`;
  const sourceAuthorityRef = useRef({ identity: sourceIdentity, generation: 0 });
  if (sourceAuthorityRef.current.identity !== sourceIdentity) {
    sourceAuthorityRef.current = {
      identity: sourceIdentity,
      generation: sourceAuthorityRef.current.generation + 1,
    };
  }
  const sourceAuthority = sourceAuthorityRef.current;
  const [selection, setSelection] = useState<{ authority: typeof sourceAuthority; versionId: string }>();
  const [compareState, setCompareState] = useState<{
    authority: typeof sourceAuthority;
    value: { left: ArtifactWorkspacePreview; right: ArtifactWorkspacePreview };
  } | null>(null);
  const [previewFailureState, setPreviewFailureState] = useState<{ authority: typeof sourceAuthority } | null>(null);
  const previewRequestRef = useRef(0);
  const compareRequestRef = useRef(0);
  const previewNavigationContextRef = useRef(previewNavigationContext);
  const selectedVersionId = selection?.authority === sourceAuthority ? selection.versionId : undefined;
  const compare = compareState?.authority === sourceAuthority ? compareState.value : null;
  const previewLoadFailed = previewFailureState?.authority === sourceAuthority;
  previewNavigationContextRef.current = previewNavigationContext;

  const availability: SpatialAvailability = workspace.status === 'unavailable' || workspace.status === 'empty'
    ? 'hidden'
    : workspace.snapshot?.access.spatial === 'enabled'
      ? 'enabled'
      : workspace.snapshot
        ? 'hidden'
        : 'unknown';

  useLayoutEffect(() => {
    onSpatialAvailabilityChange?.(availability);
  }, [availability, onSpatialAvailabilityChange]);

  useEffect(() => {
    previewRequestRef.current += 1;
    compareRequestRef.current += 1;
    setSelection(undefined);
    setCompareState(null);
    setPreviewFailureState(null);
  }, [sourceAuthority]);

  const sourceVersion = useMemo(() => (workspace.snapshot?.versions ?? []).find((version) => (
    version.sourceArtifactId === sourceArtifact?.artifactId
    && (!sourceArtifact?.sourceTaskId
      || version.sourceTaskId === sourceArtifact.sourceTaskId
      || version.producingTaskId === sourceArtifact.sourceTaskId)
  )), [sourceArtifact?.artifactId, sourceArtifact?.sourceTaskId, workspace.snapshot?.versions]);

  const versions = useMemo(() => {
    if (!workspace.snapshot) return [];
    const selected = selectedVersionId
      ? workspace.snapshot.versions.find((version) => version.id === selectedVersionId)
      : undefined;
    const lineageId = selected?.lineageId
      ?? sourceVersion?.lineageId
      ?? (!sourceArtifact && workspace.snapshot.lineages.length === 1 ? workspace.snapshot.lineages[0].id : undefined);
    return lineageId
      ? workspace.snapshot.versions.filter((version) => version.lineageId === lineageId)
      : [];
  }, [selectedVersionId, sourceArtifact, sourceVersion?.lineageId, workspace.snapshot]);

  const effectiveSelectedVersionId = (
    selectedVersionId && versions.some((version) => version.id === selectedVersionId)
      ? selectedVersionId
      : undefined
  )
    ?? (sourceVersion && versions.some((version) => version.id === sourceVersion.id) ? sourceVersion.id : undefined)
    ?? versions.find((version) => version.preferred)?.id
    ?? versions.at(-1)?.id;
  const selectedVersion = versions.find((version) => version.id === effectiveSelectedVersionId);
  const writable = workspace.snapshot?.access.revision === 'write'
    && sourceArtifact?.kind !== 'pdf'
    && sourceArtifact?.mimeType !== 'application/pdf';
  const sourceRequestedKind = requestedKindForArtifact(sourceArtifact);
  const requestedKind = sourceRequestedKind ?? requestedKindForArtifact(selectedVersion);

  const submitSelectedRevision = useCallback((prompt: string) => {
    if (!requestedKind) return;
    void workspace.submitRevision({
      prompt,
      sourceVersionId: selectedVersion?.id,
      requestedKind,
    });
  }, [requestedKind, selectedVersion?.id, workspace.submitRevision]);

  const submitBootstrapRevision = useCallback((prompt: string) => {
    if (!sourceRequestedKind || !sourceArtifact?.sourceTaskId) return;
    void workspace.submitRevision({
      prompt,
      sourceVersionId: undefined,
      requestedKind: sourceRequestedKind,
    });
  }, [sourceArtifact?.sourceTaskId, sourceRequestedKind, workspace.submitRevision]);

  const openPreviewVersion = useCallback(async (version: ArtifactWorkspaceVersionView) => {
    setSelection({ authority: sourceAuthority, versionId: version.id });
    setPreviewFailureState(null);
    if (!onPreviewVersion) return;
    const requestId = ++previewRequestRef.current;
    const capturedSourceAuthority = sourceAuthority;
    const capturedContext: ArtifactWorkspacePreviewNavigationContext = {
      originSurface: previewNavigationContext.originSurface,
      epoch: previewNavigationContext.epoch,
    };
    const isCurrentRequest = () => {
      const currentContext = previewNavigationContextRef.current;
      return requestId === previewRequestRef.current
        && sourceAuthorityRef.current === capturedSourceAuthority
        && currentContext.originSurface === capturedContext.originSurface
        && currentContext.epoch === capturedContext.epoch;
    };
    try {
      const preview = await workspace.readPreview(version.id);
      if (!isCurrentRequest()) return;
      if (!preview) {
        setPreviewFailureState({ authority: capturedSourceAuthority });
        return;
      }
      onPreviewVersion(version, preview, capturedContext);
    } catch {
      if (isCurrentRequest()) setPreviewFailureState({ authority: capturedSourceAuthority });
    }
  }, [onPreviewVersion, previewNavigationContext, sourceAuthority, workspace.readPreview]);

  const openCompareVersion = useCallback(async (version: ArtifactWorkspaceVersionView) => {
    const lineageVersions = workspace.snapshot?.versions.filter((candidate) => candidate.lineageId === version.lineageId) ?? [];
    if (lineageVersions.length < 2) return;
    const peer = version.parentVersionId
      ? lineageVersions.find((candidate) => candidate.id === version.parentVersionId)
      : lineageVersions.find((candidate) => candidate.id !== version.id);
    if (!peer) return;
    const requestId = ++compareRequestRef.current;
    const capturedSourceAuthority = sourceAuthority;
    const [left, right] = await Promise.all([
      workspace.readPreview(peer.id),
      workspace.readPreview(version.id),
    ]);
    if (
      !left
      || !right
      || requestId !== compareRequestRef.current
      || sourceAuthorityRef.current !== capturedSourceAuthority
    ) return;
    setCompareState({ authority: capturedSourceAuthority, value: { left, right } });
    void workspace.recordEvent('revision_compare_opened', { leftVersionId: peer.id, rightVersionId: version.id });
  }, [sourceAuthority, workspace.readPreview, workspace.recordEvent, workspace.snapshot?.versions]);

  const closeCompare = useCallback(() => {
    compareRequestRef.current += 1;
    setCompareState(null);
  }, []);

  const renderObjectActions = (targetId: string, submitRevision: (prompt: string) => void) => (
    <div className="artifact-workspace-object-actions">
      <button type="button" onClick={() => submitRevision(t.artifactWorkspace.continuePrompt(targetId))}>
        {t.artifactWorkspace.createRevision}
      </button>
      <button type="button" onClick={() => submitRevision(t.artifactWorkspace.annotationPrompt(targetId))}>
        {t.artifactWorkspace.reviseWithAnnotations}
      </button>
      <button type="button" onClick={() => onSubmitPrompt?.(t.artifactWorkspace.referencePrompt(targetId))}>
        {t.artifactWorkspace.useAsReference}
      </button>
      <button type="button" onClick={() => onSubmitPrompt?.(t.artifactWorkspace.continuePrompt(targetId))}>
        {t.artifactWorkspace.continueFromHere}
      </button>
    </div>
  );
  const objectActions = writable && requestedKind
    && (selectedVersion?.status === 'ready' || (!selectedVersion && sourceArtifact?.sourceTaskId))
    ? renderObjectActions(selectedVersion?.id ?? sourceArtifact!.artifactId, submitSelectedRevision)
    : null;
  const bootstrapActions = writable && sourceRequestedKind && sourceArtifact?.sourceTaskId && !sourceVersion
    ? renderObjectActions(sourceArtifact.artifactId, submitBootstrapRevision)
    : null;

  const workspaceErrorAlert = workspace.status === 'error' ? (
    <div role="alert" className="artifact-workspace-state">
      <span>{workspace.error}</span>
      <button type="button" onClick={() => void workspace.refresh()}>{t.artifactWorkspace.retry}</button>
    </div>
  ) : null;
  const previewErrorAlert = previewLoadFailed ? (
    <div role="alert" className="artifact-workspace-state">
      {t.artifactWorkspace.previewLoadFailed}
    </div>
  ) : null;
  const spatialInteractionProps = { interactionActive };

  if (workspace.status === 'unavailable') return null;
  if (!workspace.snapshot && workspace.status === 'loading') {
    return <div role="status" className="artifact-workspace-state">{t.artifactWorkspace.loading}</div>;
  }
  if (!workspace.snapshot && workspace.status === 'error') {
    return workspaceErrorAlert;
  }
  if (!workspace.snapshot) {
    return <div className="artifact-workspace-state">{t.artifactWorkspace.empty}</div>;
  }

  if (workspace.snapshot.access.spatial === 'enabled') {
    return (
      <>
        {workspaceErrorAlert}
        {previewErrorAlert}
        {bootstrapActions}
        <ArtifactSpatialCanvas
          {...spatialInteractionProps}
          snapshot={workspace.snapshot}
        onOpenNode={(node) => {
          const version = workspace.snapshot?.versions.find((candidate) => candidate.id === node.artifactVersionId);
          if (version) void openPreviewVersion(version);
        }}
        onLayoutPatch={workspace.updateLayout}
        onViewportChange={workspace.saveViewport}
        onRequestRemove={(node) => workspace.removeNode(node.id)}
        onCreateCollection={workspace.createCollection}
        onCreateNote={workspace.createNote}
        onUpdateNote={(node, noteText) => workspace.updateNote(node.id, noteText)}
        onAddToCollection={(member, collection) => workspace.addToCollection(member.id, collection.id)}
        onPreviewVersion={(version) => void openPreviewVersion(version)}
        onCompareVersion={(version) => void openCompareVersion(version)}
        onPreferVersion={(version) => void workspace.preferVersion(version.lineageId, version.id)}
        onDownloadVersion={(version) => void workspace.exportVersion(version.id)}
        onArtifactAction={(version, action) => {
          if (action === 'reference') {
            onSubmitPrompt?.(t.artifactWorkspace.referencePrompt(version.id));
            return;
          }
          if (action === 'continue') {
            onSubmitPrompt?.(t.artifactWorkspace.continuePrompt(version.id));
            return;
          }
          if (version.kind !== 'image' && version.kind !== 'html' && version.kind !== 'markdown' && version.kind !== 'slides') return;
          const prompt = action === 'annotations'
            ? t.artifactWorkspace.annotationPrompt(version.id)
            : t.artifactWorkspace.continuePrompt(version.id);
          void workspace.submitRevision({ prompt, sourceVersionId: version.id, requestedKind: version.kind });
        }}
        onCancelGeneration={(request) => void workspace.cancelGeneration(request.id)}
          onRetryGeneration={(request) => void workspace.retryGeneration(request.id)}
        />
        {compare ? <ArtifactCompare left={compare.left} right={compare.right} onClose={closeCompare} /> : null}
      </>
    );
  }

  const placeholders = workspace.snapshot.nodes.filter((node) => node.kind === 'placeholder');
  return (
    <div className="artifact-workspace-panel">
      {workspaceErrorAlert}
      {previewErrorAlert}
      {workspace.snapshot.access.revision === 'read_only' ? (
        <span className="artifact-workspace-readonly">{t.artifactWorkspace.readOnly}</span>
      ) : null}
      {versions.length > 0 ? (
        <RevisionStrip
          versions={versions}
          selectedVersionId={effectiveSelectedVersionId}
          writable={writable}
          onSelect={(version) => void openPreviewVersion(version)}
          onCompare={() => selectedVersion && void openCompareVersion(selectedVersion)}
          onPrefer={(version) => void workspace.preferVersion(version.lineageId, version.id)}
          onDownload={(version) => void workspace.exportVersion(version.id)}
        />
      ) : null}
      {placeholders.map((node) => (
        <div key={node.id} className="artifact-workspace-placeholder-state">
          <p>
            {placeholderLabel(node.placeholderState, {
              failed: t.artifactWorkspace.generationFailed,
              cancelled: t.artifactWorkspace.generationCancelled,
              recovery: t.artifactWorkspace.recoveryRequired,
              draft: t.artifactWorkspace.placeholderDraft,
              generating: t.artifactWorkspace.placeholderGenerating,
            })}
          </p>
          {(() => {
            const request = workspace.snapshot?.generationRequests.find((candidate) => candidate.placeholderNodeId === node.id);
            if (!request) {
              return (
                <button type="button" onClick={() => void workspace.removeNode(node.id)}>
                  {t.artifactWorkspace.remove}
                </button>
              );
            }
            if (request.state === 'prepared' || request.state === 'running') {
              return (
                <button type="button" onClick={() => void workspace.cancelGeneration(request.id)}>
                  {t.artifactWorkspace.cancel}
                </button>
              );
            }
            if (request.state === 'failed' || request.state === 'cancelled' || request.state === 'needs_recovery') {
              return (
                <>
                  <button type="button" onClick={() => void workspace.retryGeneration(request.id)}>
                    {t.artifactWorkspace.retry}
                  </button>
                  <button type="button" onClick={() => void workspace.removeNode(node.id)}>
                    {t.artifactWorkspace.remove}
                  </button>
                </>
              );
            }
            return null;
          })()}
        </div>
      ))}
      {objectActions}
      {compare ? <ArtifactCompare left={compare.left} right={compare.right} onClose={closeCompare} /> : null}
    </div>
  );
}
