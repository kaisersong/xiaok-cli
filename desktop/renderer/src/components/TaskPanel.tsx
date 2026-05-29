import React from 'react';
import type { TaskResult, ArtifactSummary } from '../../../../src/runtime/task-host/types';

interface PlanStepItem {
  id: string;
  label: string;
  status: string;
}

interface TaskPanelProps {
  planSteps: PlanStepItem[];
  status: 'idle' | 'running' | 'waiting_user' | 'completed' | 'failed';
  result: TaskResult | null;
  generatedFiles: Array<{ filePath: string; name: string }>;
  onFileClick: (file: { filePath: string; name: string }) => void;
  onArtifactClick: (artifact: ArtifactSummary) => void;
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <span className="step-icon step-icon--completed">●</span>;
    case 'running':
      return <span className="step-icon step-icon--running">◉</span>;
    case 'blocked':
      return <span className="step-icon step-icon--blocked">⊘</span>;
    case 'failed':
      return <span className="step-icon step-icon--failed">✕</span>;
    default:
      return <span className="step-icon step-icon--planned">○</span>;
  }
}

export function TaskPanel({ planSteps, status, result, generatedFiles, onFileClick, onArtifactClick }: TaskPanelProps) {
  if (planSteps.length === 0) return null;

  const hasResults = (result?.artifacts && result.artifacts.length > 0) || generatedFiles.length > 0;
  const showResults = hasResults && (status === 'completed' || status === 'idle');

  return (
    <div className="task-panel">
      <div className="task-panel__section">
        <div className="task-panel__heading">进度</div>
        <ul className="task-panel__steps">
          {planSteps.map((step) => (
            <li key={step.id} className={`task-panel__step task-panel__step--${step.status}`}>
              <StepIcon status={step.status} />
              <span className="task-panel__step-label">{step.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {showResults && (
        <div className="task-panel__section">
          <div className="task-panel__heading">生成结果</div>
          <ul className="task-panel__results">
            {result?.artifacts?.map((artifact) => (
              <li key={artifact.artifactId}>
                <button
                  type="button"
                  aria-label={artifact.title}
                  className="task-panel__result-item task-panel__result-button"
                  onClick={() => onArtifactClick(artifact)}
                >
                  <span className="task-panel__result-icon" aria-hidden="true">📄</span>
                  <span className="task-panel__result-name">{artifact.title}</span>
                </button>
              </li>
            ))}
            {generatedFiles
              .filter((f) => !result?.artifacts?.some((a) => a.filePath === f.filePath))
              .map((file) => (
                <li key={file.filePath}>
                  <button
                    type="button"
                    aria-label={file.name}
                    className="task-panel__result-item task-panel__result-button"
                    onClick={() => onFileClick(file)}
                  >
                    <span className="task-panel__result-icon" aria-hidden="true">📄</span>
                    <span className="task-panel__result-name">{file.name}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
