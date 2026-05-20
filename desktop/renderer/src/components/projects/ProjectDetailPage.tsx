/**
 * ProjectDetailPage — full project detail with plan, kanban, activity, deliverables tabs.
 * Uses getProjectFullDetail to fetch activities, humanActions, plan, planProgress, workspace.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, LayoutGrid, Activity, Package, CheckCircle2, Send, XCircle, Archive, RefreshCw, Users, Download, FolderOpen } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmProject, KSwarmTask, KSwarmActivityEvent, KSwarmHumanAction, ProjectIntervention } from '../../hooks/useKSwarmClient';
import type { ProjectFullDetail } from '../../hooks/useKSwarmClient';
import { PlanView } from './PlanView';
import { KanbanBoard } from './KanbanBoard';
import { ActivityTimeline } from './ActivityTimeline';
import { DeliverableView } from './DeliverableView';
import { ProjectInterventionBanner } from './ProjectInterventionBanner';
import { exportProjectMarkdown } from './exportProjectMarkdown';
import { getDesktopApi } from '../../shared/desktop';
import { api } from '../../api';
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
type ActionNotice = {
  action: 'retry' | 'export' | 'continue' | 'close';
  kind: 'info' | 'success' | 'error';
  message: string;
};

const RETRY_PLAN_COOLDOWN_MS = 15_000;
const DETAIL_HOVER_DELAY_MS = 500;
const THREAD_DRAFT_STORAGE_PREFIX = 'xiaok.threadDraft.';
const SWARM_CONTEXT_STORAGE_KEY = 'xiaok.swarmContinueContext';

function SummaryCollapsible({ summary, score, taskScores }: { summary: string; score?: number | null; taskScores?: Array<{ title: string; agent: string; score: number; comment: string }> | null }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLocale();

  return (
    <div className="rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--c-bg-deep)] transition-colors"
      >
        <h4 className="text-[13px] font-semibold text-[var(--c-text-heading)]">{t.projectsSummaryTitle}</h4>
        {score != null && (
          <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${
            score >= 8 ? 'bg-[var(--c-status-success-text)]/15 text-[var(--c-status-success-text)]'
              : score >= 5 ? 'bg-[var(--c-status-warning-text)]/15 text-[var(--c-status-warning-text)]'
              : 'bg-[var(--c-status-error-text)]/15 text-[var(--c-status-error-text)]'
          }`}>
            {score}/10
          </span>
        )}
        <span className="ml-auto text-[11px] text-[var(--c-text-muted)]">{expanded ? '收起' : '展开'}</span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--c-border-subtle)]/50">
          <div className="px-4 py-3 text-[12px] leading-relaxed text-[var(--c-text-secondary)] whitespace-pre-wrap">
            {summary}
          </div>
          {taskScores && taskScores.length > 0 && (
            <div className="px-4 pb-3">
              <h5 className="text-[11px] font-semibold text-[var(--c-text-muted)] mb-2">任务评分</h5>
              <div className="space-y-1.5">
                {taskScores.map((ts, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${
                      ts.score >= 8 ? 'bg-[var(--c-status-success-text)]/10 text-[var(--c-status-success-text)]'
                        : ts.score >= 5 ? 'bg-[var(--c-status-warning-text)]/10 text-[var(--c-status-warning-text)]'
                        : 'bg-[var(--c-status-error-text)]/10 text-[var(--c-status-error-text)]'
                    }`}>{ts.score}/10</span>
                    <span className="text-[var(--c-text-heading)] font-medium truncate">{ts.title}</span>
                    <span className="text-[var(--c-text-muted)]">@{ts.agent}</span>
                    <span className="text-[var(--c-text-tertiary)] truncate ml-auto">{ts.comment}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function storeXiaokThreadDraft(threadId: string, context: Record<string, unknown>) {
  const storedContext = { ...context, threadId };
  window.sessionStorage.setItem(SWARM_CONTEXT_STORAGE_KEY, JSON.stringify(storedContext));
  try {
    window.localStorage.setItem(`${THREAD_DRAFT_STORAGE_PREFIX}${threadId}`, JSON.stringify(storedContext));
  } catch {
    // Route state still carries the fresh draft; storage is for recovery from sidebar navigation.
  }
  return storedContext;
}

function DelayedHoverText({
  text,
  as = 'span',
  className,
  wrapperClassName = '',
  testId,
}: {
  text: string;
  as?: 'p' | 'span';
  className: string;
  wrapperClassName?: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const Element = as;
  const Wrapper = as === 'p' ? 'div' : 'span';

  const clearHoverTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearHoverTimer, []);

  const mightBeClipped = () => {
    const element = elementRef.current;
    if (element) {
      const hasLayout = element.clientWidth > 0 || element.clientHeight > 0;
      if (hasLayout) {
        return element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
      }
    }
    return text.length > 40 || text.includes('\n');
  };

  const handleMouseEnter = () => {
    clearHoverTimer();
    if (!mightBeClipped()) return;
    timerRef.current = setTimeout(() => setOpen(true), DETAIL_HOVER_DELAY_MS);
  };

  const handleMouseLeave = () => {
    clearHoverTimer();
    setOpen(false);
  };

  return (
    <Wrapper
      data-testid={testId}
      className={`relative ${as === 'p' ? 'block' : 'inline-block'} ${wrapperClassName}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Element ref={elementRef as any} className={className}>
        {text}
      </Element>
      {open && (
        <span
          role="tooltip"
          data-testid="project-detail-hover-tooltip"
          className="absolute left-0 top-full z-50 mt-2 block max-h-60 w-[min(560px,calc(100vw-96px))] overflow-auto rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-3 py-2 text-[12px] leading-relaxed text-[var(--c-text-primary)] shadow-xl whitespace-pre-wrap"
        >
          {text}
        </span>
      )}
    </Wrapper>
  );
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function buildSwarmContinueContext(detail: ProjectFullDetail, intervention: ProjectIntervention, projectId: string) {
  const actionContext = intervention.secondaryAction?.context || {};
  const primaryFailure = intervention.primaryFailure || {};
  const primaryAction = intervention.primaryAction || null;
  const taskId = toText(actionContext.taskId) || intervention.primaryTaskId || primaryAction?.taskId || '';
  const taskTitle = toText(actionContext.taskTitle) || intervention.primaryTaskTitle || '';
  const lastFailure = toText(actionContext.lastFailure)
    || primaryFailure.feedback
    || primaryFailure.reason
    || intervention.message
    || '';
  const downstreamRaw = intervention.downstreamBlockedCount ?? actionContext.downstreamBlockedCount;
  const downstreamBlockedCount = typeof downstreamRaw === 'number'
    ? downstreamRaw
    : Number(downstreamRaw || 0) || 0;
  return {
    projectId,
    projectName: toText(actionContext.projectName) || detail.project.name,
    projectGoal: detail.project.goal || '',
    taskId,
    taskTitle,
    message: intervention.message || '',
    headline: intervention.headline || '需要处理',
    lastFailure,
    downstreamBlockedCount,
    strategy: primaryAction?.strategy || 'needs_conversation',
    expectedPrimaryTaskId: taskId || undefined,
    expectedTaskUpdatedAt: primaryAction?.taskUpdatedAt ?? intervention.lastEventAt ?? undefined,
    continueTool: 'continue_project',
    continueEndpoint: `/projects/${projectId}/continue`,
    repairTool: 'repair_project_task_from_file',
    repairEndpoint: `/projects/${projectId}/intervention/resolve`,
    availableTools: ['continue_project', 'repair_project_task_from_file'],
  };
}

function buildXiaokInterventionDraft(context: ReturnType<typeof buildSwarmContinueContext>): string {
  const lines = [
    '请帮我诊断并推进这个 Swarm 项目。',
    '',
    `项目：${context.projectName}`,
    `项目 ID：${context.projectId}`,
  ];
  if (context.projectGoal) lines.push(`目标：${context.projectGoal}`);
  if (context.taskTitle || context.taskId) {
    lines.push(`当前卡住任务：${context.taskTitle || context.taskId}`);
  }
  if (context.taskId) lines.push(`任务 ID：${context.taskId}`);
  if (context.message) lines.push(`当前提示：${context.message}`);
  if (context.lastFailure) lines.push(`失败/审核反馈：${context.lastFailure}`);
  lines.push(`后续影响：后续 ${context.downstreamBlockedCount || 0} 个任务正在等待。`);
  lines.push(`建议策略：${context.strategy}`);
  lines.push('');
  if (context.strategy === 'needs_conversation') {
    lines.push('当前状态已经不适合继续自动重试。请先调用 inspect_project 读取项目状态、失败反馈和当前任务相关产物。');
    lines.push(`- projectId: ${context.projectId}`);
    lines.push('');
    lines.push('然后把完整修复产物写入 artifacts 文件，并调用 repair_project_task_from_file：');
    lines.push(`- projectId: ${context.projectId}`);
    if (context.expectedPrimaryTaskId) lines.push(`- taskId: ${context.expectedPrimaryTaskId}`);
    if (context.expectedTaskUpdatedAt !== undefined && context.expectedTaskUpdatedAt !== null) {
      lines.push(`- expectedTaskUpdatedAt: ${context.expectedTaskUpdatedAt}`);
    }
    lines.push('- artifactPath: 你刚写入的 artifacts/xxx 文件路径');
    lines.push('- summary/mimeType: 简短说明和文件类型');
    lines.push('');
    lines.push('不要在对话或 tool 参数里粘贴完整正文；不要反复调用 continue_project；repair_project_task_from_file 只是提交复审，不是强制完成。');
  } else {
    lines.push('请先判断是不是可以安全自动推进。可以安全推进时，调用 continue_project 工具，参数使用：');
    lines.push(`- projectId: ${context.projectId}`);
    if (context.expectedPrimaryTaskId) lines.push(`- expectedPrimaryTaskId: ${context.expectedPrimaryTaskId}`);
    if (context.expectedTaskUpdatedAt !== undefined && context.expectedTaskUpdatedAt !== null) {
      lines.push(`- expectedTaskUpdatedAt: ${context.expectedTaskUpdatedAt}`);
    }
    lines.push('- idempotencyKey: 由你生成一个本次会话唯一值');
    lines.push('');
    lines.push('如果 continue_project 返回 needs_user_action、recovery_budget_exceeded，或发现已有产物为空/不合格，请把完整修复产物写入 artifacts 文件，并调用 repair_project_task_from_file：');
    lines.push(`- projectId: ${context.projectId}`);
    if (context.expectedPrimaryTaskId) lines.push(`- taskId: ${context.expectedPrimaryTaskId}`);
    if (context.expectedTaskUpdatedAt !== undefined && context.expectedTaskUpdatedAt !== null) {
      lines.push(`- expectedTaskUpdatedAt: ${context.expectedTaskUpdatedAt}`);
    }
    lines.push('- artifactPath/summary/mimeType: 只传文件路径和元数据，不要传完整正文');
  }
  lines.push('');
  lines.push('不要跳过必需任务，不要人工放行不合格结果；如果需要调整目标或接受风险，请先向我确认。');
  return lines.join('\n');
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { getProjectFullDetail, approveProject, retryPlan, continueProject, dispatchTasks, deliverProject, closeProject, connected, agents } = useKSwarm();
  const { t } = useLocale();
  const [detail, setDetail] = useState<ProjectFullDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('board');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [retryCooldownUntil, setRetryCooldownUntil] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (retryCooldownRef.current) clearTimeout(retryCooldownRef.current);
      if (noticeClearRef.current) clearTimeout(noticeClearRef.current);
    };
  }, []);

  useEffect(() => {
    if (!detail?.plan || actionNotice?.action !== 'retry' || actionNotice.kind !== 'success') return;
    setActionNotice(null);
    setRetryCooldownUntil(0);
    if (retryCooldownRef.current) clearTimeout(retryCooldownRef.current);
    if (noticeClearRef.current) clearTimeout(noticeClearRef.current);
  }, [detail?.plan, actionNotice]);

  const refreshOnce = async () => {
    const data = await load();
    return data;
  };

  const showNotice = (notice: ActionNotice, ttlMs?: number) => {
    if (noticeClearRef.current) clearTimeout(noticeClearRef.current);
    setActionNotice(notice);
    if (ttlMs) {
      noticeClearRef.current = setTimeout(() => setActionNotice(null), ttlMs);
    }
  };

  const startRetryCooldown = () => {
    if (retryCooldownRef.current) clearTimeout(retryCooldownRef.current);
    setRetryCooldownUntil(Date.now() + RETRY_PLAN_COOLDOWN_MS);
    retryCooldownRef.current = setTimeout(() => setRetryCooldownUntil(0), RETRY_PLAN_COOLDOWN_MS);
  };

  const handleAction = async (action: string, fn: () => Promise<any>) => {
    if (!projectId) return;
    setActionLoading(action);
    await fn();
    await refreshOnce();
    setActionLoading(null);
  };

  const handleCloseProject = async () => {
    if (!projectId || actionLoading !== null) return;
    setActionLoading('close');
    try {
      const ok = await closeProject(projectId);
      if (ok) {
        setDetail(prev => prev ? { ...prev, project: { ...prev.project, status: 'closed' } } : prev);
        setConfirmClose(false);
        showNotice({ action: 'close', kind: 'success', message: '项目已关闭。' }, 5_000);
      } else {
        showNotice({ action: 'close', kind: 'error', message: '关闭项目失败，请稍后重试。' }, 8_000);
      }
    } catch {
      showNotice({ action: 'close', kind: 'error', message: '关闭项目失败，请稍后重试。' }, 8_000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetryPlan = async () => {
    if (!projectId || actionLoading || retryCooldownUntil > Date.now()) return;
    setActionLoading('retry');
    showNotice({ action: 'retry', kind: 'info', message: '正在通知 PO 重新制定计划...' });
    try {
      const result = await retryPlan(projectId);
      if (result?.ok) {
        const message = result.poReassigned && result.poAgent
          ? `已改派到 ${result.poAgent} 并重新制定计划，正在等待 PO 提交新计划。`
          : '已发起重新制定计划，正在等待 PO 提交新计划。';
        startRetryCooldown();
        showNotice({ action: 'retry', kind: 'success', message }, RETRY_PLAN_COOLDOWN_MS);
      } else {
        setRetryCooldownUntil(0);
        showNotice({ action: 'retry', kind: 'error', message: '重新制定计划失败，请稍后重试。' }, 8_000);
      }
    } catch {
      setRetryCooldownUntil(0);
      showNotice({ action: 'retry', kind: 'error', message: '重新制定计划失败，请稍后重试。' }, 8_000);
    } finally {
      await refreshOnce();
      setActionLoading(null);
    }
  };

  const handleExport = async () => {
    if (!detail || actionLoading !== null) return;
    setActionLoading('export');
    const defaultName = `${detail.project.name.replace(/[/\\:*?"<>|]/g, '_')}.md`;
    const md = exportProjectMarkdown(detail, agents, t);

    try {
      const api = getDesktopApi() as any;
      if (api?.showSaveDialog && api?.saveFile) {
        const { canceled, filePath } = await api.showSaveDialog({
          defaultPath: defaultName,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (canceled || !filePath) return;
        await api.saveFile({ filePath, content: md });
      } else {
        downloadTextFile(defaultName, md, 'text/markdown;charset=utf-8');
      }
      showNotice({ action: 'export', kind: 'success', message: '已导出项目报告。' }, 5_000);
    } catch {
      showNotice({ action: 'export', kind: 'error', message: '导出失败，请稍后重试。' }, 8_000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleContinueProject = async (intervention: ProjectIntervention) => {
    if (!projectId || actionLoading !== null) return;
    const primaryAction = intervention.primaryAction;
    setActionLoading('continue');
    try {
      const result = await continueProject(projectId, {
        expectedPrimaryTaskId: intervention.primaryTaskId || primaryAction?.taskId || undefined,
        expectedTaskUpdatedAt: primaryAction?.taskUpdatedAt ?? intervention.lastEventAt ?? undefined,
        idempotencyKey: `continue-${projectId}-${Date.now()}`,
      });
      if (result?.ok) {
        const message = result.outcome === 'submitted_for_review'
          ? (result.reviewNotification === 'sent'
            ? '已通知 PO 复审。'
            : result.reviewNotification === 'failed'
              ? '复审通知发送失败，请稍后重试或让小K帮忙。'
              : result.reviewNotification === 'not_available'
                ? '暂时无法通知 PO，请稍后重试或让小K帮忙。'
                : '已提交审核。')
          : '已继续推进项目。';
        showNotice({ action: 'continue', kind: 'success', message }, 5_000);
      } else if (result?.error === 'task_state_changed' || result?.status === 409) {
        showNotice({ action: 'continue', kind: 'info', message: '状态已变化，已刷新项目。' }, 8_000);
      } else if (result?.error === 'no_recoverable_artifacts') {
        showNotice({ action: 'continue', kind: 'error', message: '没有找到可恢复产物，请查看原因或让小K帮忙处理。' }, 8_000);
      } else if (
        result?.outcome === 'needs_user_action' ||
        result?.humanActionRequired ||
        result?.error === 'recovery_budget_exceeded'
      ) {
        if (detail) {
          const context = buildSwarmContinueContext(detail, intervention, projectId);
          window.sessionStorage.setItem('xiaok.swarmContinueContext', JSON.stringify({
            ...context,
            xiaokContext: result.xiaokContext || {},
            nextActions: result.nextActions || [],
            draftPrompt: buildXiaokInterventionDraft(context),
          }));
        }
        showNotice({ action: 'continue', kind: 'info', message: '需要让小K帮忙诊断并提交修复产物。' }, 8_000);
      } else if (result?.error === 'needs_conversation' || (result?.strategy === 'needs_conversation' && !result?.error)) {
        showNotice({ action: 'continue', kind: 'info', message: '当前需要让小K帮忙确认下一步。' }, 8_000);
      } else {
        showNotice({ action: 'continue', kind: 'error', message: '继续推进失败，请稍后重试。' }, 8_000);
      }
    } catch {
      showNotice({ action: 'continue', kind: 'error', message: '继续推进失败，请稍后重试。' }, 8_000);
    } finally {
      await refreshOnce();
      setActionLoading(null);
    }
  };

  const handleAskXiaok = async (intervention: ProjectIntervention) => {
    if (!projectId || !detail || actionLoading !== null) return;
    setActionLoading('ask_xiaok');
    try {
      const context = buildSwarmContinueContext(detail, intervention, projectId);
      const draftPrompt = buildXiaokInterventionDraft(context);
      const storedContext = { ...context, draftPrompt };
      window.sessionStorage.setItem('xiaok.swarmContinueContext', JSON.stringify(storedContext));
      const thread = await api.createThread({ title: `让小K帮忙：${detail.project.name}`.slice(0, 40) });
      storeXiaokThreadDraft(thread.id, storedContext);
      navigate(`/t/${thread.id}`, {
        state: {
          draftPrompt,
          swarmContinueContext: context,
        },
      });
    } catch {
      showNotice({ action: 'continue', kind: 'error', message: '打开小K会话失败，请稍后重试。' }, 8_000);
    } finally {
      setActionLoading(null);
    }
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
  const dispatchableTaskCount = detail.dispatchPlan?.dispatchedTasks?.length
    ?? detail.dispatchPlan?.dispatchable?.length
    ?? tasks.filter(t => t.status === 'pending').length;
  const showApprove = project.status === 'created' || project.status === 'draft' || project.status === 'planning';
  const showRetryPlan = canRetryPlanForProject(project, plan, tasks);
  const showInterruptedPlanHint = isInterruptedPlanProject(project, plan, tasks);
  const projectIntervention = detail.projectIntervention;
  const showDispatch = project.status === 'active' && dispatchableTaskCount > 0 && !projectIntervention?.required;
  const showDeliver = project.status === 'active' && tasks.every(t => t.status === 'done' || t.status === 'cancelled');
  const showClose = project.status === 'active' || project.status === 'delivered';
  const statusLabel = STATUS_LABELS[project.status] || project.status;
  const healthSummary = summarizeProjectHealth(detail);
  const showHealthBanner = shouldShowProjectHealth(healthSummary.status) && !projectIntervention?.required;
  const retryBusy = actionLoading === 'retry';
  const retryCoolingDown = retryCooldownUntil > Date.now();
  const retryDisabled = actionLoading !== null || retryCoolingDown;
  const retryButtonLabel = retryBusy ? '正在发起' : retryCoolingDown ? '已发起' : '重新制定计划';

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
          <button
            type="button"
            onClick={handleExport}
            disabled={actionLoading !== null}
            title={t.projectsDetailExport}
            aria-label={t.projectsDetailExport}
            className="shrink-0 rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)] disabled:opacity-50"
          >
            <Download size={14} />
          </button>
          <div className="flex-1" />
          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {showRetryPlan && (
              <button type="button" onClick={handleRetryPlan} disabled={retryDisabled}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-accent)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
                <RefreshCw size={12} className={retryBusy ? 'animate-spin' : ''} /><span>{retryButtonLabel}</span>
              </button>
            )}
            {showApprove && (
              <button type="button" onClick={() => handleAction('approve', () => approveProject(projectId!))}
                disabled={actionLoading !== null}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-status-success-text)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
                <CheckCircle2 size={12} /><span>{actionLoading === 'approve' ? '...' : t.projectsDetailApprove}</span>
              </button>
            )}
            {showDispatch && (
              <button type="button" onClick={() => handleAction('dispatch', () => dispatchTasks(projectId!, project?.poAgent))}
                disabled={actionLoading !== null}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--c-text-primary)] bg-[var(--c-bg-deep)] hover:brightness-[0.95] disabled:opacity-50">
                <Send size={12} /><span>{actionLoading === 'dispatch' ? '...' : t.projectsDetailDispatch}</span>
              </button>
            )}
            {showDeliver && (
              <button type="button" onClick={() => handleAction('deliver', () => deliverProject(projectId!))}
                disabled={actionLoading !== null}
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
                <button type="button" onClick={handleCloseProject} disabled={actionLoading !== null}
                  className="rounded-lg border border-[var(--c-status-error-text)]/30 bg-[var(--c-status-error-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-status-error-text)] hover:bg-[var(--c-status-error-text)]/10 disabled:opacity-60">
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
          <DelayedHoverText
            as="p"
            text={project.goal}
            testId="project-goal-preview"
            wrapperClassName="pl-[38px]"
            className="block text-[12px] text-[var(--c-text-secondary)] line-clamp-2"
          />
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
                <DelayedHoverText
                  text={(project as any).requirements}
                  testId="project-requirements-preview"
                  wrapperClassName="max-w-[400px] align-bottom"
                  className="inline-block max-w-full truncate"
                />
              </div>
            )}
          </div>
        )}

        {actionNotice && (
          <div
            role={actionNotice.kind === 'error' ? 'alert' : 'status'}
            className={`ml-[38px] rounded-lg border px-3 py-2 text-[11px] ${
              actionNotice.kind === 'error'
                ? 'border-[var(--c-status-error-text)]/30 bg-[var(--c-error-bg)] text-[var(--c-status-error-text)]'
                : actionNotice.kind === 'success'
                  ? 'border-[var(--c-status-success-text)]/30 bg-[var(--c-status-success-text)]/10 text-[var(--c-status-success-text)]'
                  : 'border-[var(--c-accent)]/25 bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
            }`}
          >
            {actionNotice.message}
          </div>
        )}

        {projectIntervention?.required && (
          <ProjectInterventionBanner
            intervention={projectIntervention}
            busy={actionLoading === 'continue' || actionLoading === 'ask_xiaok'}
            onContinue={() => handleContinueProject(projectIntervention)}
            onAskXiaok={() => handleAskXiaok(projectIntervention)}
          />
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
            {/* Project Summary — collapsible capsule */}
            {project.summary && (
              <SummaryCollapsible summary={project.summary} score={project.summaryScore} taskScores={project.taskScores} />
            )}
            <DeliverableView project={project} tasks={tasks} />
          </div>
        )}
      </div>
    </div>
  );
}
