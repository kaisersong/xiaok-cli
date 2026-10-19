import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorsStore } from '../../electron/connectors-store.js';
import { ConnectorsService } from '../../electron/connectors-service.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';

describe('ConnectorsService', () => {
  let dataRoot: string;
  let store: ConnectorsStore;
  let toolRegistry: ToolRegistry;
  let service: ConnectorsService;

  beforeEach(() => {
    dataRoot = join(tmpdir(), `xiaok-connectors-svc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataRoot, { recursive: true });
    store = new ConnectorsStore({ dataRoot });
    toolRegistry = new ToolRegistry({ autoMode: true });
    service = new ConnectorsService({ store, toolRegistry });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('binds scoped registries to the same live desktop connector settings', async () => {
    const scoped = new ToolRegistry({ autoMode: true }, []);
    service.bindTools(scoped);
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({results:[{title:'Configured search',url:'https://example.com',content:'desktop provider'}]}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    await service.setConfig({search:{provider:'tavily',tavilyApiKey:'fixture'},fetch:{provider:'basic'}});
    expect(await scoped.executeTool('web_search',{query:'cli reference'})).toContain('Configured search');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('tavily');
    scoped.dispose();
    expect(await toolRegistry.executeTool('web_search',{query:'still live'})).toContain('Configured search');
  });

  it('initializes with default config and registers web tools', async () => {
    const snapshot = await service.getConfig();
    expect(snapshot.config.search.provider).toBe('duckduckgo');
    expect(snapshot.config.fetch.provider).toBe('basic');
    expect(snapshot.loadStatus).toBe('missing');
    const names = toolRegistry.getToolDefinitions().map((d) => d.name).sort();
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
  });

  it('reflects runtime states for selected providers', async () => {
    const runtimes = await service.listProviders();
    const ddg = runtimes.find((r) => r.provider_name === 'web_search.duckduckgo');
    expect(ddg?.runtime_state).toBe('ready');
    const tavily = runtimes.find((r) => r.provider_name === 'web_search.tavily');
    expect(tavily?.runtime_state).toBe('inactive');
  });

  it('persists config and surfaces missing_config when key absent', async () => {
    await service.setConfig({
      search: { provider: 'tavily' },
      fetch: { provider: 'basic' },
    });
    const tavily = (await service.listProviders()).find((r) => r.provider_name === 'web_search.tavily');
    expect(tavily?.runtime_state).toBe('missing_config');

    await service.setConfig({
      search: { provider: 'tavily', tavilyApiKey: 'tvly-key' },
      fetch: { provider: 'basic' },
    });
    const ready = (await service.listProviders()).find((r) => r.provider_name === 'web_search.tavily');
    expect(ready?.runtime_state).toBe('ready');
  });

  it('reflects not_implemented for searxng and ready for firecrawl', async () => {
    await service.setConfig({
      search: { provider: 'searxng' },
      fetch: { provider: 'firecrawl' },
    });
    const runtimes = await service.listProviders();
    const searxng = runtimes.find((r) => r.provider_name === 'web_search.searxng');
    const firecrawl = runtimes.find((r) => r.provider_name === 'web_fetch.firecrawl');
    expect(searxng?.runtime_state).toBe('not_implemented');
    expect(firecrawl?.runtime_state).toBe('ready');
  });

  it('rebuilds in-memory tool wiring on setConfig', async () => {
    const before = toolRegistry.getToolDefinitions().find((d) => d.name === 'web_search');
    await service.setConfig({
      search: { provider: 'brave', braveApiKey: 'brave-key' },
      fetch: { provider: 'jina' },
    });
    const after = toolRegistry.getToolDefinitions().find((d) => d.name === 'web_search');
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after?.name).toBe('web_search');
  });

  it('getConfig returns full config with API keys after setConfig', async () => {
    await service.setConfig({
      search: { provider: 'tavily', tavilyApiKey: 'tvly-key-123' },
      fetch: { provider: 'jina', jinaApiKey: 'jina-key-456' },
    });
    const snapshot = await service.getConfig();
    expect(snapshot.config.search.tavilyApiKey).toBe('tvly-key-123');
    expect(snapshot.config.fetch.jinaApiKey).toBe('jina-key-456');
    expect(snapshot.loadStatus).toBe('ok');
  });

  it('injects the model-config deepseek key into both connectors without persisting or leaking it', async () => {
    const resolver = vi.fn(async () => 'sk-model-config');
    const svc = new ConnectorsService({ store, toolRegistry, resolveDeepseekApiKey: resolver });
    await svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'deepseek' } });

    const runtimes = await svc.listProviders();
    expect(runtimes.find((r) => r.provider_name === 'web_search.deepseek')?.runtime_state).toBe('ready');
    expect(runtimes.find((r) => r.provider_name === 'web_fetch.deepseek')?.runtime_state).toBe('ready');

    // snapshot 回传 renderer 前剥离 key：IPC 不暴露模型密钥。
    const snapshot = await svc.getConfig();
    expect(snapshot.config.search.deepseekApiKey).toBeUndefined();
    expect(snapshot.config.fetch.deepseekApiKey).toBeUndefined();

    // connectors.json 不落 key，模型配置是唯一真相源。
    const raw = readFileSync(join(dataRoot, 'connectors.json'), 'utf8');
    expect(raw).not.toContain('sk-model-config');
    expect(raw).not.toContain('deepseekApiKey');
  });

  it('re-evaluates the deepseek key on each snapshot when the model config changes', async () => {
    let stubbed: string | undefined = undefined;
    const resolver = vi.fn(async () => stubbed);
    const svc = new ConnectorsService({ store, toolRegistry, resolveDeepseekApiKey: resolver });
    await svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'basic' } });

    const missing = (await svc.listProviders()).find((r) => r.provider_name === 'web_search.deepseek');
    expect(missing?.runtime_state).toBe('missing_config');

    stubbed = 'sk-appeared';
    const ready = (await svc.listProviders()).find((r) => r.provider_name === 'web_search.deepseek');
    expect(ready?.runtime_state).toBe('ready');
    expect(resolver).toHaveBeenCalled();
  });

  it('routes web_search through the injected deepseek provider', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: 'From DeepSeek', url: 'https://example.com/ds', summary: 'ds summary' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new ConnectorsService({
      store,
      toolRegistry,
      resolveDeepseekApiKey: async () => 'sk-injected',
    });
    await svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'basic' } });

    const output = await toolRegistry.executeTool('web_search', { query: 'deepseek release' });
    expect(output).toContain('From DeepSeek');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/tools/search');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Headers | Record<string, string>).constructor === Headers
      ? (init.headers as Headers).get('authorization')
      : (init.headers as Record<string, string>).authorization
    ).toBe('Bearer sk-injected');
  });

  it('resolver failure degrades to missing key: build-time fallback to duckduckgo, deepseek endpoint untouched', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('api.deepseek.com')) throw new Error('deepseek endpoint must not be called without a key');
      return new Response('<html><body><a class="result__a" href="https://example.com/ddg">DDG</a><div class="result__snippet">s</div></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new ConnectorsService({
      store,
      toolRegistry,
      resolveDeepseekApiKey: async () => { throw new Error('model config read failed'); },
    });
    await svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'basic' } });
    const runtime = (await svc.listProviders()).find((r) => r.provider_name === 'web_search.deepseek');
    expect(runtime?.runtime_state).toBe('missing_config');
    const output = await toolRegistry.executeTool('web_search', { query: 'q' });
    expect(output).toContain('DDG');
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('api.deepseek.com');
    }
  });
});
