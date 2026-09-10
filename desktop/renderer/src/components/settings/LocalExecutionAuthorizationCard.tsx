import { useLayoutEffect, useRef, useState } from 'react';
import type { ExecutionAuthorizationRetry } from '../../../../shared/multi-agent-types';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';
import { useLocalExecutionAuthorization } from '../../hooks/useLocalExecutionAuthorization';

export function LocalExecutionAuthorizationCard() {
  const { t } = useLocale(), labels = t.multiAgent.authorization, api = getDesktopApi();
  const state = useLocalExecutionAuthorization(api ?? undefined), auth = state.authorization;
  const scope = state.connection;
  const latest = useRef({ scope, bootId: auth?.bootId });
  useLayoutEffect(() => { latest.current = { scope, bootId: auth?.bootId }; }, [scope, auth?.bootId]);
  const [confirmation, setConfirmation] = useState<{ scope: typeof scope; bootId: string; revision: number; desired: boolean }>();
  const [operation, setOperation] = useState<{ scope: typeof scope; bootId: string; request: ExecutionAuthorizationRetry; busy: boolean; unknown: boolean }>();
  const [failure, setFailure] = useState<{ scope: typeof scope; bootId?: string }>();
  const failed = !!failure && failure.scope === scope && failure.bootId === auth?.bootId;
  const setFailed = (show: boolean) => setFailure(show ? { scope, bootId: auth?.bootId } : undefined);
  const current = operation && operation.scope === scope && operation.bootId === auth?.bootId ? operation : undefined;
  const confirm = confirmation && confirmation.scope === scope && confirmation.bootId === auth?.bootId && confirmation.revision === auth?.permissionRevision ? confirmation : undefined;
  const busy = !!current?.busy;
  const uncertain = auth?.persistenceState === 'unknown' || current?.unknown;
  const buttonClass = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-40';
  const submit = async (request: ExecutionAuthorizationRetry) => {
    if (!api || !auth || busy) return;
    const bootId = auth.bootId, next = { scope, bootId, request, busy: true, unknown: false };
    setOperation(next); setConfirmation(undefined); setFailed(false);
    const valid = () => latest.current.scope === scope && latest.current.bootId === bootId;
    try {
      const receipt = await api.setLocalExecutionAuthorization(request);
      if (!valid()) return;
      setOperation({ ...next, busy: false, unknown: receipt.state === 'unknown' });
      if (receipt.outcome === 'rejected') setFailed(true);
      await scope?.refresh();
    } catch { if (valid()) { setOperation({ ...next, busy: false, unknown: true }); setFailed(true); } }
  };
  const query = async () => {
    if (!api || !scope || busy) return;
    const bootId = auth?.bootId;
    const id = auth?.pendingOperation?.operationId ?? current?.request.operationId;
    try {
      const result = id ? await api.getLocalExecutionAuthorizationOperation({ operationId: id }) : undefined;
      if (latest.current.scope !== scope || latest.current.bootId !== bootId) return;
      if (result?.kind === 'receipt' && result.receipt.state === 'applied') setOperation(undefined);
      await scope.refresh();
      if (latest.current.scope === scope && latest.current.bootId === bootId) setFailed(false);
    } catch { if (latest.current.scope === scope && latest.current.bootId === bootId) setFailed(true); }
  };
  return <section role="region" aria-label={labels.title} className="mb-6 space-y-3 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
    <h3 className="font-medium">{labels.title}</h3>
    <p className="text-sm">{labels.scope}</p>
    <div className="space-y-1 text-xs text-[var(--c-text-secondary)]">
      <p>{labels.workspaceLabel}</p>
      <p className="break-all">{state.workspace.state === 'ready' ? state.workspace.cwd : state.workspace.state === 'error' ? labels.pathUnavailable : t.loading}</p>
    </div>
    <p className="text-sm">{labels.warning}</p>
    <p role="status">{state.phase === 'loading' ? t.loading : state.phase === 'error' ? labels.unavailable : uncertain ? labels.unknown : auth?.executionAllowed ? labels.allowed : labels.denied}</p>
    {failed && <p role="alert">{labels.operationUnknown}</p>}
    <div className="flex flex-wrap gap-2">
      {uncertain ? <>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void query()}>{labels.query}</button>
        {auth?.persistenceState === 'unknown' && auth.pendingOperation && <button type="button" className={buttonClass} disabled={busy || state.phase !== 'live'} onClick={() => void submit(auth.pendingOperation!)}>{labels.restore}</button>}
      </> : auth && state.phase === 'live' && <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirmation({ scope, bootId: auth.bootId, revision: auth.permissionRevision, desired: !auth.executionAllowed })}>{auth.executionAllowed ? labels.pause : labels.grant}</button>}
      {state.phase === 'error' && !uncertain && <button type="button" className={buttonClass} onClick={() => void query()}>{labels.query}</button>}
      {confirm && !uncertain && auth && <>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void submit({ operationId: `exec-auth:${auth.bootId}:${auth.permissionRevision}:${crypto.randomUUID()}`, expectedPermissionRevision: auth.permissionRevision, executionAllowed: confirm.desired, confirm: true })}>{confirm.desired ? labels.confirmGrant : labels.confirmPause}</button>
        <button type="button" className={buttonClass} onClick={() => setConfirmation(undefined)}>{t.multiAgent.cancel}</button>
      </>}
    </div>
  </section>;
}
