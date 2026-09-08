import { useEffect, useRef, useState } from 'react';
import type { MultiAgentControlResult, MultiAgentDesktopAPI, MultiAgentManagedResource } from '../../../shared/multi-agent-types';
import { useLocale } from '../contexts/LocaleContext';

interface Props {
  api: MultiAgentDesktopAPI; threadId: string; groupId: string | null; activeGroupId: string | null;
  historical: boolean; ready: boolean; blocked: boolean; resetPending: boolean; deletionPending?: boolean; onChanged(): void;
  executionDenied?: boolean;
}
/** Resource disposition is the sole user mutation permitted on historical groups. */
export function MultiAgentGroupControls(props: Props) {
  const { t } = useLocale(); const labels = t.multiAgent;
  const [resources, setResources] = useState<MultiAgentManagedResource[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: 'reset' } | { kind: 'keep'; resourceId: string } | null>(null);
  const [busy, setBusy] = useState(false); const [pendingReset, setPendingReset] = useState(false);
  const [feedback, setFeedback] = useState<'sent' | 'unknown' | 'actionFailed' | null>(null);
  const [unknown, setUnknown] = useState<{ operationId: string; kind: 'reset' | 'resource' } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; setBusy(false); setPendingReset(false); setResources(null); setConfirmation(null); setUnknown(null); setFeedback(null);
    return () => { generation.current++; };
  }, [props.threadId, props.groupId]);
  const scope = { threadId: props.threadId, groupId: props.groupId! };
  const load = async (nextCursor?: string) => {
    if (!props.groupId) return; const current = generation.current;
    try {
      const page = await props.api.getMultiAgentResources({ ...scope, cursor: nextCursor });
      if (current === generation.current) { setResources(page.items); setCursor(page.nextCursor); }
    } catch { if (current === generation.current) setFeedback('actionFailed'); }
  };
  const apply = (result: MultiAgentControlResult, operationId: string, kind: 'reset' | 'resource') => {
    if (result.state === 'unknown') { setUnknown({ operationId, kind }); setFeedback('unknown'); return; }
    setUnknown(null);
    if (result.outcome === 'rejected' || result.outcome === 'cancelled') { setFeedback('actionFailed'); setPendingReset(false); return; }
    setPendingReset(kind === 'reset' && result.state === 'cleanup_pending');
    setFeedback(kind === 'reset' && result.state === 'cleanup_pending' ? null : 'sent');
    props.onChanged(); if (resources) void load();
  };
  const submit = async (command: { kind: 'reset' } | { kind: 'resource'; resourceId: string; action: 'keep' | 'retryCleanup' }) => {
    if (busy || unknown || !props.ready || props.blocked || !props.groupId) return;
    if (command.kind === 'reset' && (props.deletionPending || props.executionDenied)) return;
    const current = generation.current; const operationId = crypto.randomUUID();
    setBusy(true); setFeedback(null); setConfirmation(null);
    try {
      const result = command.kind === 'reset'
        ? await props.api.resetMultiAgentGroup({ threadId: props.threadId, expectedGroupId: props.activeGroupId, confirmTerminate: true, operationId })
        : await props.api.resolveMultiAgentResource({ ...scope, resourceId: command.resourceId, action: command.action, operationId });
      if (current === generation.current) apply(result, operationId, command.kind);
    } catch {
      if (current === generation.current) { setUnknown({ operationId, kind: command.kind }); setFeedback('unknown'); }
    } finally { if (current === generation.current) setBusy(false); }
  };
  const check = async () => {
    if (!unknown || busy || !props.groupId) return; const current = generation.current;
    setBusy(true);
    try {
      const operation = await props.api.getMultiAgentOperation({ ...scope, operationId: unknown.operationId });
      if (current === generation.current && operation?.applyState === 'applied') apply(operation.result as unknown as MultiAgentControlResult, unknown.operationId, unknown.kind);
    } catch { /* Keep unknown; a failed read never authorizes another mutation. */ }
    finally { if (current === generation.current) setBusy(false); }
  };
  const disabled = busy || Boolean(unknown) || !props.ready || props.blocked || !props.groupId;
  const waiting = props.resetPending || pendingReset;
  return <div className="multi-agent-group-controls">
    <div className="multi-agent-actions">
      <button type="button" disabled={!props.groupId || !props.ready} onClick={() => resources ? setResources(null) : void load()}>{labels.resources}</button>
      <button type="button" disabled={disabled || props.executionDenied || props.historical || waiting || props.deletionPending || props.groupId !== props.activeGroupId} onClick={() => setConfirmation({ kind: 'reset' })}>{labels.newGroup}</button>
    </div>
    {waiting ? <p role="status">{labels.resetPending}</p> : null}
    {resources ? <div className="multi-agent-resources">
      {!resources.length ? <p>{labels.resourcesEmpty}</p> : null}
      {resources.map(resource => <section key={resource.resourceId} className="multi-agent-resource">
        <code>{resource.canonicalPath}</code><p>{labels.resourceStates[resource.state]}</p>
        {resource.lastError ? <p><code>{resource.lastError}</code></p> : null}
        {!['released', 'retained_by_policy'].includes(resource.state) ? <div className="multi-agent-actions">
          <button type="button" disabled={disabled} onClick={() => setConfirmation({ kind: 'keep', resourceId: resource.resourceId })}>{labels.keepResource}</button>
          <button type="button" disabled={disabled || resource.cleanupEligibility === 'manual'} onClick={() => void submit({ kind: 'resource', resourceId: resource.resourceId, action: 'retryCleanup' })}>{labels.retryCleanup}</button>
        </div> : null}
      </section>)}
      {cursor ? <button type="button" onClick={() => void load(cursor)}>{labels.moreResources}</button> : null}
    </div> : null}
    {confirmation ? <div className="multi-agent-confirm" role="group" aria-label={confirmation.kind === 'keep' ? labels.resourceConfirmation : labels.confirmReset}>
      <p>{confirmation.kind === 'keep' ? labels.keepExplanation : labels.resetExplanation}</p>
      <button type="button" disabled={disabled || confirmation.kind === 'reset' && props.executionDenied} onClick={() => void submit(confirmation.kind === 'reset' ? confirmation : { kind: 'resource', resourceId: confirmation.resourceId, action: 'keep' })}>
        {confirmation.kind === 'keep' ? labels.confirmKeep : labels.confirmReset}
      </button><button type="button" onClick={() => setConfirmation(null)}>{labels.cancel}</button>
    </div> : null}
    {feedback ? <p role="status">{labels[feedback]}</p> : null}
    {unknown ? <button type="button" disabled={busy} onClick={() => void check()}>{labels.checkOperation}</button> : null}
  </div>;
}
