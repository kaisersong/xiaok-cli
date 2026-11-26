import type { ConnectorsConfig, ConnectorsFetchProvider, ConnectorsSearchProvider, ConnectorsProviderRuntime } from '../../api/types';
import type { LocaleStrings } from '../../locales/index';

// ---- Tools Settings (web search / fetch connectors) ----

export const SEARCH_PROVIDERS: Array<{
  key: ConnectorsSearchProvider;
  label: string;
  descKey: 'searchDuckduckgoDesc' | 'searchFirecrawlDesc' | 'searchTavilyDesc' | 'searchBraveDesc' | 'searchDeepseekDesc';
  notImplemented?: boolean;
}> = [
  { key: 'duckduckgo', label: 'DuckDuckGo', descKey: 'searchDuckduckgoDesc' },
  { key: 'firecrawl', label: 'Firecrawl', descKey: 'searchFirecrawlDesc' },
  { key: 'tavily', label: 'Tavily', descKey: 'searchTavilyDesc' },
  { key: 'brave', label: 'Brave Search', descKey: 'searchBraveDesc' },
  { key: 'deepseek', label: 'DeepSeek', descKey: 'searchDeepseekDesc' },
];

export const FETCH_PROVIDERS: Array<{
  key: ConnectorsFetchProvider;
  label: string;
  descKey: 'fetchBasicDesc' | 'fetchJinaDesc' | 'fetchFirecrawlDesc' | 'fetchDeepseekDesc';
  notImplemented?: boolean;
}> = [
  { key: 'basic', label: 'Basic', descKey: 'fetchBasicDesc' },
  { key: 'jina', label: 'Jina Reader', descKey: 'fetchJinaDesc' },
  { key: 'firecrawl', label: 'Firecrawl', descKey: 'fetchFirecrawlDesc' },
  { key: 'deepseek', label: 'DeepSeek', descKey: 'fetchDeepseekDesc' },
];

function runtimeStateLabel(state: ConnectorsProviderRuntime['runtime_state'], ds: LocaleStrings['desktopSettings']): { text: string; tone: 'ok' | 'warn' | 'err' | 'mute' } {
  switch (state) {
    case 'ready': return { text: ds.connectorStatusReady, tone: 'ok' };
    case 'inactive': return { text: ds.connectorStatusInactive, tone: 'mute' };
    case 'missing_config': return { text: ds.connectorStatusMissingConfig, tone: 'warn' };
    case 'invalid_config': return { text: ds.connectorStatusInvalidConfig, tone: 'err' };
    case 'not_implemented': return { text: ds.connectorStatusNotImplemented, tone: 'mute' };
    case 'decrypt_failed': return { text: ds.connectorStatusDecryptFailed, tone: 'err' };
    default: return { text: state, tone: 'mute' };
  }
}

export function RuntimeBadge({ runtime, ds }: { runtime?: ConnectorsProviderRuntime; ds: LocaleStrings['desktopSettings'] }) {
  if (!runtime) return null;
  const { text, tone } = runtimeStateLabel(runtime.runtime_state, ds);
  const toneCls =
    tone === 'ok' ? 'bg-green-50 text-green-600' :
    tone === 'warn' ? 'bg-yellow-50 text-yellow-600' :
    tone === 'err' ? 'bg-red-50 text-red-600' :
    'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${toneCls}`} title={runtime.runtime_reason || ''}>
      {text}
    </span>
  );
}

// 零配置摘要：只反映已确认快照（台账 #55 语义），不反映未保存草稿。
export function providerSummary(kind: 'search' | 'fetch', config: ConnectorsConfig, ds: LocaleStrings['desktopSettings']): { label: string; note: string } {
  if (kind === 'search') {
    const provider = config.search.provider;
    const label = SEARCH_PROVIDERS.find(p => p.key === provider)?.label ?? provider;
    if (provider === 'duckduckgo') return { label, note: ds.toolsSummaryNoConfig };
    if (provider === 'deepseek') return { label, note: ds.toolsSummaryKeyFromModel };
    if (provider === 'firecrawl') return { label, note: config.search.firecrawlApiKey ? ds.toolsSummaryKeyConfigured : ds.toolsSummaryKeyRecommended };
    const key = provider === 'tavily' ? config.search.tavilyApiKey : config.search.braveApiKey;
    return { label, note: key ? ds.toolsSummaryKeyConfigured : ds.toolsSummaryKeyRequired };
  }
  const provider = config.fetch.provider;
  const label = FETCH_PROVIDERS.find(p => p.key === provider)?.label ?? provider;
  if (provider === 'basic') return { label, note: ds.toolsSummaryNoConfig };
  if (provider === 'jina') return { label, note: ds.toolsSummaryFreeNoKey };
  if (provider === 'firecrawl') return { label, note: config.fetch.firecrawlApiKey ? ds.toolsSummaryKeyConfigured : ds.toolsSummaryKeyRecommended };
  return { label, note: ds.toolsSummaryKeyFromModel };
}
