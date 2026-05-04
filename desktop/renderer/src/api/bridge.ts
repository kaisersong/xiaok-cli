import { createLogger } from '../lib/logger';
import type {
  DesktopApi,
  DesktopModelConfigSnapshot,
  DesktopSaveModelConfigInput,
  MaterialView,
  MaterialRole,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
  DesktopTaskEvent,
} from '../../../electron/preload-api';
import type { ThreadRecord } from './types';

// Declare window.xiaokDesktop with exact types from preload-api.ts
declare global {
  interface Window {
    xiaokDesktop: DesktopApi;
  }
}

// IndexedDB helpers for thread storage
const DB_NAME = 'xiaok-desktop';
const DB_VERSION = 1;
const THREADS_STORE = 'threads';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(THREADS_STORE)) {
        const store = db.createObjectStore(THREADS_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THREADS_STORE, mode);
    const store = tx.objectStore(THREADS_STORE);
    const request = fn(store);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    if (mode === 'readonly') {
      request.onsuccess = () => resolve(request.result);
    } else {
      tx.oncomplete = () => resolve(request.result);
    }
  });
}

// Local storage keys for starred threads
const STARRED_KEY = 'xiaok-desktop:starred-threads';

function getStarredIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function setStarredIds(ids: Set<string>): void {
  localStorage.setItem(STARRED_KEY, JSON.stringify([...ids]));
}

// ============================================================
// API Bridge: Maps Xiaok Go backend API to xiaok Electron IPC
// ============================================================

async function createTaskWithRetry(input: {
  prompt: string;
  materials: Array<{ materialId: string; role?: MaterialRole }>;
  retries?: number;
}): Promise<{ taskId: string; understanding: TaskUnderstanding }> {
  try {
    return await window.xiaokDesktop.createTask(input);
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('active task already exists') && (input.retries ?? 0) < 2) {
      log.info('createTask: stale active task detected, cancelling and retrying');
      try {
        const active = await window.xiaokDesktop.getActiveTask();
        if (active?.taskId) {
          await window.xiaokDesktop.cancelTask(active.taskId);
          log.info('createTask: cancelled stale task', active.taskId);
        }
      } catch (cancelErr) {
        log.warn('createTask: failed to cancel stale task', (cancelErr as Error).message);
      }
      return createTaskWithRetry({ ...input, retries: (input.retries ?? 0) + 1 });
    }
    throw e;
  }
}

const log = createLogger('api-bridge');

export const api = {
  // ---------------------
  // Auth API (mocked)
  // ---------------------
  async getMe() {
    // Local mode: return a synthetic user
    return {
      id: 'local-user',
      username: 'local',
      email: undefined,
      email_verified: false,
      work_enabled: false,
    };
  },

  async getCaptchaConfig() {
    // No captcha in local mode
    return { enabled: false };
  },

  // ---------------------
  // Thread API (IndexedDB)
  // ---------------------
  async createThread(input: { title?: string }): Promise<ThreadRecord> {
    const now = Date.now();
    const thread: ThreadRecord = {
      id: crypto.randomUUID(),
      title: input.title ?? null,
      status: 'idle',
      mode: 'work',
      createdAt: now,
      updatedAt: now,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: null,
    };
    await withStore('readwrite', (store) => store.add(thread));
    return thread;
  },

  async getThread(id: string): Promise<ThreadRecord | null> {
    const result = await withStore('readonly', (store) => store.get(id));
    if (!result) return null;
    return { ...result, currentTaskId: result.currentTaskId ?? null };
  },

  async listThreads(options?: {
    limit?: number;
    before?: string;
  }): Promise<ThreadRecord[]> {
    const all = await withStore('readonly', (store) => store.getAll());
    // Sort by createdAt descending
    all.sort((a, b) => b.createdAt - a.createdAt);
    const normalized = all.map(t => ({ ...t, currentTaskId: t.currentTaskId ?? null }));
    if (options?.before) {
      const idx = normalized.findIndex((t) => t.id === options.before);
      if (idx >= 0) {
        return normalized.slice(idx + 1, idx + 1 + (options.limit ?? 20));
      }
    }
    return normalized.slice(0, options?.limit ?? 20);
  },

  async updateThreadTitle(id: string, title: string): Promise<void> {
    const thread = await api.getThread(id);
    if (!thread) throw new Error(`Thread ${id} not found`);
    thread.title = title;
    thread.updatedAt = Date.now();
    await withStore('readwrite', (store) => store.put(thread));
  },

  async updateThreadSidebarState(
    id: string,
    state: { starred?: boolean; gtdBucket?: ThreadRecord['gtdBucket'] }
  ): Promise<void> {
    const thread = await api.getThread(id);
    if (!thread) throw new Error(`Thread ${id} not found`);
    if (state.starred !== undefined) thread.starred = state.starred;
    if (state.gtdBucket !== undefined) thread.gtdBucket = state.gtdBucket;
    thread.updatedAt = Date.now();
    await withStore('readwrite', (store) => store.put(thread));
  },

  async updateThreadTaskId(id: string, taskId: string): Promise<void> {
    const thread = await api.getThread(id);
    if (!thread) throw new Error(`Thread ${id} not found`);
    thread.currentTaskId = taskId;
    thread.updatedAt = Date.now();
    await withStore('readwrite', (store) => store.put(thread));
  },

  async deleteThread(id: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(id));
  },

  async searchThreads(query: string): Promise<ThreadRecord[]> {
    const all = await withStore('readonly', (store) => store.getAll());
    const lower = query.toLowerCase();
    return all.filter(
      (t) => t.title?.toLowerCase().includes(lower)
    );
  },

  // ---------------------
  // Starred API (localStorage)
  // ---------------------
  async listStarredThreadIds(): Promise<string[]> {
    return [...getStarredIds()];
  },

  async starThread(id: string): Promise<void> {
    const ids = getStarredIds();
    ids.add(id);
    setStarredIds(ids);
  },

  async unstarThread(id: string): Promise<void> {
    const ids = getStarredIds();
    ids.delete(id);
    setStarredIds(ids);
  },

  // ---------------------
  // Run API (IPC via DesktopApi)
  // ---------------------
  async createTask(input: {
    prompt: string;
    materials: Array<{ materialId: string; role?: MaterialRole }>;
  }): Promise<{ taskId: string; understanding: TaskUnderstanding }> {
    log.info('createTask', JSON.stringify({ prompt: input.prompt, materialsCount: input.materials.length }));
    const result = await createTaskWithRetry(input);
    log.info('createTask ok', JSON.stringify({ taskId: result.taskId }));
    return result;
  },

  async createTaskWithFiles(input: {
    prompt: string;
    filePaths: string[];
  }): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    log.info('createTaskWithFiles', JSON.stringify({ prompt: input.prompt, filesCount: input.filePaths.length }));
    const result = await window.xiaokDesktop.createTaskWithFiles(input);
    log.info('createTaskWithFiles ok', JSON.stringify({ taskId: result.taskId }));
    return result;
  },

  subscribeTask(
    taskId: string,
    handler: (event: DesktopTaskEvent) => void
  ): () => void {
    log.info('subscribeTask', taskId);
    const unsub = window.xiaokDesktop.subscribeTask(taskId, handler);
    log.info('subscribeTask ok', taskId);
    return unsub;
  },

  async answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void> {
    log.info('answerQuestion', JSON.stringify({ taskId: input.taskId }));
    const r = await window.xiaokDesktop.answerQuestion(input);
    log.info('answerQuestion ok', JSON.stringify({ taskId: input.taskId }));
    return r;
  },

  async cancelTask(taskId: string): Promise<void> {
    log.info('cancelTask', taskId);
    const r = await window.xiaokDesktop.cancelTask(taskId);
    log.info('cancelTask ok', taskId);
    return r;
  },

  async getActiveTask(): Promise<{ taskId: string } | null> {
    log.debug('getActiveTask');
    const r = await window.xiaokDesktop.getActiveTask();
    log.debug('getActiveTask ok', JSON.stringify(r));
    return r;
  },

  async recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }> {
    log.info('recoverTask', taskId);
    const r = await window.xiaokDesktop.recoverTask(taskId);
    log.info('recoverTask ok', JSON.stringify({ status: r?.snapshot?.status }));
    return r;
  },

  // ---------------------
  // Model Config API (IPC)
  // ---------------------
  async getModelConfig(): Promise<DesktopModelConfigSnapshot> {
    log.debug('getModelConfig');
    const r = await window.xiaokDesktop.getModelConfig();
    log.debug('getModelConfig ok', JSON.stringify({ providers: r?.providers?.length }));
    return r;
  },

  async saveModelConfig(input: DesktopSaveModelConfigInput): Promise<DesktopModelConfigSnapshot> {
    log.info('saveModelConfig', JSON.stringify({ providerId: input.providerId }));
    const r = await window.xiaokDesktop.saveModelConfig(input);
    log.info('saveModelConfig ok');
    return r;
  },

  async testProviderConnection(input: { providerId: string; modelId?: string }): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    log.info('testProviderConnection', JSON.stringify({ providerId: input.providerId }));
    const r = await window.xiaokDesktop.testProviderConnection(input);
    log.info('testProviderConnection ok', JSON.stringify({ success: r?.success }));
    return r;
  },

  async listAvailableModelsForProvider(providerId: string): Promise<Array<{ modelId: string; model: string; label: string; capabilities?: string[] }>> {
    log.debug('listAvailableModelsForProvider', providerId);
    const r = await window.xiaokDesktop.listAvailableModelsForProvider(providerId);
    log.debug('listAvailableModelsForProvider ok', JSON.stringify({ count: r?.length }));
    return r;
  },

  async deleteProvider(providerId: string): Promise<void> {
    log.info('deleteProvider', providerId);
    await window.xiaokDesktop.deleteProvider(providerId);
    log.info('deleteProvider ok');
  },

  async deleteModel(modelId: string): Promise<void> {
    log.info('deleteModel', modelId);
    await window.xiaokDesktop.deleteModel(modelId);
    log.info('deleteModel ok');
  },

  // ---------------------
  // Material API (IPC)
  // ---------------------
  async selectMaterials(): Promise<{ filePaths: string[] }> {
    log.debug('selectMaterials');
    const r = await window.xiaokDesktop.selectMaterials();
    log.debug('selectMaterials ok', JSON.stringify({ count: r?.filePaths?.length }));
    return r;
  },

  async importMaterial(input: {
    taskId: string;
    filePath: string;
    role: MaterialRole;
  }): Promise<MaterialView> {
    log.info('importMaterial', JSON.stringify({ filePath: input.filePath }));
    const r = await window.xiaokDesktop.importMaterial(input);
    log.info('importMaterial ok');
    return r;
  },

  // ---------------------
  // Artifact API (IPC)
  // ---------------------
  async openArtifact(artifactId: string): Promise<void> {
    log.info('openArtifact', artifactId);
    return await window.xiaokDesktop.openArtifact(artifactId);
  },

  // ---------------------
  // Channel API (IPC)
  // ---------------------
  async listChannels() {
    return window.xiaokDesktop.listChannels();
  },
  async createChannel(input: { type: string; name: string; webhookUrl?: string }) {
    return window.xiaokDesktop.createChannel(input as never);
  },
  async updateChannel(id: string, input: { type?: string; name?: string; webhookUrl?: string; enabled?: boolean }) {
    return window.xiaokDesktop.updateChannel(id, input as never);
  },
  async deleteChannel(id: string) {
    await window.xiaokDesktop.deleteChannel(id);
  },

  // ---------------------
  // MCP API (IPC)
  // ---------------------
  async listMCPInstalls() {
    return window.xiaokDesktop.listMCPInstalls();
  },
  async createMCPInstall(input: { name: string; source: string; command: string; args?: string[] }) {
    return window.xiaokDesktop.createMCPInstall(input as never);
  },
  async updateMCPInstall(id: string, input: { name?: string; source?: string; command?: string; enabled?: boolean }) {
    return window.xiaokDesktop.updateMCPInstall(id, input as never);
  },
  async deleteMCPInstall(id: string) {
    await window.xiaokDesktop.deleteMCPInstall(id);
  },

  // ---------------------
  // Persona API (mock)
  // ---------------------
  async listPersonas() {
    return [];
  },

  async getActivePersona() {
    return null;
  },

  async listSelectablePersonas() {
    return [];
  },

  async patchPersona(_personaKey: string, _patch: unknown) {
    // No-op in local mode
  },

  // ---------------------
  // Spawn Profile API (mock)
  // ---------------------
  async listSpawnProfiles() {
    return [];
  },

  async setSpawnProfile(_name: string, _model: string) {
    // No-op in local mode
  },

  async deleteSpawnProfile(_name: string) {
    // No-op in local mode
  },

  // ---------------------
  // LLM Provider API (mapped to existing IPC)
  // ---------------------
  async listLlmProviders() {
    const config = await api.getModelConfig();
    return config.providers;
  },

  // ---------------------
  // Skill API (mock)
  // ---------------------
  async listSkills() {
    if (!window.xiaokDesktop?.listSkills) return [];
    try {
      return await window.xiaokDesktop.listSkills();
    } catch {
      return [];
    }
  },

  // ---------------------
  // Memory API (localStorage)
  // ---------------------
  async getMemoryConfig() {
    try {
      const raw = localStorage.getItem('xiaok:memory-config');
      return raw ? JSON.parse(raw) : { enabled: false };
    } catch { return { enabled: false }; }
  },

  async saveMemoryConfig(config: { enabled: boolean }) {
    try { localStorage.setItem('xiaok:memory-config', JSON.stringify(config)) } catch { /* noop */ }
    return config;
  },

  // ---------------------
  // Connectors API (mock)
  // ---------------------
  async getConnectorsConfig(): Promise<{ fetch: { provider: 'none' }; search: { provider: 'none' } }> {
    return {
      fetch: { provider: 'none' },
      search: { provider: 'none' },
    };
  },

  // ---------------------
  // Appearance API (localStorage)
  // ---------------------
  async getAppearanceConfig() {
    try {
      const raw = localStorage.getItem('xiaok:appearance-config');
      return raw ? JSON.parse(raw) : { fontSize: 'default', density: 'default', themeMode: 'system' };
    } catch { return { fontSize: 'default', density: 'default', themeMode: 'system' }; }
  },

  async saveAppearanceConfig(config: Record<string, string>) {
    try {
      const current = await api.getAppearanceConfig();
      const next = { ...current, ...config };
      localStorage.setItem('xiaok:appearance-config', JSON.stringify(next));
      return next;
    } catch { return config; }
  },

  // ---------------------
  // Credits API (mock)
  // ---------------------
  async getCreditsBalance() {
    return { balance: 0 };
  },

  // ---------------------
  // Account Settings (localStorage)
  // ---------------------
  async getAccountSettings() {
    try {
      const raw = localStorage.getItem('xiaok:account-settings');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  },
  async updateAccountSettings(settings: Record<string, unknown>) {
    const current = await api.getAccountSettings();
    const next = { ...current, ...settings };
    try { localStorage.setItem('xiaok:account-settings', JSON.stringify(next)) } catch { /* noop */ }
    return next;
  },
  async updateMe(payload: { username?: string; timezone?: string | null }) {
    try {
      const key = 'xiaok:me';
      const current = JSON.parse(localStorage.getItem(key) || '{}');
      const next = { ...current, ...payload };
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    } catch { return {}; }
  },

  // ---------------------
  // Usage Analytics (mock — no usage tracking in local mode)
  // ---------------------
  async getMyUsage() {
    return { totalRequests: 0, totalTokens: 0 };
  },
  async getMyDailyUsage() {
    return [];
  },
  async getMyHourlyUsage() {
    return [];
  },
  async getMyUsageByModel() {
    return [];
  },

  // ---------------------
  // Memory API (localStorage stub)
  // ---------------------
  async listMemoryErrors() {
    return [];
  },

  // ---------------------
  // Runs API (mock)
  // ---------------------
  async listRuns() {
    return [];
  },

  // ---------------------
  // Feedback API (mock)
  // ---------------------
  async createSuggestionFeedback() {
    // Store locally for now
    try {
      const key = 'xiaok:suggestions';
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push({ createdAt: Date.now() });
      localStorage.setItem(key, JSON.stringify(existing));
    } catch { /* noop */ }
  },
};

export function isApiError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('api') || msg.includes('provider') || msg.includes('model') || msg.includes('connection');
  }
  return false;
}

export type Api = typeof api;