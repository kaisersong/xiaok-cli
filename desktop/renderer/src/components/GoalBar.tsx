import { useEffect, useRef, useState } from 'react';
import type { DesktopGoalProjection, DesktopGoalNativeMutationProjection } from '../../../electron/preload-api';
import type { GoalCreationInput, GoalEvidenceKind } from '../../../shared/host-observation-types';
import { useLocale } from '../contexts/LocaleContext';

export interface GoalBarProps {
  goal: DesktopGoalProjection | null;
  loading?: boolean;
  error?: string | null;
  initialEditing?: boolean;
  nativeMutation?: DesktopGoalNativeMutationProjection | null;
  onRecoverNative?: () => void | Promise<void>;
  onContinueNative?: () => void | Promise<void>;
  onCancelNative?: () => void | Promise<void>;
  onCreate: (input: GoalCreationInput) => void | Promise<void>;
  onReplace?: (input: GoalCreationInput) => void | Promise<void>;
  onPause?: () => void | Promise<void>;
  onResume?: (turnLimit?: number) => void | Promise<void>;
  onRecoverPublication?: () => void | Promise<void>;
  onContinuePublication?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}

export function GoalBar({ goal, loading, error, initialEditing = false, onCreate, onReplace, onPause, onResume, onCancel, onRecoverPublication, onContinuePublication, nativeMutation, onRecoverNative, onContinueNative, onCancelNative }: GoalBarProps) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(initialEditing);
  const [replaceMode, setReplaceMode] = useState(false);
  const [objective, setObjective] = useState('');
  const [criterion, setCriterion] = useState('');
  const [definitionText, setDefinitionText] = useState('');
  const [definitionError, setDefinitionError] = useState(false);
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
  const publicationPending = !!state?.pendingCompletionIntentId;
  const budgetBlocked = !publicationPending && state?.status === 'blocked' && state.terminalReason === 'turn_budget_exhausted';
  const [resumeLimit, setResumeLimit] = useState(state ? Math.min(50, state.turnsUsed + 1) : 1);

  const toggleEvidence = (kind: GoalEvidenceKind) => {
    setEvidence(current => current.includes(kind)
      ? (current.length === 1 ? current : current.filter(value => value !== kind))
      : [...current, kind]);
  };
  const submit = async () => {
    const trimmed = objective.trim();
    if (!trimmed || pending.current || loading) return;
    let verificationDefinition: unknown;
    setDefinitionError(false);
    if (definitionText.trim()) {
      try { verificationDefinition = JSON.parse(definitionText); }
      catch { setDefinitionError(true); return; }
    }
    const input: GoalCreationInput = {
      objective: trimmed,
      ...(verificationDefinition === undefined ? {} : { verificationDefinition }),
      ...(criterion.trim() ? { completionCriterion: criterion.trim() } : {}),
      expectedEvidenceKinds: evidence,
      turnLimit,
    };
    pending.current = true; setSubmitting(true); setSubmitFailed(false);
    try { await (replaceMode && onReplace ? onReplace(input) : onCreate(input)); }
    catch { if (mounted.current) setSubmitFailed(true); }
    finally { pending.current = false; if (mounted.current) setSubmitting(false); }
  };

  const nativePending = nativeMutation && !['applied', 'retired', 'stale'].includes(nativeMutation.status);
  if (nativePending) return <div className="goal-panel text-xs" role="status">
    <p className="font-medium">{t.goalBar.nativePending}</p><p>{nativeMutation.objective}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={loading} onClick={() => void onRecoverNative?.()}>{t.goalBar.recoverNative}</button>
      {['reserved', 'enrolled', 'ready'].includes(nativeMutation.status) ? <button type="button" disabled={loading} onClick={() => void onContinueNative?.()}>{t.goalBar.continueNative}</button> : null}
      <button type="button" onClick={() => void onCancelNative?.()}>{t.goalBar.cancelNative}</button>
    </div>{error ? <p role="alert" className="mt-2 text-[var(--c-danger)]">{error}</p> : null}
  </div>;

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
          <label className="grid gap-1"><span>{t.goalBar.verificationDefinition}</span><textarea aria-label={t.goalBar.verificationDefinition} value={definitionText} onChange={event => { setDefinitionText(event.target.value); setDefinitionError(false); }} rows={3} className="rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1.5" /><span className="text-[var(--c-text-muted)]">{t.goalBar.verificationDefinitionHelp}</span></label>
          <fieldset className="flex flex-wrap gap-2"><legend className="mb-1">{t.goalBar.evidence}</legend>{evidenceOptions.map(([kind, label]) => <label key={kind} className="flex items-center gap-1"><input type="checkbox" checked={evidence.includes(kind)} onChange={() => toggleEvidence(kind)} />{label}</label>)}</fieldset>
          <label className="grid gap-1"><span>{t.goalBar.turnBudget}</span><input aria-label={t.goalBar.turnBudget} type="number" min={1} max={50} value={turnLimit} onChange={event => setTurnLimit(Number(event.target.value))} className="w-24 rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1.5" /></label>
        </div>
        <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditing(false)}>{t.goalBar.close}</button><button type="button" disabled={loading || submitting || !objective.trim()} onClick={() => void submit()} className="rounded bg-[var(--c-accent)] px-2 py-1 text-white disabled:opacity-50">{t.goalBar.confirmCreate}</button></div>
        {(submitting || loading) && definitionText.trim() && onCancelNative ? <button type="button" onClick={() => void onCancelNative()}>{t.goalBar.cancelNative}</button> : null}
        {definitionError ? <p role="alert" className="mt-2 text-[var(--c-danger)]">{t.goalBar.verificationDefinitionInvalid}</p> : null}
        {nativeMutation && ['retired', 'stale'].includes(nativeMutation.status) ? <p>{t.goalBar.nativeRetired}</p> : null}
        {error || submitFailed ? <p role="alert" className="mt-2 text-[var(--c-danger)]">{error || t.multiAgent.actionFailed}</p> : null}
      </div>
    );
  }

  const completion = goal.currentCompletion;
  const verificationLabel = completion?.kind === 'unavailable' ? t.goalBar.statusVerificationUnavailable
    : completion?.kind !== 'protected' ? undefined
      : completion.state === 'binding_required' ? t.goalBar.statusBindingRequired
        : completion.state === 'binding_pending' ? t.goalBar.statusBindingPending
          : completion.state === 'binding_mismatch' ? t.goalBar.statusBindingMismatch
            : completion.state === 'needs_revalidation' ? t.goalBar.statusNeedsRevalidation
              : completion.state === 'publication_pending' ? t.goalBar.statusPublicationPending
                : state.status === 'complete' ? t.goalBar.statusVerifiedComplete : undefined;
  const statusLabel = (state.status === 'complete' ? verificationLabel : undefined) ?? (state.status === 'active'
    ? (publicationPending ? t.goalBar.statusPublicationPending : goal.activation !== 'armed' ? t.goalBar.statusDisarmed
      : goal.waitingReason === 'waiting_children' ? t.goalBar.waitingChildren
        : goal.waitingReason === 'children_need_attention' ? t.goalBar.childrenNeedAttention : t.goalBar.statusActive)
    : state.status === 'paused' ? t.goalBar.statusPaused
      : state.status === 'blocked' ? t.goalBar.statusBlocked
        : state.status === 'complete' ? t.goalBar.statusComplete : t.goalBar.statusCancelled);
  return (
    <div className={`goal-panel text-xs${detailsExpanded ? ' is-expanded' : ''}`}>
      <div className="goal-panel__summary" role="status" aria-live="polite" aria-atomic="true">
        <span className="goal-panel__status">{statusLabel}</span>
        {state.status !== 'complete' && verificationLabel ? <span>{verificationLabel}</span> : null}
        <span className="goal-panel__turns">{t.goalBar.turns(state.turnsUsed, state.budgetLimits.turnLimit)}</span>
        {state.status === 'active' && (goal.activation === 'armed' || publicationPending) ? <button type="button" onClick={() => void onPause?.()}>{t.goalBar.pause}</button> : null}
        {!publicationPending && (state.status === 'paused' || (state.status === 'active' && goal.activation === 'disarmed')) ? <button type="button" onClick={() => void onResume?.()}>{t.goalBar.resume}</button> : null}
        {!publicationPending && state.status === 'blocked' && !budgetBlocked ? <button type="button" onClick={() => void onResume?.()}>{t.goalBar.retry}</button> : null}
        {publicationPending ? <button type="button" disabled={loading} onClick={() => void onRecoverPublication?.()}>{t.goalBar.recoverPublication}</button> : null}
        {publicationPending && ['active', 'paused', 'blocked'].includes(state.status) ? <button type="button" disabled={loading} onClick={() => void onContinuePublication?.()}>{t.goalBar.continuePublication}</button> : null}
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
