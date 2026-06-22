import React from 'react';
import type { ArtifactEditingState } from '../hooks/artifact-editing-state';
import { useLocale } from '../contexts/LocaleContext';

interface ArtifactToolbarProps {
  state: ArtifactEditingState;
  onToggleAnnotate: () => void;
  onRevert: () => void;
  onFinish: () => void;
  onRefresh?: () => void;
}

export function ArtifactToolbar({ state, onToggleAnnotate, onRevert, onFinish, onRefresh }: ArtifactToolbarProps) {
  const { t } = useLocale();
  const isAnnotating = state === 'annotating';
  const showRevertAndFinish = state === 'reviewing';

  return (
    <div className="artifact-toolbar">
      <button type="button"
        className={`artifact-toolbar-btn ${isAnnotating ? 'active' : ''}`}
        onClick={onToggleAnnotate}
        title={isAnnotating ? t.artifactFinishRevision : t.artifactStartRevision}
      >
        <span className="artifact-toolbar-icon">{isAnnotating ? '✓' : '✏'}</span>
        <span>{isAnnotating ? t.artifactFinishRevision : t.artifactRevision}</span>
      </button>
      {onRefresh && (
        <button type="button"
          className="artifact-toolbar-btn"
          onClick={onRefresh}
          title={t.artifactRefreshPreview}
        >
          <span className="artifact-toolbar-icon">↻</span>
        </button>
      )}
      {showRevertAndFinish && (
        <>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onRevert}
            title={t.artifactRevertChanges}
          >
            <span className="artifact-toolbar-icon">↩</span>
            <span>{t.artifactRevert}</span>
          </button>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onFinish}
            title={t.artifactFinishEditing}
          >
            <span className="artifact-toolbar-icon">✓</span>
            <span>{t.artifactFinish}</span>
          </button>
        </>
      )}
      {state === 'submitted' && (
        <span className="artifact-toolbar-status">{t.artifactWaitingAgent}</span>
      )}
      {state === 'timeout_idle' && (
        <span className="artifact-toolbar-status">{t.artifactAgentNotResponding}</span>
      )}
    </div>
  );
}
