import React from 'react';
import type { ArtifactEditingState } from '../hooks/artifact-editing-state';

interface ArtifactToolbarProps {
  state: ArtifactEditingState;
  onToggleAnnotate: () => void;
  onRevert: () => void;
  onFinish: () => void;
  onRefresh?: () => void;
}

export function ArtifactToolbar({ state, onToggleAnnotate, onRevert, onFinish, onRefresh }: ArtifactToolbarProps) {
  const isAnnotating = state === 'annotating';
  const showRevertAndFinish = state === 'reviewing';

  return (
    <div className="artifact-toolbar">
      <button type="button"
        className={`artifact-toolbar-btn ${isAnnotating ? 'active' : ''}`}
        onClick={onToggleAnnotate}
        title={isAnnotating ? '完成修订' : '开启修订'}
      >
        <span className="artifact-toolbar-icon">{isAnnotating ? '✓' : '✏'}</span>
        <span>{isAnnotating ? '完成修订' : '修订'}</span>
      </button>
      {onRefresh && (
        <button type="button"
          className="artifact-toolbar-btn"
          onClick={onRefresh}
          title="刷新预览"
        >
          <span className="artifact-toolbar-icon">↻</span>
        </button>
      )}
      {showRevertAndFinish && (
        <>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onRevert}
            title="撤回修改"
          >
            <span className="artifact-toolbar-icon">↩</span>
            <span>撤回</span>
          </button>
          <button type="button"
            className="artifact-toolbar-btn"
            onClick={onFinish}
            title="完成编辑"
          >
            <span className="artifact-toolbar-icon">✓</span>
            <span>完成</span>
          </button>
        </>
      )}
      {state === 'submitted' && (
        <span className="artifact-toolbar-status">等待 Agent 响应...</span>
      )}
      {state === 'timeout_idle' && (
        <span className="artifact-toolbar-status">Agent 未响应，可继续操作</span>
      )}
    </div>
  );
}
