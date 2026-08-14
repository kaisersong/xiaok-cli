import { useEffect, useState } from 'react';
import { ArrowRight, RotateCw, Sparkles, Users } from 'lucide-react';

import { useLocale } from '../../contexts/LocaleContext';

export type ProjectTeamPlanOutcome = 'proposal' | 'no_change' | 'needs_manual_scope';
export type ProjectTeamPlanAction = 'keep' | 'reuse' | 'create';

export interface ProjectTeamPlanItemView {
  desiredAgentId: string;
  action: ProjectTeamPlanAction;
  role: string;
  agentName?: string;
  capabilityLabels: string[];
  reasonCode: string;
}

export interface ProjectTeamPlanView {
  planId: string;
  projectId: string;
  projectRevision: number;
  outcome: ProjectTeamPlanOutcome;
  summary: string;
  items: ProjectTeamPlanItemView[];
}

export interface ProjectTeamOperationView {
  operationId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

export interface ProjectSmartTeamClient {
  planProjectTeam(input: { projectId: string }): Promise<ProjectTeamPlanView>;
  applyProjectTeamPlan(input: { projectId: string; planId: string; projectRevision: number }): Promise<ProjectTeamOperationView>;
  getProjectTeamOperation?(input: { projectId: string }): Promise<ProjectTeamOperationView | null>;
}

export interface ProjectSmartTeamPanelProps {
  projectId: string;
  client: ProjectSmartTeamClient;
  onOpenManual: () => void;
}

export function ProjectSmartTeamPanel({ projectId, client, onOpenManual }: ProjectSmartTeamPanelProps) {
  const { t } = useLocale();
  const [plan, setPlan] = useState<ProjectTeamPlanView | null>(null);
  const [operation, setOperation] = useState<ProjectTeamOperationView | null>(null);
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client.getProjectTeamOperation) return;
    let active = true;
    client.getProjectTeamOperation({ projectId })
      .then(snapshot => {
        if (active && snapshot) setOperation(snapshot);
      })
      .catch(() => {
        if (active) setError(t.projectSmartTeam.restoreFailed);
      });
    return () => {
      active = false;
    };
  }, [client, projectId, t.projectSmartTeam.restoreFailed]);

  const handlePlan = async () => {
    setBusy('plan');
    setError(null);
    try {
      const nextPlan = await client.planProjectTeam({ projectId });
      setPlan(nextPlan);
      setOperation(null);
    } catch {
      setError(t.projectSmartTeam.planFailed);
    } finally {
      setBusy(null);
    }
  };

  const handleApply = async () => {
    if (!plan || plan.outcome !== 'proposal') return;
    setBusy('apply');
    setError(null);
    try {
      const nextOperation = await client.applyProjectTeamPlan({
        projectId,
        planId: plan.planId,
        projectRevision: plan.projectRevision,
      });
      setOperation(nextOperation);
    } catch {
      setError(t.projectSmartTeam.applyFailed);
    } finally {
      setBusy(null);
    }
  };

  const actionLabel = (action: ProjectTeamPlanAction) => {
    if (action === 'create') return t.projectSmartTeam.actionCreate;
    if (action === 'reuse') return t.projectSmartTeam.actionReuse;
    return t.projectSmartTeam.actionKeep;
  };

  const reasonLabel = (reasonCode: string) => {
    if (reasonCode === 'existing_capability_match') return t.projectSmartTeam.reasonExistingMatch;
    if (reasonCode === 'capability_gap') return t.projectSmartTeam.reasonCapabilityGap;
    return t.projectSmartTeam.reasonPolicyDecision;
  };

  const operationStatusLabel = (status: ProjectTeamOperationView['status']) => {
    if (status === 'pending') return t.projectSmartTeam.operationPending;
    if (status === 'running') return t.projectSmartTeam.operationRunning;
    if (status === 'completed') return t.projectSmartTeam.operationCompleted;
    return t.projectSmartTeam.operationFailed;
  };

  const planSummary = plan?.outcome === 'no_change'
    ? t.projectSmartTeam.summaryNoChange
    : plan?.outcome === 'needs_manual_scope'
      ? t.projectSmartTeam.summaryManualScope
      : t.projectSmartTeam.summaryAnalyzed(plan?.items.length ?? 0);

  return (
    <section className="rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4" aria-labelledby="project-smart-team-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--c-accent)]/10 text-[var(--c-accent)]"><Users size={16} /></span>
          <div>
            <h3 id="project-smart-team-title" className="text-sm font-semibold text-[var(--c-text-primary)]">{t.projectSmartTeam.title}</h3>
            <p className="mt-1 text-xs text-[var(--c-text-secondary)]">{t.projectSmartTeam.description}</p>
          </div>
        </div>
        <button type="button" disabled={busy !== null || operation?.status === 'running'} onClick={handlePlan} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
          {busy === 'plan' ? <RotateCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {busy === 'plan' ? t.projectSmartTeam.planning : t.projectSmartTeam.planAction}
        </button>
      </div>

      {error && <p role="alert" className="mt-3 rounded-md bg-[var(--c-status-error-bg)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">{error}</p>}

      {plan && (
        <div className="mt-4 border-t border-[var(--c-border-subtle)] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-[var(--c-text-primary)]">{t.projectSmartTeam.proposalTitle}</h4>
            <span className="text-[10px] text-[var(--c-text-tertiary)]">{t.projectSmartTeam.projectRevision(plan.projectRevision)}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--c-text-secondary)]">{planSummary}</p>
          {plan.items.length > 0 && (
            <div className="mt-3 space-y-2">
              {plan.items.map(item => (
                <div key={item.desiredAgentId} className="flex items-start gap-3 rounded-lg bg-[var(--c-bg-deep)] px-3 py-2.5">
                  <span className="mt-0.5 rounded bg-[var(--c-bg-card)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--c-text-primary)]">{actionLabel(item.action)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-[var(--c-text-primary)]">{item.agentName || item.desiredAgentId}</span>
                      <span className="text-[10px] text-[var(--c-text-tertiary)]">{item.role}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--c-text-secondary)]">{reasonLabel(item.reasonCode)}</p>
                    {item.capabilityLabels.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {item.capabilityLabels.map(capability => <span key={capability} className="rounded-full border border-[var(--c-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--c-text-tertiary)]">{capability}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {plan.outcome === 'proposal' && !operation && (
            <div className="mt-4 flex justify-end">
              <button type="button" disabled={busy !== null} onClick={handleApply} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
                {busy === 'apply' ? <RotateCw size={13} className="animate-spin" /> : <ArrowRight size={13} />}
                {busy === 'apply' ? t.projectSmartTeam.applying : t.projectSmartTeam.applyAction}
              </button>
            </div>
          )}
        </div>
      )}

      {operation && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg bg-[var(--c-bg-deep)] px-3 py-2.5">
          <div>
            <p className="text-xs font-medium text-[var(--c-text-primary)]">{operation.message || t.projectSmartTeam.operationDefaultMessage}</p>
            <p className="mt-1 text-[10px] text-[var(--c-text-tertiary)]">{t.projectSmartTeam.operationId(operation.operationId)}</p>
          </div>
          <span className="shrink-0 rounded bg-[var(--c-bg-card)] px-2 py-1 text-[10px] text-[var(--c-text-secondary)]">{operationStatusLabel(operation.status)}</span>
        </div>
      )}

      <div className="mt-4 border-t border-[var(--c-border-subtle)] pt-3">
        <button type="button" onClick={onOpenManual} className="text-xs text-[var(--c-text-secondary)] hover:text-[var(--c-accent)] hover:underline">
          {t.projectSmartTeam.manualAction}
        </button>
      </div>
    </section>
  );
}
