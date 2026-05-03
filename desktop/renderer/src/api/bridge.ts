import type {
  DesktopApi,
  DesktopModelConfigSnapshot,
  DesktopSaveModelConfigInput,
} from '../../../electron/preload-api';
import type {
  MaterialView,
  MaterialRole,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
  DesktopTaskEvent,
} from '../../../runtime/task-host/types';
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
    request.onsuccess = () => resolve(request.result);
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
// API Bridge: Maps Arkloop Go backend API to xiaok Electron IPC
// ============================================================

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
    };
    await withStore('readwrite', (store) => store.add(thread));
    return thread;
  },

  async getThread(id: string): Promise<ThreadRecord | null> {
    const result = await withStore('readonly', (store) => store.get(id));
    return result ?? null;
  },

  async listThreads(options?: {
    limit?: number;
    before?: string;
  }): Promise<ThreadRecord[]> {
    const all = await withStore('readonly', (store) => store.getAll());
    // Sort by createdAt descending
    all.sort((a, b) => b.createdAt - a.createdAt);
    if (options?.before) {
      const idx = all.findIndex((t) => t.id === options.before);
      if (idx >= 0) {
        return all.slice(idx + 1, idx + 1 + (options.limit ?? 20));
      }
    }
    return all.slice(0, options?.limit ?? 20);
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
    return window.xiaokDesktop.createTask(input);
  },

  subscribeTask(
    taskId: string,
    handler: (event: DesktopTaskEvent) => void
  ): () => void {
    return window.xiaokDesktop.subscribeTask(taskId, handler);
  },

  async answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void> {
    return window.xiaokDesktop.answerQuestion(input);
  },

  async cancelTask(taskId: string): Promise<void> {
    return window.xiaokDesktop.cancelTask(taskId);
  },

  async getActiveTask(): Promise<{ taskId: string } | null> {
    return window.xiaokDesktop.getActiveTask();
  },

  async recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }> {
    return window.xiaokDesktop.recoverTask(taskId);
  },

  // ---------------------
  // Model Config API (IPC)
  // ---------------------
  async getModelConfig(): Promise<DesktopModelConfigSnapshot> {
    return window.xiaokDesktop.getModelConfig();
  },

  async saveModelConfig(input: DesktopSaveModelConfigInput): Promise<DesktopModelConfigSnapshot> {
    return window.xiaokDesktop.saveModelConfig(input);
  },

  // ---------------------
  // Material API (IPC)
  // ---------------------
  async selectMaterials(): Promise<{ filePaths: string[] }> {
    return window.xiaokDesktop.selectMaterials();
  },

  async importMaterial(input: {
    taskId: string;
    filePath: string;
    role: MaterialRole;
  }): Promise<MaterialView> {
    return window.xiaokDesktop.importMaterial(input);
  },

  // ---------------------
  // Artifact API (IPC)
  // ---------------------
  async openArtifact(artifactId: string): Promise<void> {
    return window.xiaokDesktop.openArtifact(artifactId);
  },

  // ---------------------
  // Persona API (mock)
  // ---------------------
  async listPersonas() {
    // No personas in local mode
    return [];
  },

  async getActivePersona() {
    // No active persona in local mode
    return null;
  },

  // ---------------------
  // Skill API (mock)
  // ---------------------
  async listSkills() {
    // No skills in local mode
    return [];
  },

  // ---------------------
  // Memory API (mock)
  // ---------------------
  async getMemoryConfig() {
    return { enabled: false };
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
  // Credits API (mock)
  // ---------------------
  async getCreditsBalance() {
    // No credits in local mode
    return { balance: 0 };
  },
};

export type Api = typeof api;