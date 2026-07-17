import { useEffect, useState } from 'react';
import type {
  ArtifactWorkspaceNode,
  ArtifactWorkspaceVersionView,
  WorkspaceGenerationRequest,
} from '../../../../shared/artifact-workspace-types';
import { useLocale } from '../../contexts/LocaleContext';
import { RevisionStrip } from './RevisionStrip';

interface ArtifactWorkspaceDetailPanelProps {
  node: ArtifactWorkspaceNode;
  onClose: () => void;
  onUpdateNote?: (node: ArtifactWorkspaceNode, noteText: string) => void | Promise<void>;
  versions?: ArtifactWorkspaceVersionView[];
  writable?: boolean;
  generationRequest?: WorkspaceGenerationRequest;
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
  onRemoveNode?: (node: ArtifactWorkspaceNode) => void;
}

export function ArtifactWorkspaceDetailPanel({
  node,
  onClose,
  onUpdateNote,
  versions = [],
  writable = false,
  generationRequest,
  onPreviewVersion,
  onCompareVersion,
  onPreferVersion,
  onDownloadVersion,
  onArtifactAction,
  onCancelGeneration,
  onRetryGeneration,
  onRemoveNode,
}: ArtifactWorkspaceDetailPanelProps) {
  const { t } = useLocale();
  const [noteText, setNoteText] = useState(node.noteText ?? '');
  const [selectedVersionId, setSelectedVersionId] = useState(node.artifactVersionId);

  useEffect(() => {
    setNoteText(node.noteText ?? '');
  }, [node.id, node.noteText]);

  useEffect(() => {
    setSelectedVersionId(
      node.artifactVersionId
      ?? versions.find((version) => version.preferred)?.id
      ?? versions.at(-1)?.id,
    );
  }, [node.artifactVersionId, node.id, versions]);

  const selectedVersion = versions.find((version) => version.id === selectedVersionId);

  return (
    <aside className="artifact-workspace-detail" aria-label={t.artifactWorkspace.detailTitle}>
      <header>
        <h2>{t.artifactWorkspace.detailTitle}</h2>
        <button type="button" onClick={onClose}>{t.artifactWorkspace.close}</button>
      </header>
      <strong>{node.title ?? node.kind}</strong>
      {node.kind === 'note' ? (
        onUpdateNote ? (
          <>
            <textarea
              aria-label={t.artifactWorkspace.noteText}
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
            />
            <button
              type="button"
              disabled={!noteText.trim() || noteText === (node.noteText ?? '')}
              onClick={() => void onUpdateNote(node, noteText)}
            >
              {t.artifactWorkspace.saveNote}
            </button>
          </>
        ) : <p>{node.noteText}</p>
      ) : null}
      {node.kind === 'placeholder' && node.placeholderState ? (
        <>
          <p>{t.artifactWorkspace.statusLabel(node.placeholderState)}</p>
          {generationRequest && ['prepared', 'running'].includes(generationRequest.state) && onCancelGeneration ? (
            <button type="button" onClick={() => onCancelGeneration(generationRequest)}>
              {t.artifactWorkspace.cancel}
            </button>
          ) : null}
          {generationRequest && ['failed', 'cancelled', 'needs_recovery'].includes(generationRequest.state) && onRetryGeneration ? (
            <button type="button" onClick={() => onRetryGeneration(generationRequest)}>
              {t.artifactWorkspace.retry}
            </button>
          ) : null}
          {(!generationRequest || !['prepared', 'running'].includes(generationRequest.state)) && onRemoveNode ? (
            <button type="button" onClick={() => onRemoveNode(node)}>
              {t.artifactWorkspace.remove}
            </button>
          ) : null}
        </>
      ) : null}
      {node.kind === 'artifact' && versions.length > 0 ? (
        <>
          <RevisionStrip
            versions={versions}
            selectedVersionId={selectedVersionId}
            writable={writable}
            onSelect={(version) => {
              setSelectedVersionId(version.id);
              onPreviewVersion?.(version);
            }}
            onCompare={() => selectedVersion && onCompareVersion?.(selectedVersion)}
            onPrefer={(version) => onPreferVersion?.(version)}
            onDownload={(version) => onDownloadVersion?.(version)}
          />
          {writable && selectedVersion && onArtifactAction ? (
            <div className="artifact-workspace-object-actions">
              <button type="button" onClick={() => onArtifactAction(selectedVersion, 'revision')}>
                {t.artifactWorkspace.createRevision}
              </button>
              <button type="button" onClick={() => onArtifactAction(selectedVersion, 'annotations')}>
                {t.artifactWorkspace.reviseWithAnnotations}
              </button>
              <button type="button" onClick={() => onArtifactAction(selectedVersion, 'reference')}>
                {t.artifactWorkspace.useAsReference}
              </button>
              <button type="button" onClick={() => onArtifactAction(selectedVersion, 'continue')}>
                {t.artifactWorkspace.continueFromHere}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
