import type { IpcRenderer } from 'electron';
import type {
  DesktopTaskEvent,
  MaterialView,
  MaterialRole,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
} from '../../src/runtime/task-host/types.js';
import type { ProtocolId } from '../../src/ai/providers/types.js';

// Re-export types for renderer usage
export type {
  DesktopTaskEvent,
  MaterialView,
  MaterialRole,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
  ProtocolId,
};

export const PRELOAD_API_KEYS = [
  'getModelConfig',
  'saveModelConfig',
  'testProviderConnection',
  'listAvailableModelsForProvider',
  'deleteProvider',
  'deleteModel',
  'selectMaterials',
  'importMaterial',
  'createTask',
  'createTaskWithFiles',
  'subscribeTask',
  'answerQuestion',
  'cancelTask',
  'getActiveTask',
  'recoverTask',
  'openArtifact',
  'listSkills',
  'listChannels',
  'createChannel',
  'updateChannel',
  'deleteChannel',
  'listMCPInstalls',
  'createMCPInstall',
  'updateMCPInstall',
  'deleteMCPInstall',
] as const;

export interface DesktopModelProviderView {
  id: string;
  label: string;
  type: 'first_party' | 'custom';
  protocol: ProtocolId;
  baseUrl?: string;
  apiKeyConfigured: boolean;
}

export interface DesktopModelEntryView {
  id: string;
  provider: string;
  model: string;
  label: string;
  capabilities?: string[];
  isDefault: boolean;
}

export interface DesktopProviderProfileView {
  id: string;
  label: string;
  protocol: ProtocolId;
  baseUrl?: string;
  defaultModelId: string;
  defaultModel: string;
  defaultModelLabel: string;
  capabilities?: string[];
}

export interface DesktopModelConfigSnapshot {
  configPath: string;
  defaultProvider: string;
  defaultModelId: string;
  providers: DesktopModelProviderView[];
  models: DesktopModelEntryView[];
  providerProfiles: DesktopProviderProfileView[];
}

export interface DesktopSaveModelConfigInput {
  providerId: string;
  modelId?: string;
  modelName?: string;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
  protocol?: ProtocolId;
}

export interface AvailableModelView {
  modelId: string;
  model: string;
  label: string;
  capabilities?: string[];
}

export interface TestProviderConnectionResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export type DesktopChannelType = 'yunzhijia' | 'discord' | 'feishu' | 'qq' | 'qqbot' | 'weixin' | 'telegram';

export interface DesktopChannelView {
  id: string;
  type: DesktopChannelType;
  name: string;
  webhookUrl?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopChannelInput {
  type: DesktopChannelType;
  name: string;
  webhookUrl?: string;
}

export interface DesktopMCPInstallView {
  id: string;
  name: string;
  source: 'npm' | 'github' | 'local';
  command: string;
  args?: string[];
  enabled: boolean;
  createdAt: number;
}

export interface DesktopMCPInput {
  name: string;
  source: 'npm' | 'github' | 'local';
  command: string;
  args?: string[];
}

export interface DesktopApi {
  getModelConfig(): Promise<DesktopModelConfigSnapshot>;
  saveModelConfig(input: DesktopSaveModelConfigInput): Promise<DesktopModelConfigSnapshot>;
  testProviderConnection(input: { providerId: string; modelId?: string }): Promise<TestProviderConnectionResult>;
  listAvailableModelsForProvider(providerId: string): Promise<AvailableModelView[]>;
  deleteProvider(providerId: string): Promise<void>;
  deleteModel(modelId: string): Promise<void>;
  selectMaterials(): Promise<{ filePaths: string[] }>;
  importMaterial(input: { taskId: string; filePath: string; role: MaterialRole }): Promise<MaterialView>;
  createTask(input: {
    prompt: string;
    materials: Array<{ materialId: string; role?: MaterialRole }>;
  }): Promise<{ taskId: string; understanding: TaskUnderstanding }>;
  createTaskWithFiles(input: {
    prompt: string;
    filePaths: string[];
  }): Promise<{ taskId: string; understanding?: TaskUnderstanding }>;
  subscribeTask(taskId: string, handler: (event: DesktopTaskEvent) => void): () => void;
  answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  getActiveTask(): Promise<{ taskId: string } | null>;
  recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }>;
  openArtifact(artifactId: string): Promise<void>;
  listSkills(): Promise<Array<{ name: string; aliases: string[]; description: string; source: string; tier: string }>>;
  listChannels(): Promise<DesktopChannelView[]>;
  createChannel(input: DesktopChannelInput): Promise<DesktopChannelView>;
  updateChannel(id: string, input: Partial<DesktopChannelInput>): Promise<DesktopChannelView>;
  deleteChannel(id: string): Promise<void>;
  listMCPInstalls(): Promise<DesktopMCPInstallView[]>;
  createMCPInstall(input: DesktopMCPInput): Promise<DesktopMCPInstallView>;
  updateMCPInstall(id: string, input: Partial<DesktopMCPInput>): Promise<DesktopMCPInstallView>;
  deleteMCPInstall(id: string): Promise<void>;
}

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export function createPreloadApi(ipcRenderer: IpcRendererLike): DesktopApi {
  return {
    getModelConfig: () => ipcRenderer.invoke('desktop:getModelConfig') as ReturnType<DesktopApi['getModelConfig']>,
    saveModelConfig: (input) => ipcRenderer.invoke('desktop:saveModelConfig', input) as ReturnType<DesktopApi['saveModelConfig']>,
    testProviderConnection: (input) => ipcRenderer.invoke('desktop:testProviderConnection', input) as ReturnType<DesktopApi['testProviderConnection']>,
    listAvailableModelsForProvider: (providerId) => ipcRenderer.invoke('desktop:listAvailableModelsForProvider', providerId) as ReturnType<DesktopApi['listAvailableModelsForProvider']>,
    deleteProvider: (providerId) => ipcRenderer.invoke('desktop:deleteProvider', providerId) as Promise<void>,
    deleteModel: (modelId) => ipcRenderer.invoke('desktop:deleteModel', modelId) as Promise<void>,
    selectMaterials: () => ipcRenderer.invoke('desktop:selectMaterials') as ReturnType<DesktopApi['selectMaterials']>,
    importMaterial: (input) => ipcRenderer.invoke('desktop:importMaterial', input) as ReturnType<DesktopApi['importMaterial']>,
    createTask: (input) => ipcRenderer.invoke('desktop:createTask', input) as ReturnType<DesktopApi['createTask']>,
    createTaskWithFiles: (input) => ipcRenderer.invoke('desktop:createTaskWithFiles', input) as ReturnType<DesktopApi['createTaskWithFiles']>,
    subscribeTask(taskId, handler) {
      const channel = `desktop:taskEvent:${taskId}`;
      const listener = (_event: unknown, payload: unknown) => {
        handler(payload as DesktopTaskEvent);
      };
      ipcRenderer.on(channel, listener);
      void ipcRenderer.invoke('desktop:subscribeTask', { taskId });
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    answerQuestion: (input) => ipcRenderer.invoke('desktop:answerQuestion', input) as Promise<void>,
    cancelTask: (taskId) => ipcRenderer.invoke('desktop:cancelTask', { taskId }) as Promise<void>,
    getActiveTask: () => ipcRenderer.invoke('desktop:getActiveTask') as ReturnType<DesktopApi['getActiveTask']>,
    recoverTask: (taskId) => ipcRenderer.invoke('desktop:recoverTask', { taskId }) as ReturnType<DesktopApi['recoverTask']>,
    openArtifact: (artifactId) => ipcRenderer.invoke('desktop:openArtifact', { artifactId }) as Promise<void>,
    listSkills: () => ipcRenderer.invoke('desktop:listSkills') as ReturnType<DesktopApi['listSkills']>,
    listChannels: () => ipcRenderer.invoke('desktop:listChannels') as Promise<DesktopChannelView[]>,
    createChannel: (input) => ipcRenderer.invoke('desktop:createChannel', input) as Promise<DesktopChannelView>,
    updateChannel: (id, input) => ipcRenderer.invoke('desktop:updateChannel', id, input) as Promise<DesktopChannelView>,
    deleteChannel: (id) => ipcRenderer.invoke('desktop:deleteChannel', id) as Promise<void>,
    listMCPInstalls: () => ipcRenderer.invoke('desktop:listMCPInstalls') as Promise<DesktopMCPInstallView[]>,
    createMCPInstall: (input) => ipcRenderer.invoke('desktop:createMCPInstall', input) as Promise<DesktopMCPInstallView>,
    updateMCPInstall: (id, input) => ipcRenderer.invoke('desktop:updateMCPInstall', id, input) as Promise<DesktopMCPInstallView>,
    deleteMCPInstall: (id) => ipcRenderer.invoke('desktop:deleteMCPInstall', id) as Promise<void>,
  };
}

export type { IpcRenderer };
