/**
 * ActivityTimeline — full event timeline from server-side activity log,
 * with artifact links, human actions, and agent name resolution.
 */

import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, AlertCircle, Play, FileText, Users, Plus, Send, Eye, Archive, Workflow as WorkflowIcon } from 'lucide-react';
import type { KSwarmProject, KSwarmActivityEvent, KSwarmHumanAction, KSwarmArtifact, KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import { ArtifactPreviewModal } from './ArtifactPreviewModal';

interface ActivityTimelineProps {
  project: KSwarmProject;
  activities?: KSwarmActivityEvent[];
  humanActions?: KSwarmHumanAction[];
  workflowRuns?: KSwarmWorkflowRun[];
}

type TimelineEntry =
  | { kind: 'activity'; key: string; tsValue: number; event: KSwarmActivityEvent }
  | { kind: 'workflow'; key: string; tsValue: number; run: KSwarmWorkflowRun };

function formatTime(ts?: number | string): string {
  if (!ts) return '';
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ''; }
}

function timeValue(ts?: number | string | null): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  const value = new Date(ts).getTime();
  return Number.isFinite(value) ? value : 0;
}

function workflowRunTime(run: KSwarmWorkflowRun): number {
  return run.completedAt ?? run.updatedAt ?? run.startedAt ?? run.createdAt ?? 0;
}

function formatWorkflowRunName(run: KSwarmWorkflowRun): string {
  if (run.workflowId === 'agent-review-smoke') return 'Agent 复核诊断';
  if (run.workflowId === 'project-diagnose') return '快速诊断';
  return run.title || run.workflowId;
}

function formatWorkflowRunStatus(status: KSwarmWorkflowRun['status']): string {
  const labels: Record<KSwarmWorkflowRun['status'], string> = {
    awaiting_approval: '待确认',
    running: '运行中',
    blocked: '阻塞',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return labels[status] || status;
}

function getWorkflowRunDetail(run: KSwarmWorkflowRun): string {
  return (
    run.summary?.primaryMessage ||
    run.gateDecision?.reason ||
    (run.gateDecision?.status ? `Gate：${run.gateDecision.status}` : '') ||
    formatWorkflowRunStatus(run.status)
  );
}

function isWorkflowActivity(event: KSwarmActivityEvent): boolean {
  return event.type.startsWith('workflow.');
}

function formatWorkflowActivityLabel(event: KSwarmActivityEvent): string {
  const labels: Record<string, string> = {
    'workflow.run.started': '工作流启动',
    'workflow.run.completed': '工作流完成',
    'workflow.run.cancelled': '工作流取消',
    'workflow.run.gate_completed': '工作流 Gate 完成',
    'workflow.node.output_received': '工作流节点提交',
    'workflow.node.reviewed': '工作流节点复核',
    'workflow.node.blocked': '工作流节点阻塞',
  };
  return labels[event.type] || event.type;
}

export function ActivityTimeline({ project, activities: propActivities, humanActions: propHumanActions, workflowRuns: propWorkflowRuns }: ActivityTimelineProps) {
  const { lastEvent, agents } = useKSwarm();
  const { t } = useLocale();
  const [previewArtifact, setPreviewArtifact] = useState<KSwarmArtifact | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const EVENT_META: Record<string, { icon: typeof FileText; label: string; color: string }> = {
    'project.created': { icon: Plus, label: t.projectsActivityCreated, color: 'text-[var(--c-text-secondary)]' },
    'po.assigned': { icon: Users, label: t.projectsActivityPoAssigned, color: 'text-[var(--c-text-secondary)]' },
    'tasks.created': { icon: FileText, label: 'PO 创建任务', color: 'text-[var(--c-text-secondary)]' },
    'tasks.added_by_human': { icon: Plus, label: '人工添加任务', color: 'text-[var(--c-text-primary)]' },
    'project.approved': { icon: CheckCircle2, label: t.projectsActivityApproved, color: 'text-[var(--c-status-success-text)]' },
    'task.assigned': { icon: Users, label: t.projectsActivityDispatched, color: 'text-[var(--c-text-secondary)]' },
    'task.dispatched': { icon: Send, label: t.projectsActivityDispatched, color: 'text-[var(--c-text-secondary)]' },
    'task.accepted': { icon: Play, label: '接受任务', color: 'text-[var(--c-status-warning-text)]' },
    'task.progress': { icon: Play, label: t.projectsActivityInProgress, color: 'text-[var(--c-status-warning-text)]' },
    'task.submitted': { icon: Eye, label: t.projectsActivitySubmitted, color: 'text-[var(--c-status-success-text)]' },
    'task.done': { icon: CheckCircle2, label: t.projectsActivityDone, color: 'text-[var(--c-status-success-text)]' },
    'task.rework': { icon: AlertCircle, label: t.projectsActivityRework, color: 'text-[var(--c-status-error-text)]' },
    'task.failed': { icon: AlertCircle, label: t.projectsActivityFailed, color: 'text-[var(--c-status-error-text)]' },
    'task.quality_reviewed': { icon: Eye, label: 'PO 质量验收', color: 'text-[var(--c-status-warning-text)]' },
    'task.blocked': { icon: AlertCircle, label: '任务阻塞', color: 'text-[var(--c-status-error-text)]' },
    'task.cancelled': { icon: AlertCircle, label: t.projectsActivityCancelled, color: 'text-[var(--c-text-muted)]' },
    'project.delivered': { icon: Archive, label: 'PO 提交交付', color: 'text-[var(--c-status-success-text)]' },
    'project.closed': { icon: CheckCircle2, label: '项目关闭', color: 'text-[var(--c-text-muted)]' },
    'approval.pending': { icon: Eye, label: '等待审批', color: 'text-[var(--c-status-warning-text)]' },
    'plan.submitted': { icon: FileText, label: '提交计划', color: 'text-[var(--c-text-secondary)]' },
    'plan.revised': { icon: FileText, label: '修订计划', color: 'text-[var(--c-status-warning-text)]' },
    'task.reviewed': { icon: Eye, label: 'PO 质量验收', color: 'text-[var(--c-status-success-text)]' },
  };

  const agentName = (id?: string) => {
    if (!id) return '';
    const a = agents.find(a => a.id === id);
    return a?.name || id;
  };

  const humanActions = propHumanActions || [];
  const workflowRuns = propWorkflowRuns || [];
  const workflowRunIds = new Set(workflowRuns.map((run) => run.id));
  const activities = (propActivities || []).filter((event) => (
    !isWorkflowActivity(event) ||
    !event.workflowRunId ||
    !workflowRunIds.has(event.workflowRunId)
  ));
  const timelineEntries: TimelineEntry[] = [
    ...activities.map((event, index) => ({
      kind: 'activity' as const,
      key: `activity-${event.type}-${event.ts ?? index}-${index}`,
      tsValue: timeValue(event.ts),
      event,
    })),
    ...workflowRuns.map((run) => ({
      kind: 'workflow' as const,
      key: `workflow-${run.id}`,
      tsValue: timeValue(workflowRunTime(run)),
      run,
    })),
  ].sort((a, b) => a.tsValue - b.tsValue);

  if (timelineEntries.length === 0 && humanActions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--c-text-tertiary)]">{t.projectsActivityEmpty}</p>
      </div>
    );
  }

  return (
    <div className="p-6" data-testid="activity-timeline">
      {/* Activity events */}
      <div className="flex flex-col gap-0">
        {timelineEntries.map((entry, idx) => {
          if (entry.kind === 'workflow') {
            const { run } = entry;
            const completed = run.summary?.completed ?? 0;
            const total = run.summary?.total ?? 0;
            const detailText = getWorkflowRunDetail(run);

            return (
              <div key={entry.key} data-testid="activity-timeline-entry" className="flex gap-3 group">
                <div className="flex flex-col items-center">
                  <div className="flex size-6 items-center justify-center rounded-full bg-[var(--c-bg-deep)]">
                    <WorkflowIcon size={13} className="text-[var(--c-accent)]" />
                  </div>
                  {idx < timelineEntries.length - 1 && <div className="w-px flex-1 bg-[var(--c-border-subtle)]" />}
                </div>

                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-medium text-[var(--c-text-primary)]">{formatWorkflowRunName(run)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-accent)]/10 text-[var(--c-accent)]">Workflow</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]">{formatWorkflowRunStatus(run.status)}</span>
                    {total > 0 && (
                      <span className="text-[10px] text-[var(--c-text-tertiary)]">{completed}/{total}</span>
                    )}
                  </div>
                  {detailText && (
                    <p className="mt-1 max-w-3xl rounded-md bg-[var(--c-bg-deep)] px-2 py-1 text-[10px] leading-relaxed text-[var(--c-text-secondary)] line-clamp-3">
                      {detailText}
                    </p>
                  )}
                </div>

                <span className="text-[10px] text-[var(--c-text-muted)] shrink-0 font-mono pt-1">{formatTime(workflowRunTime(run))}</span>
              </div>
            );
          }

          const { event } = entry;
          const workflowActivity = isWorkflowActivity(event);
          const meta = workflowActivity
            ? { icon: WorkflowIcon, label: formatWorkflowActivityLabel(event), color: 'text-[var(--c-accent)]' }
            : EVENT_META[event.type] || { icon: FileText, label: event.type, color: 'text-[var(--c-text-muted)]' };
          const Icon = meta.icon;
          const agent = event.agent || event.by || event.target || '';
          const taskTitle = event.taskTitle || '';
          const artifacts = event.output?.artifacts || [];
          const detailText = getActivityDetail(event);

          return (
            <div key={entry.key} data-testid="activity-timeline-entry" className="flex gap-3 group">
              {/* Timeline line + dot */}
              <div className="flex flex-col items-center">
                <div className="flex size-6 items-center justify-center rounded-full bg-[var(--c-bg-deep)]">
                  <Icon size={13} className={meta.color} />
                </div>
                {idx < timelineEntries.length - 1 && <div className="w-px flex-1 bg-[var(--c-border-subtle)]" />}
              </div>

              {/* Content */}
              <div className="flex-1 pb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-medium text-[var(--c-text-primary)]">{meta.label}</span>
                  {workflowActivity ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-accent)]/10 text-[var(--c-accent)]">Workflow</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]">Swarm</span>
                  )}
                  {agent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]">@{agentName(agent)}</span>}
                  {taskTitle && <span className="text-[10px] text-[var(--c-text-tertiary)]">"{taskTitle}"</span>}
                </div>

                {/* Task assignments detail */}
                {event.tasks && event.tasks.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {event.tasks.map((t, j) => (
                      <span key={j} className="text-[10px] text-[var(--c-text-muted)]">
                        {t.title}{t.assignedAgent ? ` → @${agentName(t.assignedAgent)}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {/* Artifact links */}
                {artifacts.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {artifacts.map((art, j) => {
                      const artifact = typeof art === 'string' ? { name: art, mimeType: 'text/plain' } : art;
                      return (
                        <button key={j} type="button" onClick={() => setPreviewArtifact(artifact)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] border-[0.5px] border-[var(--c-border-subtle)] hover:bg-[var(--c-bg-page)]">
                          {artifact.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {event.count && <span className="text-[10px] text-[var(--c-text-muted)] ml-1">{event.count} tasks</span>}
                {detailText && (
                  <p className="mt-1 max-w-3xl rounded-md bg-[var(--c-bg-deep)] px-2 py-1 text-[10px] leading-relaxed text-[var(--c-text-secondary)] line-clamp-3">
                    {detailText}
                  </p>
                )}
              </div>

              <span className="text-[10px] text-[var(--c-text-muted)] shrink-0 font-mono pt-1">{formatTime(event.ts)}</span>
            </div>
          );
        })}
      </div>

      {/* Human actions */}
      {humanActions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[var(--c-border-subtle)]">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--c-text-muted)] mb-3">你的操作记录</h4>
          <div className="flex flex-col gap-1">
            {humanActions.map((action, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <div className="flex size-4 items-center justify-center rounded-full bg-[var(--c-btn-bg)]">
                  <span className="text-[7px] font-bold text-[var(--c-btn-text)]">H</span>
                </div>
                <span className="text-[12px] text-[var(--c-text-primary)]">{action.action}</span>
                {action.projectName && <span className="text-[11px] text-[var(--c-text-tertiary)]">— {action.projectName}</span>}
                <span className="text-[10px] text-[var(--c-text-muted)] font-mono ml-auto">{formatTime(action.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
      {previewArtifact && <ArtifactPreviewModal artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
    </div>
  );
}

function getActivityDetail(event: KSwarmActivityEvent): string {
  return (
    event.errorMessage ||
    event.failureReason ||
    event.feedback ||
    event.reason ||
    event.blockedReason ||
    ''
  );
}
