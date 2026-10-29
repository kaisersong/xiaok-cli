import { useEffect, useState } from 'react';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';

export function HarnessOptimizationSettingsStatus() {
  const { t } = useLocale();
  const labels = t.desktopSettings;
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'error'>('loading');
  useEffect(() => {
    let live = true;
    const api = getDesktopApi();
    if (!api?.getHarnessOptimizationConfig) { setStatus('unavailable'); return; }
    void api.getHarnessOptimizationConfig().then(value => {
      if (live) setStatus(value.publicStatus === 'unavailable' ? 'unavailable' : 'error');
    }, () => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, []);
  const text = status === 'loading' ? labels.chatCompactLoading
    : status === 'error' ? labels.harnessOptimizationReadError : labels.harnessOptimizationUnavailable;
  return <section className="rounded-xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-menu)] p-4">
    <h3 className="text-sm font-medium text-[var(--c-text-heading)]">{labels.harnessOptimizationTitle}</h3>
    <p className="mt-1 text-xs text-[var(--c-text-muted)]" role={status === 'error' ? 'alert' : 'status'}>{text}</p>
  </section>;
}
