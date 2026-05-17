/**
 * DeliverableView — shows project deliverables, task output summaries, and artifacts with inline preview.
 */

import { FileText, ExternalLink } from 'lucide-react';
import type { KSwarmProject, KSwarmArtifact, KSwarmTask } from '../../hooks/useKSwarmClient';
import { useLocale } from '../../contexts/LocaleContext';

interface DeliverableViewProps {
  project: KSwarmProject;
  tasks?: KSwarmTask[];
}

function ArtifactCard({ artifact, taskTitle }: { artifact: KSwarmArtifact; taskTitle: string }) {
  const { t } = useLocale();

  const handleOpen = () => {
    if (artifact.path) {
      window.open(`file://${artifact.path}`, '_blank');
    } else if (artifact.url) {
      window.open(artifact.url, '_blank');
    }
  };

  const hasPath = !!(artifact.path || artifact.url);

  return (
    <div
      onClick={hasPath ? handleOpen : undefined}
      className={`flex items-center gap-3 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3 ${hasPath ? 'cursor-pointer hover:bg-[var(--c-bg-deep)]' : ''}`}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
        <FileText size={15} className="text-[var(--c-text-icon)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[var(--c-text-primary)] truncate">{artifact.name}</p>
        <p className="text-[10px] text-[var(--c-text-muted)] truncate">{taskTitle} · {artifact.mimeType || t.projectsDeliverableUnknownType}</p>
      </div>
      {hasPath && (
        <div className="flex items-center">
          <span className="rounded-md p-1.5 text-[var(--c-text-muted)]"><ExternalLink size={14} /></span>
        </div>
      )}
    </div>
  );
}

export function DeliverableView({ project, tasks: propTasks }: DeliverableViewProps) {
  const { t } = useLocale();
  const tasks = propTasks || project.tasks || [];

  // Collect all artifacts from tasks with their summaries
  const taskOutputs: Array<{ task: KSwarmTask; artifacts: KSwarmArtifact[] }> = [];
  for (const task of tasks) {
    const artifacts = (task as any).result?.artifacts || [];
    if (artifacts.length > 0) taskOutputs.push({ task, artifacts });
  }

  const deliverables = project.deliverables || [];
  const deliverable = (project as any).deliverable;

  if (taskOutputs.length === 0 && deliverables.length === 0 && !deliverable) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--c-text-tertiary)]">{t.projectsDeliverableEmpty}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Project deliverable text */}
      {deliverable && (
        <div className="rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--c-text-muted)] mb-3">{t.projectsDeliverableTitle}</h3>
          <pre className="text-[13px] text-[var(--c-text-primary)] whitespace-pre-wrap font-sans">
            {typeof deliverable === 'string' ? deliverable : JSON.stringify(deliverable, null, 2)}
          </pre>
          {(project as any).deliveredAt && (
            <p className="text-[10px] text-[var(--c-text-muted)] mt-2">
              {t.projectsDeliverableDeliveredAt}: {new Date((project as any).deliveredAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Project deliverables list */}
      {deliverables.length > 0 && (
        <div>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--c-text-muted)]">{t.projectsDeliverableTitle}</h3>
          <div className="flex flex-col gap-2">
            {deliverables.map(d => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
                  <FileText size={15} className="text-[var(--c-status-success-text)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[var(--c-text-primary)] truncate">{d.title}</p>
                  {d.format && <p className="text-[10px] text-[var(--c-text-muted)]">{d.format}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task output summaries */}
      {taskOutputs.length > 0 && (
        <div>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--c-text-muted)]">任务产物</h3>
          <div className="flex flex-col gap-3">
            {taskOutputs.map(({ task, artifacts }) => (
              <div key={task.id} className="rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] overflow-hidden">
                {/* Task header with summary */}
                <div className="px-4 py-3 border-b border-[var(--c-border-subtle)]/50">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${task.status === 'done' ? 'bg-[var(--c-status-success-text)]' : task.status === 'review' ? 'bg-[var(--c-status-warning-text)]' : 'bg-[var(--c-text-muted)]'}`} />
                    <span className="text-[12px] font-medium text-[var(--c-text-primary)]">{task.title}</span>
                    {task.assignedAgent && <span className="text-[10px] text-[var(--c-text-muted)]">@{task.assignedAgent}</span>}
                  </div>
                  {(task as any).result?.summary && (
                    <p className="mt-1.5 text-[11px] text-[var(--c-text-tertiary)] pl-4">{(task as any).result.summary}</p>
                  )}
                </div>
                {/* Artifacts */}
                <div className="divide-y divide-[var(--c-border-subtle)]/50">
                  {artifacts.map((art, i) => (
                    <div key={i} className="px-4 py-2">
                      <ArtifactCard artifact={art} taskTitle={task.title} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
