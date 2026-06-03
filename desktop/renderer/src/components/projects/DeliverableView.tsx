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
  workspaceArtifacts?: Array<KSwarmArtifact | string>;
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
      <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
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

function DeliverableContent({
  deliverable,
  projectId,
  onPreview,
}: {
  deliverable: unknown;
  projectId?: string;
  onPreview(artifact: KSwarmArtifact): void;
}) {
  if (typeof deliverable === 'string') {
    return <p className="text-[13px] text-[var(--c-text-primary)] whitespace-pre-wrap">{deliverable}</p>;
  }

  if (typeof deliverable !== 'object' || deliverable === null) {
    return null;
  }

  const obj = deliverable as Record<string, unknown>;
  const description = typeof obj.description === 'string' ? obj.description : null;
  const fileArrayKeys = ['artifacts', 'files', 'expectedArtifacts', 'deliverables'];
  const fileArrays: Array<{ label: string; items: KSwarmArtifact[] }> = [];

  for (const key of fileArrayKeys) {
    if (Array.isArray(obj[key]) && obj[key].length > 0) {
      const items = obj[key]
        .map((item: unknown) => normalizeDeliverableFile(item, projectId))
        .filter((item): item is KSwarmArtifact => item !== null);
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
            {items.map((artifact, i) => (
              <ArtifactCard
                key={`${artifact.url || artifact.path || artifact.filename || artifact.name || label}-${i}`}
                artifact={artifact}
                taskTitle={fileArrays.length > 1 ? label : '项目交付物'}
                onPreview={onPreview}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DeliverableView({ project, tasks: propTasks, workspaceArtifacts = [] }: DeliverableViewProps) {
  const { t } = useLocale();
  const [previewArtifact, setPreviewArtifact] = useState<KSwarmArtifact | null>(null);
  const tasks = propTasks || project.tasks || [];

  // Collect all artifacts from tasks with their summaries
  const taskOutputs: Array<{ task: KSwarmTask; artifacts: KSwarmArtifact[] }> = [];
  for (const task of tasks) {
    const rawArtifacts = (task as any).result?.artifacts || [];
    const artifacts = Array.isArray(rawArtifacts)
      ? rawArtifacts
          .map((item: unknown) => normalizeDeliverableFile(item, project.id))
          .filter((item): item is KSwarmArtifact => item !== null)
      : [];
    if (artifacts.length > 0) taskOutputs.push({ task, artifacts });
  }

  const deliverables = project.deliverables || [];
  const rawDeliverable = (project as any).deliverable;
  // Filter out bare { synthesis: true } placeholder — it has no displayable content
  const deliverable = rawDeliverable && !(
    typeof rawDeliverable === 'object' && rawDeliverable.synthesis && !rawDeliverable.files && !rawDeliverable.artifacts && !rawDeliverable.description
  ) ? rawDeliverable : null;
  const linkedArtifactKeys = new Set<string>();
  for (const { artifacts } of taskOutputs) {
    for (const artifact of artifacts) addArtifactKeys(linkedArtifactKeys, artifact);
  }
  for (const artifact of extractDeliverableArtifacts(deliverable, project.id)) {
    addArtifactKeys(linkedArtifactKeys, artifact);
  }
  const projectFiles = normalizeWorkspaceArtifacts(workspaceArtifacts, project.id, linkedArtifactKeys);

  if (taskOutputs.length === 0 && deliverables.length === 0 && !deliverable && projectFiles.length === 0) {
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
          <DeliverableContent deliverable={deliverable} projectId={project.id} onPreview={setPreviewArtifact} />
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
                <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
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

      {/* Workspace files not yet linked to a deliverable/task */}
      {projectFiles.length > 0 && (
        <div>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--c-text-muted)]">项目文件</h3>
          <div className="flex flex-col gap-2">
            {projectFiles.map((artifact, i) => (
              <ArtifactCard
                key={`${artifact.url || artifact.path || artifact.filename || artifact.name || 'workspace'}-${i}`}
                artifact={artifact}
                taskTitle="项目工作区"
                onPreview={setPreviewArtifact}
              />
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
                    <div className={`size-2 rounded-full ${task.status === 'done' ? 'bg-[var(--c-status-success-text)]' : task.status === 'review' ? 'bg-[var(--c-status-warning-text)]' : 'bg-[var(--c-text-muted)]'}`} />
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

function extractDeliverableArtifacts(deliverable: unknown, projectId?: string): KSwarmArtifact[] {
  if (typeof deliverable !== 'object' || deliverable === null) return [];
  const obj = deliverable as Record<string, unknown>;
  const fileArrayKeys = ['artifacts', 'files', 'expectedArtifacts', 'deliverables'];
  const artifacts: KSwarmArtifact[] = [];
  for (const key of fileArrayKeys) {
    if (!Array.isArray(obj[key])) continue;
    for (const item of obj[key]) {
      const artifact = normalizeDeliverableFile(item, projectId);
      if (artifact) artifacts.push(artifact);
    }
  }
  return artifacts;
}

function normalizeWorkspaceArtifacts(
  workspaceArtifacts: Array<KSwarmArtifact | string>,
  projectId: string | undefined,
  linkedArtifactKeys: Set<string>,
): KSwarmArtifact[] {
  const seen = new Set(linkedArtifactKeys);
  const artifacts: KSwarmArtifact[] = [];
  for (const item of workspaceArtifacts) {
    const artifact = normalizeDeliverableFile(item, projectId);
    if (!artifact || isGeneratedPlanArtifact(artifact)) continue;

    const keys = getArtifactKeys(artifact);
    if (keys.some(key => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    artifacts.push(artifact);
  }
  return artifacts;
}

function addArtifactKeys(target: Set<string>, artifact: KSwarmArtifact) {
  for (const key of getArtifactKeys(artifact)) target.add(key);
}

function getArtifactKeys(artifact: KSwarmArtifact): string[] {
  const rawValues = [
    artifact.filename,
    artifact.name,
    artifact.relativePath,
    artifact.path,
    artifact.url,
  ];
  const keys = new Set<string>();
  for (const value of rawValues) {
    if (!value) continue;
    const raw = String(value).trim();
    if (!raw) continue;
    keys.add(raw);
    const name = basename(raw);
    if (name) keys.add(name);
  }
  return [...keys];
}

function isGeneratedPlanArtifact(artifact: KSwarmArtifact): boolean {
  const name = (artifact.filename || artifact.name || basename(artifact.path) || basename(artifact.url) || '').trim();
  return /^plan-v\d+\.(md|markdown)$/i.test(name);
}

function normalizeDeliverableFile(item: unknown, projectId?: string): KSwarmArtifact | null {
  if (typeof item === 'string' || typeof item === 'number') {
    const filename = String(item);
    return {
      name: filename,
      filename,
      mimeType: inferMimeType(filename),
      projectId,
      url: artifactUrlFromProject(projectId, filename),
    };
  }

  if (typeof item !== 'object' || item === null) return null;

  const obj = item as Record<string, unknown>;
  const source = item as Partial<KSwarmArtifact>;
  const rawPath = stringField(obj, 'path');
  const rawUrl = stringField(obj, 'url');
  const relativePath = stringField(obj, 'relativePath');
  const pathName = basename(rawPath) || basename(relativePath) || basename(rawUrl);
  const displayName = stringField(obj, 'name', 'filename', 'title', 'label') || pathName;
  const filename = stringField(obj, 'filename') || pathName || displayName;
  if (!displayName && !filename && !rawPath && !rawUrl) return null;

  const type = stringField(obj, 'type', 'format');
  const mimeType = stringField(obj, 'mimeType') || inferMimeType(filename || displayName || type);

  return {
    ...source,
    name: displayName || filename,
    filename: filename || displayName,
    mimeType,
    type,
    projectId: stringField(obj, 'projectId') || projectId,
    path: rawPath,
    relativePath,
    url: rawUrl || artifactUrlFromProject(projectId, filename || displayName),
    size: numberField(obj, 'size'),
  };
}

function stringField(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function artifactUrlFromProject(projectId?: string, filename?: string): string | undefined {
  if (!projectId || !filename) return undefined;
  return `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(filename)}`;
}

function basename(value?: string): string {
  if (!value) return '';
  const withoutQuery = value.split(/[?#]/, 1)[0] || '';
  const normalized = withoutQuery.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  const name = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function inferMimeType(value?: string): string | undefined {
  const lower = (value || '').toLowerCase();
  if (!lower) return undefined;
  if (lower.includes('/')) return value;
  if (lower === 'markdown' || lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower === 'json' || lower.endsWith('.json')) return 'application/json';
  if (lower === 'html' || lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower === 'text' || lower.endsWith('.txt')) return 'text/plain';
  if (lower === 'csv' || lower.endsWith('.csv')) return 'text/csv';
  if (lower === 'pdf' || lower.endsWith('.pdf')) return 'application/pdf';
  return value;
}
