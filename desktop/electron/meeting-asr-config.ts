import type { Config } from '../../src/types.js';

export type MeetingAsrProviderId = 'sherpa-onnx-paraformer' | 'whisper' | 'volcengine-asr' | 'aliyun-asr';

export interface MeetingAsrProviderStatus {
  configured: boolean;
  appKeyConfigured: boolean;
  endpoint?: string;
}

export interface MeetingVolcengineAsrStatus extends MeetingAsrProviderStatus {
  accessKeyConfigured: boolean;
  resourceId: string;
}

export interface MeetingAliyunAsrStatus {
  configured: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
}

export interface MeetingAsrConfigSnapshot {
  defaultProvider: MeetingAsrProviderId;
  volcengine: MeetingVolcengineAsrStatus;
  aliyun: MeetingAliyunAsrStatus;
}

export interface MeetingSaveAsrConfigInput {
  defaultProvider?: MeetingAsrProviderId;
  volcengine?: {
    appKey?: string;
    accessKey?: string;
    endpoint?: string;
    resourceId?: string;
    clearAppKey?: boolean;
    clearAccessKey?: boolean;
  };
  aliyun?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    clearApiKey?: boolean;
  };
}

export interface MeetingVolcengineAsrCredentials {
  appKey: string;
  accessKey?: string;
  endpoint: string;
  resourceId: string;
}

export interface MeetingAliyunAsrCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_PROVIDER: MeetingAsrProviderId = 'sherpa-onnx-paraformer';
const PROVIDERS = new Set<MeetingAsrProviderId>(['sherpa-onnx-paraformer', 'whisper', 'volcengine-asr', 'aliyun-asr']);
const LEGACY_VOLCENGINE_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const LEGACY_VOLCENGINE_RESOURCE_ID = 'volc.bigasr.auc_turbo';
const DEFAULT_VOLCENGINE_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const DEFAULT_VOLCENGINE_RESOURCE_ID = 'volc.seedasr.sauc.duration';
const DEFAULT_ALIYUN_BASE_URL = 'https://dashscope.aliyuncs.com';
const DEFAULT_ALIYUN_MODEL = 'fun-asr';

export function createMeetingAsrConfigSnapshot(config: Config): MeetingAsrConfigSnapshot {
  const asr = config.meeting?.asr;
  const defaultProvider = asr?.defaultProvider && PROVIDERS.has(asr.defaultProvider)
    ? asr.defaultProvider
    : DEFAULT_PROVIDER;
  const volcengine = asr?.volcengine ?? {};
  const aliyun = asr?.aliyun ?? {};
  const volcAppKeyConfigured = Boolean(volcengine.appKey?.trim());
  const volcAccessKeyConfigured = Boolean(volcengine.accessKey?.trim());
  const aliyunApiKeyConfigured = Boolean((aliyun.apiKey ?? aliyun.appKey)?.trim());

  return {
    defaultProvider,
    volcengine: {
      configured: volcAppKeyConfigured,
      appKeyConfigured: volcAppKeyConfigured,
      accessKeyConfigured: volcAccessKeyConfigured,
      endpoint: normalizeVolcengineEndpoint(volcengine.endpoint),
      resourceId: normalizeVolcengineResourceId(volcengine.resourceId),
    },
    aliyun: {
      configured: aliyunApiKeyConfigured,
      apiKeyConfigured: aliyunApiKeyConfigured,
      baseUrl: normalizeEndpoint(aliyun.baseUrl ?? aliyun.endpoint) || DEFAULT_ALIYUN_BASE_URL,
      model: normalizeOptionalString(aliyun.model) || DEFAULT_ALIYUN_MODEL,
    },
  };
}

export function applyMeetingAsrConfigUpdate(config: Config, input: MeetingSaveAsrConfigInput): Config {
  config.meeting = {
    ...(config.meeting ?? {}),
    asr: {
      ...(config.meeting?.asr ?? {}),
    },
  };
  const asr = config.meeting.asr!;
  if (input.defaultProvider && PROVIDERS.has(input.defaultProvider)) {
    asr.defaultProvider = input.defaultProvider;
  }

  if (input.volcengine) {
    asr.volcengine = { ...(asr.volcengine ?? {}) };
    applySecretField(asr.volcengine, 'appKey', input.volcengine.appKey, input.volcengine.clearAppKey);
    applySecretField(asr.volcengine, 'accessKey', input.volcengine.accessKey, input.volcengine.clearAccessKey);
    applyPlainField(asr.volcengine, 'endpoint', input.volcengine.endpoint);
    applyPlainField(asr.volcengine, 'resourceId', input.volcengine.resourceId);
  }

  if (input.aliyun) {
    asr.aliyun = { ...(asr.aliyun ?? {}) };
    applySecretField(asr.aliyun, 'apiKey', input.aliyun.apiKey, input.aliyun.clearApiKey);
    applyPlainField(asr.aliyun, 'baseUrl', input.aliyun.baseUrl === undefined ? undefined : normalizeEndpoint(input.aliyun.baseUrl));
    applyPlainField(asr.aliyun, 'model', input.aliyun.model);
  }

  return config;
}

export function resolveMeetingVolcengineAsrCredentials(config: Config): MeetingVolcengineAsrCredentials {
  const provider = config.meeting?.asr?.volcengine;
  const appKey = normalizeOptionalString(provider?.appKey);
  if (!appKey) throw new Error('volcengine_asr_not_configured');
  return {
    appKey,
    accessKey: normalizeOptionalString(provider?.accessKey),
    endpoint: normalizeVolcengineEndpoint(provider?.endpoint),
    resourceId: normalizeVolcengineResourceId(provider?.resourceId),
  };
}

export function resolveMeetingAliyunAsrCredentials(config: Config): MeetingAliyunAsrCredentials {
  const provider = config.meeting?.asr?.aliyun;
  const apiKey = normalizeOptionalString(provider?.apiKey ?? provider?.appKey);
  if (!apiKey) throw new Error('aliyun_asr_not_configured');
  return {
    apiKey,
    baseUrl: normalizeEndpoint(provider?.baseUrl ?? provider?.endpoint) || DEFAULT_ALIYUN_BASE_URL,
    model: normalizeOptionalString(provider?.model) || DEFAULT_ALIYUN_MODEL,
  };
}

function applySecretField<T extends Record<string, unknown>>(target: T, key: keyof T & string, value?: string, clear?: boolean): void {
  if (clear) {
    delete target[key];
    return;
  }
  const normalized = normalizeOptionalString(value);
  if (normalized) {
    target[key] = normalized as T[keyof T & string];
  }
}

function applyPlainField<T extends Record<string, unknown>>(target: T, key: keyof T & string, value?: string): void {
  if (value === undefined) return;
  const normalized = normalizeOptionalString(value);
  if (normalized) {
    target[key] = normalized as T[keyof T & string];
  } else {
    delete target[key];
  }
}

function normalizeEndpoint(value?: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return '';
  return normalized.replace(/\/+$/, '');
}

function normalizeVolcengineEndpoint(value?: string): string {
  const endpoint = normalizeEndpoint(value);
  return !endpoint || endpoint === LEGACY_VOLCENGINE_ENDPOINT ? DEFAULT_VOLCENGINE_ENDPOINT : endpoint;
}

function normalizeVolcengineResourceId(value?: string): string {
  const resourceId = normalizeOptionalString(value);
  return !resourceId || resourceId === LEGACY_VOLCENGINE_RESOURCE_ID ? DEFAULT_VOLCENGINE_RESOURCE_ID : resourceId;
}

function normalizeOptionalString(value?: string): string {
  return typeof value === 'string' ? value.trim() : '';
}
