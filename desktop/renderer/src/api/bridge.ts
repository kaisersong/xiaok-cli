import { createLogger } from '../lib/logger';
import type {
  FullDesktopApi,
  DesktopRelatedServiceId,
  DesktopServiceStatusSnapshot,
  DesktopModelConfigSnapshot,
  DesktopMobilePairingInfo,
  DesktopSaveModelConfigInput,
  MaterialView,
  MaterialRole,
  TaskCreateContext,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
  DesktopTaskEvent,
  ProtocolId,
  ConnectorTestResult,
} from '../../../electron/preload-api';
import type {
  AutomationOverviewSnapshotView,
  AutomationRunHistoryItemView,
  AutomationsConfigView,
  EvidenceAnomalyView,
  CreateLoopScheduleInputView,
  CreateUserLoopTemplateInputView,
  CreateUserLoopTemplateResultView,
  LearnedConstraintView,
  LoopDefinitionView,
  LoopOutputActionResultView,
  LoopOutputPreviewView,
  LoopRunView,
  LoopScheduleBindingView,
  RunLoopNowResultView,
  TimedActionView,
  ThreadMode,
  ThreadRecord,
  UpdateThreadSidebarRequest,
  UserLoopTemplateView,
} from './types';
import type { ChannelBindingResponse, ChannelIdentityResponse, Persona } from './types';
import { getDesktopApi } from '../shared/desktop';

// Declare window.xiaokDesktop with exact types from preload-api.ts
declare global {
  interface Window {
    xiaokDesktop: FullDesktopApi;
  }
}

// IndexedDB helpers for thread storage
const DB_NAME = 'xiaok-desktop';
const DB_VERSION = 1;
const THREADS_STORE = 'threads';

function timestampToIso(value: number): string {
  return Number.isFinite(value) ? new Date(value).toISOString() : new Date(0).toISOString();
}

export function withThreadCompatibility(thread: ThreadRecord): ThreadRecord {
  return {
    ...thread,
    created_at: thread.created_at ?? timestampToIso(thread.createdAt),
    updated_at: thread.updated_at ?? timestampToIso(thread.updatedAt),
    sidebar_gtd_bucket: thread.sidebar_gtd_bucket ?? thread.gtdBucket,
    sidebar_pinned_at: thread.sidebar_pinned_at ?? thread.pinnedAt,
  };
}

export function withoutThreadCompatibility(thread: ThreadRecord): ThreadRecord {
  const {
    created_at,
    updated_at,
    active_run_id,
    sidebar_pinned_at,
    sidebar_gtd_bucket,
    is_private,
    collaboration_mode,
    collaboration_mode_revision,
    ...stored
  } = thread;
  void created_at;
  void updated_at;
  void active_run_id;
  void sidebar_pinned_at;
  void sidebar_gtd_bucket;
  void is_private;
  void collaboration_mode;
  void collaboration_mode_revision;
  return stored;
}

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
  context?: TaskCreateContext;
  retries?: number;
}): Promise<{ taskId: string; understanding: TaskUnderstanding }> {
  return await window.xiaokDesktop.createTask(input);
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
      taskIds: [],
    };
    await withStore('readwrite', (store) => store.add(thread));
    return withThreadCompatibility(thread);
  },

  async getThread(id: string): Promise<ThreadRecord | null> {
    const result = await withStore('readonly', (store) => store.get(id));
    if (!result) return null;
    return withThreadCompatibility({
      ...result,
      currentTaskId: result.currentTaskId ?? null,
      taskIds: result.taskIds ?? [],
    });
  },

  async listThreads(options?: {
    limit?: number;
    before?: string;
    mode?: ThreadMode;
  }): Promise<ThreadRecord[]> {
    const all = await withStore('readonly', (store) => store.getAll());
    // Sort by createdAt descending
    all.sort((a, b) => b.createdAt - a.createdAt);
    const normalized = all.map(t => withThreadCompatibility({
      ...t,
      currentTaskId: t.currentTaskId ?? null,
      taskIds: t.taskIds ?? [],
    }));
    const filtered = options?.mode ? normalized.filter((thread) => thread.mode === options.mode) : normalized;
    if (options?.before) {
      const idx = filtered.findIndex((t) => t.id === options.before);
      if (idx >= 0) {
        return filtered.slice(idx + 1, idx + 1 + (options.limit ?? 20));
      }
    }
    return filtered.slice(0, options?.limit ?? 20);
  },

  async updateThreadTitle(id: string, title: string): Promise<void> {
    const thread = await api.getThread(id);
    if (!thread) throw new Error(`Thread ${id} not found`);
    thread.title = title;
    thread.updatedAt = Date.now();
    await withStore('readwrite', (store) => store.put(withoutThreadCompatibility(thread)));
  },

  async updateThreadSidebarState(
    id: string,
    state: { starred?: boolean; gtdBucket?: ThreadRecord['gtdBucket']; mode?: ThreadMode; sidebar_work_folder?: string | null }
  ): Promise<void> {
    const thread = await api.getThread(id);
    if (!thread) throw new Error(`Thread ${id} not found`);
    if (state.starred !== undefined) {
      thread.starred = state.starred;
      thread.pinnedAt = state.starred ? Date.now() : null;
    }
    if (state.gtdBucket !== undefined) thread.gtdBucket = state.gtdBucket;
    if (state.mode !== undefined) thread.mode = state.mode;
    if (state.sidebar_work_folder !== undefined) thread.sidebar_work_folder = state.sidebar_work_folder;
    thread.updatedAt = Date.now();
    await withStore('readwrite', (store) => store.put(withoutThreadCompatibility(thread)));
  },

  async updateThreadTaskId(id: string, taskId: string): Promise<void> {
    const thread = await api.getThread(id);
    if (!thread) throw new Error(`Thread ${id} not found`);
    thread.currentTaskId = taskId;
    if (!thread.taskIds.includes(taskId)) {
      thread.taskIds.push(taskId);
    }
    thread.updatedAt = Date.now();
    await withStore('readwrite', (store) => store.put(withoutThreadCompatibility(thread)));
  },

  async deleteThread(id: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(id));
  },

  async searchThreads(query: string): Promise<ThreadRecord[]> {
    const all = await withStore('readonly', (store) => store.getAll());
    const lower = query.toLowerCase();
    return all.filter(
      (t) => t.title?.toLowerCase().includes(lower)
    ).map((t) => withThreadCompatibility({ ...t, currentTaskId: t.currentTaskId ?? null, taskIds: t.taskIds ?? [] }));
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
    context?: TaskCreateContext;
  }): Promise<{ taskId: string; understanding: TaskUnderstanding }> {
    log.info('createTask', JSON.stringify({ prompt: input.prompt, materialsCount: input.materials.length }));
    const result = await createTaskWithRetry(input);
    log.info('createTask ok', JSON.stringify({ taskId: result.taskId }));
    return result;
  },

  async createTaskWithFiles(input: {
    prompt: string;
    filePaths: string[];
    context?: TaskCreateContext;
  }): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    log.info('createTaskWithFiles', JSON.stringify({ prompt: input.prompt, filesCount: input.filePaths.length }));
    const result = await window.xiaokDesktop.createTaskWithFiles(input);
    log.info('createTaskWithFiles ok', JSON.stringify({ taskId: result.taskId }));
    return result;
  },

  subscribeTask(
    taskId: string,
    handler: (event: DesktopTaskEvent) => void,
    sinceIndex?: number
  ): () => void {
    log.info('subscribeTask', taskId);
    const unsub = window.xiaokDesktop.subscribeTask(taskId, handler, sinceIndex);
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

  async getLoopDefinitions(): Promise<LoopDefinitionView[]> {
    return await window.xiaokDesktop.getLoopDefinitions() as LoopDefinitionView[];
  },

  async getLoopRuns(loopId: string): Promise<LoopRunView[]> {
    return await window.xiaokDesktop.getLoopRuns(loopId) as LoopRunView[];
  },

  async getEvidenceAnomalies(loopId: string): Promise<EvidenceAnomalyView[]> {
    return await window.xiaokDesktop.getEvidenceAnomalies(loopId) as EvidenceAnomalyView[];
  },

  async runLoopNow(loopId: string): Promise<RunLoopNowResultView> {
    return await window.xiaokDesktop.runLoopNow(loopId) as RunLoopNowResultView;
  },

  async listUserLoopTemplates(): Promise<UserLoopTemplateView[]> {
    return await window.xiaokDesktop.listUserLoopTemplates() as UserLoopTemplateView[];
  },

  async createUserLoopTemplate(input: CreateUserLoopTemplateInputView): Promise<CreateUserLoopTemplateResultView> {
    return await window.xiaokDesktop.createUserLoopTemplate(input) as CreateUserLoopTemplateResultView;
  },

  async updateUserLoopTemplate(loopId: string, patch: { title?: string; description?: string; prompt?: string; outputDirectory?: string; outputFileName?: string }): Promise<unknown> {
    return await window.xiaokDesktop.updateUserLoopTemplate(loopId, patch);
  },

  async deleteUserLoopTemplate(loopId: string): Promise<void> {
    await window.xiaokDesktop.deleteUserLoopTemplate(loopId);
  },

  async clearLoopRunHistory(loopId: string, statuses?: string[]): Promise<{ ok: boolean; removed: number }> {
    return await window.xiaokDesktop.clearLoopRunHistory(loopId, statuses);
  },

  async clearScheduledTaskRunHistory(actionId: string, statuses?: string[]): Promise<{ ok: boolean; removed: number }> {
    return await window.xiaokDesktop.clearScheduledTaskRunHistory(actionId, statuses);
  },

  async createLoopSchedule(input: CreateLoopScheduleInputView): Promise<TimedActionView> {
    return await window.xiaokDesktop.createLoopSchedule(input) as TimedActionView;
  },

  async getLoopScheduleBindings(): Promise<LoopScheduleBindingView[]> {
    return await window.xiaokDesktop.getLoopScheduleBindings() as LoopScheduleBindingView[];
  },

  async getAutomationOverviewSnapshot(): Promise<AutomationOverviewSnapshotView> {
    return await window.xiaokDesktop.getAutomationOverviewSnapshot() as AutomationOverviewSnapshotView;
  },

  async getAutomationRunHistory(): Promise<AutomationRunHistoryItemView[]> {
    return await window.xiaokDesktop.getAutomationRunHistory() as AutomationRunHistoryItemView[];
  },

  async getAutomationsConfig(): Promise<AutomationsConfigView> {
    return await window.xiaokDesktop.getAutomationsConfig() as AutomationsConfigView;
  },

  async setGlobalBackgroundAutoRun(input: { enabled: boolean }): Promise<AutomationsConfigView> {
    return await window.xiaokDesktop.setGlobalBackgroundAutoRun(input) as AutomationsConfigView;
  },

  async openLoopOutputDirectory(loopId: string): Promise<LoopOutputActionResultView> {
    return await window.xiaokDesktop.openLoopOutputDirectory(loopId) as LoopOutputActionResultView;
  },

  async readLoopOutputPreview(loopId: string): Promise<LoopOutputPreviewView> {
    return await window.xiaokDesktop.readLoopOutputPreview(loopId) as LoopOutputPreviewView;
  },

  async listLoopConstraints(loopId: string): Promise<LearnedConstraintView[]> {
    return await window.xiaokDesktop.listLoopConstraints(loopId) as LearnedConstraintView[];
  },

  async setLoopConstraintActive(constraintId: string, active: boolean): Promise<LearnedConstraintView | undefined> {
    return await window.xiaokDesktop.setLoopConstraintActive(constraintId, active) as LearnedConstraintView | undefined;
  },

  async confirmLoopConstraint(constraintId: string): Promise<LearnedConstraintView | undefined> {
    return await window.xiaokDesktop.confirmLoopConstraint(constraintId) as LearnedConstraintView | undefined;
  },

  onLoopConstraintAdded(handler: (constraint: LearnedConstraintView) => void): () => void {
    return window.xiaokDesktop.onLoopConstraintAdded((constraint) => handler(constraint as LearnedConstraintView));
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

  async createManagedXiaokAgent(input: {
    name: string;
    description?: string;
    roles?: string[];
    capabilities?: string[];
    instructions?: string;
    maxConcurrentTasks?: number;
  }): Promise<unknown> {
    log.info('createManagedXiaokAgent', JSON.stringify({ name: input.name, roles: input.roles }));
    const r = await window.xiaokDesktop.createManagedXiaokAgent(input);
    log.info('createManagedXiaokAgent ok');
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

  async getMobilePairingInfo(): Promise<DesktopMobilePairingInfo> {
    return await window.xiaokDesktop.getMobilePairingInfo();
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

  async readFileContent(filePath: string): Promise<{ content: string; error?: string }> {
    log.info('readFileContent', filePath);
    return await window.xiaokDesktop.readFileContent(filePath);
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
  async testChannel(channelId: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    if (!window.xiaokDesktop?.testChannel) {
      return { success: false, error: 'testChannel API not available' };
    }
    return await window.xiaokDesktop.testChannel(channelId);
  },
  async listChannelBindings(_accessToken: string, channelId: string): Promise<ChannelBindingResponse[]> {
    const api = getDesktopApi();
    if (!api?.kswarmProxyGet) return [];
    try {
      const data = await api.kswarmProxyGet(`/channels/${channelId}/bindings`) as { bindings?: ChannelBindingResponse[] } | null;
      return data?.bindings ?? [];
    } catch {
      return [];
    }
  },
  async deleteChannelBinding(_accessToken: string, channelId: string, bindingId: string): Promise<void> {
    const api = getDesktopApi();
    if (!api?.kswarmProxyDelete) return;
    await api.kswarmProxyDelete(`/channels/${channelId}/bindings/${bindingId}`);
  },
  async updateChannelBinding(_accessToken: string, channelId: string, bindingId: string, patch: Record<string, unknown>): Promise<ChannelBindingResponse | null> {
    const api = getDesktopApi();
    if (!api?.kswarmProxyPatch) return null;
    return await api.kswarmProxyPatch(`/channels/${channelId}/bindings/${bindingId}`, patch) as ChannelBindingResponse | null;
  },
  async createChannelBindCode(_accessToken: string, channelType: string): Promise<{ token: string } | null> {
    const api = getDesktopApi();
    if (!api?.kswarmProxyPost) return null;
    return await api.kswarmProxyPost('/channel-bind-codes', { channelType }) as { token: string } | null;
  },
  async listChannelPersonas(_accessToken: string): Promise<Persona[]> {
    const api = getDesktopApi();
    if (!api?.kswarmProxyGet) return [];
    try {
      const data = await api.kswarmProxyGet('/channel-personas') as { personas?: Persona[] } | null;
      return data?.personas ?? [];
    } catch {
      return [];
    }
  },
  async listMyChannelIdentities(_accessToken: string): Promise<ChannelIdentityResponse[]> {
    const api = getDesktopApi();
    if (!api?.kswarmProxyGet) return [];
    try {
      const data = await api.kswarmProxyGet('/channel-identities/mine') as { identities?: ChannelIdentityResponse[] } | null;
      return data?.identities ?? [];
    } catch {
      return [];
    }
  },
  async unbindChannelIdentity(_accessToken: string, identityId: string): Promise<void> {
    const api = getDesktopApi();
    if (!api?.kswarmProxyDelete) return;
    await api.kswarmProxyDelete(`/channel-identities/${identityId}`);
  },
  async verifyChannel(_accessToken: string, channelId: string): Promise<{ verified: boolean }> {
    const api = getDesktopApi();
    if (!api?.kswarmProxyPost) return { verified: false };
    try {
      const data = await api.kswarmProxyPost(`/channels/${channelId}/verify`, {}) as { verified?: boolean } | null;
      return { verified: data?.verified ?? false };
    } catch {
      return { verified: false };
    }
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
  async listPluginMcpServers() {
    return window.xiaokDesktop.listPluginMcpServers();
  },
  async setPluginMcpServerEnabled(input: { name: string; enabled: boolean }) {
    return window.xiaokDesktop.setPluginMcpServerEnabled(input);
  },
  async restartPluginMcpServers() {
    return window.xiaokDesktop.restartPluginMcpServers();
  },
  async restartPluginMcpServer(input: { name: string }) {
    return window.xiaokDesktop.restartPluginMcpServer(input);
  },
  async getComputerUseCapabilityStatus() {
    return window.xiaokDesktop.getComputerUseCapabilityStatus();
  },
  async enableComputerUse() {
    return window.xiaokDesktop.enableComputerUse();
  },
  async reconnectComputerUse() {
    return window.xiaokDesktop.reconnectComputerUse();
  },
  async disableComputerUse() {
    return window.xiaokDesktop.disableComputerUse();
  },
  async openPluginDependencyPermissionSettings(input: { permission: 'accessibility' | 'screen' }) {
    return window.xiaokDesktop.openPluginDependencyPermissionSettings(input);
  },
  async installPlugin(name: string) {
    return window.xiaokDesktop.installPlugin(name);
  },
  async listPluginDependencyStatuses() {
    return window.xiaokDesktop.listPluginDependencyStatuses();
  },
  async installPluginDependency(input: { pluginName: string; dependencyId: string; confirmed?: boolean }) {
    return window.xiaokDesktop.installPluginDependency(input);
  },
  async updatePluginDependency(input: { pluginName: string; dependencyId: string; confirmed?: boolean }) {
    return window.xiaokDesktop.updatePluginDependency(input);
  },
  async diagnosePluginDependency(input: { pluginName: string; dependencyId: string }) {
    return window.xiaokDesktop.diagnosePluginDependency(input);
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
    return config.providers.map(p => ({ ...p, models: config.models.filter(m => m.provider === p.id) }));
  },

  async createLlmProvider(input: { providerId: string; label: string; protocol: string; apiKey?: string; baseUrl?: string; advanced_json?: Record<string, unknown> }) {
    return api.saveModelConfig({
      providerId: input.providerId,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      protocol: input.protocol as ProtocolId,
    });
  },

  async updateLlmProvider(providerId: string, input: { label?: string; protocol?: string; apiKey?: string; baseUrl?: string; advanced_json?: Record<string, unknown> }) {
    const payload: DesktopSaveModelConfigInput = {
      providerId,
      label: input.label,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
    };
    if (input.protocol) payload.protocol = input.protocol as ProtocolId;
    return api.saveModelConfig(payload);
  },

  async deleteLlmProvider(providerId: string) {
    await api.deleteProvider(providerId);
  },

  async createProviderModel(input: { providerId: string; model: string; label: string; capabilities?: string[] }) {
    return api.saveModelConfig({
      providerId: input.providerId,
      modelName: input.model,
      label: input.label,
    });
  },

  async deleteProviderModel(modelId: string) {
    await api.deleteModel(modelId);
  },

  async patchProviderModel(modelId: string, input: { label?: string; capabilities?: string[] }) {
    const config = await api.getModelConfig();
    const model = config.models.find(m => m.id === modelId);
    if (!model) throw new Error('Model not found');
    return api.saveModelConfig({
      providerId: model.provider,
      modelName: model.model,
      label: input.label || model.label,
    });
  },

  async listAvailableModels() {
    // Return all profiles from config
    const config = await api.getModelConfig();
    return config.providerProfiles;
  },

  async testLlmProviderModel(input: { providerId: string; modelId?: string }) {
    return api.testProviderConnection({ providerId: input.providerId, modelId: input.modelId });
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
  async installSkill(skillName: string): Promise<{ success: boolean; message: string }> {
    if (!window.xiaokDesktop?.installSkill) {
      return { success: false, message: 'installSkill API not available' };
    }
    return await window.xiaokDesktop.installSkill(skillName);
  },
  async uninstallSkill(skillName: string): Promise<{ success: boolean; message: string }> {
    if (!window.xiaokDesktop?.uninstallSkill) {
      return { success: false, message: 'uninstallSkill API not available' };
    }
    return await window.xiaokDesktop.uninstallSkill(skillName);
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
  // Connectors API
  // ---------------------
  async getConnectorsConfig(): Promise<import('./types').ConnectorsConfigSnapshot | null> {
    const desktop = (window as unknown as { xiaokDesktop?: { getConnectorsConfig?: () => Promise<import('./types').ConnectorsConfigSnapshot | null> } }).xiaokDesktop;
    if (desktop?.getConnectorsConfig) {
      try {
        return await desktop.getConnectorsConfig();
      } catch {
        return null;
      }
    }
    return {
      config: {
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'basic' },
      },
      loadStatus: 'missing',
      providers: [],
    };
  },
  async saveConnectorsConfig(input: import('./types').ConnectorsConfig): Promise<import('./types').ConnectorsConfigSnapshot | null> {
    const desktop = (window as unknown as { xiaokDesktop?: { saveConnectorsConfig?: (input: unknown) => Promise<import('./types').ConnectorsConfigSnapshot> } }).xiaokDesktop;
    if (desktop?.saveConnectorsConfig) {
      try {
        return await desktop.saveConnectorsConfig(input);
      } catch {
        return null;
      }
    }
    return null;
  },
  async listConnectorRuntimes(): Promise<import('./types').ConnectorsProviderRuntime[]> {
    const desktop = (window as unknown as { xiaokDesktop?: { listConnectorRuntimes?: () => Promise<import('./types').ConnectorsProviderRuntime[]> } }).xiaokDesktop;
    if (desktop?.listConnectorRuntimes) {
      try {
        return await desktop.listConnectorRuntimes();
      } catch {
        return [];
      }
    }
    return [];
  },
  async testConnectorProvider(kind: 'search' | 'fetch'): Promise<ConnectorTestResult> {
    const desktop = (window as unknown as { xiaokDesktop?: { testConnectorProvider?: (kind: 'search' | 'fetch') => Promise<ConnectorTestResult> } }).xiaokDesktop;
    if (desktop?.testConnectorProvider) {
      try {
        return await desktop.testConnectorProvider(kind);
      } catch (e) {
        return { success: false, latencyMs: 0, providerName: 'unknown', error: (e as Error).message };
      }
    }
    return { success: false, latencyMs: 0, providerName: 'none', error: 'not available in browser' };
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

  // ---------------------
  // Update API (IPC)
  // ---------------------
  async getUpdateStatus() {
    return window.xiaokDesktop.getUpdateStatus();
  },
  async checkForUpdates() {
    return window.xiaokDesktop.checkForUpdates();
  },
  async quitAndInstall() {
    return window.xiaokDesktop.quitAndInstall();
  },
  onUpdateStatus(handler: (status: { checking: boolean; available: boolean; downloading: boolean; downloaded: boolean; installing?: boolean; progress: number; version?: string; error?: string }) => void) {
    return window.xiaokDesktop.onUpdateStatus(handler);
  },

  // ---------------------
  // Reminder API (IPC)
  // ---------------------
  async createReminder(input: { content: string; scheduleAt: number; timezone?: string }) {
    return window.xiaokDesktop.createReminder(input);
  },
  async listReminders() {
    return window.xiaokDesktop.listReminders();
  },
  async cancelReminder(id: string) {
    return window.xiaokDesktop.cancelReminder(id);
  },
  async getReminderStatus() {
    return window.xiaokDesktop.getReminderStatus();
  },
  onReminder(handler: (event: { reminderId: string; content: string; createdAt: number }) => void) {
    return window.xiaokDesktop.onReminder(handler);
  },

  // ---------------------
  // Skill Debug API (IPC)
  // ---------------------
  async getSkillDebugConfig() {
    return window.xiaokDesktop.getSkillDebugConfig();
  },
  async saveSkillDebugConfig(input: { enabled: boolean }) {
    return window.xiaokDesktop.saveSkillDebugConfig(input);
  },

  // KSwarm Config API (IPC)
  // -----------------------
  async getKswarmConfig() {
    return window.xiaokDesktop.getKswarmConfig();
  },
  async saveKswarmConfig(input: { maxConcurrentTasks: number }) {
    return window.xiaokDesktop.saveKswarmConfig(input);
  },

  async getSkillStats() {
    try {
      return await window.xiaokDesktop.getSkillStats();
    } catch {
      return [];
    }
  },

  // ---------------------
  // Related Service Status API (IPC)
  // ---------------------
  async getServiceStatus(): Promise<DesktopServiceStatusSnapshot> {
    return window.xiaokDesktop.getServiceStatus();
  },
  async restartRelatedService(serviceId: DesktopRelatedServiceId): Promise<void> {
    return window.xiaokDesktop.restartRelatedService(serviceId);
  },

  // ---------------------
  // Memory API (IPC)
  // ---------------------
  async listMemories() {
    try {
      return await window.xiaokDesktop.listMemories();
    } catch {
      return [];
    }
  },
  async createMemory(input: { content: string; tags: string[]; source?: string }) {
    return await window.xiaokDesktop.createMemory(input);
  },
  async updateMemory(input: { id: string; content?: string; tags?: string[] }) {
    return await window.xiaokDesktop.updateMemory(input);
  },
  async deleteMemory(id: string) {
    return await window.xiaokDesktop.deleteMemory(id);
  },
  async importMemories(raw: string) {
    return await window.xiaokDesktop.importMemories(raw);
  },
};

// Skill management functions — bridge between skill API and desktop local skill system
// These are standalone exports (not on `api` object) because SkillsSettingsContent imports them directly.

export interface InstalledSkill {
  skill_key: string;
  display_name: string;
  description?: string;
  version: string;
  source: string;
  is_platform: boolean;
  platform_status?: string;
  registry_slug?: string;
  registry_provider?: string;
  registry_source_url?: string;
  registry_detail_url?: string;
  registry_owner_handle?: string;
  updated_at?: string;
  scan_status?: string;
  scan_has_warnings?: boolean;
  scan_summary?: string;
  moderation_verdict?: string;
}

export interface MarketSkill {
  skill_key: string;
  display_name: string;
  description?: string;
  version: string;
  registry_slug?: string;
  detail_url?: string;
  repository_url?: string;
  installed: boolean;
  enabled_by_default: boolean;
  scan_status?: string;
  scan_has_warnings?: boolean;
  scan_summary?: string;
  moderation_verdict?: string;
}

export interface SkillPackageResponse extends InstalledSkill {}

export interface SkillReference {
  skill_key: string;
  version: string;
}

export interface SkillImportCandidate {
  skill_key: string;
  display_name: string;
  description?: string;
  version: string;
  source: string;
}

export interface PlatformSkillItem {
  skill_key: string;
  display_name: string;
  description?: string;
  version: string;
  platform_status: string;
}

export async function listInstalledSkills(_accessToken: string): Promise<InstalledSkill[]> {
  try {
    const skills = await api.listSkills();
    return skills.map((s: { name: string; aliases?: string[]; description?: string; source?: string; tier?: string }) => ({
      skill_key: s.name,
      display_name: s.name,
      description: s.description,
      version: '1.0.0',
      source: s.source || 'builtin',
      is_platform: false,
      updated_at: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function listDefaultSkills(_accessToken: string): Promise<InstalledSkill[]> {
  return [];
}

export async function listPlatformSkills(_accessToken: string): Promise<PlatformSkillItem[]> {
  try {
    const skills = await api.listSkills();
    return skills
      .filter((s: { source?: string }) => s.source === 'builtin' || s.source === 'platform')
      .map((s: { name: string; description?: string }) => ({
        skill_key: s.name,
        display_name: s.name,
        description: s.description,
        version: '1.0.0',
        platform_status: 'auto',
      }));
  } catch {
    return [];
  }
}

export async function searchMarketSkills(_accessToken: string, _query: string, _officialOnly: boolean): Promise<MarketSkill[]> {
  return [];
}

export async function installSkill(_accessToken: string, ref: SkillReference): Promise<{ success: boolean; message: string }> {
  return api.installSkill(ref.skill_key);
}

export async function deleteSkill(_accessToken: string, ref: SkillReference): Promise<void> {
  const result = await api.uninstallSkill(ref.skill_key);
  if (!result.success) throw new Error(result.message);
}

export async function importRegistrySkill(_accessToken: string, _input: { slug: string; version?: string; skill_key?: string; detail_url?: string; repository_url?: string }): Promise<SkillPackageResponse> {
  throw new Error('Marketplace not available in desktop mode');
}

export async function importSkillFromGitHub(_accessToken: string, _input: { repositoryUrl: string }): Promise<{ candidates: SkillImportCandidate[] }> {
  throw new Error('GitHub import not available in desktop mode');
}

export async function importSkillFromUpload(_input: { fileName: string; content: string }): Promise<{ candidates: SkillImportCandidate[] }> {
  throw new Error('Upload import not available in desktop mode');
}

export async function replaceDefaultSkills(_accessToken: string, _refs: SkillReference[]): Promise<InstalledSkill[]> {
  return listInstalledSkills(_accessToken);
}

export async function setPlatformSkillOverride(_accessToken: string, _skillKey: string, _version: string, _status: string): Promise<void> {
  // No-op in desktop mode
}

export type ExternalSkillDir = { path: string; skills: Array<{ name: string; instruction_path: string }> };

export function discoverExternalSkills(_accessToken: string): Promise<{ dirs: ExternalSkillDir[] }> {
  return Promise.resolve({ dirs: [] });
}

export function getExternalDirs(_accessToken: string): Promise<string[]> {
  return Promise.resolve([]);
}

export function setExternalDirs(_accessToken: string, _dirs: string[]): Promise<string[]> {
  return Promise.resolve(_dirs);
}

export interface ApiErrorLike extends Error {
  status?: number;
}

export function isApiError(error: unknown): error is ApiErrorLike {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('api') || msg.includes('provider') || msg.includes('model') || msg.includes('connection');
  }
  return false;
}

// Standalone function exports for thread-list.tsx compatibility (web-client naming convention).
// These delegate to the `api` object methods.

export async function listThreads(accessToken: string, options?: { limit?: number; before?: string; mode?: ThreadMode }): Promise<ThreadRecord[]> {
  void accessToken;
  return api.listThreads(options);
}

export async function updateThreadSidebarState(accessToken: string, id: string, state: UpdateThreadSidebarRequest): Promise<ThreadRecord> {
  void accessToken;
  const patch: Parameters<typeof api.updateThreadSidebarState>[1] = {};
  if (state.starred !== undefined) patch.starred = state.starred;
  if (state.sidebar_pinned !== undefined) patch.starred = state.sidebar_pinned;
  if (state.gtdBucket !== undefined) patch.gtdBucket = state.gtdBucket;
  if (state.sidebar_gtd_bucket !== undefined) patch.gtdBucket = state.sidebar_gtd_bucket;
  if (state.mode !== undefined) patch.mode = state.mode;
  if (state.sidebar_work_folder !== undefined) patch.sidebar_work_folder = state.sidebar_work_folder;
  await api.updateThreadSidebarState(id, patch);
  const thread = await api.getThread(id);
  if (!thread) throw new Error(`Thread ${id} not found`);
  return thread;
}

export async function updateThreadMode(_accessToken: string, _threadId: string, _mode: ThreadMode): Promise<ThreadRecord> {
  await api.updateThreadSidebarState(_threadId, { mode: _mode });
  const thread = await api.getThread(_threadId);
  if (!thread) throw new Error(`Thread ${_threadId} not found`);
  return thread;
}

export interface ThreadRunStateEvent {
  thread_id: string;
  active_run_id: string | null;
  title?: string | null;
}

export async function streamThreadRunStateEvents(
  _accessToken: string,
  _options: { signal?: AbortSignal; onEvent?: (event: ThreadRunStateEvent) => void; onError?: (error: unknown) => void },
): Promise<void> {
  // No-op: desktop uses IPC-based SSE events, not direct HTTP streaming.
  // The thread-list context falls back to polling when this returns immediately.
}

export type Api = typeof api;
