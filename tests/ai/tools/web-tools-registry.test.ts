import { describe, expect, it, vi } from 'vitest';
import { createWebSearchTool } from '../../../src/ai/tools/web-search.js';
import { createWebFetchTool } from '../../../src/ai/tools/web-fetch.js';
import { ConnectorRegistry } from '../../../src/ai/tools/connectors/registry.js';
import { cloneDefaultConnectorsConfig } from '../../../src/ai/tools/connectors/config.js';

describe('web_search tool with registry', () => {
  it('appends fallback tag when registry fell back', async () => {
    let tavilyCalled = 0;
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.startsWith('https://api.tavily.com')) {
        tavilyCalled++;
        return new Response('boom', { status: 500 });
      }
      return new Response(`
        <a class="result__a" href="https://example.com/x">Title</a>
        <div class="result__snippet">snippet</div>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    });
    const cfg = cloneDefaultConnectorsConfig();
    cfg.search.provider = 'tavily';
    cfg.search.tavilyApiKey = 'tvly-x';
    const registry = new ConnectorRegistry(cfg, { fetchFn });
    const tool = createWebSearchTool({ registry });
    const out = await tool.execute({ query: 'q', count: 2 });
    expect(tavilyCalled).toBe(1);
    expect(out).toContain('Title');
    expect(out).toContain('(fallback: web_search.duckduckgo after web_search.tavily error:');
  });
});

describe('web_fetch tool with registry', () => {
  it('appends fallback tag when registry fell back', async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.startsWith('https://r.jina.ai/')) {
        return new Response('boom', { status: 500 });
      }
      return new Response('<html><body>basic body</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    const cfg = cloneDefaultConnectorsConfig();
    cfg.fetch.provider = 'jina';
    const registry = new ConnectorRegistry(cfg, { fetchFn });
    const tool = createWebFetchTool({ registry });
    const out = await tool.execute({ url: 'https://example.com/p' });
    expect(out).toContain('basic body');
    expect(out).toContain('(fallback: web_fetch.basic after web_fetch.jina error:');
  });
});
