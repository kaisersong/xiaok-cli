import type { FullDesktopApi } from '../../../electron/preload-api.js';

export type ConnectionMode = 'local' | 'saas' | 'self-hosted';
export type DesktopPlatform = 'win32' | 'darwin' | 'linux';
export function isDesktop(): boolean { return true; }
export function isLocalMode(): boolean { return true; }
export function getDesktopAccessToken(): string | null { return 'local-token'; }

export type UpdaterComponent = 'openviking' | 'sandbox_kernel' | 'sandbox_rootfs' | 'rtk' | 'opencli';

export interface AppUpdaterState {
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error' | 'unsupported';
  progressPercent?: number;
  currentVersion?: string;
  latestVersion?: string;
  error?: string;
}

interface PreloadUpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  installing?: boolean;
  progress: number;
  version?: string;
  currentVersion?: string;
  error?: string;
}

function mapUpdateStatus(s: PreloadUpdateStatus): AppUpdaterState {
  const base = { currentVersion: s.currentVersion, latestVersion: s.version }
  if (s.error) {
    return { ...base, phase: 'error', error: s.error }
  }
  if (s.installing) {
    return { ...base, phase: 'installing', progressPercent: 100 }
  }
  if (s.downloaded) {
    return { ...base, phase: 'downloaded', progressPercent: 100 }
  }
  if (s.downloading) {
    return { ...base, phase: 'downloading', progressPercent: s.progress }
  }
  if (s.available) {
    return { ...base, phase: 'available' }
  }
  if (s.checking) {
    return { ...base, phase: 'checking' }
  }
  return { ...base, phase: 'not-available' }
}

function getWindowApi(): FullDesktopApi | null {
  if (typeof window !== 'undefined' && window.xiaokDesktop) {
    return window.xiaokDesktop
  }
  return null
}

export interface AppUpdaterApi {
  check(): Promise<AppUpdaterState>;
  download(): Promise<AppUpdaterState>;
  install(): Promise<void>;
  getState(): Promise<AppUpdaterState>;
  onState(handler: (state: AppUpdaterState) => void): () => void;
}

export interface DesktopMemoryApi {
  getConfig(): Promise<Record<string, unknown>>;
  setConfig(config: Record<string, unknown>): Promise<void>;
  getStatus(): Promise<{ configured: boolean; healthy: boolean }>;
  getSnapshot(): Promise<{ memory_block: string; hits: unknown[] }>;
  getImpression(): Promise<{ impression: string; updated_at: unknown }>;
  rebuildSnapshot(): Promise<{ memory_block: string; hits: unknown[] }>;
  rebuildImpression(): Promise<{ updated_at: unknown }>;
  getContent(uri: string, layer: string): Promise<{ content: string }>;
  list(): Promise<{ entries: MemoryEntry[] }>;
  add(content: string, category?: string): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  stats(): Promise<{ l0: number; l1: number; l2: number; l3: number; dbSizeBytes: number } | null>;
  compact(): Promise<boolean>;
  personaTraits(): Promise<{ trait: string; confidence: number }[]>;
  listLayer(layer: number, limit?: number, offset?: number): Promise<{ id: string; content: string; tags?: string[]; createdAt: string; meta?: Record<string, unknown> }[]>;
  deleteEntry(id: string, layer: number): Promise<boolean>;
  clearAll(): Promise<boolean>;
  getModelId(): Promise<string | null>;
  setModelId(modelId: string | null): Promise<boolean>;
}

export type ExtendedDesktopApi = FullDesktopApi & {
  appUpdater: AppUpdaterApi;
  memory: DesktopMemoryApi;
};

let _cachedApi: ExtendedDesktopApi | null | undefined;

/** @internal Reset cached API reference — for tests only */
export function _resetDesktopApiCache(): void { _cachedApi = undefined; }

export function getDesktopApi(): ExtendedDesktopApi | null {
  if (_cachedApi !== undefined) return _cachedApi

  const raw = getWindowApi()
  if (!raw) return null

  const appUpdater = {
    async check(): Promise<AppUpdaterState> {
      await raw.checkForUpdates()
      const status = await raw.getUpdateStatus() as PreloadUpdateStatus
      return mapUpdateStatus(status)
    },
    async download(): Promise<AppUpdaterState> {
      // autoDownload is true, so check triggers download automatically
      await raw.checkForUpdates()
      const status = await raw.getUpdateStatus() as PreloadUpdateStatus
      return mapUpdateStatus(status)
    },
    async install(): Promise<void> {
      await raw.quitAndInstall()
    },
    async getState(): Promise<AppUpdaterState> {
      const status = await raw.getUpdateStatus() as PreloadUpdateStatus
      return mapUpdateStatus(status)
    },
    onState(handler: (state: AppUpdaterState) => void): () => void {
      return raw.onUpdateStatus((status: PreloadUpdateStatus) => {
        handler(mapUpdateStatus(status))
      })
    },
  }

  const memory = {
    async getConfig() {
      try {
        const raw = localStorage.getItem('xiaok:memory-config')
        return raw ? JSON.parse(raw) : { enabled: true, provider: 'notebook' }
      } catch { return { enabled: true, provider: 'notebook' } }
    },
    async setConfig(config: Record<string, unknown>) {
      try { localStorage.setItem('xiaok:memory-config', JSON.stringify(config)) } catch { /* noop */ }
    },
    async getStatus() {
      return { configured: true, healthy: true }
    },
    async getSnapshot() {
      return { memory_block: '', hits: [] }
    },
    async getImpression() {
      return { impression: '', updated_at: undefined }
    },
    async rebuildSnapshot() {
      return { memory_block: '', hits: [] }
    },
    async rebuildImpression() {
      return { updated_at: undefined }
    },
    async getContent(_uri: string, _layer: string) {
      return { content: '' }
    },
    async list() {
      const items = await raw.listMemories() as any[]
      const entries = (items ?? []).map((e: any) => ({
        id: e.id,
        content: e.content,
        category: e.tags?.[0] || '',
        key: e.id,
        createdAt: typeof e.createdAt === 'number' ? new Date(e.createdAt).toISOString() : e.createdAt || '',
        tags: e.tags || [],
      }))
      return { entries }
    },
    async add(content: string, category?: string) {
      const tags = category ? [category] : []
      return raw.createMemory({ content, tags })
    },
    async delete(id: string) {
      return raw.deleteMemory(id)
    },
    async stats() {
      return raw.memoryStats() as Promise<{ l0: number; l1: number; l2: number; l3: number; dbSizeBytes: number } | null>
    },
    async compact() {
      return raw.memoryCompact() as Promise<boolean>
    },
    async personaTraits() {
      return raw.memoryPersonaTraits() as Promise<{ trait: string; confidence: number }[]>
    },
    async listLayer(layer: number, limit?: number, offset?: number) {
      return raw.memoryListLayer(layer, limit, offset) as Promise<{ id: string; content: string; tags?: string[]; createdAt: string; meta?: Record<string, unknown> }[]>
    },
    async deleteEntry(id: string, layer: number) {
      return raw.memoryDeleteEntry(id, layer) as Promise<boolean>
    },
    async clearAll() {
      return raw.memoryClearAll() as Promise<boolean>
    },
    async getModelId() {
      return raw.memoryGetModelId() as Promise<string | null>
    },
    async setModelId(modelId: string | null) {
      return raw.memorySetModelId(modelId) as Promise<boolean>
    },
  }

  _cachedApi = { ...raw, appUpdater, memory }
  return _cachedApi
}

export interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  key: string;
  createdAt: string;
  tags?: string[];
}

export type DesktopSettingsKey = 'general' | 'appearance' | 'providers' | 'agents' | 'channels' | 'tools' | 'skills' | 'memory' | 'security' | 'advanced' | 'about';

export interface OpenVikingDesktopConfig {
  vlmSelector?: string;
  vlmModel?: string;
  vlmProvider?: string;
  vlmApiKey?: string;
  vlmApiBase?: string;
  embeddingSelector?: string;
  embeddingModel?: string;
  embeddingProvider?: string;
  embeddingApiKey?: string;
  embeddingApiBase?: string;
  rerankSelector?: string;
  rerankModel?: string;
  rerankProvider?: string;
  rerankApiKey?: string;
  rerankApiBase?: string;
}

export interface NowledgeDesktopConfig {
  baseUrl?: string;
  apiKey?: string;
  requestTimeoutMs?: number;
}

export interface MemoryConfig {
  enabled: boolean;
  provider?: 'notebook' | 'openviking' | 'nowledge';
  memoryCommitEachTurn?: boolean;
  openviking?: OpenVikingDesktopConfig;
  nowledge?: NowledgeDesktopConfig;
}

export interface SnapshotHit {
  uri: string;
  abstract?: string;
  is_leaf?: boolean;
}
