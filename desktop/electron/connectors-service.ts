import {assertConnectorsUser,captureConnectorsInput,captureConnectorsKind,captureConnectorsSnapshot} from './connectors-authority.js';
import type {ConnectorsMutationRequest} from '../shared/connectors-ipc-contract.js';
import { ConnectorRegistry } from '../../src/ai/tools/connectors/registry.js';
import {
  type ConnectorsConfig,
  type ProviderRuntime,
} from '../../src/ai/tools/connectors/config.js';
import { createWebSearchTool } from '../../src/ai/tools/web-search.js';
import { createWebFetchTool } from '../../src/ai/tools/web-fetch.js';
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

/**
 * 把 deepseek key 同时注入 search/fetch。无论 resolver 返回什么都**显式覆盖**
 * 两处字段（含 undefined）：key 从模型配置删除后必须立即失效，不能靠旧配置
 * spread 残留（评审 BLOCK #2）。
 */
function withDeepseekConfigKey(config: ConnectorsConfig, apiKey: string | undefined): ConnectorsConfig {
  return {
    search: { ...config.search, deepseekApiKey: apiKey ?? undefined },
    fetch: { ...config.fetch, deepseekApiKey: apiKey ?? undefined },
  };
}

/**
 * key 只存在于进程内存；snapshot 回传 renderer 前剥离，IPC 不暴露模型密钥。
 */
function stripDeepseekConfigKey(config: ConnectorsConfig): ConnectorsConfig {
  const search = { ...config.search };
  const fetch = { ...config.fetch };
  delete search.deepseekApiKey;
  delete fetch.deepseekApiKey;
  return {
    search,
    fetch,
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
   * 链式队列保证顺序：后到的 resolver 结果不会覆盖先到的新 key（乱序防护）。
   */
  private credentialRefresh: Promise<void> = Promise.resolve();
  /** 上次实际应用（注入后）的完整运行时配置指纹；无变化不重建 registry。 */
  private lastAppliedRuntimeSignature: string | undefined;

  constructor(deps: ConnectorsServiceDeps) {
    this.deps = deps;
    this.store = deps.store;
    this.toolRegistry = deps.toolRegistry;
    const loaded = this.store.load();
    this.loadStatus = loaded.status;
    this.registry = new ConnectorRegistry(loaded.config);
    this.bindTools(this.toolRegistry);
  }

  private refreshCredentials(pendingBase?: ConnectorsConfig): Promise<void> {
    const next = this.credentialRefresh.then(
      () => this.refreshCredentialsNow(pendingBase),
      () => this.refreshCredentialsNow(pendingBase),
    );
    this.credentialRefresh = next.then(() => undefined, () => undefined);
    return next;
  }

  private async refreshCredentialsNow(pendingBase?: ConnectorsConfig): Promise<void> {
    let apiKey: string | undefined;
    try {
      apiKey = (await this.deps.resolveDeepseekApiKey?.()) ?? undefined;
    } catch {
      apiKey = undefined;
    }
    const trimmed = apiKey?.trim() ? apiKey.trim() : undefined;
    // 基底与凭证分离：显式配置切换以 persisted 为基底（等待期间旧 registry
    // 保持完整可用）；普通凭证刷新以当前 registry 状态为基底。旧注入字段先
    // 剥离再统一覆盖，旧 key 不会残留在 registry 状态里（评审 BLOCK #2）。
    const base = stripDeepseekConfigKey(pendingBase ?? this.registry.getConfig());
    const next = withDeepseekConfigKey(base, trimmed);
    // 仅在有效配置实际变化时 rebuild：registry.apply() 会清空连败降级窗口，
    // 每次工具执行前无条件 apply 会让三连败保护失效（评审 P2 #5）。
    const signature = JSON.stringify(next);
    if (this.lastAppliedRuntimeSignature === signature) return;
    this.registry.apply(next);
    this.lastAppliedRuntimeSignature = signature;
  }

  /** 保持 public 方法返回前 registry 状态已含最新凭证注入。 */
  private async withCredentials<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.refreshCredentials();
    return await fn();
  }

  getConfig(request?: ConnectorsMutationRequest): Promise<ConnectorsConfigSnapshot> {
    assertConnectorsUser(request);
    return this.withCredentials(() => Promise.resolve(this.snapshot()));
  }

  async setConfig(input: unknown, request?: ConnectorsMutationRequest): Promise<ConnectorsConfigSnapshot> {
    const actor = assertConnectorsUser(request);
    const snapshot = captureConnectorsInput(input);
    const persisted = await this.store.save(snapshot, actor);
    this.loadStatus = 'ok';
    // 配置切换与凭证注入合并为同一串行轮次的一次性重建（评审 #9）：不存在
    // 「先应用无凭证 persisted、再排队补 key」的窗口——并发中的工具调用要
    // 么使用旧的完整配置，要么等待「persisted+注入 key」一次到位后才执行，
    // 不会在有效凭证配置切换期间静默降级 fallback。
    await this.refreshCredentials(persisted);
    return this.snapshot('connectors_operation_unknown');
  }

  async listProviders(): Promise<ProviderRuntime[]> {
    return this.withCredentials(() => Promise.resolve(this.registry.listProviderRuntimes()));
  }

  async testProvider(kind: 'search' | 'fetch', request?: ConnectorsMutationRequest): Promise<ConnectorTestResult> {
    assertConnectorsUser(request);
    const capturedKind = captureConnectorsKind(kind);
    return this.withCredentials(() => this.testProviderNow(capturedKind));
  }

  private snapshot(errorCode = 'connectors_projection_unavailable'): ConnectorsConfigSnapshot {
    return captureConnectorsSnapshot({
      config: stripDeepseekConfigKey(this.registry.getConfig()),
      loadStatus: this.loadStatus,
      providers: this.registry.listProviderRuntimes(),
    }, errorCode);
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
