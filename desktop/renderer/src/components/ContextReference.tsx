import { useEffect, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { parseContextLink, type ContextReferencePage } from '../../../shared/context-continuity-types';
import { ContextMcpAccess } from './ContextMcpAccess';

export function contextLinksInText(text: string): string[] {
  return [...new Set(text.split(/\s+/u).filter(value => parseContextLink(value)))].slice(0, 10);
}
export function CopyContextReferenceButton({ conversationId, sourceMessage }: { conversationId: string; sourceMessage?: { sourceId: string; sourceMessageId: string } }) {
  const { t } = useLocale(); const labels = t.contextContinuity;
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'error'>('idle');
  const active = useRef(true), busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const copy = async () => {
    if (busy.current) return; busy.current = true; setState('busy');
    try {
      const api = getDesktopApi(); if (!api?.createContextReference) throw new Error('unavailable');
      const c = await api.getContextConversation({ conversationId }); if (!c) throw new Error('unclaimed');
      const ref = await api.createContextReference({ conversationId, expectedRevision: c.revision, operationId: crypto.randomUUID(), ...(sourceMessage ? { sourceMessage } : {}) });
      await navigator.clipboard.writeText(ref.url); if (active.current) setState('copied');
    } catch { if (active.current) setState('error'); } finally { busy.current = false; }
  };
  if (!getDesktopApi()?.createContextReference) return null;
  return <span className="inline-flex items-center gap-1"><button type="button" onClick={() => void copy()} disabled={state === 'busy'}
    title={sourceMessage ? labels.copyMessage : labels.copyConversation} aria-label={sourceMessage ? labels.copyMessage : labels.copyConversation}
    className="rounded p-1.5 text-[var(--c-text-tertiary)] hover:bg-[var(--c-bg-hover)] focus-visible:outline-2"><Link2 size={14} /></button>
    <span role="status" className="text-xs text-[var(--c-text-secondary)]">{state === 'copied' ? labels.copied : state === 'error' ? labels.copyFailed : ''}</span></span>;
}
export function ContextReferenceCard({ url, targetConversationId }: { url: string; targetConversationId?: string }) {
  const { t } = useLocale(); const l = t.contextContinuity; const refId = parseContextLink(url);
  const [page, setPage] = useState<ContextReferencePage | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false), [grantId, setGrantId] = useState<string | null>(null);
  const generation = useRef(0), inFlight = useRef(false), authQuery = useRef(0);
  const [auth, setAuth] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [grantBasis,setGrantBasis]=useState<'explicit'|'history_search'>('explicit');
  const loadGrant = async () => {
    if (!targetConversationId) { setAuth('ready'); return; }
    const gen = generation.current, query = ++authQuery.current;
    setAuth('checking');
    try {
      const api = getDesktopApi(); if (!refId || !api?.getContextGrant) throw new Error('unavailable');
      const grant = await api.getContextGrant({ refId, targetConversationId });
      if (gen === generation.current && query === authQuery.current) { setGrantId(grant?.grantId ?? null);setGrantBasis(grant?.basis??'explicit');setAuth('ready'); }
    } catch { if (gen === generation.current && query === authQuery.current) setAuth('failed'); }
  };
  useEffect(() => {
    generation.current++; inFlight.current = false; setBusy(false); setPage(null); setError(false); setGrantId(null); void loadGrant();
    const refresh = () => { void loadGrant(); };
    window.addEventListener('xiaok:context-grants-changed', refresh);
    return () => { generation.current++; authQuery.current++; window.removeEventListener('xiaok:context-grants-changed', refresh); };
  }, [url, targetConversationId]);
  if (!refId || !getDesktopApi()?.resolveContextReference) return null;
  const act = async (action: 'read' | 'attach' | 'revoke') => {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(false); const gen = generation.current;
    try {
      const api = getDesktopApi()!;
      if (action === 'read') {
        const next = await api.resolveContextReference({ refId, ...(page?.nextCursor ? { cursor: page.nextCursor } : {}) });
        if (gen === generation.current) setPage(previous => ({ ...next, messages: [...(previous?.messages ?? []), ...next.messages] }));
      } else if (action === 'attach') {
        if (!targetConversationId) throw new Error('unavailable');
        const grant = await api.attachContextReference({ refId, targetConversationId, operationId: crypto.randomUUID() });
        if (gen === generation.current){setGrantId(grant.grantId);setGrantBasis('explicit');}
      } else if (grantId) { await api.revokeContextGrant({ grantId }); if (gen === generation.current) setGrantId(null); }
    } catch { if (gen === generation.current) { setError(true); if (action === 'read') setPage(null); } }
    finally { if (gen === generation.current) { inFlight.current = false; setBusy(false); if (action !== 'read') window.dispatchEvent(new Event('xiaok:context-grants-changed')); } }
  };
  return <aside className="my-2 max-w-[663px] rounded-lg border border-[var(--c-border)] p-3 text-sm text-[var(--c-text-secondary)]" aria-label={l.reference}>
    <div className="flex flex-wrap items-center gap-3"><span>{l.reference}</span>
      {(!page || page.nextCursor) && <button type="button" disabled={busy} onClick={() => void act('read')}>{page ? l.more : l.expand}</button>}
      {targetConversationId && <button type="button" disabled={busy || auth === 'checking'} onClick={() => { if (auth === 'failed') void loadGrant(); else void act(grantId ? 'revoke' : 'attach'); }}>{auth === 'failed' ? t.retryConnection : grantId ? l.revoke : l.attach}</button>}</div>
    {grantId&&grantBasis==='history_search'&&auth==='ready'&&<button type="button" disabled={busy} title={t.historySearch.keepNotice} onClick={()=>void act('attach')}>{t.historySearch.keepGrant}</button>}
    {error && <p role="alert">{l.unavailable}</p>}
    {page && <><p className="my-2 text-xs">{l.snapshot(page.snapshotRevision)}</p>{page.messages.map((message, index) => <div key={`${message.messageId}:${index}`} className="my-2 whitespace-pre-wrap break-words">
      {message.visibilityBasis === 'user_claimed_archive' ? <p className="text-xs">{l.archiveUnknown}</p> : message.executionState !== 'settled' && <p className="text-xs">{l.effectUnsettled}</p>}<p>{message.text}</p>
      {message.sourceKind==='cli_session'&&message.visibilityBasis==='user_claimed_archive'
        ? targetConversationId&&<a className="text-xs underline" href={`#/context/${refId}`}>{l.openSource}</a>
        : <a className="text-xs underline" href={`#/t/${encodeURIComponent(page.conversationId)}?sourceTask=${encodeURIComponent(message.sourceId)}&sourceMessage=${encodeURIComponent(message.sourceMessageId)}`}>{l.openSource}</a>}
    </div>)}</>}
    {targetConversationId&&<ContextMcpAccess refId={refId} targetConversationId={targetConversationId} allowed={!!grantId&&auth==='ready'} />}
  </aside>;
}
