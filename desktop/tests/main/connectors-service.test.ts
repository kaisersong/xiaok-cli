import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
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
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('initializes with default config and registers web tools', () => {
    const snapshot = service.getConfig();
    expect(snapshot.config.search.provider).toBe('duckduckgo');
    expect(snapshot.config.fetch.provider).toBe('basic');
    expect(snapshot.loadStatus).toBe('missing');
    const names = toolRegistry.getToolDefinitions().map((d) => d.name).sort();
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
  });

  it('reflects runtime states for selected providers', () => {
    const ddg = service.listProviders().find((r) => r.provider_name === 'web_search.duckduckgo');
    expect(ddg?.runtime_state).toBe('ready');
    const tavily = service.listProviders().find((r) => r.provider_name === 'web_search.tavily');
    expect(tavily?.runtime_state).toBe('inactive');
  });

  it('persists config and surfaces missing_config when key absent', async () => {
    await service.setConfig({
      search: { provider: 'tavily' },
      fetch: { provider: 'basic' },
    });
    const tavily = service.listProviders().find((r) => r.provider_name === 'web_search.tavily');
    expect(tavily?.runtime_state).toBe('missing_config');

    await service.setConfig({
      search: { provider: 'tavily', tavilyApiKey: 'tvly-key' },
      fetch: { provider: 'basic' },
    });
    const ready = service.listProviders().find((r) => r.provider_name === 'web_search.tavily');
    expect(ready?.runtime_state).toBe('ready');
  });

  it('reflects not_implemented for searxng and firecrawl', async () => {
    await service.setConfig({
      search: { provider: 'searxng' },
      fetch: { provider: 'firecrawl' },
    });
    const searxng = service.listProviders().find((r) => r.provider_name === 'web_search.searxng');
    const firecrawl = service.listProviders().find((r) => r.provider_name === 'web_fetch.firecrawl');
    expect(searxng?.runtime_state).toBe('not_implemented');
    expect(firecrawl?.runtime_state).toBe('not_implemented');
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
    const snapshot = service.getConfig();
    expect(snapshot.config.search.tavilyApiKey).toBe('tvly-key-123');
    expect(snapshot.config.fetch.jinaApiKey).toBe('jina-key-456');
    expect(snapshot.loadStatus).toBe('ok');
  });
});
