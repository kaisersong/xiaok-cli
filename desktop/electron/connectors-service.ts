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
  /**
   * DeepSeek Search & Fetch 与模型共用同一把 key：从「模型配置」的
   * deepseek provider 动态解析，connectors 侧不持久化自己的副本。
   * desktop-services 装配为 loadConfig().providers.deepseek.apiKey。
   */
  resolveDeepseekApiKey?: () => Promise<string | undefined>;
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

/** 把 deepseek key 同时注入 search/fetch（Lazy 键复制成双份是既有 schema 形状）。 */
function withDeepseekConfigKey(config: ConnectorsConfig, apiKey: string | undefined): ConnectorsConfig {
  if (!apiKey) return config;
  return {
    search: { ...config.search, deepseekApiKey: apiKey },
    fetch: { ...config.fetch, deepseekApiKey: apiKey },
  };
}

/**
 * key 只存在于进程内存；snapshot 回传 renderer 前剥离，IPC 不暴露模型密钥。
 */
function stripDeepseekConfigKey(config: ConnectorsConfig): ConnectorsConfig {
  return {
    search: { ...config.search, deepseekApiKey: undefined },
    fetch: { ...config.fetch, deepseekApiKey: undefined },
  };
}

export class ConnectorsService {
  private readonly store: ConnectorsStore;
  private readonly toolRegistry: ToolRegistry;
  private readonly deps: ConnectorsServiceDeps;
  private registry: ConnectorRegistry;
  private loadStatus: ConnectorsLoadStatus = 'missing';
  /**
   * 每次公开调用都重新解析模型配置里的 DeepSeek key：设置页改 key 不需要
   * 回调通知 connectors，下一次工具调用/快照即生效。失败按未配置处理。
   */
  private credentialRefresh: Promise<void> = Promise.resolve();

  constructor(deps: ConnectorsServiceDeps) {
    this.deps = deps;
    this.store = deps.store;
    this.toolRegistry = deps.toolRegistry;
    const loaded = this.store.load();
    this.loadStatus = loaded.status;
    this.registry = new ConnectorRegistry(loaded.config);
    this.bindTools(this.toolRegistry);
  }

  private storeConfig(): ConnectorsConfig {
    return this.registry.getConfig();
  }

  private refreshCredentials(): Promise<void> {
    this.credentialRefresh = this.refreshCredentialsNow();
    return this.credentialRefresh;
  }

  private async refreshCredentialsNow(): Promise<void> {
    let apiKey: string | undefined;
    try {
      apiKey = (await this.deps.resolveDeepseekApiKey?.()) ?? undefined;
    } catch {
      apiKey = undefined;
    }
    const base = this.storeConfig();
    this.registry.apply(withDeepseekConfigKey(base, apiKey?.trim() ? apiKey.trim() : undefined));
  }

  /** 保持 public 方法返回前 registry 状态已含最新凭证注入。 */
  private async withCredentials<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.refreshCredentials();
    return await fn();
  }

  async getConfig(): Promise<ConnectorsConfigSnapshot> {
    return this.withCredentials(() => Promise.resolve(this.snapshot()));
  }

  async setConfig(input: unknown): Promise<ConnectorsConfigSnapshot> {
    const persisted = await this.store.save(input);
    this.loadStatus = 'ok';
    this.registry.apply(persisted);
    // persisted 不含凭证字段；重新注入 DeepSeek key 后再产出快照。
    await this.refreshCredentials();
    return this.snapshot();
  }

  async listProviders(): Promise<ProviderRuntime[]> {
    return this.withCredentials(() => Promise.resolve(this.registry.listProviderRuntimes()));
  }

  async testProvider(kind: 'search' | 'fetch'): Promise<ConnectorTestResult> {
    return this.withCredentials(() => this.testProviderNow(kind));
  }

  private snapshot(): ConnectorsConfigSnapshot {
    return {
      config: stripDeepseekConfigKey(this.registry.getConfig()),
      loadStatus: this.loadStatus,
      providers: this.registry.listProviderRuntimes(),
    };
  }

  private async testProviderNow(kind: 'search' | 'fetch'): Promise<ConnectorTestResult> {
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

  /** Each invocation owns its wrappers; provider configuration stays main-owned. */
  bindTools(target: ToolRegistry): void {
    const search = createWebSearchTool({ registry: this.registry });
    const fetchTool = createWebFetchTool({ registry: this.registry });
    // 工具 execute 前等待凭证已就绪：冷启动后第一次搜索也要走已注入 key 的
    // provider，而不是退化进 DuckDuckGo fallback。
    target.registerTool({
      ...search,
      execute: async (input, context) => {
        return this.withCredentials(() => search.execute(input, context));
      },
    });
    target.registerTool({
      ...fetchTool,
      execute: async (input, context) => {
        return this.withCredentials(() => fetchTool.execute(input, context));
      },
    });
  }
}
