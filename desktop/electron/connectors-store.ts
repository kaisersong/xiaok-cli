import {readProtectedJsonSync,saveProtectedJson,updateProtectedJson} from '../../src/utils/protected-json-async.js';
import {assertConnectorsUser,captureConnectorsInput} from './connectors-authority.js';
import type {ConnectorsMutationRequest} from '../shared/connectors-ipc-contract.js';
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
 * Secrets are stored in the OS credential store. JSON contains bound references only;
 * Main receives plaintext only inside the trusted connector runtime.
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
    const parsed=readProtectedJsonSync(this.filePath)!;
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

  save(input: unknown, request?: ConnectorsMutationRequest): Promise<ConnectorsConfig> {
    assertConnectorsUser(request);
    const snapshot = captureConnectorsInput(input);
    return this.enqueue(() => this.doSave(snapshot));
  }

  private async doSave(input: unknown): Promise<ConnectorsConfig> {
    const captured=structuredClone(input) as ConnectorsConfig;const old=this.load().config;
    for(const part of ['search','fetch'] as const)for(const [field,value] of Object.entries(captured[part]??{}))if(value==='••••••••') {const previous=(old[part] as unknown as Record<string,unknown>)[field];if(typeof previous!=='string'||!previous)throw Error('credential_config_changed');(captured[part] as unknown as Record<string,unknown>)[field]=previous;}
    const normalized = normalizeConnectorsConfig(captured);

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

    await saveProtectedJson(this.filePath,persisted);
    return persisted as ConnectorsConfig;
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

  async replaceCredential(part:'search'|'fetch',field:string,value:string,expected:string,request:ConnectorsMutationRequest,signal?:AbortSignal):Promise<void>{assertConnectorsUser(request);const allowed=part==='search'?['tavilyApiKey','braveApiKey','firecrawlApiKey']:['jinaApiKey','firecrawlApiKey'];if(!allowed.includes(field))throw Error('credential_target_unavailable');await updateProtectedJson(this.filePath,raw=>{const current=normalizeConnectorsConfig(raw);if(JSON.stringify(current)!==expected)throw Error('credential_target_changed');(current[part] as unknown as Record<string,unknown>)[field]=value;return {schemaVersion:1,...current};},signal);}

  private enqueue<T>(fn: () => T|Promise<T>): Promise<T> {
    const task = this.writeQueue.then(() => fn());
    this.writeQueue = task.then(() => {}, () => {});
    return task;
  }
}
