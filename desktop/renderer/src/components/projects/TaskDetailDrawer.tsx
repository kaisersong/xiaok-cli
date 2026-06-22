import { useMemo } from 'react';
import { X, CheckCircle2, Circle, Loader2, AlertCircle, Ban, Workflow } from 'lucide-react';
import type { KSwarmProject, KSwarmTask, KSwarmArtifact, KSwarmWorkflowRun, KSwarmWorkflowNode } from '../../hooks/useKSwarmClient';
import { useLocale } from '../../contexts/LocaleContext';
import { TaskWorkflowProgressBar } from './TaskWorkflowProgressBar';
import {
  getStatusIcon, getToneClass, labelNodeStatus, labelFailurePolicy,
  computeTaskPipelineProgress, readString, buildWorkflowLabels,
  type WorkflowLabels,
} from './workflowUtils';

interface TaskDetailDrawerProps {
  task: KSwarmTask;
  workflowRun: KSwarmWorkflowRun | null;
  projectId: string;
  projectExecutionMode?: KSwarmProject['executionMode'];
  onClose: () => void;
  onStartTaskWorkflow?: (taskId: string) => void;
  onPreviewArtifact: (art: KSwarmArtifact) => void;
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return '';
  const num = typeof ts === 'number' ? ts : Number(ts);
  if (!Number.isFinite(num) || num <= 0) return '';
  return new Date(num).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status: KSwarmTask['status'], t: ReturnType<typeof import('../../contexts/LocaleContext').useLocale>['t']): string {
  const map: Record<string, string> = {
    pending: t.projectsTaskStatusPending, dispatched: t.projectsTaskStatusDispatched, accepted: t.projectsTaskStatusAccepted,
    in_progress: t.projectsTaskStatusInProgress, submitted: t.projectsTaskStatusSubmitted, review: t.projectsTaskStatusReview,
    done: t.projectsTaskStatusDone, failed: t.projectsTaskStatusFailed, blocked: t.projectsTaskStatusBlocked, cancelled: t.projectsTaskStatusCancelled,
  };
  return map[status] || status;
}

function statusTone(status: KSwarmTask['status']): string {
  if (status === 'done') return 'text-[var(--c-status-success-text)]';
  if (status === 'failed' || status === 'blocked') return 'text-[var(--c-status-error-text)]';
  if (status === 'in_progress' || status === 'dispatched' || status === 'accepted') return 'text-[var(--c-accent)]';
  return 'text-[var(--c-text-muted)]';
}

export function TaskDetailDrawer({
  task,
  workflowRun,
  projectId,
  projectExecutionMode,
  onClose,
  onStartTaskWorkflow,
  onPreviewArtifact,
}: TaskDetailDrawerProps) {
  const { t } = useLocale();
  const wfLabels = useMemo(() => buildWorkflowLabels(t), [t]);
  const pipelineProgress = useMemo(
    () => workflowRun ? computeTaskPipelineProgress(workflowRun) : null,
    [workflowRun],
  );

  const nodesByPhase = useMemo(() => {
    if (!workflowRun) return [];
    const phases = workflowRun.phases || [];
    return phases.map(phase => ({
      ...phase,
      nodes: (workflowRun.nodes || []).filter(n => n.phaseId === phase.id),
    }));
  }, [workflowRun]);

  const parallelGroups = workflowRun?.parallelGroups || [];
  const review = task.reviewResult;
  const result = typeof task.result === 'object' && task.result !== null ? task.result : {};
  const resultArtifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const hasArtifacts = resultArtifacts.length > 0;
  const canStartWorkflow = !workflowRun && onStartTaskWorkflow && task.status !== 'done' && task.status !== 'cancelled';

  const closeFromButton = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/20"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-label={t.projectsTaskDetailTitle}
        className="h-full w-[min(480px,100vw)] overflow-y-auto border-l border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] p-5 shadow-xl"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold leading-snug text-[var(--c-text-heading)]">
              {task.title || task.description || ''}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <span className={`text-[11px] font-medium ${statusTone(task.status)}`}>
                {statusLabel(task.status, t)}
              </span>
              {task.assignedAgent && (
                <span className="text-[10px] text-[var(--c-text-muted)]">
                  · {task.assignedAgent}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label={t.commonClose}
            onMouseDown={closeFromButton}
            onClick={closeFromButton}
            className="ml-auto shrink-0 rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Description */}
        {task.description && task.description !== task.title && (
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--c-text-secondary)]">
            {task.description}
          </p>
        )}

        {/* Execution strategy */}
        {task.execution && (
          <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-[var(--c-accent)]/10 px-2 py-0.5 text-[10px] text-[var(--c-accent)]">
            <Workflow size={10} />
            <span>{task.execution.strategy === 'workflow' ? t.projectsTaskWorkflowExec : t.projectsTaskDirectExec}</span>
          </div>
        )}

        {/* Time */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--c-text-muted)]">
          {task.createdAt && <span>{t.projectsTaskCreated} {formatTimestamp(task.createdAt)}</span>}
          {task.startedAt && <span>{t.projectsTaskStarted} {formatTimestamp(task.startedAt)}</span>}
          {task.completedAt && <span>{t.projectsTaskCompleted} {formatTimestamp(task.completedAt)}</span>}
        </div>

        {/* Pipeline progress */}
        {pipelineProgress && pipelineProgress.total > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[10px] font-medium text-[var(--c-text-muted)]">{t.projectsTaskWorkflowProgress}</div>
            <TaskWorkflowProgressBar progress={pipelineProgress} height="md" />
          </div>
        )}

        {/* Workflow nodes by phase */}
        {nodesByPhase.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="text-[10px] font-medium text-[var(--c-text-muted)]">{t.projectsTaskNodeDetails}</div>
            {nodesByPhase.map(phase => (
              <div key={phase.id}>
                <div className="mb-1.5 text-[11px] font-medium text-[var(--c-text-secondary)]">{phase.title}</div>
                <div className="space-y-1.5">
                  {phase.nodes.map(node => (
                    <NodeRow key={node.id} node={node} parallelGroups={parallelGroups} wfLabels={wfLabels} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Parallel groups summary */}
        {parallelGroups.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="text-[10px] font-medium text-[var(--c-text-muted)]">{t.projectsTaskParallelGroups}</div>
            {parallelGroups.map(pg => (
              <div key={pg.id} className="flex items-center gap-2 rounded-lg bg-[var(--c-bg-card)] px-2.5 py-1.5 text-[11px]">
                <span className="font-medium text-[var(--c-text-secondary)]">{pg.label}</span>
                <span className="text-[var(--c-text-muted)]">
                  {pg.completedCount ?? 0}/{pg.totalCount ?? 0}
                </span>
                {pg.failurePolicy && (
                  <span className="ml-auto text-[10px] text-[var(--c-text-muted)]">
                    {labelFailurePolicy(pg.failurePolicy, wfLabels)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Review */}
        {review && (
          <div className="mt-4">
            <div className="mb-1 text-[10px] font-medium text-[var(--c-text-muted)]">{t.projectsTaskReviewResult}</div>
            <div className={`rounded-lg border-[0.5px] px-3 py-2 text-[11px] ${
              review.passed
                ? 'border-[var(--c-status-success-text)]/20 bg-[var(--c-status-success-text)]/5 text-[var(--c-status-success-text)]'
                : 'border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-text)]/5 text-[var(--c-status-error-text)]'
            }`}>
              <span className="font-medium">{review.passed ? 'PASSED' : 'REWORK'}</span>
              {review.feedback && <p className="mt-1 text-[var(--c-text-muted)]">{review.feedback}</p>}
            </div>
          </div>
        )}

        {/* Artifacts */}
        {hasArtifacts && (
          <div className="mt-4">
            <div className="mb-1.5 text-[10px] font-medium text-[var(--c-text-muted)]">{t.projectsTaskArtifacts}</div>
            <div className="flex flex-wrap gap-1.5">
              {resultArtifacts.map((art: KSwarmArtifact, i: number) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onPreviewArtifact(art); }}
                  className="rounded bg-[var(--c-bg-deep)] px-2 py-1 text-[11px] text-[var(--c-text-secondary)] border-[0.5px] border-[var(--c-border-subtle)] hover:bg-[var(--c-bg-page)] truncate max-w-full"
                >
                  {art.name || art.filename || 'artifact'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Failure / blocked info */}
        {(task.status === 'failed' || task.status === 'blocked') && (
          <div className="mt-4">
            <div className="mb-1 text-[10px] font-medium text-[var(--c-text-muted)]">
              {task.status === 'blocked' ? t.projectsTaskBlockedReason : t.projectsTaskFailureReason}
            </div>
            <p className="rounded-lg bg-[var(--c-status-error-text)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--c-status-error-text)]">
              {task.blockedReason || task.failureReason || task.lastFailureClass || task.failureClass || t.projectsTaskUnknownReason}
            </p>
          </div>
        )}

        {/* Bottom action */}
        {canStartWorkflow && (
          <div className="mt-6 border-t border-[var(--c-border-subtle)] pt-4">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStartTaskWorkflow!(task.id); }}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--c-accent)]/10 px-3 py-2 text-[12px] font-medium text-[var(--c-accent)] hover:bg-[var(--c-accent)]/20"
            >
              <Workflow size={13} />
              <span>{t.projectsTaskStartWorkflow}</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function NodeRow({ node, parallelGroups, wfLabels }: { node: KSwarmWorkflowNode; parallelGroups: any[]; wfLabels: WorkflowLabels }) {
  const StatusIcon = getStatusIcon(node.status);
  const toneClass = getToneClass(node.status);
  const pgLabel = node.parallelGroupId
    ? parallelGroups.find(pg => pg.id === node.parallelGroupId)?.label
    : null;

  return (
    <div className={`flex items-start gap-2 rounded-lg border-[0.5px] px-2.5 py-1.5 ${toneClass}`}>
      <StatusIcon size={12} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] font-medium text-[var(--c-text-primary)]">{node.title}</span>
          {node.fanoutItemLabel && (
            <span className="shrink-0 text-[9px] text-[var(--c-text-muted)]">{node.fanoutItemLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--c-text-muted)]">
          {node.assignedAgent && <span>{node.assignedAgent}</span>}
          {pgLabel && <span>· {pgLabel}</span>}
          <span className="ml-auto">{labelNodeStatus(node.status, wfLabels)}</span>
        </div>
        {node.error && (
          <p className="mt-0.5 truncate text-[10px] text-[var(--c-status-error-text)]">{node.error}</p>
        )}
      </div>
    </div>
  );
}
