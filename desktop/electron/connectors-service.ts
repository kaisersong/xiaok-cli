import { ConnectorRegistry } from '../../src/ai/tools/connectors/registry.js';
import {
  cloneDefaultConnectorsConfig,
  type ConnectorsConfig,
  type ProviderRuntime,
} from '../../src/ai/tools/connectors/config.js';
import { createWebSearchTool } from '../../src/ai/tools/web-search.js';
import { createWebFetchTool } from '../../src/ai/tools/web-fetch.js';
import type { Tool } from '../../src/types.js';
import type { ToolRegistry } from '../../src/ai/tools/index.js';
import { ConnectorsStore, type ConnectorsLoadStatus } from './connectors-store.js';

export interface ConnectorsServiceDeps {
  store: ConnectorsStore;
  toolRegistry: ToolRegistry;
}

export interface ConnectorsConfigSnapshot {
  config: ConnectorsConfig;
  loadStatus: ConnectorsLoadStatus;
  providers: ProviderRuntime[];
}

export interface ConnectorTestResult {
  success: boolean;
  latencyMs: number;
  providerName: string;
  detail?: string;
  error?: string;
}

export class ConnectorsService {
  private readonly store: ConnectorsStore;
  private readonly toolRegistry: ToolRegistry;
  private registry: ConnectorRegistry;
  private loadStatus: ConnectorsLoadStatus = 'missing';

  constructor(deps: ConnectorsServiceDeps) {
    this.store = deps.store;
    this.toolRegistry = deps.toolRegistry;
    const loaded = this.store.load();
    this.loadStatus = loaded.status;
    this.registry = new ConnectorRegistry(loaded.config);
    this.installTools(this.registry);
  }

  getConfig(): ConnectorsConfigSnapshot {
    return this.snapshot();
  }

  async setConfig(input: unknown): Promise<ConnectorsConfigSnapshot> {
    const persisted = await this.store.save(input);
    this.registry.apply(persisted);
    this.loadStatus = 'ok';
    return this.snapshot();
  }

  listProviders(): ProviderRuntime[] {
    return this.registry.listProviderRuntimes();
  }

  async testProvider(kind: 'search' | 'fetch'): Promise<ConnectorTestResult> {
    const start = Date.now();
    try {
      if (kind === 'search') {
        const provider = this.registry.getSearchProvider();
        const hits = await provider.search({ query: 'test', count: 1 });
        return {
          success: true,
          latencyMs: Date.now() - start,
          providerName: provider.name,
          detail: `${hits.length} result(s)`,
        };
      } else {
        const provider = this.registry.getFetchProvider();
        const result = await provider.fetch({ url: 'https://example.com', maxChars: 500 });
        return {
          success: true,
          latencyMs: Date.now() - start,
          providerName: provider.name,
          detail: `${result.content.length} chars`,
        };
      }
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        providerName: 'unknown',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private snapshot(): ConnectorsConfigSnapshot {
    return {
      config: this.registry.getConfig(),
      loadStatus: this.loadStatus,
      providers: this.registry.listProviderRuntimes(),
    };
  }

  private installTools(registry: ConnectorRegistry): void {
    const search: Tool = createWebSearchTool({ registry });
    const fetchTool: Tool = createWebFetchTool({ registry });
    this.toolRegistry.registerTool(search);
    this.toolRegistry.registerTool(fetchTool);
  }
}
