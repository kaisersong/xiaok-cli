/**
 * KanbanBoard — 4-column kanban view with full task detail, artifact links,
 * review results, and agent assignment in add-task form.
 */

import { useState, useMemo } from 'react';
import { Circle, Loader2, Eye, CheckCircle2, Plus, X as XIcon, Check, AlertCircle } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmProject, KSwarmTask, KSwarmArtifact } from '../../hooks/useKSwarmClient';
import { ArtifactPreviewModal } from './ArtifactPreviewModal';

interface KanbanBoardProps {
  project: KSwarmProject;
}

interface Column {
  id: string;
  label: string;
  color: string;
  icon: typeof Circle;
  statuses: KSwarmTask['status'][];
}


function TaskCard({ task, projectId, onPreviewArtifact }: { task: KSwarmTask; projectId: string; onPreviewArtifact: (art: KSwarmArtifact) => void }) {
  const { cancelTask, markTaskDone, agents } = useKSwarm();
  const { t } = useLocale();
  const [acting, setActing] = useState(false);
  const isFailed = task.status === 'failed';
  const isCancelled = task.status === 'cancelled';
  const canCancel = task.status === 'pending';
  const canMarkDone = task.status === 'review' || task.status === 'in_progress';
  const result = (task as any).result || {};
  const review = (task as any).reviewResult;
  const hasArtifacts = result.artifacts && result.artifacts.length > 0;

  const agentName = (id?: string) => {
    if (!id) return '';
    const a = agents.find(a => a.id === id);
    return a?.name || id;
  };

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActing(true);
    await cancelTask(projectId, task.id);
    setActing(false);
  };

  const handleMarkDone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActing(true);
    await markTaskDone(projectId, task.id);
    setActing(false);
  };

  return (
    <>
      <div className={`group rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-3 transition-colors duration-150 hover:bg-[var(--c-bg-deep)] ${
        isFailed ? 'border-[var(--c-status-error-text)]/30' : isCancelled ? 'opacity-50' : ''
      }`}>
        <div className="flex items-start justify-between gap-1">
          <p className="text-[12px] font-medium text-[var(--c-text-primary)] line-clamp-2 flex-1">{task.title}</p>
          {!acting && (canCancel || canMarkDone) && (
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              {canMarkDone && (
                <button type="button" onClick={handleMarkDone} className="rounded p-0.5 text-[var(--c-status-success-text)] hover:bg-[var(--c-bg-deep)]" title={t.projectsKanbanMarkDone}><Check size={12} /></button>
              )}
              {canCancel && (
                <button type="button" onClick={handleCancel} className="rounded p-0.5 text-[var(--c-status-error-text)] hover:bg-[var(--c-bg-deep)]" title={t.projectsKanbanCancel}><XIcon size={12} /></button>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        {task.description && (
          <p className="mt-1 text-[11px] text-[var(--c-text-tertiary)] line-clamp-2">{task.description}</p>
        )}

        {/* Agent */}
        {task.assignedAgent && (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="h-4 w-4 rounded-full bg-[var(--c-bg-deep)] flex items-center justify-center">
              <span className="text-[8px] font-bold text-[var(--c-text-secondary)]">{task.assignedAgent.charAt(0).toUpperCase()}</span>
            </div>
            <span className="text-[10px] text-[var(--c-text-muted)] truncate">{agentName(task.assignedAgent)}</span>
          </div>
        )}

        {/* Review result */}
        {review && (
          <div className={`mt-2 px-2 py-1.5 rounded-lg text-[10px] border-[0.5px] ${
            review.passed
              ? 'border-[var(--c-status-success-text)]/20 bg-[var(--c-status-success-text)]/5 text-[var(--c-status-success-text)]'
              : 'border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-text)]/5 text-[var(--c-status-error-text)]'
          }`}>
            <span className="font-medium">{review.passed ? 'PASSED' : 'REWORK'}</span>
            {review.feedback && <p className="mt-0.5 text-[var(--c-text-muted)] line-clamp-2">{review.feedback}</p>}
          </div>
        )}

        {/* Artifacts */}
        {hasArtifacts && (
          <div className="mt-2 flex flex-wrap gap-1">
            {result.artifacts.map((art: KSwarmArtifact, i: number) => (
              <button key={i} type="button" onClick={(e) => { e.stopPropagation(); onPreviewArtifact(art); }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] border-[0.5px] border-[var(--c-border-subtle)] hover:bg-[var(--c-bg-page)] truncate max-w-full">
                {art.name}
              </button>
            ))}
          </div>
        )}

        {isFailed && (
          <span className="mt-1.5 inline-block rounded-full bg-[var(--c-error-bg)] px-1.5 py-0.5 text-[10px] text-[var(--c-status-error-text)]">失败</span>
        )}
      </div>
    </>
  );
}

function AddTaskForm({ projectId, onDone }: { projectId: string; onDone(): void }) {
  const { humanAddTasks, agents } = useKSwarm();
  const { t } = useLocale();
  const [rows, setRows] = useState([{ title: '', assignedAgent: '' }]);
  const [saving, setSaving] = useState(false);

  const updateRow = (idx: number, field: string, value: string) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const addRow = () => setRows(prev => [...prev, { title: '', assignedAgent: '' }]);

  const removeRow = (idx: number) => {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const tasks = rows.filter(r => r.title.trim()).map(r => ({ title: r.title.trim(), description: '', assignedAgent: r.assignedAgent || undefined }));
    if (tasks.length === 0) return;
    setSaving(true);
    await humanAddTasks(projectId, tasks);
    setSaving(false);
    onDone();
  };

  const managedAgents = agents.filter(a => a.roles?.includes('worker') || !a.roles?.length);

  return (
    <div className="rounded-xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-3">
      <div className="flex flex-col gap-2">
        {rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input
              type="text"
              value={row.title}
              onChange={e => updateRow(idx, 'title', e.target.value)}
              placeholder={t.projectsKanbanRequirementPlaceholder}
              className="flex-1 rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-2.5 py-1.5 text-[12px] text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none focus:border-[var(--c-input-border-color-focus)]"
              autoFocus={idx === 0}
            />
            <select
              value={row.assignedAgent}
              onChange={e => updateRow(idx, 'assignedAgent', e.target.value)}
              className="w-28 rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-2 py-1.5 text-[11px] text-[var(--c-text-primary)] outline-none"
            >
              <option value="">{t.projectsKanbanAutoAssign}</option>
              {managedAgents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {rows.length > 1 && (
              <button type="button" onClick={() => removeRow(idx)} className="rounded p-1 text-[var(--c-text-muted)] hover:text-[var(--c-status-error-text)]"><XIcon size={12} /></button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={addRow} className="flex items-center gap-1 text-[11px] text-[var(--c-text-muted)] hover:text-[var(--c-text-secondary)]">
          <Plus size={11} /><span>{t.projectsKanbanAddRow}</span>
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onDone} className="rounded-lg px-2.5 py-1 text-[11px] text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">{t.projectsKanbanCancel}</button>
          <button type="button" onClick={handleSave}
            disabled={saving || rows.every(r => !r.title.trim())}
            className="rounded-lg bg-[var(--c-btn-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-btn-text)] hover:brightness-[1.12] disabled:opacity-50">
            {saving ? '...' : t.projectsKanbanSave}
          </button>
        </div>
      </div>
    </div>
  );
}

export function KanbanBoard({ project }: KanbanBoardProps) {
  const { t } = useLocale();
  const tasks = project.tasks || [];
  const [showAddForm, setShowAddForm] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<KSwarmArtifact | null>(null);

  const COLUMNS: Column[] = useMemo(() => [
    { id: 'pending', label: t.projectsKanbanPending, color: 'border-t-[var(--c-text-muted)]', icon: Circle, statuses: ['pending'] },
    { id: 'active', label: t.projectsKanbanActive, color: 'border-t-[var(--c-status-warning-text)]', icon: Loader2, statuses: ['dispatched', 'in_progress'] },
    { id: 'review', label: t.projectsKanbanReview, color: 'border-t-[var(--c-status-success-text)]', icon: Eye, statuses: ['review'] },
    { id: 'done', label: t.projectsKanbanDone, color: 'border-t-[var(--c-status-success-text)]', icon: CheckCircle2, statuses: ['done', 'failed', 'cancelled'] },
  ], [t]);

  if (tasks.length === 0 && !showAddForm) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-[var(--c-text-tertiary)]">{t.projectsKanbanNoTasks}</p>
        <button type="button" onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] px-3 py-1.5 text-[12px] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
          <Plus size={12} /><span>{t.projectsKanbanAddRequirement}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center px-6 pt-4 pb-2">
        {!showAddForm ? (
          <button type="button" onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
            <Plus size={11} /><span>{t.projectsKanbanAddRequirement}</span>
          </button>
        ) : (
          <div className="w-full max-w-md">
            <AddTaskForm projectId={project.id} onDone={() => setShowAddForm(false)} />
          </div>
        )}
      </div>

      <div className="flex flex-1 gap-4 overflow-x-auto px-6 pb-6">
        {COLUMNS.map(col => {
          const Icon = col.icon;
          const colTasks = tasks.filter(t => col.statuses.includes(t.status));
          return (
            <div key={col.id} className="flex w-60 shrink-0 flex-col">
              <div className={`mb-3 flex items-center gap-2 border-t-2 ${col.color} pt-2`}>
                <Icon size={13} className="text-[var(--c-text-muted)]" />
                <span className="text-[12px] font-medium text-[var(--c-text-primary)]">{col.label}</span>
                <span className="ml-auto text-[10px] text-[var(--c-text-muted)]">{colTasks.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
                {colTasks.map(task => <TaskCard key={task.id} task={task} projectId={project.id} onPreviewArtifact={setPreviewArtifact} />)}
              </div>
            </div>
          );
        })}
      </div>
      {previewArtifact && <ArtifactPreviewModal artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
    </div>
  );
}
