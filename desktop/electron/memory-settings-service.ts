import type { Config, MemoryCompactionResult } from '../../src/types.js';
import type { MemoryStore } from '../../src/ai/memory/store.js';
import { isCompactionModel, normalizeMemoryConfiguration, memorySettingsSnapshot } from '../../src/ai/memory/configuration.js';
import { MODEL_REGISTRY, isModelDownloaded, downloadModel, deleteEmbeddingModelFiles } from '../../src/ai/memory/model-registry.js';
import { createDesktopMemoryLlm } from './memory-distillation.js';

type Source = { requestSource: 'user' | 'agent' | 'scheduler'; assertCurrent?: () => void };
type LLM = (prompt: string, signal?: AbortSignal) => Promise<string>;
interface Dependencies {
  load(): Promise<Config>;
  save(config: Config): Promise<void>;
  update?(mutate: (config: Config) => Config): Promise<Config | void>;
  store: MemoryStore;
  createLLM?(config: Config, id: string): LLM;
  isDownloaded?(id: string): boolean;
}
/** Settings serialize through Main; the existing store owns compaction and embedding work. */
export class MemorySettingsService {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: Dependencies) {}
  private authorize(source: Source): void {
    if (source?.requestSource !== 'user') throw new Error('memory_settings_user_only');
    source.assertCurrent?.();
  }
  private async write<T>(source: Source, action: () => Promise<T>): Promise<T> {
    this.authorize(source);
    const pending = this.writes.then(() => { this.authorize(source); return action(); });
    this.writes = pending.then(() => undefined, () => undefined); return pending;
  }
  private async persist(source: Source, mutate: (config: Config) => Config): Promise<Config> {
    const apply = (config: Config) => { this.authorize(source); return mutate(config); };
    if (this.deps.update) { const result = await this.deps.update(apply); return result ?? this.deps.load(); }
    const next = apply(await this.deps.load()); await this.deps.save(next); return next;
  }
  settings(source: Source) {
    return this.write(source, async () => {
      let config = await this.deps.load(); this.authorize(source);
      const memory = normalizeMemoryConfiguration(config);
      if (JSON.stringify(memory) !== JSON.stringify(config.memory)) config = await this.persist(source, current => ({ ...current, memory: normalizeMemoryConfiguration(current) }));
      this.authorize(source); return memorySettingsSnapshot(config);
    });
  }
  setCompactionModel(id: string | null, source: Source): Promise<boolean> {
    return this.write(source, async () => {
      await this.persist(source, config => {
        if ((id !== null && typeof id !== 'string') || !isCompactionModel(config, id ?? config.defaultModelId)) throw new Error('invalid_compaction_model');
        this.deps.store.cancelCompaction?.({requestSource:'user'});
        const memory = normalizeMemoryConfiguration(config);
        memory.compaction = { ...memory.compaction, modelId: id }; memory.legacyModelUnresolved = false;
        return { ...config, memory };
      }); return true;
    });
  }
  setEmbeddingModel(id: string, source: Source): Promise<void> {
    return this.write(source, async () => {
      const model = MODEL_REGISTRY.find(m => m.id === id);
      if (!model) throw new Error('invalid_embedding_model');
      if (!(this.deps.isDownloaded ?? isModelDownloaded)(id)) throw new Error('embedding_model_not_downloaded');
      if (!this.deps.store.configureEmbedding) throw new Error('embedding_backend_unavailable');
      const embedding = { provider: 'local' as const, model: id, dimensions: model.dims };
      let previous: NonNullable<Config['memory']>['embedding'];
      await this.persist(source, config => {
        const memory = normalizeMemoryConfiguration(config); previous = memory.embedding;
        return { ...config, memory: { ...memory, embedding } };
      });
      try {
        this.authorize(source);
        // A matching ID is not evidence of recovery after a failed release.
        await this.deps.store.configureEmbedding({ ...embedding, apiUrl: 'http://localhost:11434/v1' }, {requestSource:'user'});
      } catch (error) {
        let rollbackFailed = false; let rollbackError: unknown;
        try { await this.persist(source, latest => JSON.stringify(latest.memory?.embedding) === JSON.stringify(embedding)
          ? { ...latest, memory: { ...latest.memory, embedding: previous } } : latest); }
        catch (failure) { rollbackFailed = true; rollbackError = failure; }
        if (rollbackFailed) throw new AggregateError([error, rollbackError], 'memory_embedding_rollback_failed', {cause:error});
        throw error;
      }
    });
  }
  downloadEmbeddingModel(id: string, source: Source): Promise<void> {
    return this.write(source, () => downloadModel(id));
  }
  deleteEmbeddingModel(id: string, source: Source): Promise<void> {
    return this.write(source, async () => {
      if (!MODEL_REGISTRY.some(model => model.id === id)) throw new Error('invalid_embedding_model');
      const memory = normalizeMemoryConfiguration(await this.deps.load()); this.authorize(source);
      if ((memory.embedding?.model ?? 'all-MiniLM-L6-v2') === id || this.deps.store.getEmbeddingModelId?.() === id) throw new Error('embedding_model_active');
      await deleteEmbeddingModelFiles(id, {requestSource:'user'});
    });
  }
  cancel(source: Source): boolean {
    this.authorize(source); return this.deps.store.cancelCompaction?.({requestSource:'user'}) ?? false;
  }
  async compact(source: Source, expectedModelId?: string): Promise<MemoryCompactionResult> {
    this.authorize(source);
    if (!this.deps.store.compact || !this.deps.store.setLLMFn) throw new Error('memory_backend_unavailable');
    const build = this.deps.createLLM ? async (config:Config,id?:string) => this.deps.createLLM!(config,id ?? config.defaultModelId) : undefined;
    const currentLLM = createDesktopMemoryLlm(this.deps.load,build);
    this.deps.store.setLLMFn(async (prompt, signal) => { await this.writes; signal?.throwIfAborted(); return currentLLM(prompt, signal); });
    const manualLLM = expectedModelId === undefined ? undefined : createDesktopMemoryLlm(this.deps.load,build,expectedModelId);
    return this.deps.store.compact({requestSource:'user',force:true,...(manualLLM ? {llm:async(prompt:string,signal?:AbortSignal)=>{await this.writes;signal?.throwIfAborted();return manualLLM(prompt,signal)}}:{}),assertCurrent:()=>this.authorize(source),prepare:async signal=>{
      await this.writes; signal.throwIfAborted(); this.authorize(source);
      const config=await this.deps.load(); signal.throwIfAborted(); this.authorize(source);
      const memory=normalizeMemoryConfiguration(config);
      if((expectedModelId !== undefined && (memory.compaction?.modelId ?? config.defaultModelId) !== expectedModelId) || memory.legacyModelUnresolved || !isCompactionModel(config,memory.compaction?.modelId ?? config.defaultModelId)) throw Error('invalid_compaction_model');
    }});
  }
}
