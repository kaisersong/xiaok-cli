import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';
import type { YzjCliAuthAction, YzjCliAuthState } from '../../../../shared/yzj-cli-auth-ipc-contract';

const busyPhases = new Set(['checking', 'opening', 'waiting', 'cancelling', 'stopPending']);
export function YzjCliAuthCard() {
  const { t, locale } = useLocale(); const labels = t.desktopSettings.yzjCliAuth;
  const [state, setState] = useState<YzjCliAuthState>({ phase: 'idle', revision: 0 });
  const [pending, setPending] = useState(false); const [failedRead, setFailedRead] = useState(false);
  const mounted = useRef(false); const revision = useRef(-1);
  const accept = useCallback((next: YzjCliAuthState) => {
    if (!mounted.current || next.revision < revision.current) return;
    revision.current = next.revision; setState(next); setFailedRead(false);
  }, []);
  const control = useCallback(async (action: YzjCliAuthAction) => {
    const desktop = getDesktopApi();
    if (!desktop?.controlYzjCliAuth) { if (mounted.current) setState({ phase: 'unavailable', revision: 0 }); return; }
    setPending(true); setFailedRead(false);
    try { accept(await desktop.controlYzjCliAuth(action)); }
    catch { if (mounted.current) setFailedRead(true); }
    finally { if (mounted.current) setPending(false); }
  }, [accept]);
  useEffect(() => {
    mounted.current = true; void control('check');
    return () => { mounted.current = false; };
  }, [control]);
  useEffect(() => {
    if (!busyPhases.has(state.phase)) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const desktop = getDesktopApi();
      if (!desktop?.getYzjCliAuthState) return;
      try { const next = await desktop.getYzjCliAuthState(); if (!stopped) accept(next); }
      catch { if (!stopped && mounted.current) setFailedRead(true); }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 1000);
    };
    timer = setTimeout(() => { void poll(); }, 1000);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [state.phase, accept]);
  const busy = busyPhases.has(state.phase);
  const cancellable = state.phase === 'opening' || state.phase === 'waiting' || state.phase === 'checking' || state.phase === 'stopPending';
  const connection = state.phase === 'authenticated' ? state.connection : undefined;
  const displayTime = (value: string | undefined, fallback: string) => value && Number.isFinite(Date.parse(value))
    ? <time dateTime={value}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value))}</time>
    : fallback;
  const details = connection ? [
    [labels.account, connection.name || labels.notProvided],
    [labels.department, connection.department || labels.notProvided],
    [labels.accountId, connection.openId || labels.notProvided],
    [labels.orgId, connection.orgId || labels.notProvided],
    [labels.connectedAt, displayTime(connection.connectedAt, labels.notRecorded)],
    [labels.expiresAt, displayTime(connection.expiresAt, labels.notProvided)],
    [labels.tokenStatus, connection.tokenStatus ? labels.tokenStates[connection.tokenStatus] : labels.notProvided],
    [labels.checkedAt, displayTime(connection.checkedAt, labels.notProvided)],
  ] as const : [];
  const button = 'rounded-md border border-[var(--c-border-subtle)] px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-[var(--c-bg-deep)]';
  return (
    <section className="mb-6 rounded-xl border border-[var(--c-border-subtle)] p-4" aria-label={labels.title}>
      <h3 className="text-sm font-semibold text-[var(--c-text-primary)]">{labels.title}</h3>
      <p className="mt-1 text-xs text-[var(--c-text-secondary)]">{labels.description}</p>
      <div className="mt-3 flex items-center gap-2 text-xs" role="status" aria-live="polite">
        {busy && <Loader2 size={14} className="animate-spin" />}
        <span>{labels[state.phase]}</span>
      </div>
      {connection && (
        <div className="mt-4 border-t border-[var(--c-border-subtle)] pt-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[var(--c-text-secondary)]">{label}</dt>
                <dd className="mt-1 break-words text-[var(--c-text-primary)]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-[var(--c-text-muted)]">{labels.timeNote}</p>
        </div>
      )}
      {failedRead && <p role="alert" className="mt-2 text-xs text-red-500">{labels.transportFailed}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={button} disabled={pending || busy || state.phase === 'unavailable'} onClick={() => { void control('login'); }}>
          <span className="inline-flex items-center gap-1"><ExternalLink size={13} />{labels.login}</span>
        </button>
        <button type="button" className={button} disabled={pending || busy || state.phase === 'unavailable'} onClick={() => { void control('check'); }}>{labels.refresh}</button>
        {cancellable && <button type="button" className={button} disabled={pending} onClick={() => { void control('cancel'); }}>{labels.cancel}</button>}
      </div>
    </section>
  );
}
