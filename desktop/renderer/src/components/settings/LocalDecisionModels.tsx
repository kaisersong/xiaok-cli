import { useRef, useState } from 'react';
import type { DecisionModelView } from '../../api/types';
import { useLocale } from '../../contexts/LocaleContext';
import { Modal } from '../shared/Modal';
import { secondaryButtonSmCls, secondaryButtonBorderStyle } from '../buttonStyles';
export type DecisionModelOperation = 'download' | 'cancel' | 'remove' | 'start' | 'stop' | 'use';
export function decisionModelTrustKey(model: DecisionModelView): string {
  return JSON.stringify([model.id, model.source, model.revision, model.codeHash, model.runtime, model.runtimeSource, model.runtimeVersion]);
}
interface Props { models: DecisionModelView[]; busy: boolean; onAction(kind: DecisionModelOperation, id: string, trust?: string): Promise<void> }
export function LocalDecisionModels({ models, busy, onAction }: Props) {
  const { t } = useLocale(); const labels = t.localDecisionModels;
  const [pending, setPending] = useState<{ kind: 'start' | 'remove'; model: DecisionModelView; trust: string } | null>(null);
  const [details, setDetails] = useState<string | null>(null); const confirming = useRef(false);
  const name = (model: DecisionModelView) => model.id === 'clef-flash-mlx-4bit' ? labels.clef : model.id === 'laya-multilingual' ? labels.laya : model.id;
  function confirm() {
    if (!pending || confirming.current) return;
    const chosen = pending; confirming.current = true; setPending(null);
    void onAction(chosen.kind, chosen.model.id, chosen.trust).finally(() => { confirming.current = false; });
  }
  const button = (label: string, disabled: boolean, action: () => void) => <button type="button" className={secondaryButtonSmCls} style={secondaryButtonBorderStyle} disabled={disabled} onClick={action}>{label}</button>;
  return <>
    {models.map(model => {
      const transferring = ['downloading', 'checking'].includes(model.state), loading = model.state === 'loading';
      const open = (kind: 'start' | 'remove') => setPending({ kind, model, trust: decisionModelTrustKey(model) });
      return <article key={model.id} className="flex flex-col gap-2 rounded-lg border border-[var(--c-border-subtle)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{name(model)}</span>
          <span className="text-xs text-[var(--c-text-secondary)]">{labels.state[model.state]}{model.selected ? ' · ' + labels.selected : ''}</span></div>
        <p className="text-xs text-[var(--c-text-muted)]">{model.sizeLabel} · {model.supported ? labels.supported : labels.unsupported}</p>
        {model.reason && <p className="text-xs text-[var(--c-status-warning-text)]">{labels.reason(model.reason)}</p>}
        {transferring && <><progress aria-label={labels.progressLabel(name(model))} max={Math.max(1, model.sizeBytes)} value={Math.max(0, Math.min(model.downloadedBytes, model.sizeBytes))} className="w-full" />
          <p className="text-xs">{labels.progress(Math.min(100, Math.max(0, Math.round(model.downloadedBytes / Math.max(1, model.sizeBytes) * 100))), model.currentFile ?? '')}</p></>}
        <div className="flex flex-wrap gap-2">
          {transferring ? button(labels.cancel, false, () => void onAction('cancel', model.id)) : !model.verified ? button(['failed', 'interrupted'].includes(model.state) ? labels.retry : labels.download, busy || loading || !model.supported, () => void onAction('download', model.id)) : button(labels.start, busy || loading || !model.supported || model.state === 'ready', () => open('start'))}
          {['loading', 'ready'].includes(model.state) && button(labels.stop, false, () => void onAction('stop', model.id))}
          {button(labels.use, busy || model.state !== 'ready' || model.selected, () => void onAction('use', model.id))}
          {button(labels.remove, busy || loading || transferring || model.state === 'not_installed', () => open('remove'))}
          {button(labels.details, false, () => setDetails(details === model.id ? null : model.id))}
        </div>
        {details === model.id && <div className="flex flex-col gap-1 break-all text-xs text-[var(--c-text-muted)]">
          <p>{labels.source}: {model.source}</p><p>{labels.revision}: {model.revision}</p><p>{labels.codeHash}: {model.codeHash ?? labels.notProvided}</p>
          <p>{labels.runtime}: {[model.runtime, model.runtimeInfo?.engine, model.runtimeInfo?.device, model.runtimeInfo?.parameterPrecision, model.runtimeInfo?.quantization].filter(Boolean).join(' · ')}</p>
          {model.runtimeInfo && <p>{Object.entries(model.runtimeInfo.versions).map(([key, value]) => key + ' ' + value).join(' · ')}</p>}
        </div>}
      </article>;
    })}
    <Modal open={pending !== null} onClose={() => setPending(null)} title={pending?.kind === 'remove' ? labels.confirmRemove : labels.confirmStart}>
      {pending && <div className="flex flex-col gap-3 p-5 text-sm">
        <p>{pending.kind === 'remove' ? labels.removeNotice : labels.codeNotice}</p>
        <dl className="break-all text-xs"><dt>{labels.source}</dt><dd>{pending.model.source}</dd><dt>{labels.revision}</dt><dd>{pending.model.revision}</dd>
          <dt>{labels.codeHash}</dt><dd>{pending.model.codeHash ?? labels.notProvided}</dd><dt>{labels.runtime}</dt><dd>{pending.model.runtimeSource ?? pending.model.runtime} · {pending.model.runtimeVersion ?? pending.model.revision}</dd></dl>
        <div className="flex justify-end gap-2">{button(labels.dismiss, false, () => setPending(null))}{button(pending.kind === 'remove' ? labels.confirmRemove : labels.confirmStart, busy, confirm)}</div>
      </div>}
    </Modal>
  </>;
}
