/**
 * PlanView — full-featured plan display with analysis, success criteria,
 * expandable phases with progress, review results, and revision history.
 */

import { useState } from 'react';
import { CheckCircle2, Circle, Loader2, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmTask } from '../../hooks/useKSwarmClient';

interface PlanItem {
  id: string;
  title: string;
  brief?: string;
  assignedAgent?: string;
  acceptanceCriteria?: string;
  status?: string;
}

interface PlanPhase {
  id: string | number;
  name: string;
  items?: PlanItem[];
}

interface Plan {
  analysis?: string;
  successCriteria?: string[];
  phases?: PlanPhase[];
  revisions?: Array<{
    version: number;
    ts?: number;
    reason?: string;
    changes?: Array<{ type: string; item?: { title?: string }; itemId?: string }>;
  }>;
  version?: number;
}

interface PlanViewProps {
  plan: Plan | null;
  planProgress?: { phases: Array<{ phaseId: string | number; total: number; done: number }>; total: number; done: number } | null;
  tasks: KSwarmTask[];
}

const ITEM_STATUS_STYLES: Record<string, string> = {
  planned: 'text-[var(--c-text-muted)] bg-[var(--c-bg-deep)] border-[var(--c-border-subtle)]',
  active: 'text-[var(--c-text-secondary)] bg-[var(--c-bg-deep)] border-[var(--c-border-mid)]',
  completed: 'text-[var(--c-status-success-text)] bg-[var(--c-bg-deep)] border-[var(--c-status-success-text)]/20',
  revised: 'text-[var(--c-status-warning-text)] bg-[var(--c-bg-deep)] border-[var(--c-status-warning-text)]/20',
  dropped: 'text-[var(--c-text-muted)] line-through opacity-50',
};

function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'done': return <CheckCircle2 size={13} className="text-[var(--c-status-success-text)] shrink-0" />;
    case 'in_progress': case 'dispatched': return <Loader2 size={13} className="text-[var(--c-text-secondary)] animate-spin shrink-0" />;
    case 'failed': case 'cancelled': return <AlertCircle size={13} className="text-[var(--c-status-error-text)] shrink-0" />;
    default: return <Circle size={13} className="text-[var(--c-text-muted)] shrink-0" />;
  }
}

export function PlanView({ plan, planProgress, tasks }: PlanViewProps) {
  const { t } = useLocale();
  const tasks_ = tasks || [];
  const [expandedPhases, setExpandedPhases] = useState<Set<string | number>>(() => {
    const ids = (plan?.phases || []).map(p => p.id);
    return new Set(ids);
  });
  const [showRevisions, setShowRevisions] = useState(false);

  // Group tasks by phase
  const tasksByPhase = new Map<string | number, KSwarmTask[]>();
  for (const task of tasks_) {
    const phase = task.phase ?? 0;
    if (!tasksByPhase.has(phase)) tasksByPhase.set(phase, []);
    tasksByPhase.get(phase)!.push(task);
  }

  // Match planProgress to phases
  const progressMap = new Map<string | number, { total: number; done: number }>();
  if (planProgress?.phases) {
    for (const p of planProgress.phases) progressMap.set(p.phaseId, { total: p.total, done: p.done });
  }

  const togglePhase = (id: string | number) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (!plan && tasks_.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--c-text-tertiary)]">{t.projectsPlanEmpty}</p>
      </div>
    );
  }

  if (!plan && tasks_.length > 0) {
    return (
      <div className="p-6">
        <div className="flex flex-col gap-2">
          {tasks_.map(task => (
            <div key={task.id} className="flex items-start gap-2.5 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3">
              <TaskStatusIcon status={task.status} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[var(--c-text-primary)]">{task.title}</p>
                {task.description && <p className="mt-0.5 text-[12px] text-[var(--c-text-tertiary)] line-clamp-2">{task.description}</p>}
              </div>
              {task.assignedAgent && (
                <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[10px] text-[var(--c-text-muted)]">{task.assignedAgent}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const phases = plan?.phases || [];

  return (
    <div className="p-6 space-y-4">
      {/* Analysis */}
      {plan?.analysis && (
        <div className="rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--c-text-muted)] mb-2">Analysis</h4>
          <div className="text-[13px] text-[var(--c-text-primary)] whitespace-pre-wrap leading-relaxed">{plan.analysis}</div>
        </div>
      )}

      {/* Success Criteria */}
      {plan && plan.successCriteria && plan.successCriteria.length > 0 && (
        <div className="rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--c-text-muted)] mb-2">Success Criteria</h4>
          <ul className="space-y-1">
            {plan.successCriteria.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span className="text-[var(--c-text-muted)] mt-0.5">-</span>
                <span className="text-[var(--c-text-primary)]">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Phases */}
      {phases.map((phase, idx) => {
        const phaseTasks = tasksByPhase.get(phase.id) || [];
        const progress = progressMap.get(phase.id) || { total: phaseTasks.length, done: phaseTasks.filter(t => t.status === 'done').length };
        const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
        const isExpanded = expandedPhases.has(phase.id);
        const isCompleted = phaseItemsDone(phase) === (phase.items?.length || 0);
        const isActive = idx === activePhaseIndex(phases, tasksByPhase);

        return (
          <div key={phase.id} className="rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] overflow-hidden">
            <button type="button" onClick={() => togglePhase(phase.id)}
              className="w-full flex items-center gap-3 p-4 hover:bg-[var(--c-bg-deep)] transition-colors text-left">
              {isExpanded ? <ChevronDown size={14} className="text-[var(--c-text-muted)] shrink-0" /> : <ChevronRight size={14} className="text-[var(--c-text-muted)] shrink-0" />}
              <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${
                isCompleted ? 'bg-[var(--c-bg-deep)] text-[var(--c-status-success-text)]' :
                isActive ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]' :
                'bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]'
              }`}>
                {idx + 1}
              </div>
              <span className="text-[13px] font-medium text-[var(--c-text-primary)] flex-1">{phase.name}</span>
              <span className="text-[11px] text-[var(--c-text-muted)]">{progress.done}/{progress.total}</span>
              <div className="w-20 h-1.5 bg-[var(--c-bg-deep)] rounded-full overflow-hidden shrink-0">
                <div className="h-full bg-[var(--c-status-success-text)] rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </button>

            {isExpanded && phase.items && phase.items.length > 0 && (
              <div className="border-t border-[var(--c-border-subtle)] divide-y divide-[var(--c-border-subtle)]/50">
                {phase.items.map(item => {
                  const task = tasks_.find(t => t.id === item.id || t.planItemId === item.id);
                  const status = item.status || (task?.status === 'done' ? 'completed' : task?.status === 'in_progress' ? 'active' : 'planned');
                  const review = (task as any)?.reviewResult;

                  return (
                    <div key={item.id} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded border-[0.5px] px-1.5 py-0.5 text-[9px] font-medium ${ITEM_STATUS_STYLES[status] || ITEM_STATUS_STYLES.planned}`}>{status}</span>
                        <span className="text-[12px] font-medium text-[var(--c-text-primary)] flex-1">{item.title}</span>
                        {item.assignedAgent && <span className="text-[10px] text-[var(--c-text-muted)]">@{item.assignedAgent}</span>}
                      </div>
                      {item.brief && <p className="text-[11px] text-[var(--c-text-tertiary)] mt-1 ml-6">{item.brief}</p>}
                      {item.acceptanceCriteria && <p className="text-[10px] text-[var(--c-text-muted)] mt-0.5 ml-6">Acceptance: {item.acceptanceCriteria}</p>}
                      {review && (
                        <div className={`mt-2 ml-6 px-2.5 py-1.5 rounded-lg text-[10px] border-[0.5px] ${
                          review.passed
                            ? 'border-[var(--c-status-success-text)]/20 bg-[var(--c-status-success-text)]/5 text-[var(--c-status-success-text)]'
                            : 'border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-text)]/5 text-[var(--c-status-error-text)]'
                        }`}>
                          <span className="font-medium">{review.passed ? 'PASSED' : 'REWORK'}</span>
                          {review.feedback && <p className="mt-0.5 text-[var(--c-text-muted)]">{review.feedback}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {isExpanded && (!phase.items || phase.items.length === 0) && (
              <div className="border-t border-[var(--c-border-subtle)] px-4 py-3">
                <p className="text-[12px] text-[var(--c-text-muted)]">{t.projectsPlanNoTasks}</p>
              </div>
            )}
          </div>
        );
      })}

      {/* Revision History */}
      {plan && plan.revisions && plan.revisions.length > 0 && (
        <div className="rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)]">
          <button type="button" onClick={() => setShowRevisions(!showRevisions)}
            className="w-full flex items-center gap-2 p-4 hover:bg-[var(--c-bg-deep)] transition-colors text-left">
            {showRevisions ? <ChevronDown size={14} className="text-[var(--c-text-muted)]" /> : <ChevronRight size={14} className="text-[var(--c-text-muted)]" />}
            <span className="text-[11px] font-semibold text-[var(--c-text-muted)]">Revision History ({plan.revisions.length})</span>
          </button>
          {showRevisions && plan.revisions && (
            <div className="border-t border-[var(--c-border-subtle)] p-4 space-y-3">
              {plan.revisions.map((rev, i) => (
                <div key={i} className="border-l-2 border-[var(--c-status-warning-text)]/30 pl-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--c-text-secondary)]">v{rev.version}</span>
                    {rev.ts && <span className="text-[10px] text-[var(--c-text-muted)]">{new Date(rev.ts).toLocaleString()}</span>}
                  </div>
                  {rev.reason && <p className="text-[11px] text-[var(--c-text-tertiary)] mt-0.5">{rev.reason}</p>}
                  {rev.changes && rev.changes.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--c-text-muted)]">
                      {rev.changes.map((c, j) => (
                        <span key={j}>{c.type === 'add' ? '+' : c.type === 'drop' ? '-' : '~'} {c.item?.title || c.itemId || ''}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function phaseItemsDone(phase: PlanPhase): number {
  if (!phase.items) return 0;
  return phase.items.filter(item => item.status === 'completed').length;
}

function activePhaseIndex(phases: PlanPhase[], tasksByPhase: Map<string | number, KSwarmTask[]>): number {
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const phaseTasks = tasksByPhase.get(phase.id) || [];
    const allDone = phase.items ? phase.items.every(item => item.status === 'completed') : phaseTasks.every(t => t.status === 'done');
    const hasPending = phase.items ? phase.items.some(item => item.status !== 'completed') : phaseTasks.length > 0 && phaseTasks.some(t => t.status !== 'done');
    if (!allDone && (hasPending || i === 0)) return i;
  }
  return 0;
}
