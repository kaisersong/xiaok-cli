/**
 * ProjectDetailPage — full project detail with plan, kanban, activity, deliverables tabs.
 * Uses getProjectFullDetail to fetch activities, humanActions, plan, planProgress, workspace.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, LayoutGrid, Activity, Package, CheckCircle2, Send, XCircle, Archive, RefreshCw, Users } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmProject, KSwarmTask, KSwarmActivityEvent, KSwarmHumanAction } from '../../hooks/useKSwarmClient';
import type { ProjectFullDetail } from '../../hooks/useKSwarmClient';
import { PlanView } from './PlanView';
import { KanbanBoard } from './KanbanBoard';
import { ActivityTimeline } from './ActivityTimeline';
import { DeliverableView } from './DeliverableView';

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
  const showDispatch = project.status === 'active' && tasks.some(t => t.status === 'pending');
  const showDeliver = project.status === 'active' && tasks.every(t => t.status === 'done' || t.status === 'cancelled');
  const showClose = project.status === 'active' || project.status === 'delivered';
  const statusLabel = STATUS_LABELS[project.status] || project.status;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--c-border-subtle)] px-6 py-4">
        <button type="button" onClick={() => navigate('/projects')} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[14px] font-semibold text-[var(--c-text-heading)] truncate">{project.name}</h1>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border-[0.5px] border-[var(--c-border-subtle)] text-[var(--c-text-muted)]`}>{statusLabel}</span>
          </div>
          {project.goal && <p className="text-[12px] text-[var(--c-text-tertiary)] truncate mt-0.5">{project.goal}</p>}
          {/* Requirements */}
          {(project as any).requirements && (
            <p className="text-[11px] text-[var(--c-text-tertiary)] mt-0.5 line-clamp-1">{(project as any).requirements}</p>
          )}
          {/* Workspace path */}
          {workspace?.path && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-[var(--c-text-muted)]">Workspace:</span>
              <span className="text-[10px] text-[var(--c-text-tertiary)] font-mono truncate max-w-[300px]">{workspace.path}</span>
              {workspace.artifacts && workspace.artifacts.length > 0 && (
                <span className="text-[9px] px-1 rounded bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]">{workspace.artifacts.length} files</span>
              )}
            </div>
          )}
          {/* Status hints */}
          {(project.status === 'created' || project.status === 'draft' || project.status === 'planning') && !plan && (
            <p className="text-[10px] text-[var(--c-status-warning-text)] mt-1">等待 PO 制定计划...</p>
          )}
          {(project.status === 'created' || project.status === 'draft' || project.status === 'planning') && plan && (
            <p className="text-[10px] text-[var(--c-status-success-text)] mt-1">Plan v{plan.version} 已就绪，可审批</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {showApprove && (
            <button type="button" onClick={async () => {
              await retryPlan(projectId!);
              await refreshOnce();
            }} disabled={actionLoading === 'retry'}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--c-accent)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
              <RefreshCw size={13} /><span>{actionLoading === 'retry' ? '...' : t.projectsDetailRetryPlan ?? '重新制定计划'}</span>
            </button>
          )}
          {showApprove && (
            <button type="button" onClick={() => handleAction('approve', () => approveProject(projectId!))}
              disabled={actionLoading === 'approve'}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--c-status-success-text)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
              <CheckCircle2 size={13} /><span>{actionLoading === 'approve' ? '...' : t.projectsDetailApprove}</span>
            </button>
          )}
          {showDispatch && (
            <button type="button" onClick={() => handleAction('dispatch', () => dispatchTasks(projectId!, project?.poAgent))}
              disabled={actionLoading === 'dispatch'}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--c-text-primary)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
              <Send size={13} /><span>{actionLoading === 'dispatch' ? '...' : t.projectsDetailDispatch}</span>
            </button>
          )}
          {showDeliver && (
            <button type="button" onClick={() => handleAction('deliver', () => deliverProject(projectId!))}
              disabled={actionLoading === 'deliver'}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--c-status-success-text)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
              <Archive size={13} /><span>{actionLoading === 'deliver' ? '...' : t.projectsDetailDeliver}</span>
            </button>
          )}
          {showClose && !confirmClose && (
            <button type="button" onClick={() => setConfirmClose(true)}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--c-status-error-text)] bg-[var(--c-bg-deep)] hover:brightness-[0.95]">
              <XCircle size={13} /><span>完成项目</span>
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
                return (
                  <div key={project.poAgent} className="flex items-center gap-3 rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3">
                    <div className={`size-2.5 rounded-full ${poAgentData?.status === 'offline' ? 'bg-[var(--c-text-muted)]' : 'bg-[var(--c-status-success-text)]'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-[var(--c-text-heading)]">{poAgentData?.name || project.poAgent}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-accent)]/10 text-[var(--c-accent)]">PO</span>
                      </div>
                      <span className="text-[11px] text-[var(--c-text-muted)]">{poAgentData?.status === 'offline' ? '离线' : poAgentData?.status === 'working' ? '工作中' : '空闲'}</span>
                    </div>
                  </div>
                );
              })()}
              {/* Worker Agents */}
              {(() => {
                const memberIds = new Set(project.members || []);
                const workerAgents = agents.filter(a => memberIds.has(a.id));
                return workerAgents.map(agent => {
                  const assignedTask = tasks.find(t => t.assignedAgent === agent.id && t.status !== 'done' && t.status !== 'cancelled');
                  return (
                    <div key={agent.id} className="flex items-center gap-3 rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3">
                      <div className={`size-2.5 rounded-full ${agent.status === 'offline' ? 'bg-[var(--c-text-muted)]' : agent.status === 'working' ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-status-success-text)]'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium text-[var(--c-text-heading)]">{agent.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]">Worker</span>
                        </div>
                        <span className="text-[11px] text-[var(--c-text-muted)]">
                          {agent.status === 'offline' ? '离线' : agent.status === 'working' ? '工作中' : '空闲'}
                          {assignedTask && ` · ${assignedTask.title}`}
                        </span>
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
          <DeliverableView project={project} tasks={tasks} />
        )}
      </div>
    </div>
  );
}
