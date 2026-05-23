import { describe, expect, it } from 'vitest';
import {
  cloneDefaultConnectorsConfig,
  evaluateProviderRuntimes,
  normalizeConnectorsConfig,
  resolveCliConnectorsConfig,
} from '../../../../src/ai/tools/connectors/config.js';

describe('connectors config', () => {
  it('falls back to defaults for unknown input', () => {
    expect(normalizeConnectorsConfig(null)).toEqual(cloneDefaultConnectorsConfig());
    expect(normalizeConnectorsConfig({ search: { provider: 'bogus' } } as unknown).search.provider).toBe('duckduckgo');
  });

  it('preserves known provider names and trims string fields', () => {
    const cfg = normalizeConnectorsConfig({
      search: { provider: 'tavily', tavilyApiKey: '  tvly-x  ', braveApiKey: '' },
      fetch: { provider: 'jina', jinaApiKey: 'jina-x' },
    });
    expect(cfg.search.provider).toBe('tavily');
    expect(cfg.search.tavilyApiKey).toBe('tvly-x');
    expect(cfg.search.braveApiKey).toBeUndefined();
    expect(cfg.fetch.provider).toBe('jina');
    expect(cfg.fetch.jinaApiKey).toBe('jina-x');
  });

  it('env overrides take precedence over base config in CLI mode', () => {
    const cfg = resolveCliConnectorsConfig(
      { search: { provider: 'duckduckgo' }, fetch: { provider: 'basic' } },
      {
        XIAOK_SEARCH_PROVIDER: 'tavily',
        TAVILY_API_KEY: 'tvly-from-env',
        XIAOK_FETCH_PROVIDER: 'jina',
        JINA_API_KEY: 'jina-from-env',
      } as NodeJS.ProcessEnv,
    );
    expect(cfg.search.provider).toBe('tavily');
    expect(cfg.search.tavilyApiKey).toBe('tvly-from-env');
    expect(cfg.fetch.provider).toBe('jina');
    expect(cfg.fetch.jinaApiKey).toBe('jina-from-env');
  });

  it('runtime evaluation surfaces missing keys and not-implemented providers', () => {
    const cfg = cloneDefaultConnectorsConfig();
    cfg.search.provider = 'tavily';
    const runtimes = evaluateProviderRuntimes(cfg);
    const tavily = runtimes.find((r) => r.provider_name === 'web_search.tavily');
    expect(tavily?.runtime_state).toBe('missing_config');
    const searxng = runtimes.find((r) => r.provider_name === 'web_search.searxng');
    expect(searxng?.runtime_state).toBe('not_implemented');
    const firecrawl = runtimes.find((r) => r.provider_name === 'web_fetch.firecrawl');
    expect(firecrawl?.runtime_state).toBe('not_implemented');
  });

  it('runtime is ready when configured selected provider has its key', () => {
    const cfg = cloneDefaultConnectorsConfig();
    cfg.search.provider = 'brave';
    cfg.search.braveApiKey = 'brave-x';
    cfg.fetch.provider = 'jina';
    const runtimes = evaluateProviderRuntimes(cfg);
    expect(runtimes.find((r) => r.provider_name === 'web_search.brave')?.runtime_state).toBe('ready');
    expect(runtimes.find((r) => r.provider_name === 'web_fetch.jina')?.runtime_state).toBe('ready');
    expect(runtimes.find((r) => r.provider_name === 'web_search.duckduckgo')?.runtime_state).toBe('inactive');
  });
});
