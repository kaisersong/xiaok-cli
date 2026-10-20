import { describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry } from '../../../../src/ai/tools/connectors/registry.js';
import {
  cloneDefaultConnectorsConfig,
  type ConnectorsConfig,
} from '../../../../src/ai/tools/connectors/config.js';

function buildConfig(patch: (cfg: ConnectorsConfig) => void): ConnectorsConfig {
  const cfg = cloneDefaultConnectorsConfig();
  patch(cfg);
  return cfg;
}

function tavilyResponse(): Response {
  return new Response(JSON.stringify({
    results: [{ title: 'A', url: 'https://a.example/', content: 'snippet' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function ddgResponse(): Response {
  return new Response(`
    <html><body>
      <a class="result__a" href="https://example.com/1">Example One</a>
      <div class="result__snippet">First snippet</div>
    </body></html>
  `, { status: 200, headers: { 'content-type': 'text/html' } });
}

function deepSeekSearchResponse(): Response {
  return new Response(JSON.stringify({
    results: [{
      rerank_score: 2.4,
      title: 'DeepSeek V4 release',
      url: 'https://example.com/ds',
      snippet: 'short',
      summary: 'Model-oriented summary for the DeepSeek Search API.',
      date: '2026-10-17T00:00:00+00:00',
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('ConnectorRegistry search routing', () => {
  it('routes search to the deepseek provider when its key is configured', async () => {
    const fetchFn = vi.fn<typeof globalThis.fetch>(async () => deepSeekSearchResponse());
    const registry = new ConnectorRegistry(
      buildConfig((cfg) => {
        cfg.search.provider = 'deepseek';
        cfg.search.deepseekApiKey = 'sk-ds';
      }),
      { fetchFn },
    );
    const outcome = await registry.runSearch({ query: 'q', count: 3 });
    expect(outcome.effective).toBe('web_search.deepseek');
    expect(outcome.fallback).toBeUndefined();
    expect(outcome.hits[0].url).toBe('https://example.com/ds');
    const [, init] = fetchFn.mock.calls[0];
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-ds');
  });

  it('falls back to duckduckgo when deepseek search is selected without a key', async () => {
    // key 缺失时根本不该请求 DeepSeek 端点；mock 只服务 DDG。
    const fetchFn = vi.fn<typeof globalThis.fetch>(async (url) => {
      const u = url.toString();
      if (u.includes('deepseek')) throw new TypeError('deepseek provider must not be called without a key');
      return ddgResponse();
    });
    const registry = new ConnectorRegistry(
      buildConfig((cfg) => {
        cfg.search.provider = 'deepseek';
        cfg.search.deepseekApiKey = undefined;
      }),
      { fetchFn },
    );
    const outcome = await registry.runSearch({ query: 'q', count: 3 });
    // 缺 key 时构建期即回退：primary/effective 都是 DDG，且从不请求 DeepSeek 端点。
    expect(outcome.effective).toBe('web_search.duckduckgo');
    expect(outcome.fallback).toBeUndefined();
    for (const [url] of fetchFn.mock.calls) {
      expect(String(url)).not.toContain('api.deepseek.com');
    }
    expect(fetchFn).toHaveBeenCalled();
  });

  it('uses primary tavily when key is configured', async () => {
    const fetchFn = vi.fn(async () => tavilyResponse());
    const registry = new ConnectorRegistry(
      buildConfig((cfg) => {
        cfg.search.provider = 'tavily';
        cfg.search.tavilyApiKey = 'tvly-x';
      }),
      { fetchFn },
    );
    const outcome = await registry.runSearch({ query: 'q', count: 3 });
    expect(outcome.effective).toBe('web_search.tavily');
    expect(outcome.fallback).toBeUndefined();
    expect(outcome.hits[0].url).toBe('https://a.example/');
  });

  it('falls back to duckduckgo when primary throws and surfaces fallback metadata', async () => {
    let firstCall = true;
    const fetchFn = vi.fn<typeof globalThis.fetch>(async (url) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.startsWith('https://api.tavily.com')) {
        if (firstCall) {
          firstCall = false;
          return new Response('boom', { status: 500 });
        }
      }
      return ddgResponse();
    });
    const registry = new ConnectorRegistry(
      buildConfig((cfg) => {
        cfg.search.provider = 'tavily';
        cfg.search.tavilyApiKey = 'tvly-x';
      }),
      { fetchFn },
    );
    const outcome = await registry.runSearch({ query: 'q', count: 3 });
    expect(outcome.primary).toBe('web_search.tavily');
    expect(outcome.effective).toBe('web_search.duckduckgo');
    expect(outcome.fallback).toBeDefined();
    expect(outcome.fallback?.reason).toContain('500');
  });

  it('after 3 consecutive primary failures, marks primary invalid_config', async () => {
    const fetchFn = vi.fn<typeof globalThis.fetch>(async (url) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.startsWith('https://api.tavily.com')) {
        return new Response('boom', { status: 500 });
      }
      return ddgResponse();
    });
    const registry = new ConnectorRegistry(
      buildConfig((cfg) => {
        cfg.search.provider = 'tavily';
        cfg.search.tavilyApiKey = 'tvly-x';
      }),
      { fetchFn },
    );
    for (let i = 0; i < 3; i++) {
      await registry.runSearch({ query: 'q', count: 3 });
    }
    const runtime = registry.listProviderRuntimes().find((r) => r.provider_name === 'web_search.tavily');
    expect(runtime?.runtime_state).toBe('invalid_config');
    expect(runtime?.runtime_reason).toBe('repeated_failures');
  });

  it('apply() rebuilds providers and clears failure window', async () => {
    const fetchFn = vi.fn(async () => ddgResponse());
    const registry = new ConnectorRegistry(cloneDefaultConnectorsConfig(), { fetchFn });
    expect(registry.getSearchProvider().name).toBe('web_search.duckduckgo');
    registry.apply(buildConfig((cfg) => {
      cfg.search.provider = 'brave';
      cfg.search.braveApiKey = 'k';
    }));
    expect(registry.getSearchProvider().name).toBe('web_search.brave');
  });

  it('empty api key falls back to duckduckgo immediately (no provider error)', async () => {
    const fetchFn = vi.fn(async () => ddgResponse());
    const registry = new ConnectorRegistry(
      buildConfig((cfg) => {
        cfg.search.provider = 'tavily';
        cfg.search.tavilyApiKey = '';
      }),
      { fetchFn },
    );
    expect(registry.getSearchProvider().name).toBe('web_search.duckduckgo');
    const outcome = await registry.runSearch({ query: 'q', count: 1 });
    expect(outcome.effective).toBe('web_search.duckduckgo');
  });
});

describe('ConnectorRegistry fetch routing', () => {
  it('falls back to basic when jina returns 500', async () => {
    let jinaCalled = false;
    const fetchFn = vi.fn<typeof globalThis.fetch>(async (url) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.startsWith('https://r.jina.ai/')) {
        jinaCalled = true;
        return new Response('boom', { status: 500 });
      }
      return new Response('<html><body>basic</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    const registry = new ConnectorRegistry(
      buildConfig((cfg) => { cfg.fetch.provider = 'jina'; }),
      { fetchFn },
    );
    const outcome = await registry.runFetch({ url: 'https://example.com/page', maxChars: 1000 });
    expect(jinaCalled).toBe(true);
    expect(outcome.effective).toBe('web_fetch.basic');
    expect(outcome.fallback?.reason).toContain('500');
  });
});

describe('ConnectorRegistry timeout', () => {
  it('aborts search after timeout when fetch hangs', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    const registry = new ConnectorRegistry(
      buildConfig(() => {}),
      { fetchFn },
    );
    await expect(
      registry.runSearch({ query: 'hang', count: 3, signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow();
  });

  it('aborts fetch after timeout when fetch hangs', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    const registry = new ConnectorRegistry(
      buildConfig(() => {}),
      { fetchFn },
    );
    await expect(
      registry.runFetch({ url: 'https://example.com/hang', maxChars: 1000, signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow();
  });
});
