import { connectorsErrorMessage } from '../../lib/connectors-error';
import { useState } from 'react';
import { Loader2, Zap } from 'lucide-react';
import { api } from '../../api';
import type { ConnectorsConfig } from '../../api/types';
import type { LocaleStrings } from '../../locales/index';

interface TestButtonProps {
  kind: 'search' | 'fetch';
  config: ConnectorsConfig;
  savedConfig?: ConnectorsConfig;
  canTest: boolean;
}

export function TestButton({ kind, config, savedConfig, canTest, ds }: TestButtonProps & { ds: LocaleStrings['desktopSettings'] }) {
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<{
    config: ConnectorsConfig;
    savedConfig: ConnectorsConfig | undefined;
    result: { success: boolean; latencyMs: number; detail?: string; error?: string };
  } | null>(null);
  // A result belongs to the exact draft and confirmed main snapshot tested.
  // Changing away and back must not revive an old or late provider response.
  const result = canTest && outcome?.config === config && outcome.savedConfig === savedConfig
    ? outcome.result : null;

  const handleTest = async () => {
    if (!canTest || testing) return;
    setTesting(true);
    setOutcome(null);
    try {
      const r = await api.testConnectorProvider(kind);
      setOutcome({ config, savedConfig, result: r });
    } catch (e) {
      setOutcome({ config, savedConfig, result: { success: false, latencyMs: 0, error: connectorsErrorMessage(e, ds) } });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-3">
      <button
        type="button"
        onClick={handleTest}
        disabled={testing || !canTest}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors disabled:opacity-50"
        aria-label={`test-${kind}`}
      >
        {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
        {ds.connectorTestConnection}
      </button>
      {!canTest && <span className="text-xs text-[var(--c-text-secondary)]" role="status">{ds.connectorTestSaveFirst}</span>}
      {result && (
        result.success
          ? <span className="text-xs text-green-600">{result.latencyMs}ms {result.detail ? `· ${result.detail}` : ''}</span>
          : <span className="text-xs text-red-500 truncate max-w-[280px]">{result.error}</span>
      )}
    </div>
  );
}
