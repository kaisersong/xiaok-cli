export type ConnectionMode = 'local' | 'saas' | 'self-hosted';
export type DesktopPlatform = 'win32' | 'darwin' | 'linux';
export function isDesktop(): boolean { return true; }
export function isLocalMode(): boolean { return true; }
export function getDesktopAccessToken(): string | null { return 'local-token'; }

export type UpdaterComponent = 'openviking' | 'sandbox_kernel' | 'sandbox_rootfs' | 'rtk' | 'opencli';

export interface AppUpdaterState {
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported';
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

function getWindowApi(): Record<string, any> | null {
  if (typeof window !== 'undefined' && (window as any).xiaokDesktop) {
    return (window as any).xiaokDesktop
  }
  return null
}

let _cachedApi: Record<string, unknown> | null = null;

export function getDesktopApi(): Record<string, unknown> | null {
  if (_cachedApi) return _cachedApi

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
  }

  _cachedApi = {
    ...raw,
    appUpdater,
    memory,
  }
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
