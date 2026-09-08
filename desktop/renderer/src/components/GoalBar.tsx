import { useEffect, useRef, useState } from 'react';
import type { DesktopGoalProjection } from '../../../electron/preload-api';
import type { GoalInput, GoalEvidenceKind } from '../../../../src/runtime/goal/types';
import { useLocale } from '../contexts/LocaleContext';

export interface GoalBarProps {
  goal: DesktopGoalProjection | null;
  loading?: boolean;
  error?: string | null;
  initialEditing?: boolean;
  onCreate: (input: GoalInput) => void | Promise<void>;
  onReplace?: (input: GoalInput) => void | Promise<void>;
  onPause?: () => void | Promise<void>;
  onResume?: (turnLimit?: number) => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}

export function GoalBar({ goal, loading, error, initialEditing = false, onCreate, onReplace, onPause, onResume, onCancel }: GoalBarProps) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(initialEditing);
  const [replaceMode, setReplaceMode] = useState(false);
  const [objective, setObjective] = useState('');
  const [criterion, setCriterion] = useState('');
  const [turnLimit, setTurnLimit] = useState(20);
  const [evidence, setEvidence] = useState<GoalEvidenceKind[]>(['answer']);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false), pending = useRef(false), mounted = useRef(true);
  const [submitFailed, setSubmitFailed] = useState(false);
  const goalIdentity = goal ? `${goal.state.goalId}:${goal.state.epoch}` : null;
  const previousGoal = useRef(goalIdentity);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (goalIdentity && goalIdentity !== previousGoal.current) { setEditing(false); setSubmitFailed(false); }
    previousGoal.current = goalIdentity;
  }, [goalIdentity]);
  const state = goal?.state;
  const budgetBlocked = state?.status === 'blocked' && state.terminalReason === 'turn_budget_exhausted';
  const [resumeLimit, setResumeLimit] = useState(state ? Math.min(50, state.turnsUsed + 1) : 1);

  const toggleEvidence = (kind: GoalEvidenceKind) => {
    setEvidence(current => current.includes(kind)
      ? (current.length === 1 ? current : current.filter(value => value !== kind))
      : [...current, kind]);
  };
  const submit = async () => {
    const trimmed = objective.trim();
    if (!trimmed || pending.current || loading) return;
    const input: GoalInput = {
      objective: trimmed,
      ...(criterion.trim() ? { completionCriterion: criterion.trim() } : {}),
      expectedEvidenceKinds: evidence,
      turnLimit,
    };
    pending.current = true; setSubmitting(true); setSubmitFailed(false);
    try { await (replaceMode && onReplace ? onReplace(input) : onCreate(input)); }
    catch { if (mounted.current) setSubmitFailed(true); }
    finally { pending.current = false; if (mounted.current) setSubmitting(false); }
  };

  if (!state || editing) {
    if (!editing) {
      return <div className="goal-panel goal-panel--empty"><button type="button" onClick={() => { setReplaceMode(false); setEditing(true); }} className="text-xs font-medium text-[var(--c-accent)]">{t.goalBar.createGoal}</button></div>;
    }
    const evidenceOptions: Array<[GoalEvidenceKind, string]> = [
      ['answer', t.goalBar.evidenceAnswer],
      ['file_artifact', t.goalBar.evidenceFile],
      ['command_action', t.goalBar.evidenceCommand],
      ['project_update', t.goalBar.evidenceProject],
    ];
    return (
      <div className="goal-panel goal-panel--editing is-expanded text-xs">
        <div className="grid gap-2">
          <label className="grid gap-1"><span>{t.goalBar.goal}</span><input aria-label={t.goalBar.goal} value={objective} onChange={event => setObjective(event.target.value)} className="rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1.5" /></label>
          <label className="grid gap-1"><span>{t.goalBar.completionCriterion}</span><input aria-label={t.goalBar.completionCriterion} value={criterion} onChange={event => setCriterion(event.target.value)} className="rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1.5" /></label>
          <fieldset className="flex flex-wrap gap-2"><legend className="mb-1">{t.goalBar.evidence}</legend>{evidenceOptions.map(([kind, label]) => <label key={kind} className="flex items-center gap-1"><input type="checkbox" checked={evidence.includes(kind)} onChange={() => toggleEvidence(kind)} />{label}</label>)}</fieldset>
          <label className="grid gap-1"><span>{t.goalBar.turnBudget}</span><input aria-label={t.goalBar.turnBudget} type="number" min={1} max={50} value={turnLimit} onChange={event => setTurnLimit(Number(event.target.value))} className="w-24 rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1.5" /></label>
        </div>
        <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditing(false)}>{t.goalBar.close}</button><button type="button" disabled={loading || submitting || !objective.trim()} onClick={() => void submit()} className="rounded bg-[var(--c-accent)] px-2 py-1 text-white disabled:opacity-50">{t.goalBar.confirmCreate}</button></div>
        {error || submitFailed ? <p role="alert" className="mt-2 text-[var(--c-danger)]">{error || t.multiAgent.actionFailed}</p> : null}
      </div>
    );
  }

  const statusLabel = state.status === 'active'
    ? (goal.activation !== 'armed' ? t.goalBar.statusDisarmed
      : goal.waitingReason === 'waiting_children' ? t.goalBar.waitingChildren
        : goal.waitingReason === 'children_need_attention' ? t.goalBar.childrenNeedAttention : t.goalBar.statusActive)
    : state.status === 'paused' ? t.goalBar.statusPaused
      : state.status === 'blocked' ? t.goalBar.statusBlocked
        : state.status === 'complete' ? t.goalBar.statusComplete : t.goalBar.statusCancelled;
  return (
    <div className={`goal-panel text-xs${detailsExpanded ? ' is-expanded' : ''}`}>
      <div className="goal-panel__summary" role="status" aria-live="polite" aria-atomic="true">
        <span className="goal-panel__status">{statusLabel}</span>
        <span className="goal-panel__turns">{t.goalBar.turns(state.turnsUsed, state.budgetLimits.turnLimit)}</span>
        {state.status === 'active' && goal.activation === 'armed' ? <button type="button" onClick={() => void onPause?.()}>{t.goalBar.pause}</button> : null}
        {(state.status === 'paused' || (state.status === 'active' && goal.activation === 'disarmed')) ? <button type="button" onClick={() => void onResume?.()}>{t.goalBar.resume}</button> : null}
        {state.status === 'blocked' && !budgetBlocked ? <button type="button" onClick={() => void onResume?.()}>{t.goalBar.retry}</button> : null}
        <button
          type="button"
          className="goal-panel__details-toggle"
          aria-expanded={detailsExpanded}
          onClick={() => setDetailsExpanded(value => !value)}
        >
          {detailsExpanded ? t.goalBar.hideDetails : t.goalBar.showDetails}
        </button>
      </div>
      <div className="goal-panel__details">
        <p className="goal-panel__objective">{state.objective}</p>
        <p className="goal-panel__tokens">{state.tokensUsed > 0 ? t.goalBar.tokens(state.tokensUsed) : t.goalBar.tokensUnknown}</p>
        <div className="goal-panel__actions">
          {!['complete', 'cancelled'].includes(state.status) ? <button type="button" onClick={() => void onCancel?.()}>{t.goalBar.cancelGoal}</button> : null}
          <button type="button" onClick={() => { setReplaceMode(!['complete', 'cancelled'].includes(state.status)); setEditing(true); }}>{t.goalBar.replaceGoal}</button>
        </div>
        {budgetBlocked ? <div className="mt-2 flex flex-wrap items-center gap-2"><span>{t.goalBar.budgetExhausted}</span>{state.turnsUsed < 50 ? <><label><span className="sr-only">{t.goalBar.newTurnBudget}</span><input aria-label={t.goalBar.newTurnBudget} type="number" min={state.turnsUsed + 1} max={50} value={resumeLimit} onChange={event => setResumeLimit(Number(event.target.value))} className="w-20 rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1" /></label><button type="button" onClick={() => void onResume?.(resumeLimit)}>{t.goalBar.increaseBudgetAndResume}</button></> : null}</div> : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-[var(--c-danger)]">{error}</p> : null}
    </div>
  );
}
