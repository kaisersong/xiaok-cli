import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/bridge';
import type { DecisionModelView } from '../../api/types';
import { useLocale } from '../../contexts/LocaleContext';
import { LocalDecisionModels, type DecisionModelOperation, decisionModelTrustKey } from './LocalDecisionModels';
import { secondaryButtonSmCls, secondaryButtonBorderStyle } from '../buttonStyles';

export function DecisionModelSettings() {
  const { t } = useLocale(); const labels = t.localDecisionModels;
  const [models, setModels] = useState<DecisionModelView[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<'action' | 'changed' | null>(null), [saved, setSaved] = useState(false);
  const latest = useRef<DecisionModelView[]>([]), version = useRef(0), epoch = useRef(0), live = useRef(false);
  const operation = useRef<object | null>(null), interrupts = useRef(new Map<string, object>());

  async function refresh() {
    const current = ++version.current, generation = epoch.current;
    let next: DecisionModelView[];
    try { next = await api.decisionModelsList(); }
    catch (error) { if (live.current && generation === epoch.current && current === version.current) throw error; return; }
    if (live.current && generation === epoch.current && current === version.current) {
      latest.current = next; setModels(next); setLoading(false);
    }
  }
  useEffect(() => {
    live.current = true; const generation = ++epoch.current;
    let stop = () => {};
    try {
      stop = api.onDecisionModelsChanged(next => {
        if (!live.current || generation !== epoch.current) return;
        ++version.current; latest.current = next; setModels(next); setLoading(false);
      });
    } catch { setError('action'); }
    void refresh().catch(() => { if (live.current && generation === epoch.current) { setError('action'); setLoading(false); } });
    return () => { live.current = false; ++epoch.current; ++version.current; stop(); operation.current = null; interrupts.current.clear(); };
  }, []);

  async function run(kind: DecisionModelOperation, id: string, trust?: string) {
    if (!live.current) return;
    const model = latest.current.find(value => value.id === id), interrupt = kind === 'cancel' || kind === 'stop';
    if (!model || trust !== undefined && decisionModelTrustKey(model) !== trust) { setError('changed'); return; }
    if (kind === 'start' && (!model.verified || !model.supported || !['installed', 'failed', 'interrupted'].includes(model.state))
      || kind === 'use' && model.state !== 'ready'
      || kind === 'download' && (!model.supported || model.verified || ['downloading', 'checking', 'loading'].includes(model.state))
      || kind === 'cancel' && !['downloading', 'checking'].includes(model.state)
      || kind === 'stop' && !['loading', 'ready'].includes(model.state)
      || kind === 'remove' && ['not_installed', 'downloading', 'checking', 'loading'].includes(model.state)) { setError('changed'); return; }
    const key = kind + ':' + id;
    if (interrupt ? interrupts.current.has(key) : operation.current !== null) return;
    const token = {}, generation = epoch.current;
    if (interrupt) interrupts.current.set(key, token); else { operation.current = token; setBusy(true); }
    setError(null); setSaved(false);
    try {
      switch (kind) {
        case 'download': await api.decisionModelsDownload(id); break;
        case 'cancel': await api.decisionModelsCancel(id); break;
        case 'remove': await api.decisionModelsRemove(id); break;
        case 'start': await api.decisionModelsStart({ modelId: id, approveCommunityCode: true }); break;
        case 'stop': await api.decisionModelsStop(id); break;
        case 'use': await api.decisionModelsUse(id); if (live.current && generation === epoch.current) setSaved(true); break;
      }
      if (live.current && generation === epoch.current) await refresh();
    } catch { if (live.current && generation === epoch.current) setError('action'); }
    finally {
      if (interrupt) { if (interrupts.current.get(key) === token) interrupts.current.delete(key); }
      else if (operation.current === token) { operation.current = null; if (live.current && generation === epoch.current) setBusy(false); }
    }
  }
  return <section className="flex flex-col gap-3 rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-menu)] p-4">
    <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-[var(--c-text-heading)]">{labels.title}</h4>
      <button type="button" className={secondaryButtonSmCls} style={secondaryButtonBorderStyle} disabled={busy} onClick={() => { setError(null); void refresh().catch(() => { if (live.current) setError('action'); }); }}>{labels.refresh}</button></div>
    <p className="text-xs text-[var(--c-text-secondary)]">{labels.manualOnly}</p>
    {loading ? <p role="status" className="text-xs">{labels.loading}</p> : models.length === 0 && !error ? <p className="text-xs">{labels.empty}</p> : null}
    {error && <p role="alert" className="text-xs text-[var(--c-status-error)]">{error === 'changed' ? labels.changed : labels.actionError}</p>}
    {saved && <p role="status" className="text-xs text-[var(--c-text-secondary)]">{labels.saved}</p>}
    <LocalDecisionModels models={models} busy={busy} onAction={run} />
  </section>;
}
