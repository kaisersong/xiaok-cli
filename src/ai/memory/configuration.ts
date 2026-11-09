import type {Config} from '../../types.js';
import {MODEL_REGISTRY} from './model-registry.js';
import {findCatalogModel,listProviderProfiles} from '../providers/registry.js';

export type {MemoryCompactionResult} from '../../types.js';
export interface MemoryCompactionModelChoice {
  id: string;
  label: string;
  eligible: boolean;
  reason: 'missing_model' | 'unsupported_protocol' | 'non_text_model' | 'unknown_capability' | null;
  source: 'provider_catalog' | 'config_declared' | null;
  contextLimit: number | null;
  quality: 'not_evaluated';
}
export interface MemorySettingsSnapshot {
  version: 1;
  embeddingModelId: string;
  compactionModelId: string | null;
  resolvedCompactionModelId: string | null;
  defaultCompactionModel: MemoryCompactionModelChoice;
  compactionModels: MemoryCompactionModelChoice[];
  warning: 'legacy_model_unresolved' | 'invalid_model' | null;
}
export type MemoryConfiguration = NonNullable<Config['memory']> & {
  legacyModelId?: string;
  legacyModelUnresolved?: boolean;
  settingsVersion?: 1;
  compaction?: NonNullable<NonNullable<Config['memory']>['compaction']> & {modelId?: string | null};
};

/** Classification metadata only. This never authorizes a provider, Native IO or a tool. */
export function compactionModelQualification(config: Config,id: string): MemoryCompactionModelChoice {
  const entry = config.models[id];
  const provider = entry && config.providers[entry.provider];
  const profile = provider?.type === 'first_party'
    ? listProviderProfiles().find(value => value.id === entry.provider) : undefined;
  const catalog = profile ? findCatalogModel(profile,id,entry.model) : undefined;
  const limit = entry?.runtimeOptions?.contextLimit ?? catalog?.runtimeOptions?.contextLimit;
  const result: MemoryCompactionModelChoice = {
    id,label: entry?.label ?? id,eligible: false,reason: null,source: null,
    contextLimit: Number.isSafeInteger(limit) && limit! > 0 ? limit! : null,
    quality: 'not_evaluated',
  };
  if (!entry) return {...result,reason: 'missing_model'};
  const caps = (entry.capabilities ?? []).map(value => value.toLowerCase().replace(/[^a-z0-9]/g,''));
  const nonText = new Set(['embedding','embeddings','textembedding','embeddingmodel','rerank','reranker','reranking',
    'classification','classifier','decision','asr','speechtotext','speechrecognition','tts','texttospeech']);
  if (MODEL_REGISTRY.some(model => model.id === id || model.id === entry.model)
    || (entry.purpose !== undefined && entry.purpose !== 'generation')
    || (catalog?.purpose && catalog.purpose !== 'generation')
    || caps.some(value => nonText.has(value))
    || /^(?:text-embedding-|embedding-|bge-|all-MiniLM-|clef-|laya-|jev(?:-|$))/i.test(entry.model)) {
    return {...result,reason: 'non_text_model'};
  }
  if (!['anthropic','openai_legacy','openai_responses'].includes(provider?.protocol ?? '')) {
    return {...result,reason: 'unsupported_protocol'};
  }
  const declared = entry.outputModalities;
  if (declared !== undefined) {
    if (!Array.isArray(declared) || declared.some(value => !['text','image','audio'].includes(value))
      || !declared.includes('text')) return {...result,reason: 'non_text_model'};
    return {...result,eligible: true,source: 'config_declared'};
  }
  if (caps.includes('textgeneration')) return {...result,eligible: true,source: 'config_declared'};
  if (caps.some(value => ['imagegeneration','imagegenerator','audiogeneration','audiogenerator'].includes(value))) {
    return {...result,reason: 'non_text_model'};
  }
  if (catalog?.outputModalities?.includes('text')) return {...result,eligible: true,source: 'provider_catalog'};
  return {...result,reason: 'unknown_capability'};
}
export function isCompactionModel(config: Config,id: string): boolean {
  return compactionModelQualification(config,id).eligible;
}

/** Pure migration. A generated null is never evidence that a user selected cloud main. */
export function normalizeMemoryConfiguration(config: Config): MemoryConfiguration {
  const memory: MemoryConfiguration = structuredClone(config.memory ?? {});
  const legacy = memory.modelId;
  if (legacy !== undefined) {
    if (typeof legacy !== 'string') throw new Error('invalid_memory_configuration');
    const explicit = memory.compaction?.modelId !== undefined;
    const embedding = MODEL_REGISTRY.find(model => model.id === legacy);
    if (embedding) {
      memory.embedding = {provider: 'local',...memory.embedding,model: memory.embedding?.model ?? legacy};
      memory.legacyModelId ??= legacy;
      memory.legacyModelUnresolved = memory.legacyModelUnresolved === true || !explicit;
    } else if (isCompactionModel(config,legacy)) {
      if (!explicit) memory.compaction = {...memory.compaction,modelId: legacy};
    } else {
      memory.legacyModelId ??= legacy;
      memory.legacyModelUnresolved = memory.legacyModelUnresolved === true || !explicit;
    }
    delete memory.modelId;
  }
  memory.compaction = {...memory.compaction,modelId: memory.compaction?.modelId ?? null};
  memory.settingsVersion = 1;
  return memory;
}
export function memorySettingsSnapshot(config: Config): MemorySettingsSnapshot {
  const memory = normalizeMemoryConfiguration(config), id = memory.compaction?.modelId ?? null;
  const resolved = id ?? config.defaultModelId;
  const eligible = isCompactionModel(config,resolved);
  return {
    version: 1,embeddingModelId: memory.embedding?.model ?? 'all-MiniLM-L6-v2',
    compactionModelId: id,resolvedCompactionModelId: !memory.legacyModelUnresolved && eligible ? resolved : null,
    defaultCompactionModel: compactionModelQualification(config,config.defaultModelId),
    compactionModels: Object.keys(config.models).map(key => compactionModelQualification(config,key)),
    warning: memory.legacyModelUnresolved ? 'legacy_model_unresolved' : !eligible ? 'invalid_model' : null,
  };
}
