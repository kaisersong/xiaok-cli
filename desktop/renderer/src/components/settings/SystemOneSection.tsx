import { useState, useEffect, useCallback } from 'react';
import { Loader2, Brain } from 'lucide-react';
import { api } from '../../api';
import type { DesktopSaveSystemOneConfigInput, DesktopSystemOneConfigSnapshot } from '../../../../electron/preload-api';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, Section, Card, inputCls, btnPrimary, btnSecondary } from './settings-ui';

export function SystemOneSection() {
  const { t } = useLocale();
  const ds = t.desktopSettings;
  const [snapshot, setSnapshot] = useState<DesktopSystemOneConfigSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSnapshot(await api.getSystemOneConfig());
      setError('');
    } catch (e) {
      // 不把 "xxx is not a function" 这类原始 JS 报错渲染给用户；
      // 细节留在 main 进程日志里，界面只给一句可读的失败提示。
      console.error('[SystemOne] load failed', e);
      setError(ds.systemOneLoadFailed);
    }
  }, [ds.systemOneLoadFailed]);

  useEffect(() => { void load(); }, [load]);

  // Jev 只有这一条写入路径：顶层 config.systemOne，永远不进 providers/models。
  const submit = async (patch: DesktopSaveSystemOneConfigInput) => {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      setSnapshot(await api.saveSystemOneConfig(patch));
      setDraft('');
      setSaved(ds.connectorSaved);
    } catch (e) {
      console.error('[SystemOne] save failed', e);
      setError(ds.systemOneLoadFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section>
      <SectionHeader icon={Brain}>{ds.systemOneTitle}</SectionHeader>
      <div className="text-xs text-[var(--c-text-secondary)] mb-3">{ds.systemOneDesc}</div>
      <Card>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{ds.jevKeyName}</span>
          <span className="text-xs text-[var(--c-text-muted)]">
            {snapshot?.configured && snapshot.apiKeyMasked
              ? ds.jevKeyConfigured(snapshot.apiKeyMasked)
              : ds.jevKeyNotConfigured}
          </span>
          {snapshot?.keySource === 'env' && snapshot.keyEnvVar && (
            <span className="text-xs text-[var(--c-text-muted)]">{ds.jevKeyFromEnv(snapshot.keyEnvVar)}</span>
          )}
        </div>
        <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{ds.jevKeyDesc}</div>
        <div className="mt-2 flex flex-col gap-1 text-xs text-[var(--c-text-secondary)]">
          <div>{ds.jevKeySteps}</div>
          <div>{snapshot ? ds.jevKeyEndpointValue(snapshot.baseUrl) : ds.jevKeyEndpoint}</div>
          <div>{snapshot ? ds.jevKeyModelValue(snapshot.model) : ds.jevKeyModel}</div>
          <div>{ds.jevKeyAuth}</div>
          <div className="text-[var(--c-text-muted)]">{ds.jevKeyIsolationNote}</div>
        </div>
        <input
          className={`${inputCls} mt-2`}
          type="password"
          value={draft}
          placeholder={ds.jevApiKeyPlaceholder}
          aria-label="jev-api-key"
          onChange={e => setDraft(e.target.value)}
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || !draft.trim()}
            onClick={() => { void submit({ apiKey: draft.trim() }); }}
          >
            {busy
              ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{ds.connectorSaving}</span>
              : ds.jevSaveBtn}
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={busy || snapshot?.keySource !== 'config'}
            title={snapshot?.keySource === 'env' ? ds.jevClearEnvHint : undefined}
            onClick={() => { void submit({ apiKey: '' }); }}
          >
            {ds.jevClearBtn}
          </button>
          {saved && <span className="text-xs text-green-600">{saved}</span>}
          {error && <span className="text-xs text-red-500 truncate max-w-[280px]">{error}</span>}
        </div>
      </Card>
    </Section>
  );
}
