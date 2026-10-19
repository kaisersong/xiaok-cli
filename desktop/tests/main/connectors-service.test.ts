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

  it('stops using stale deepseek credentials as soon as the model config stops providing them', async () => {
    // 评审 BLOCK #2：key 被删除/空白/resolver 抛错后，注入必须显式覆盖为
    // undefined——旧 key 不能靠 spread 残留在 registry 状态里继续外发。
    let stubbed: string | undefined = 'sk-revocable';
    let failResolver = false;
    const resolver = vi.fn(async () => {
      if (failResolver) throw new Error('model config read failed');
      return stubbed;
    });
    const svc = new ConnectorsService({ store, toolRegistry, resolveDeepseekApiKey: resolver });
    const deepseekCalls: Array<{ url: string; auth?: string }> = [];
    const ddgHtml = '<html><body><a class="result__a" href="https://example.com/ddg">DDG after revocation</a><div class="result__snippet">s</div></body></html>';
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.deepseek.com')) {
        const headers = init?.headers;
        deepseekCalls.push({
          url,
          auth: headers instanceof Headers
            ? headers.get('authorization') ?? undefined
            : (headers as Record<string, string> | undefined)?.authorization,
        });
        return new Response(JSON.stringify({
          results: [{ title: 'From DeepSeek', url: 'https://example.com/ds', summary: 'ds' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(ddgHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'basic' } });
    expect(await toolRegistry.executeTool('web_search', { query: 'live' })).toContain('From DeepSeek');
    expect(deepseekCalls).toHaveLength(1);
    expect(deepseekCalls[0]?.auth).toBe('Bearer sk-revocable');

    // key 从模型配置删除 → 立即失效：不走 deepseek 端点，降级 DDG。
    stubbed = undefined;
    expect(await toolRegistry.executeTool('web_search', { query: 'revoked' })).toContain('DDG after revocation');
    expect(deepseekCalls).toHaveLength(1);
    const runtime = (await svc.listProviders()).find((r) => r.provider_name === 'web_search.deepseek');
    expect(runtime?.runtime_state).toBe('missing_config');

    // resolver 抛错 = 无 key，同样不得复用旧凭证（含空白 trim 归一为 undefined）。
    deepseekCalls.length = 0;
    stubbed = '   ';
    expect(await toolRegistry.executeTool('web_search', { query: 'blank' })).toContain('DDG after revocation');
    failResolver = true;
    expect(await toolRegistry.executeTool('web_search', { query: 'resolver-fail' })).toContain('DDG after revocation');
    expect(deepseekCalls).toHaveLength(0);
  });

  it('never leaks a malformed deepseek key through tool output or requests', async () => {
    // 桌面端到端（评审 BLOCK #1）：含 CRLF 的 key 在 provider 构造期被固定
    // 文本拒绝，canary 不允许出现在请求头、错误文本或会话 tool_result 里。
    const canary = 'sk-CANARYDESKTOP\nheader-copy';
    const svc = new ConnectorsService({ store, toolRegistry, resolveDeepseekApiKey: async () => canary });
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      requests.push(`${url} ${JSON.stringify(init?.headers ?? null)}`);
      return new Response('<html><body><a class="result__a" href="https://example.com/ddg">DDG</a><div class="result__snippet">s</div></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'basic' } });
    const output = await toolRegistry.executeTool('web_search', { query: 'canary' });
    expect(output).not.toContain('CANARYDESKTOP');
    expect(output).toContain('DDG');
    expect(await svc.listProviders().then((rs) => JSON.stringify(rs))).not.toContain('CANARYDESKTOP');
    for (const request of requests) {
      expect(request).not.toContain('CANARYDESKTOP');
    }
  });

  it('keeps the consecutive-failure fallback intact across repeated deepseek executions', async () => {
    // 评审 P2 #5：refreshCredentials 只在有效配置变化时重建 registry——
    // 每次工具执行前的凭证刷新不得清空连败窗口，否则降级保护名存实亡。
    let deepseekCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.deepseek.com')) {
        deepseekCalls += 1;
        return new Response('rate limited', { status: 429, headers: { 'content-type': 'text/plain' } });
      }
      return new Response('<html><body><a class="result__a" href="https://example.com/ddg">DDG</a><div class="result__snippet">s</div></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new ConnectorsService({ store, toolRegistry, resolveDeepseekApiKey: async () => 'sk-persistent' });
    await svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'basic' } });

    for (let i = 0; i < 4; i += 1) {
      await toolRegistry.executeTool('web_search', { query: `q${i}` });
    }
    // FALLBACK_LIMIT = 3：三次连败后 primary 标记失效，第 4 次直接走 fallback。
    expect(deepseekCalls).toBe(3);
  });

  it('applies a config switch atomically with credential injection while tools execute', async () => {
    // 评审 #9：setConfig 不得出现「先应用无凭证 persisted、再排队补 key」的
    // 窗口——并发中的 web_search 必须始终打到 deepseek，不静默降级 DDG。
    let ddgCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.deepseek.com')) {
        return new Response(JSON.stringify({
          results: [{ title: 'From DeepSeek', url: 'https://example.com/ds', summary: 'ds' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      ddgCalls += 1;
      return new Response('<html><body><a class="result__a" href="https://example.com/ddg">DDG</a><div class="result__snippet">s</div></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new ConnectorsService({ store, toolRegistry, resolveDeepseekApiKey: async () => 'sk-atomic' });
    await svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'basic' } });

    const [output] = await Promise.all([
      toolRegistry.executeTool('web_search', { query: 'concurrent' }),
      svc.setConfig({ search: { provider: 'deepseek' }, fetch: { provider: 'basic' } }),
    ]);
    expect(output).toContain('From DeepSeek');
    expect(ddgCalls).toBe(0);
  });
});
