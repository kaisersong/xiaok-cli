/**
 * DeliverableView — shows project deliverables, task output summaries, and artifacts with inline preview.
 */

import { useState } from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import type { KSwarmProject, KSwarmArtifact, KSwarmTask } from '../../hooks/useKSwarmClient';
import { useLocale } from '../../contexts/LocaleContext';
import { ArtifactPreviewModal } from './ArtifactPreviewModal';
import { artifactDisplayName, formatArtifactGeneratedTime, resolveArtifactUrl } from './artifactActions';

interface DeliverableViewProps {
  project: KSwarmProject;
  tasks?: KSwarmTask[];
}

function ArtifactCard({ artifact, taskTitle, onPreview }: { artifact: KSwarmArtifact; taskTitle: string; onPreview(artifact: KSwarmArtifact): void }) {
  const { t } = useLocale();
  const displayName = artifactDisplayName(artifact);
  const hasPath = !!resolveArtifactUrl(artifact);
  const generatedTime = formatArtifactGeneratedTime(artifact);
  const annotation = `${taskTitle} · ${artifact.mimeType || t.projectsDeliverableUnknownType}${generatedTime ? ` · 生成 ${generatedTime}` : ''}`;

  return (
    <button
      type="button"
      onClick={hasPath ? () => onPreview(artifact) : undefined}
      disabled={!hasPath}
      className={`flex w-full items-center gap-3 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3 text-left ${hasPath ? 'cursor-pointer hover:bg-[var(--c-bg-deep)]' : 'cursor-default opacity-70'}`}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
        <FileText size={15} className="text-[var(--c-text-icon)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[var(--c-text-primary)] truncate">{displayName}</p>
        <p className="text-[10px] text-[var(--c-text-muted)] truncate">{annotation}</p>
      </div>
      {hasPath && (
        <div className="flex items-center">
          <span className="rounded-md p-1.5 text-[var(--c-text-muted)]"><ExternalLink size={14} /></span>
        </div>
      )}
    </button>
  );
}

function DeliverableContent({ deliverable }: { deliverable: unknown }) {
  if (typeof deliverable === 'string') {
    return <p className="text-[13px] text-[var(--c-text-primary)] whitespace-pre-wrap">{deliverable}</p>;
  }

  if (typeof deliverable !== 'object' || deliverable === null) {
    return null;
  }

  const obj = deliverable as Record<string, unknown>;
  const description = typeof obj.description === 'string' ? obj.description : null;
  const fileArrayKeys = ['artifacts', 'files', 'expectedArtifacts', 'deliverables'];
  const fileArrays: Array<{ label: string; items: string[] }> = [];

  for (const key of fileArrayKeys) {
    if (Array.isArray(obj[key]) && obj[key].length > 0) {
      const items = obj[key].map((item: unknown) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          const o = item as Record<string, unknown>;
          return (o.path || o.name || o.title || JSON.stringify(item)) as string;
        }
        return String(item);
      });
      fileArrays.push({ label: key, items });
    }
  }

  if (!description && fileArrays.length === 0) {
    // Fallback: render all string fields
    const entries = Object.entries(obj).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
    if (entries.length === 0) return null;
    return (
      <div className="space-y-1">
        {entries.map(([k, v]) => (
          <p key={k} className="text-[12px] text-[var(--c-text-secondary)]">
            <span className="text-[var(--c-text-muted)]">{k}:</span> {String(v)}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {description && (
        <p className="text-[13px] text-[var(--c-text-primary)] whitespace-pre-wrap">{description}</p>
      )}
      {fileArrays.map(({ label, items }) => (
        <div key={label}>
          {fileArrays.length > 1 && (
            <p className="text-[10px] font-medium text-[var(--c-text-muted)] uppercase mb-1">{label}</p>
          )}
          <div className="flex flex-col gap-1.5">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-deep)] px-3 py-2">
                <FileText size={13} className="text-[var(--c-text-icon)] shrink-0" />
                <span className="text-[12px] text-[var(--c-text-primary)] truncate">{item}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DeliverableView({ project, tasks: propTasks }: DeliverableViewProps) {
  const { t } = useLocale();
  const [previewArtifact, setPreviewArtifact] = useState<KSwarmArtifact | null>(null);
  const tasks = propTasks || project.tasks || [];

  // Collect all artifacts from tasks with their summaries
  const taskOutputs: Array<{ task: KSwarmTask; artifacts: KSwarmArtifact[] }> = [];
  for (const task of tasks) {
    const artifacts = (task as any).result?.artifacts || [];
    if (artifacts.length > 0) taskOutputs.push({ task, artifacts });
  }

  const deliverables = project.deliverables || [];
  const rawDeliverable = (project as any).deliverable;
  // Filter out bare { synthesis: true } placeholder — it has no displayable content
  const deliverable = rawDeliverable && !(
    typeof rawDeliverable === 'object' && rawDeliverable.synthesis && !rawDeliverable.files && !rawDeliverable.artifacts && !rawDeliverable.description
  ) ? rawDeliverable : null;

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
          <DeliverableContent deliverable={deliverable} />
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
                      <ArtifactCard artifact={art} taskTitle={task.title} onPreview={setPreviewArtifact} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {previewArtifact && (
        <ArtifactPreviewModal artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />
      )}
    </div>
  );
}
