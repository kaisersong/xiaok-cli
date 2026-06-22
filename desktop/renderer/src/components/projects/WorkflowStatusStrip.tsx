import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Workflow, X } from 'lucide-react';
import type { KSwarmWorkflowProposal, KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';
import { useLocale } from '../../contexts/LocaleContext';
import type { LocaleStrings } from '../../locales';
import {
  getStatusIcon,
  getToneClass,
  labelNodeStatus,
  formatWorkflowProgress,
  readString,
  readNumber,
  getPatternPublicView,
  buildGenericWorkflowView,
  getNodeOutput,
  buildWorkflowLabels,
  type WorkflowLabels,
} from './workflowUtils';

interface WorkflowStatusStripProps {
  workflowRun?: KSwarmWorkflowRun | null;
  busy: boolean;
  onStartDiagnose: () => void;
  onStartAgentWorkflow?: () => void;
  workflowProposal?: KSwarmWorkflowProposal | null;
  onConfirmWorkflowProposal?: () => void;
  onDismissWorkflowProposal?: () => void;
  onCancelWorkflowRun?: () => void;
  disabledReason?: string | null;
  compact?: boolean;
}

export function WorkflowStatusStrip({
  workflowRun,
  busy,
  onStartDiagnose,
  onStartAgentWorkflow,
  workflowProposal,
  onConfirmWorkflowProposal,
  onDismissWorkflowProposal,
  onCancelWorkflowRun,
  disabledReason,
  compact: compactMode = false,
}: WorkflowStatusStripProps) {
  const { t } = useLocale();
  const wfLabels = useMemo(() => buildWorkflowLabels(t), [t]);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const status = workflowRun?.status || 'idle';
  const isBuiltinDiagnose = workflowRun?.workflowId === 'project-diagnose' && workflowRun.source === 'builtin';
  const isCompletedScriptWorkflowAwaitingDelivery = Boolean(workflowRun && isScriptWorkflowAwaitingDelivery(workflowRun));
  const displayStatus = isCompletedScriptWorkflowAwaitingDelivery ? 'blocked' : status;
  const patternPublicView = getPatternPublicView(workflowRun, wfLabels);
  const workflowDisplayName = workflowRun ? getWorkflowDisplayName(workflowRun, t) : '';
  const diagnoseStatusLabels: Record<string, string> = {
    awaiting_approval: t.projectsDiagnoseStatusAwaitingApproval,
    running: t.projectsDiagnoseStatusRunning,
    blocked: t.projectsDiagnoseStatusBlocked,
    completed: t.projectsDiagnoseStatusCompleted,
    failed: t.projectsDiagnoseStatusFailed,
    cancelled: t.projectsDiagnoseStatusCancelled,
  };
  const label = workflowRun
    ? patternPublicView
      ? patternPublicView.patternLabel
      : isBuiltinDiagnose
      ? (diagnoseStatusLabels[status] || status)
      : workflowDisplayName
    : t.projectsWorkflowIdle;
  const summary = workflowRun?.summary;
  const action = workflowRun?.diagnosis?.recommendedActions?.[0];
  const completed = summary?.completed ?? 0;
  const total = summary?.total ?? 0;
  const progressText = workflowRun
    ? patternPublicView
      ? formatPublicWorkflowProgress(patternPublicView)
      : isBuiltinDiagnose
      ? t.projectsWorkflowProgressCompleted(`${completed}/${total}`)
      : isCompletedScriptWorkflowAwaitingDelivery
        ? t.projectsWorkflowCompletedAwaitingDelivery
        : (summary?.primaryMessage || formatWorkflowProgress(status, completed, total, wfLabels))
    : t.projectsWorkflowIdleHint;
  const effectiveProgressText = disabledReason || progressText;
  const sourceText = workflowRun
    ? patternPublicView
      ? t.projectsWorkflowKswarmView
      : isBuiltinDiagnose
      ? t.projectsWorkflowBuiltinSource
      : t.projectsWorkflowExecSource
    : t.projectsWorkflowNoAgentSource;
  const diagnosis = isBuiltinDiagnose && workflowRun ? buildSystemDiagnosisView(workflowRun, wfLabels, t) : null;
  const genericWorkflow = workflowRun && !diagnosis ? buildGenericWorkflowView(workflowRun, wfLabels) : null;
  const compact = diagnosis ? buildCompactDiagnosisSummary(diagnosis, t) : null;
  const StatusIcon = getStatusIcon(displayStatus);
  const toneClass = getToneClass(displayStatus);
  const dialogLabel = diagnosis ? t.projectsWorkflowDiagnosisDialog : getWorkflowDialogLabel(workflowRun, t);
  const handleStartDiagnose = () => {
    setMenuOpen(false);
    onStartDiagnose();
  };
  const handleStartAgentWorkflow = () => {
    setMenuOpen(false);
    onStartAgentWorkflow?.();
  };
  const showCancelRun = workflowRun && ['running', 'blocked', 'awaiting_approval'].includes(workflowRun.status) && onCancelWorkflowRun;

  useEffect(() => {
    if (!open && !menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, menuOpen]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => {
          if (!workflowRun) return;
          setMenuOpen(false);
          setOpen(value => !value);
        }}
        aria-expanded={open}
        disabled={!workflowRun}
        className={compactMode
          ? 'inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] text-[var(--c-text-muted)] hover:text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:cursor-default'
          : `inline-flex min-w-0 max-w-[420px] items-center gap-1.5 rounded-md border px-2 py-1 text-left disabled:cursor-default ${toneClass}`}
      >
        <span className={`inline-flex min-w-0 items-center gap-1 ${compactMode ? 'font-normal' : 'font-semibold'}`}>
          <StatusIcon size={compactMode ? 11 : 13} className={status === 'running' ? 'animate-spin' : ''} />
          <span className="truncate">{label}</span>
        </span>
        {compactMode ? (
          (disabledReason || progressText) ? (
            <>
              <span className="text-[var(--c-text-muted)]">·</span>
              <span className="truncate text-[var(--c-text-muted)]">{disabledReason || progressText}</span>
            </>
          ) : null
        ) : (compact ? (
          <>
            <span className="text-[var(--c-text-muted)]">·</span>
            <span className="truncate text-[var(--c-text-secondary)]">{compact.health}</span>
            <span className="text-[var(--c-text-muted)]">·</span>
            <span className="shrink-0 text-[var(--c-text-secondary)]">{compact.taskCount}</span>
            <span className="text-[var(--c-text-muted)]">·</span>
            <span className="shrink-0 text-[var(--c-text-secondary)]">{compact.blocker}</span>
          </>
        ) : (
          <span className="truncate text-[var(--c-text-muted)]">{effectiveProgressText}</span>
        ))}
      </button>

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setMenuOpen(value => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={t.projectsWorkflowRunAriaLabel}
        disabled={busy || Boolean(disabledReason)}
        title={disabledReason || undefined}
        className="inline-flex items-center gap-1 rounded-md bg-[var(--c-bg-page)] px-2 py-1 font-medium text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Workflow size={12} />
        <span>{busy ? t.projectsWorkflowRunningBtn : disabledReason ? t.projectsWorkflowUnavailableBtn : t.projectsWorkflowRunBtn}</span>
        <ChevronDown size={12} />
      </button>

      {menuOpen && !busy && (
        <div
          role="menu"
          aria-label={t.projectsWorkflowMenuAriaLabel}
          className="absolute right-0 top-full z-50 mt-2 w-[min(320px,calc(100vw-48px))] rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-1.5 text-[var(--c-text-secondary)] shadow-xl"
        >
          <WorkflowMenuItem
            title={t.projectsWorkflowQuickDiagnose}
            description={t.projectsWorkflowQuickDiagnoseDesc}
            onClick={handleStartDiagnose}
          />
          {onStartAgentWorkflow && (
            <WorkflowMenuItem
              title={t.projectsWorkflowAgentReview}
              description={t.projectsWorkflowAgentReviewDesc}
              onClick={handleStartAgentWorkflow}
            />
          )}
        </div>
      )}

      {workflowRun && open && (
        <div
          role="dialog"
          aria-label={dialogLabel}
          className="fixed z-[9999] max-h-[min(72vh,640px)] w-[min(560px,calc(100vw-48px))] min-w-[320px] overflow-y-auto rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-3 text-[var(--c-text-secondary)] shadow-xl"
          style={{ top: (rootRef.current?.getBoundingClientRect().bottom ?? 40) + 8, right: 24 }}
        >
          <div className="flex flex-wrap items-start gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold">
              <StatusIcon size={13} className={status === 'running' ? 'animate-spin' : ''} />
              <span className="truncate">{label}</span>
            </span>
            <span className="text-[var(--c-text-muted)]">{progressText}</span>
            <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-muted)]">
              {sourceText}
            </span>
            {genericWorkflow && (
              <>
                <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-secondary)]">
                  {t.projectsWorkflowExecLabel}
                </span>
                {genericWorkflow.agentText && (
                  <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-secondary)]">
                    {t.projectsWorkflowAgentLabel}{genericWorkflow.agentText}
                  </span>
                )}
              </>
            )}
            {action && (
              <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-secondary)]">
                {action.label}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={`${t.projectsWorkflowCloseDialogPrefix}${dialogLabel}`}
              className="ml-auto rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-page)] hover:text-[var(--c-text-primary)]"
            >
              <X size={12} />
            </button>
          </div>

          {diagnosis && <SystemDiagnosisDetails diagnosis={diagnosis} />}
          {genericWorkflow && <GenericWorkflowDetails workflow={genericWorkflow} />}
          {showCancelRun && (
            <div className="mt-2 flex justify-end border-t border-current/10 pt-2">
              <button
                type="button"
                onClick={onCancelWorkflowRun}
                className="rounded-md border border-[var(--c-status-error-text)]/35 px-2 py-1 text-[10px] font-medium text-[var(--c-status-error-text)] hover:bg-[var(--c-error-bg)]"
              >
                {t.projectsWorkflowCancelRun}
              </button>
            </div>
          )}
        </div>
      )}

      {workflowProposal && (
        <div
          role="dialog"
          aria-label={t.projectsWorkflowConfirmTitle}
          className={`absolute ${compactMode ? 'right-0' : 'left-0'} top-full z-50 mt-2 w-[min(620px,calc(100vw-48px))] rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-3 text-[var(--c-text-secondary)] shadow-xl`}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[var(--c-text-primary)]">{workflowProposal.title}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--c-text-muted)]">
                {t.projectsWorkflowGoalLabel}{workflowProposal.goal || workflowProposal.description || workflowProposal.title}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismissWorkflowProposal}
              aria-label={`${t.projectsWorkflowCloseDialogPrefix}${t.projectsWorkflowConfirmTitle}`}
              className="ml-auto rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-page)] hover:text-[var(--c-text-primary)]"
            >
              <X size={12} />
            </button>
          </div>

          <WorkflowProposalDetails proposal={workflowProposal} />

          <div className="mt-3 flex justify-end gap-2 border-t border-current/10 pt-2">
            <button
              type="button"
              onClick={onDismissWorkflowProposal}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--c-text-muted)] hover:bg-[var(--c-bg-page)]"
            >
              {t.projectsWorkflowConfirmCancel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmWorkflowProposal}
              className="rounded-md bg-[var(--c-text-primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--c-bg-card)] disabled:opacity-60"
            >
              {t.projectsWorkflowConfirmRun}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowProposalDetails({ proposal }: { proposal: KSwarmWorkflowProposal }) {
  const { t } = useLocale();
  return (
    <div className="mt-2 space-y-2 border-t border-current/10 pt-2 text-[10px] text-[var(--c-text-secondary)]">
      {proposal.sourceTask && (
        <p className="leading-relaxed"><span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowTaskLabel}</span>{proposal.sourceTask.title || proposal.sourceTask.id}</p>
      )}
      {proposal.source === 'po_generated' && (
        <p className="leading-relaxed text-[var(--c-text-muted)]">{t.projectsWorkflowPoGenHint}</p>
      )}
      <p className="leading-relaxed"><span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowAcceptanceLabel}</span>{proposal.acceptanceRubric.title}</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {proposal.acceptanceRubric.machineChecks.map((check) => (
          <span key={check.id} className="rounded bg-[var(--c-bg-page)] px-2 py-1">{t.projectsWorkflowMachineCheck}{check.title}</span>
        ))}
        {proposal.acceptanceRubric.judgmentChecks.map((check) => (
          <span key={check.id} className="rounded bg-[var(--c-bg-page)] px-2 py-1">{t.projectsWorkflowReviewerCheck}{check.title}</span>
        ))}
      </div>
      {proposal.assumptions && proposal.assumptions.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowAssumptions}</p>
          {proposal.assumptions.map((item) => (
            <p key={item} className="leading-relaxed text-[var(--c-text-muted)]">{item}</p>
          ))}
        </div>
      )}
      {proposal.phases.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowPhases}</p>
          {proposal.phases.map((phase) => (
            <p key={phase.id} className="leading-relaxed">
              <span className="text-[var(--c-text-primary)]">{phase.title}</span>
              <span className="text-[var(--c-text-muted)]"> · {t.projectsWorkflowPhaseNodes(phase.nodes.length)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowMenuItem({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full flex-col rounded-md px-2.5 py-2 text-left hover:bg-[var(--c-bg-page)]"
    >
      <span className="text-[12px] font-semibold text-[var(--c-text-primary)]">{title}</span>
      <span className="mt-0.5 text-[10px] leading-relaxed text-[var(--c-text-muted)]">{description}</span>
    </button>
  );
}

function SystemDiagnosisDetails({ diagnosis }: { diagnosis: ReturnType<typeof buildSystemDiagnosisView> }) {
  const { t } = useLocale();
  return (
    <div className="mt-2 border-t border-current/10 pt-2 text-[10px] text-[var(--c-text-secondary)]">
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        <DiagnosisMetric label={t.projectsWorkflowDiagProjectStatus} value={diagnosis.projectStatus} />
        <DiagnosisMetric label={t.projectsWorkflowDiagHealthState} value={diagnosis.healthState} />
        <DiagnosisMetric label={t.projectsWorkflowDiagTasks} value={String(diagnosis.taskCount)} />
        <DiagnosisMetric label={t.projectsWorkflowDiagBlocked} value={String(diagnosis.blockedCount)} />
        <DiagnosisMetric label={t.projectsWorkflowDiagWaiting} value={String(diagnosis.waitingCount)} />
        <DiagnosisMetric label={t.projectsWorkflowDiagDispatchable} value={String(diagnosis.dispatchableCount)} />
      </div>
      {diagnosis.gate && (
        <p className="mt-2 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowDiagGate}</span>{diagnosis.gate}
        </p>
      )}
      {diagnosis.actionLabel && (
        <p className="mt-2 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowDiagSuggestion}</span>{diagnosis.actionLabel}
          {diagnosis.actionReason && <span className="text-[var(--c-text-muted)]"> · {diagnosis.actionReason}</span>}
        </p>
      )}
      {diagnosis.blockedTasks.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowDiagBlockedTasks}</p>
          {diagnosis.blockedTasks.map((task) => (
            <p key={`${task.taskId}-${task.message}`} className="leading-relaxed">
              <span className="font-mono text-[var(--c-text-primary)]">{task.taskId || 'unknown'}</span>
              <span className="text-[var(--c-text-muted)]"> · {task.message || t.projectsWorkflowDiagTaskBlocked}</span>
            </p>
          ))}
        </div>
      )}
      {diagnosis.evidence.length > 0 && (
        <p className="mt-2 leading-relaxed text-[var(--c-text-muted)]">
          {t.projectsWorkflowDiagEvidence}{diagnosis.evidence.join(' / ')}
        </p>
      )}
    </div>
  );
}

function GenericWorkflowDetails({ workflow }: { workflow: ReturnType<typeof buildGenericWorkflowView> }) {
  const { t } = useLocale();
  return (
    <div className="mt-2 border-t border-current/10 pt-2 text-[10px] text-[var(--c-text-secondary)]">
      {workflow.publicView && (
        <div className="mb-2 space-y-1 rounded-md border border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] px-2 py-1.5">
          <p className="leading-relaxed">
            <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowStrategyLabel}</span>{workflow.publicView.patternLabel}
          </p>
          {workflow.publicView.reasonLabel && (
            <p className="leading-relaxed">
              <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowReasonLabel}</span>{workflow.publicView.reasonLabel}
            </p>
          )}
          <p className="leading-relaxed">
            <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowPublicProgress}</span>{workflow.publicView.progress}%
          </p>
          {workflow.publicView.currentPhase && (
            <p className="leading-relaxed">
              <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowCurrentPhase}</span>{workflow.publicView.currentPhase}
            </p>
          )}
          {workflow.publicView.recoveryLabel && (
            <p className="leading-relaxed">
              <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowRecoverySuggestion}</span>{workflow.publicView.recoveryLabel}
            </p>
          )}
        </div>
      )}
      {workflow.scopeText && (
        <p className="leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{workflow.scopeText}</span>
        </p>
      )}
      {workflow.cacheText && (
        <p className="mt-1 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{workflow.cacheText}</span>
        </p>
      )}
      {workflow.recoveryText && (
        <p className="mt-1 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowRecoveryLabel}</span>{workflow.recoveryText}
        </p>
      )}
      {workflow.progressText && (
        <p className="mt-1 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowLatestProgress}</span>{workflow.progressText}
        </p>
      )}
      {workflow.checkpointText && (
        <p className="mt-1 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowScriptCheckpoint}</span>{workflow.checkpointText}
        </p>
      )}
      {workflow.parallelGroups.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="font-medium text-[var(--c-text-primary)]">{t.projectsWorkflowParallelOrch}</p>
          {workflow.parallelGroups.map((group) => (
            <div
              key={group.id}
              className="rounded-md border border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] px-2 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium text-[var(--c-text-primary)]">{group.label}</span>
                <span className="shrink-0 text-[var(--c-text-muted)]">{group.status}</span>
                <span className="ml-auto shrink-0 text-[var(--c-text-secondary)]">{group.progress}</span>
              </div>
              <p className="mt-1 leading-relaxed text-[var(--c-text-muted)]">
                {t.projectsWorkflowPolicy}{group.failurePolicy}
                {group.branchText ? ` · ${t.projectsWorkflowBranch}${group.branchText}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
      {workflow.blockingFailures.length > 0 && (
        <div className="mt-1 space-y-1">
          <p className="font-medium text-[var(--c-status-error-text)]">{t.projectsWorkflowBlockingFailures}</p>
          {workflow.blockingFailures.map((failure) => (
            <p key={`${failure.nodeId}-${failure.reason}`} className="leading-relaxed text-[var(--c-status-error-text)]">
              {failure.title || failure.nodeId} · {failure.reason || failure.status}
            </p>
          ))}
        </div>
      )}
      {workflow.gateText && (
        <p className="leading-relaxed text-[var(--c-text-primary)]">
          {workflow.gateText}
        </p>
      )}
      <div className="mt-2 space-y-1.5">
        {workflow.nodes.map((node) => (
          <div
            key={node.id}
            className="rounded-md border border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] px-2 py-1.5"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium text-[var(--c-text-primary)]">{node.title}</span>
              <span className="shrink-0 text-[var(--c-text-muted)]">{node.status}</span>
              {node.agent && (
                <span className="ml-auto shrink-0 rounded bg-[var(--c-bg-card)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--c-text-secondary)]">
                  {node.agent}
                </span>
              )}
            </div>
            {node.summary && (
              <p className="mt-1 leading-relaxed text-[var(--c-text-secondary)]">{node.summary}</p>
            )}
            {node.reviewText && (
              <p className="mt-1 leading-relaxed text-[var(--c-text-muted)]">{node.reviewText}</p>
            )}
            {node.branchText && (
              <p className="mt-1 leading-relaxed text-[var(--c-text-muted)]">{node.branchText}</p>
            )}
            {node.error && (
              <p className="mt-1 leading-relaxed text-[var(--c-status-error-text)]">{node.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosisMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="text-[var(--c-text-muted)]">{label}</span>
      <span className="truncate font-medium text-[var(--c-text-primary)]">{value}</span>
    </span>
  );
}



function buildCompactDiagnosisSummary(diagnosis: ReturnType<typeof buildSystemDiagnosisView>, t: LocaleStrings) {
  return {
    health: diagnosis.healthState,
    taskCount: t.projectsWorkflowDiagCompactTasks(diagnosis.taskCount),
    blocker: diagnosis.blockedCount > 0 ? t.projectsWorkflowDiagBlockerCount(diagnosis.blockedCount) : t.projectsWorkflowDiagNoBlocker,
  };
}

function buildSystemDiagnosisView(workflowRun: KSwarmWorkflowRun, wfLabels: WorkflowLabels, t: LocaleStrings) {
  const diagnosis = workflowRun.diagnosis;
  const collectOutput = getNodeOutput(workflowRun, 'collect-project-state');
  const projectStatus = labelProjectStatus(readString(collectOutput.projectStatus), t);
  const healthState = labelHealthState(readString(diagnosis?.healthState ?? collectOutput.healthState), t);
  const taskCount = readNumber(collectOutput.taskCount, 0);
  const blockedTasks = diagnosis?.blockedTasks ?? [];
  const action = diagnosis?.recommendedActions?.[0];

  return {
    projectStatus,
    healthState,
    taskCount,
    blockedCount: blockedTasks.length,
    waitingCount: diagnosis?.waitingCount ?? 0,
    dispatchableCount: diagnosis?.dispatchableCount ?? 0,
    gate: readString(diagnosis?.gate),
    actionLabel: action?.label || workflowRun.summary.primaryMessage || '',
    actionReason: action?.reason || '',
    blockedTasks,
    evidence: workflowRun.nodes.map((node) => `${node.title}${node.status === 'completed' ? ' \u2713' : ` ${labelNodeStatus(node.status, wfLabels)}`}`),
  };
}




function getWorkflowDisplayName(workflowRun: KSwarmWorkflowRun, t: LocaleStrings) {
  if (workflowRun.workflowId === 'agent-review-smoke') return t.projectsWorkflowAgentReviewName;
  if (workflowRun.workflowId === 'po-generated-task-workflow') return t.projectsWorkflowPoTaskName;
  const statusLabels: Record<string, string> = {
    awaiting_approval: t.projectsWorkflowStatusAwaitingApproval,
    running: t.projectsWorkflowStatusRunning,
    blocked: t.projectsWorkflowStatusBlocked,
    completed: t.projectsWorkflowStatusCompleted,
    failed: t.projectsWorkflowStatusFailed,
    cancelled: t.projectsWorkflowStatusCancelled,
  };
  return workflowRun.title || statusLabels[workflowRun.status] || workflowRun.status;
}


function formatPublicWorkflowProgress(publicView: NonNullable<ReturnType<typeof getPatternPublicView>>) {
  const progress = `${publicView.progress}%`;
  const reasonLabel = readString(publicView.reasonLabel);
  return reasonLabel ? `${reasonLabel} · ${progress}` : progress;
}


function isScriptWorkflowAwaitingDelivery(workflowRun: KSwarmWorkflowRun) {
  if (workflowRun.source !== 'script_generated') return false;
  if (workflowRun.status !== 'completed') return false;
  if (workflowRun.scope?.taskId) return false;
  const delivery = (workflowRun as KSwarmWorkflowRun & { projectDelivery?: { status?: string } | null }).projectDelivery;
  return delivery?.status !== 'delivered';
}

function getWorkflowDialogLabel(workflowRun: KSwarmWorkflowRun | null | undefined, t: LocaleStrings) {
  if (!workflowRun) return t.projectsWorkflowDialogDefault;
  if (workflowRun.workflowId === 'agent-review-smoke') return t.projectsWorkflowDialogAgentReview;
  return t.projectsWorkflowDialogDefault;
}

function labelProjectStatus(status: string, t: LocaleStrings): string {
  const labels: Record<string, string> = {
    active: t.projectsLabelStatusActive,
    created: t.projectsLabelStatusCreated,
    draft: t.projectsLabelStatusDraft,
    planning: t.projectsLabelStatusPlanning,
    review: t.projectsLabelStatusReview,
    delivered: t.projectsLabelStatusDelivered,
    closed: t.projectsLabelStatusClosed,
  };
  return labels[status] || status || t.projectsLabelStatusUnknown;
}

function labelHealthState(state: string, t: LocaleStrings): string {
  const labels: Record<string, string> = {
    idle: t.projectsHealthIdle,
    healthy: t.projectsHealthHealthy,
    running: t.projectsHealthRunning,
    dispatchable: t.projectsHealthDispatchable,
    waiting: t.projectsHealthWaiting,
    needs_review: t.projectsHealthNeedsReview,
    blocked: t.projectsHealthBlocked,
    failed: t.projectsHealthFailed,
    complete: t.projectsHealthComplete,
    closed: t.projectsHealthClosed,
    unknown: t.projectsHealthUnknown,
  };
  return labels[state] || state || t.projectsHealthUnknown;
}
