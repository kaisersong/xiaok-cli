import React from 'react';
import { Check, MessageSquareText, PencilLine, Redo2, RefreshCw, RotateCcw, Save, Undo2 } from 'lucide-react';
import type { ArtifactEditingState } from '../hooks/artifact-editing-state';
import { useLocale } from '../contexts/LocaleContext';

interface ArtifactToolbarProps {
  state: ArtifactEditingState;
  isHtmlEditing?: boolean;
  isHtmlDirty?: boolean;
  canUndoHtmlEdit?: boolean;
  canRedoHtmlEdit?: boolean;
  onToggleAnnotate: () => void;
  onToggleHtmlEdit?: () => void;
  onSaveHtmlEdit?: () => void;
  onUndoHtmlEdit?: () => void;
  onRedoHtmlEdit?: () => void;
  onRevert: () => void;
  onFinish: () => void;
  onRefresh?: () => void;
}

export function ArtifactToolbar({
  state,
  isHtmlEditing = false,
  isHtmlDirty = false,
  canUndoHtmlEdit = false,
  canRedoHtmlEdit = false,
  onToggleAnnotate,
  onToggleHtmlEdit,
  onSaveHtmlEdit,
  onUndoHtmlEdit,
  onRedoHtmlEdit,
  onRevert,
  onFinish,
  onRefresh,
}: ArtifactToolbarProps) {
  const { t } = useLocale();
  const isAnnotating = state === 'annotating';
  const showRevertAndFinish = state === 'reviewing';

  return (
    <div className="artifact-toolbar">
      {onToggleHtmlEdit && (
        <button type="button"
          className={`artifact-toolbar-btn ${isHtmlEditing ? 'active' : ''}`}
          onClick={onToggleHtmlEdit}
          title={isHtmlEditing ? t.artifactHtmlStopEditing : t.artifactHtmlEdit}
        >
          <span className="artifact-toolbar-icon"><PencilLine size={14} aria-hidden="true" /></span>
          <span>{isHtmlEditing ? t.artifactHtmlStopEditing : t.artifactHtmlEdit}</span>
          {isHtmlDirty && <span className="artifact-toolbar-dot" aria-hidden="true" />}
        </button>
      )}
      <button type="button"
        className={`artifact-toolbar-btn ${isAnnotating ? 'active' : ''}`}
        onClick={onToggleAnnotate}
        title={isAnnotating ? t.artifactFinishRevision : t.artifactStartRevision}
      >
        <span className="artifact-toolbar-icon">{isAnnotating ? <Check size={14} aria-hidden="true" /> : <MessageSquareText size={14} aria-hidden="true" />}</span>
        <span>{isAnnotating ? t.artifactFinishRevision : t.artifactRevision}</span>
      </button>
      {isHtmlEditing && (
        <>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onUndoHtmlEdit}
            disabled={!canUndoHtmlEdit}
            title={t.artifactHtmlUndo}
          >
            <span className="artifact-toolbar-icon"><Undo2 size={14} aria-hidden="true" /></span>
          </button>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onRedoHtmlEdit}
            disabled={!canRedoHtmlEdit}
            title={t.artifactHtmlRedo}
          >
            <span className="artifact-toolbar-icon"><Redo2 size={14} aria-hidden="true" /></span>
          </button>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onSaveHtmlEdit}
            disabled={!isHtmlDirty}
            title={t.artifactHtmlSave}
          >
            <span className="artifact-toolbar-icon"><Save size={14} aria-hidden="true" /></span>
            <span>{t.artifactHtmlSave}</span>
          </button>
        </>
      )}
      {onRefresh && (
        <button type="button"
          className="artifact-toolbar-btn"
          onClick={onRefresh}
          title={t.artifactRefreshPreview}
        >
          <span className="artifact-toolbar-icon"><RefreshCw size={14} aria-hidden="true" /></span>
        </button>
      )}
      {showRevertAndFinish && (
        <>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onRevert}
            title={t.artifactRevertChanges}
          >
            <span className="artifact-toolbar-icon"><RotateCcw size={14} aria-hidden="true" /></span>
            <span>{t.artifactRevert}</span>
          </button>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onFinish}
            title={t.artifactFinishEditing}
          >
            <span className="artifact-toolbar-icon"><Check size={14} aria-hidden="true" /></span>
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
