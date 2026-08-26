import { useState } from 'react';
import type { DesktopGoalProjection } from '../../../electron/preload-api';
import type { GoalInput, GoalEvidenceKind } from '../../../../src/runtime/goal/types';
import { useLocale } from '../contexts/LocaleContext';

export interface GoalBarProps {
  goal: DesktopGoalProjection | null;
  loading?: boolean;
  error?: string | null;
  onCreate: (input: GoalInput) => void | Promise<void>;
  onReplace?: (input: GoalInput) => void | Promise<void>;
  onPause?: () => void | Promise<void>;
  onResume?: (turnLimit?: number) => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}

export function GoalBar({ goal, loading, error, onCreate, onReplace, onPause, onResume, onCancel }: GoalBarProps) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [objective, setObjective] = useState('');
  const [criterion, setCriterion] = useState('');
  const [turnLimit, setTurnLimit] = useState(20);
  const [evidence, setEvidence] = useState<GoalEvidenceKind[]>(['answer']);
  const state = goal?.state;
  const budgetBlocked = state?.status === 'blocked' && state.terminalReason === 'turn_budget_exhausted';
  const [resumeLimit, setResumeLimit] = useState(state ? Math.min(50, state.turnsUsed + 1) : 1);

  const toggleEvidence = (kind: GoalEvidenceKind) => {
    setEvidence(current => current.includes(kind)
      ? (current.length === 1 ? current : current.filter(value => value !== kind))
      : [...current, kind]);
  };
  const submit = () => {
    const trimmed = objective.trim();
    if (!trimmed) return;
    const input: GoalInput = {
      objective: trimmed,
      ...(criterion.trim() ? { completionCriterion: criterion.trim() } : {}),
      expectedEvidenceKinds: evidence,
      turnLimit,
    };
    void (replaceMode && onReplace ? onReplace(input) : onCreate(input));
    setEditing(false);
  };

  if (!state || editing) {
    if (!editing) {
      return <div className="border-b border-[var(--c-border)] px-4 py-2"><button type="button" onClick={() => { setReplaceMode(false); setEditing(true); }} className="text-xs font-medium text-[var(--c-accent)]">{t.goalBar.createGoal}</button></div>;
    }
    const evidenceOptions: Array<[GoalEvidenceKind, string]> = [
      ['answer', t.goalBar.evidenceAnswer],
      ['file_artifact', t.goalBar.evidenceFile],
      ['command_action', t.goalBar.evidenceCommand],
      ['project_update', t.goalBar.evidenceProject],
    ];
    return (
      <div className="border-b border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-3 text-xs">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span>{t.goalBar.goal}</span><input aria-label={t.goalBar.goal} value={objective} onChange={event => setObjective(event.target.value)} className="rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1.5" /></label>
          <label className="grid gap-1"><span>{t.goalBar.completionCriterion}</span><input aria-label={t.goalBar.completionCriterion} value={criterion} onChange={event => setCriterion(event.target.value)} className="rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1.5" /></label>
          <fieldset className="flex flex-wrap gap-2"><legend className="mb-1">{t.goalBar.evidence}</legend>{evidenceOptions.map(([kind, label]) => <label key={kind} className="flex items-center gap-1"><input type="checkbox" checked={evidence.includes(kind)} onChange={() => toggleEvidence(kind)} />{label}</label>)}</fieldset>
          <label className="grid gap-1"><span>{t.goalBar.turnBudget}</span><input aria-label={t.goalBar.turnBudget} type="number" min={1} max={50} value={turnLimit} onChange={event => setTurnLimit(Number(event.target.value))} className="w-24 rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1.5" /></label>
        </div>
        <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditing(false)}>{t.goalBar.close}</button><button type="button" disabled={loading || !objective.trim()} onClick={submit} className="rounded bg-[var(--c-accent)] px-2 py-1 text-white disabled:opacity-50">{t.goalBar.confirmCreate}</button></div>
        {error ? <p role="alert" className="mt-2 text-[var(--c-danger)]">{error}</p> : null}
      </div>
    );
  }

  const statusLabel = state.status === 'active'
    ? (goal.activation === 'armed' ? t.goalBar.statusActive : t.goalBar.statusDisarmed)
    : state.status === 'paused' ? t.goalBar.statusPaused
      : state.status === 'blocked' ? t.goalBar.statusBlocked
        : state.status === 'complete' ? t.goalBar.statusComplete : t.goalBar.statusCancelled;
  return (
    <div className="border-b border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-2 text-xs">
      <div className="flex items-center gap-3">
        <span className="rounded bg-[var(--c-bg-deep)] px-2 py-1 font-medium">{statusLabel}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--c-text-heading)]">{state.objective}</span>
        <span>{t.goalBar.turns(state.turnsUsed, state.budgetLimits.turnLimit)}</span>
        <span>{state.tokensUsed > 0 ? t.goalBar.tokens(state.tokensUsed) : t.goalBar.tokensUnknown}</span>
        {state.status === 'active' && goal.activation === 'armed' ? <button type="button" onClick={() => void onPause?.()}>{t.goalBar.pause}</button> : null}
        {(state.status === 'paused' || (state.status === 'active' && goal.activation === 'disarmed')) ? <button type="button" onClick={() => void onResume?.()}>{t.goalBar.resume}</button> : null}
        {state.status === 'blocked' && !budgetBlocked ? <button type="button" onClick={() => void onResume?.()}>{t.goalBar.retry}</button> : null}
        {!['complete', 'cancelled'].includes(state.status) ? <button type="button" onClick={() => void onCancel?.()}>{t.goalBar.cancelGoal}</button> : null}
        <button type="button" onClick={() => { setReplaceMode(!['complete', 'cancelled'].includes(state.status)); setEditing(true); }}>{t.goalBar.replaceGoal}</button>
      </div>
      {budgetBlocked ? <div className="mt-2 flex items-center gap-2"><span>{t.goalBar.budgetExhausted}</span>{state.turnsUsed < 50 ? <><label><span className="sr-only">{t.goalBar.newTurnBudget}</span><input aria-label={t.goalBar.newTurnBudget} type="number" min={state.turnsUsed + 1} max={50} value={resumeLimit} onChange={event => setResumeLimit(Number(event.target.value))} className="w-20 rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1" /></label><button type="button" onClick={() => void onResume?.(resumeLimit)}>{t.goalBar.increaseBudgetAndResume}</button></> : null}</div> : null}
      {error ? <p role="alert" className="mt-2 text-[var(--c-danger)]">{error}</p> : null}
    </div>
  );
}
