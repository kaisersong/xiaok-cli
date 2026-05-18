/**
 * ProjectDetailPage — full project detail with plan, kanban, activity, deliverables tabs.
 * Uses getProjectFullDetail to fetch activities, humanActions, plan, planProgress, workspace.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, LayoutGrid, Activity, Package, CheckCircle2, Send, XCircle, Archive, RefreshCw, Users, Download, FolderOpen } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmProject, KSwarmTask, KSwarmActivityEvent, KSwarmHumanAction } from '../../hooks/useKSwarmClient';
import type { ProjectFullDetail } from '../../hooks/useKSwarmClient';
import { PlanView } from './PlanView';
import { KanbanBoard } from './KanbanBoard';
import { ActivityTimeline } from './ActivityTimeline';
import { DeliverableView } from './DeliverableView';
import { exportProjectMarkdown } from './exportProjectMarkdown';
import { getDesktopApi } from '../../shared/desktop';
import { canRetryPlanForProject, isInterruptedPlanProject } from './projectPlanRecovery';
import {
  describeKSwarmAgentStatus,
  formatKSwarmAgentStatus,
  getAgentStatusDotClass,
  getProjectHealthLabel,
  shouldShowProjectHealth,
  summarizeProjectHealth,
} from './kswarmStatus';

type TabId = 'plan' | 'board' | 'agents' | 'activity' | 'deliverables';

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { getProjectFullDetail, approveProject, retryPlan, dispatchTasks, deliverProject, closeProject, connected, agents } = useKSwarm();
  const { t } = useLocale();
  const [detail, setDetail] = useState<ProjectFullDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('board');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const TABS: Array<{ id: TabId; label: string; icon: typeof FileText }> = useMemo(() => [
    { id: 'plan', label: t.projectsDetailPlan, icon: FileText },
    { id: 'board', label: t.projectsDetailKanban, icon: LayoutGrid },
    { id: 'agents', label: '智能体', icon: Users },
    { id: 'activity', label: t.projectsDetailActivity, icon: Activity },
    { id: 'deliverables', label: t.projectsDetailDeliverables, icon: Package },
  ], [t]);

  const STATUS_LABELS: Record<string, string> = useMemo(() => ({
    draft: t.projectsStatusDraft, planning: t.projectsStatusPlanning, created: t.projectsStatusPlanning, active: t.projectsStatusActive,
    review: t.projectsStatusReview, delivered: t.projectsStatusDelivered, closed: t.projectsStatusClosed,
  }), [t]);

  const load = async () => {
    if (!projectId) return;
    const data = await getProjectFullDetail(projectId);
    if (data) setDetail(data);
    return data;
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const doLoad = async () => {
      const data = await load();
      if (!cancelled) setLoading(false);
    };
    doLoad();
    refreshRef.current = setInterval(load, 5000);
    return () => {
      cancelled = true;
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [projectId, getProjectFullDetail]);

  const refreshOnce = async () => {
    const data = await load();
    return data;
  };

  const handleAction = async (action: string, fn: () => Promise<any>) => {
    if (!projectId) return;
    setActionLoading(action);
    await fn();
    await refreshOnce();
    setActionLoading(null);
  };

  const handleExport = async () => {
    if (!detail) return;
    const api = getDesktopApi() as any;
    if (!api?.showSaveDialog || !api?.saveFile) return;
    const defaultName = `${detail.project.name.replace(/[/\\:*?"<>|]/g, '_')}.md`;
    const { canceled, filePath } = await api.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return;
    const md = exportProjectMarkdown(detail, agents, t);
    await api.saveFile({ filePath, content: md });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--c-text-muted)] border-t-transparent" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-[var(--c-text-tertiary)]">项目未找到</p>
        <button type="button" onClick={() => navigate('/projects')} className="text-sm text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]">返回项目列表</button>
      </div>
    );
  }

  const { project, tasks, activities, humanActions, workspace, plan, planProgress } = detail;
  const showApprove = project.status === 'created' || project.status === 'draft' || project.status === 'planning';
  const showRetryPlan = canRetryPlanForProject(project, plan, tasks);
  const showInterruptedPlanHint = isInterruptedPlanProject(project, plan, tasks);
  const showDispatch = project.status === 'active' && tasks.some(t => t.status === 'pending');
  const showDeliver = project.status === 'active' && tasks.every(t => t.status === 'done' || t.status === 'cancelled');
  const showClose = project.status === 'active' || project.status === 'delivered';
  const statusLabel = STATUS_LABELS[project.status] || project.status;
  const healthSummary = summarizeProjectHealth(detail);
  const showHealthBanner = shouldShowProjectHealth(healthSummary.status);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--c-border-subtle)] px-6 py-3 space-y-2">
        {/* Row 1: Back + Title + Status + Actions */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/projects')} className="shrink-0 rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-[15px] font-semibold text-[var(--c-text-heading)] truncate">{project.name}</h1>
          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border-[0.5px] border-[var(--c-border-subtle)] text-[var(--c-text-muted)]`}>{statusLabel}</span>
          <button type="button" onClick={handleExport} title={t.projectsDetailExport} className="shrink-0 rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)]">
            <Download size={14} />
          </button>
          <div className="flex-1" />
          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {showRetryPlan && (
              <button type="button" onClick={() => handleAction('retry', () => retryPlan(projectId!))} disabled={actionLoading === 'retry'}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-accent)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
                <RefreshCw size={12} /><span>{actionLoading === 'retry' ? '...' : t.projectsDetailRetryPlan ?? '重新制定计划'}</span>
              </button>
            )}
            {showApprove && (
              <button type="button" onClick={() => handleAction('approve', () => approveProject(projectId!))}
                disabled={actionLoading === 'approve'}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-status-success-text)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
                <CheckCircle2 size={12} /><span>{actionLoading === 'approve' ? '...' : t.projectsDetailApprove}</span>
              </button>
            )}
            {showDispatch && (
              <button type="button" onClick={() => handleAction('dispatch', () => dispatchTasks(projectId!, project?.poAgent))}
                disabled={actionLoading === 'dispatch'}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-text-primary)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
                <Send size={12} /><span>{actionLoading === 'dispatch' ? '...' : t.projectsDetailDispatch}</span>
              </button>
            )}
            {showDeliver && (
              <button type="button" onClick={() => handleAction('deliver', () => deliverProject(projectId!))}
                disabled={actionLoading === 'deliver'}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-status-success-text)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
                <Archive size={12} /><span>{actionLoading === 'deliver' ? '...' : t.projectsDetailDeliver}</span>
              </button>
            )}
            {showClose && !confirmClose && (
              <button type="button" onClick={() => setConfirmClose(true)}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-status-error-text)] bg-[var(--c-bg-deep)] hover:brightness-[0.95]">
                <XCircle size={12} /><span>完成项目</span>
              </button>
            )}
            {confirmClose && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => handleAction('close', () => closeProject(projectId!))} disabled={actionLoading === 'close'}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-medium bg-[var(--c-status-error-text)] text-white">
                  {actionLoading === 'close' ? '...' : t.projectsDetailConfirmDone}
                </button>
                <button type="button" onClick={() => setConfirmClose(false)} className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">{t.commonCancel}</button>
              </div>
            )}
            {!connected && (
              <span className="rounded-full bg-[var(--c-error-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--c-status-warning-text)]">{t.projectsPageOffline}</span>
            )}
          </div>
        </div>

        {/* Row 2: Goal */}
        {project.goal && (
          <p className="text-[12px] text-[var(--c-text-secondary)] line-clamp-2 pl-[38px]">{project.goal}</p>
        )}

        {/* Row 3: Metadata tags */}
        {((project as any).requirements || workspace?.path) && (
          <div className="flex items-center gap-3 pl-[38px] flex-wrap">
            {workspace?.path && (
              <div className="flex items-center gap-1 text-[11px] text-[var(--c-text-muted)]">
                <FolderOpen size={11} className="shrink-0" />
                <span className="font-mono truncate max-w-[260px]">{workspace.path}</span>
                {workspace.artifacts && workspace.artifacts.length > 0 && (
                  <span className="text-[9px] px-1 rounded bg-[var(--c-bg-deep)]">{workspace.artifacts.length} files</span>
                )}
              </div>
            )}
            {(project as any).requirements && (
              <div className="flex items-center gap-1 text-[11px] text-[var(--c-text-muted)]">
                <FileText size={11} className="shrink-0" />
                <span className="truncate max-w-[400px]">{(project as any).requirements}</span>
              </div>
            )}
          </div>
        )}

        {showHealthBanner && (
          <div className={`ml-[38px] rounded-lg border px-3 py-2 ${
            healthSummary.status === 'blocked' || healthSummary.status === 'failed'
              ? 'border-[var(--c-status-error-text)]/30 bg-[var(--c-error-bg)] text-[var(--c-status-error-text)]'
              : 'border-[var(--c-status-warning-text)]/30 bg-[var(--c-bg-deep)] text-[var(--c-status-warning-text)]'
          }`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold">{getProjectHealthLabel(healthSummary.status)}</span>
              {healthSummary.primaryTaskId && (
                <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 font-mono text-[10px]">{healthSummary.primaryTaskId}</span>
              )}
              {detail.projectHealth?.actions?.map((action) => (
                <span
                  key={action.id}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    action.recommended
                      ? 'bg-[var(--c-bg-page)] text-[var(--c-text-primary)]'
                      : 'bg-[var(--c-bg-page)]/60 text-[var(--c-text-secondary)]'
                  }`}
                >
                  {action.label}
                </span>
              ))}
            </div>
            {healthSummary.message && (
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--c-text-secondary)]">{healthSummary.message}</p>
            )}
            {(healthSummary.dispatchableCount > 0 || healthSummary.blockedCount > 0 || healthSummary.waitingCount > 0) && (
              <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--c-text-muted)]">
                <span>可派发 {healthSummary.dispatchableCount}</span>
                <span>阻塞 {healthSummary.blockedCount}</span>
                <span>等待 {healthSummary.waitingCount}</span>
              </div>
            )}
          </div>
        )}

        {/* Status hint */}
        {(project.status === 'created' || project.status === 'draft' || project.status === 'planning' || showInterruptedPlanHint) && (
          <div className="pl-[38px]">
            {showInterruptedPlanHint && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-[var(--c-bg-deep)] text-[var(--c-status-warning-text)]">计划中断，可重新制定计划</span>
            )}
            {!showInterruptedPlanHint && !plan && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-[var(--c-bg-deep)] text-[var(--c-status-warning-text)]">等待 PO 制定计划...</span>
            )}
            {!showInterruptedPlanHint && plan && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-[var(--c-bg-deep)] text-[var(--c-status-success-text)]">Plan v{plan.version} 已就绪，可审批</span>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--c-border-subtle)] px-6">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12px] font-medium transition-colors ${
                isActive ? 'border-[var(--c-text-primary)] text-[var(--c-text-primary)]' : 'border-transparent text-[var(--c-text-muted)] hover:text-[var(--c-text-secondary)]'
              }`}>
              <Icon size={14} /><span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content — pass full detail data to child components */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'plan' && (
          <PlanView plan={plan} planProgress={planProgress} tasks={tasks} />
        )}
        {activeTab === 'board' && (
          <KanbanBoard project={{ ...project, tasks } as KSwarmProject} />
        )}
        {activeTab === 'agents' && (
          <div className="p-6">
            <div className="space-y-2">
              {/* PO Agent */}
              {project.poAgent && (() => {
                const poAgentData = agents.find(a => a.id === project.poAgent);
                const runtimeStatus = describeKSwarmAgentStatus(
                  poAgentData ?? { id: project.poAgent, name: project.poAgent, status: 'offline' },
                  tasks,
                );
                return (
                  <div key={project.poAgent} className="flex items-center gap-3 rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3">
                    <div className={`size-2.5 rounded-full ${getAgentStatusDotClass(runtimeStatus.status)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-[var(--c-text-heading)]">{poAgentData?.name || project.poAgent}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-accent)]/10 text-[var(--c-accent)]">PO</span>
                      </div>
                      <span className="text-[11px] text-[var(--c-text-muted)]">{formatKSwarmAgentStatus(runtimeStatus)}</span>
                    </div>
                  </div>
                );
              })()}
              {/* Worker Agents */}
              {(() => {
                const memberIds = new Set(project.members || []);
                const workerAgents = agents.filter(a => memberIds.has(a.id));
                return workerAgents.map(agent => {
                  const runtimeStatus = describeKSwarmAgentStatus(agent, tasks);
                  return (
                    <div key={agent.id} className="flex items-center gap-3 rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3">
                      <div className={`size-2.5 rounded-full ${getAgentStatusDotClass(runtimeStatus.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium text-[var(--c-text-heading)]">{agent.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]">Worker</span>
                        </div>
                        <span className="text-[11px] text-[var(--c-text-muted)]">{formatKSwarmAgentStatus(runtimeStatus)}</span>
                      </div>
                    </div>
                  );
                });
              })()}
              {agents.length === 0 && (
                <p className="text-[12px] text-[var(--c-text-muted)] py-4 text-center">暂无智能体</p>
              )}
            </div>
          </div>
        )}
        {activeTab === 'activity' && (
          <ActivityTimeline project={project} activities={activities} humanActions={humanActions} />
        )}
        {activeTab === 'deliverables' && (
          <div className="space-y-4">
            {/* Project Summary */}
            {project.summary && (
              <div className="rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4">
                <div className="flex items-center gap-3 mb-3">
                  <h4 className="text-[13px] font-semibold text-[var(--c-text-heading)]">{t.projectsSummaryTitle}</h4>
                  {project.summaryScore != null && (
                    <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                      project.summaryScore >= 8 ? 'bg-[var(--c-status-success-text)]/15 text-[var(--c-status-success-text)]'
                        : project.summaryScore >= 5 ? 'bg-[var(--c-status-warning-text)]/15 text-[var(--c-status-warning-text)]'
                        : 'bg-[var(--c-status-error-text)]/15 text-[var(--c-status-error-text)]'
                    }`}>
                      {project.summaryScore}/10
                    </span>
                  )}
                </div>
                <div className="text-[12px] leading-relaxed text-[var(--c-text-secondary)] whitespace-pre-wrap">
                  {project.summary}
                </div>
              </div>
            )}
            <DeliverableView project={project} tasks={tasks} />
          </div>
        )}
      </div>
    </div>
  );
}
