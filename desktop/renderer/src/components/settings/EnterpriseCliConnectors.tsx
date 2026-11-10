import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';
import type { EnterpriseCliAction, EnterpriseCliProvider, EnterpriseCliState } from '../../../../shared/enterprise-cli-ipc-contract';
const providerOrder: EnterpriseCliProvider[] = ['dingtalk', 'feishu', 'wecom'];
const busy = new Set(['installing','checking','opening','waiting','cancelling','stopPending']);
export function EnterpriseCliConnectors() {
  const { t, locale } = useLocale(); const labels = t.desktopSettings.enterpriseCli; const common = t.desktopSettings.yzjCliAuth;
  const [states, setStates] = useState<EnterpriseCliState[]>([]); const [pending, setPending] = useState<EnterpriseCliProvider[]>([]); const [failed, setFailed] = useState(false);
  const mounted = useRef(false); const revisions = useRef(new Map<EnterpriseCliProvider, number>());
  const accept = (next: EnterpriseCliState[]) => {
    if (!mounted.current) return;
    const fresh = next.filter(state => state.revision >= (revisions.current.get(state.provider) ?? -1));
    for (const state of fresh) revisions.current.set(state.provider, state.revision);
    setStates(previous => providerOrder.flatMap(provider => { const state = fresh.find(item => item.provider === provider) ?? previous.find(item => item.provider === provider); return state ? [state] : []; }));
  };
  const control = async (provider: EnterpriseCliProvider, action: EnterpriseCliAction) => {
    const api = getDesktopApi(); if (!api?.controlEnterpriseCliConnector) { setFailed(true); return; }
    setPending(previous => [...previous, provider]); setFailed(false);
    try { accept([await api.controlEnterpriseCliConnector(provider, action)]); }
    catch { if (mounted.current) setFailed(true); }
    finally { if (mounted.current) setPending(previous => previous.filter(item => item !== provider)); }
  };
  useEffect(() => {
    mounted.current = true;
    const read = async () => {
      const api = getDesktopApi(); if (!api?.getEnterpriseCliConnectors) { if (mounted.current) setFailed(true); return; }
      try {
        const initial = await api.getEnterpriseCliConnectors(); if (!mounted.current) return; accept(initial);
      } catch { if (mounted.current) setFailed(true); }
    };
    void read(); return () => { mounted.current = false; };
  }, []);
  const polling = states.some(state => busy.has(state.phase));
  useEffect(() => {
    if (!polling) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try { const api = getDesktopApi(); if (api?.getEnterpriseCliConnectors) { const next = await api.getEnterpriseCliConnectors(); if (!stopped) accept(next); } }
      catch { if (!stopped && mounted.current) setFailed(true); }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 1000);
    };
    timer = setTimeout(() => { void poll(); }, 1000);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [polling]);
  const button = 'rounded-md border border-[var(--c-border-subtle)] px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-[var(--c-bg-deep)]';
  const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? <time dateTime={value}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value))}</time> : common.notProvided;
  return <div>
    <p className="mb-4 text-xs text-[var(--c-text-secondary)]">{labels.onDemand}</p>
    {failed && <p role="alert" className="mb-4 text-xs text-red-500">{labels.failedRead}</p>}
    {states.map(state => {
      const provider = labels.providers[state.provider]; const working = busy.has(state.phase); const disabled = pending.includes(state.provider) || working;
      const connection = state.phase === 'connected' ? state.connection : undefined;
      return <section key={state.provider} aria-label={provider.title} className="mb-6 rounded-xl border border-[var(--c-border-subtle)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text-primary)]">{provider.title}</h3>
        <p className="mt-1 text-xs text-[var(--c-text-secondary)]">{provider.description}</p>
        <div role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-xs">
          {working && <Loader2 size={14} className="animate-spin" />}<span>{labels.phases[state.phase]}{state.phase === 'installing' && state.progress !== undefined ? ` ${state.progress}%` : ''}</span>
          {state.version && <span className="text-[var(--c-text-muted)]">{labels.version(state.version)}</span>}
        </div>
        {connection && <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-[var(--c-border-subtle)] pt-4 text-xs sm:grid-cols-2">
          {[
            [common.account, connection.name || connection.openId || common.notProvided],
            [labels.identityType, connection.identityType === 'bot' ? labels.botIdentity : labels.userIdentity],
            [labels.organization, connection.organization || connection.orgId || common.notProvided],
            [common.connectedAt, connection.connectedAt ? date(connection.connectedAt) : common.notRecorded],
            [common.expiresAt, date(connection.expiresAt)],
            [common.tokenStatus, connection.tokenStatus ? common.tokenStates[connection.tokenStatus] : common.notProvided],
            [common.checkedAt, date(connection.checkedAt)],
          ].map(([label,value]) => <div key={String(label)} className="min-w-0"><dt className="text-[var(--c-text-secondary)]">{label}</dt><dd className="mt-1 break-words text-[var(--c-text-primary)]">{value}</dd></div>)}
        </dl>}
        <div className="mt-3 flex flex-wrap gap-2">
          {!state.installed && state.phase !== 'unsupported' && <button type="button" className={button} disabled={disabled} onClick={() => { void control(state.provider, 'install'); }}><span className="inline-flex items-center gap-1"><Download size={13} />{labels.install}</span></button>}
          {state.installed && <>
            <button type="button" className={button} disabled={disabled} onClick={() => { void control(state.provider, state.phase === 'needsSetup' ? 'setup' : 'login'); }}><span className="inline-flex items-center gap-1"><ExternalLink size={13} />{state.phase === 'needsSetup' ? labels.setup : common.login}</span></button>
            <button type="button" className={button} disabled={disabled} onClick={() => { void control(state.provider, 'check'); }}>{common.refresh}</button>
          </>}
          {working && state.phase !== 'cancelling' && <button type="button" className={button} disabled={pending.includes(state.provider)} onClick={() => { void control(state.provider, 'cancel'); }}>{labels.cancel}</button>}
        </div>
      </section>;
    })}
  </div>;
}
