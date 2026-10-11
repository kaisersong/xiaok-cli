import type { Config } from '../../src/types.js';
import type { MemoryStore } from '../../src/ai/memory/store.js';

type BuildLlm = (config: Config, modelId?: string) => Promise<(prompt: string) => Promise<string>>;

/** Resolve at call time so changing the main model does not require restarting Desktop. */
export function createDesktopMemoryLlm(
  readConfig: () => Promise<Config> = async () => (await import('../../src/utils/config.js')).loadConfig(),
  build: BuildLlm = async (config, modelId) => {
    const { resolveRuntimeModelBinding } = await import('../../src/ai/providers/control-plane.js');
    const { createAdapterFromBinding } = await import('../../src/ai/models.js');
    const { createLLMFromAdapter } = await import('../../src/ai/memory/layered-store.js');
    return createLLMFromAdapter(createAdapterFromBinding(resolveRuntimeModelBinding(config, modelId)));
  },
): (prompt: string) => Promise<string> {
  return async prompt => {
    const config = await readConfig();
    const requested = config.memory?.modelId;
    const modelId = requested && config.models[requested] ? requested : undefined;
    return (await build(config, modelId))(prompt);
  };
}

export function registerMemoryDistillationIpc<Event>(
  registrar: { handle(channel: string, handler: (event: Event, ...args: unknown[]) => Promise<unknown>): unknown },
  store: Pick<MemoryStore, 'compact'>,
  isTrusted: (event: Event) => boolean,
): void {
  registrar.handle('desktop:memoryCompact', async (event, ...args) => {
    if (!isTrusted(event)) throw new Error('memory_compaction_forbidden');
    if (args.length) throw new Error('memory_compaction_invalid_request');
    if (!store.compact) throw new Error('memory_backend_unavailable');
    return store.compact({ requestSource: 'user', force: true });
  });
}

export function getActiveMemoryEmbeddingModel(config: Config, registryIds: readonly string[]): string {
  const selected = config.memory?.embedding?.model;
  if (selected) return selected;
  const legacy = config.memory?.modelId;
  return legacy && registryIds.includes(legacy) ? legacy : 'all-MiniLM-L6-v2';
}

/** Embedding selection must never overwrite the separate LLM used for distillation. */
export function selectMemoryEmbeddingModel(config: Config, modelId: string, registryIds: readonly string[]): {
  config: Config; changed: boolean; previousModelId: string;
} {
  if (!registryIds.includes(modelId)) throw new Error('memory_embedding_model_unavailable');
  const previousModelId = getActiveMemoryEmbeddingModel(config, registryIds);
  return {
    previousModelId, changed: previousModelId !== modelId,
    config: { ...config, memory: { ...config.memory, embedding: { ...config.memory?.embedding, model: modelId } } },
  };
}
