import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  cloneDefaultConnectorsConfig,
  normalizeConnectorsConfig,
  type ConnectorsConfig,
} from '../../src/ai/tools/connectors/config.js';

/**
 * Persistent connectors config store for the desktop main process.
 *
 * Storage layout (JSON file at {dataRoot}/connectors.json):
 *   {
 *     "schemaVersion": 1,
 *     "search": { "provider": "tavily", "tavilyApiKey": "tvly-..." },
 *     "fetch": { "provider": "jina", "jinaApiKey": "..." }
 *   }
 *
 * DeepSeek Search & Fetch 复用模型配置的 DeepSeek key，由
 * ConnectorsService 运行时注入；deepseekApiKey 持续不落本文件。
 *
 * Keys are stored in plaintext — same approach as model provider API keys
 * in this app. The file lives under the user-local app data directory which
 * is not world-readable on macOS/Windows.
 */

export interface ConnectorsStoreOptions {
  dataRoot: string;
}

export type ConnectorsLoadStatus = 'ok' | 'missing' | 'parse_failed';

export interface ConnectorsLoadResult {
  config: ConnectorsConfig;
  status: ConnectorsLoadStatus;
}

export class ConnectorsStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: ConnectorsStoreOptions) {
    mkdirSync(options.dataRoot, { recursive: true });
    this.filePath = join(options.dataRoot, 'connectors.json');
  }

  load(): ConnectorsLoadResult {
    if (!existsSync(this.filePath)) {
      return { config: cloneDefaultConnectorsConfig(), status: 'missing' };
    }
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch {
      return { config: cloneDefaultConnectorsConfig(), status: 'parse_failed' };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.backupAndRemove();
      return { config: cloneDefaultConnectorsConfig(), status: 'parse_failed' };
    }
    if (!parsed || parsed.schemaVersion !== 1) {
      this.backupAndRemove();
      return { config: cloneDefaultConnectorsConfig(), status: 'parse_failed' };
    }

    const config = normalizeConnectorsConfig({
      search: parsed.search ?? {},
      fetch: parsed.fetch ?? {},
    });
    return { config, status: 'ok' };
  }

  save(input: unknown): Promise<ConnectorsConfig> {
    return this.enqueue(() => this.doSave(input));
  }

  private doSave(input: unknown): ConnectorsConfig {
    const normalized = normalizeConnectorsConfig(input);

    // deepseekApiKey 是运行时从「模型配置」注入的（见 connectors-service.ts），
    // 不落 connectors.json，避免与模型配置形成两份可漂移的 key 副本。
    const persisted = {
      schemaVersion: 1,
      search: {
        provider: normalized.search.provider,
        tavilyApiKey: normalized.search.tavilyApiKey,
        braveApiKey: normalized.search.braveApiKey,
        firecrawlApiKey: normalized.search.firecrawlApiKey,
        searxngBaseUrl: normalized.search.searxngBaseUrl,
      },
      fetch: {
        provider: normalized.fetch.provider,
        jinaApiKey: normalized.fetch.jinaApiKey,
        firecrawlApiKey: normalized.fetch.firecrawlApiKey,
        firecrawlBaseUrl: normalized.fetch.firecrawlBaseUrl,
      },
    };

    this.persist(persisted);
    return persisted as ConnectorsConfig;
  }

  private persist(data: Record<string, unknown>): void {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmp, this.filePath);
  }

  private backupAndRemove(): void {
    const bak = `${this.filePath}.bak`;
    try {
      if (existsSync(bak)) rmSync(bak, { force: true });
      renameSync(this.filePath, bak);
    } catch {
      // best-effort backup
    }
  }

  private enqueue<T>(fn: () => T): Promise<T> {
    const task = this.writeQueue.then(() => fn());
    this.writeQueue = task.then(() => {}, () => {});
    return task;
  }
}
